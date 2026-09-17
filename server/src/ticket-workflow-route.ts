import type { Request, Response } from "express";
import type { Prisma, PrismaClient, TicketStatus } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError, type ErrorCode } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import { attachmentSelect } from "./attachment-view.js";
import { serializeTicketDetail, ticketDetailSelect } from "./tickets-route.js";
import { decideStatusChange, isTerminal } from "./ticket-workflow.js";

// The operations that move a ticket through its life (api-spec.md §6).
//
// All four are mounted behind requireRole("IT_STAFF", "ADMINISTRATOR"), so a
// Requester is refused before any of this runs and the refusal cannot disclose
// whether the ticket exists (BR-18).
//
// Every one of them is a read-decide-write inside a single transaction with a
// conditional update on `version` (BR-24). Two IT Staff on one ticket is the
// ordinary case for a shared queue, and without the condition the second save
// silently reverts the first.

type WorkflowTicket = {
  id: number;
  version: number;
  ownerId: number | null;
  currentStatus: TicketStatus;
};

/**
 * What a handler decides to do, once it has seen the ticket.
 *
 * `Unchecked` is the deliberate half of the pair: the write goes through the
 * conditional `updateMany` below, which takes scalar columns only. An owner is
 * therefore set as `ownerId`, never as a nested `owner: { connect }` — that form
 * compiles against TicketUpdateInput and then fails at the database.
 */
type Decision =
  | { write: Prisma.TicketUncheckedUpdateManyInput; event?: { statusChangedTo: TicketStatus; content: string } }
  | { refuse: { status: number; code: ErrorCode; message: string; fieldErrors?: Record<string, string> } };

type Outcome =
  | { kind: "missing" }
  | { kind: "refused"; status: number; code: ErrorCode; message: string; fieldErrors?: Record<string, string> }
  | { kind: "stale" }
  | { kind: "updated"; detail: unknown };

function ticketId(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/** `version` is required on every workflow request (BR-24). */
function requestedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * Read the ticket, ask the caller's `decide` what to do, then write it under the
 * version the client last read.
 *
 * The conditional `updateMany` is what actually enforces BR-24: the pre-read
 * comparison below is a courtesy that produces a good message, but two requests
 * can pass it in the same instant, and only the `where: { id, version }` decides
 * between them.
 */
async function mutate(
  prisma: PrismaClient,
  id: number,
  version: number,
  actorId: number,
  decide: (ticket: WorkflowTicket, tx: Prisma.TransactionClient) => Promise<Decision> | Decision,
): Promise<Outcome> {
  return prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id },
      select: { id: true, version: true, ownerId: true, currentStatus: true },
    });
    if (!ticket) return { kind: "missing" as const };
    if (ticket.version !== version) return { kind: "stale" as const };

    const decision = await decide(ticket, tx);
    if ("refuse" in decision) return { kind: "refused" as const, ...decision.refuse };

    const written = await tx.ticket.updateMany({
      where: { id, version },
      data: { ...decision.write, version: { increment: 1 } },
    });
    if (written.count !== 1) return { kind: "stale" as const };

    // BR-30: the summary or reason is also the Public Comment that tells the
    // Requester why, written in the same transaction so a status change can
    // never exist without its explanation.
    if (decision.event) {
      await tx.publicComment.create({
        data: {
          ticketId: id,
          authorId: actorId,
          content: decision.event.content,
          statusChangedTo: decision.event.statusChangedTo,
        },
      });
    }

    const detail = await tx.ticket.findUniqueOrThrow({ where: { id }, select: ticketDetailSelect });
    const attachments = await tx.attachment.findMany({
      where: { ticketId: id },
      orderBy: { uploadedAt: "asc" },
      select: attachmentSelect,
    });

    return { kind: "updated" as const, detail: serializeTicketDetail(detail, attachments) };
  });
}

/** One place that turns an Outcome into a response, so the codes cannot drift. */
async function respond(res: Response, outcome: Outcome, prisma: PrismaClient, id: number): Promise<void> {
  if (outcome.kind === "missing") {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }
  if (outcome.kind === "refused") {
    sendError(res, outcome.status, outcome.code, outcome.message, outcome.fieldErrors);
    return;
  }
  if (outcome.kind === "stale") {
    // api-spec.md §6: the body carries the current ticket, so the client can
    // show what changed instead of asking the user to go and look.
    const detail = await prisma.ticket.findUnique({ where: { id }, select: ticketDetailSelect });
    const attachments = detail
      ? await prisma.attachment.findMany({ where: { ticketId: id }, orderBy: { uploadedAt: "asc" }, select: attachmentSelect })
      : [];
    res.status(409).json({
      error: {
        code: "TICKET_VERSION_CONFLICT",
        message: "This Ticket changed while you were working on it. Reload it and try again.",
        ...(detail ? { ticket: serializeTicketDetail(detail, attachments) } : {}),
      },
    });
    return;
  }
  res.status(200).json(outcome.detail);
}

/** An owner must be an active IT Staff or Administrator at the moment of assignment (BR-21). */
async function eligibleOwner(tx: Prisma.TransactionClient, ownerId: number): Promise<boolean> {
  const user = await tx.user.findFirst({
    where: { id: ownerId, isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
    select: { id: true },
  });
  return user !== null;
}

export async function claimTicket(req: Request, res: Response): Promise<void> {
  const actor = currentUser(res);
  const id = ticketId(req.params.ticketId);
  const version = requestedVersion((req.body ?? {}).version);
  if (!id) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }
  if (version === null) {
    sendError(res, 400, "VALIDATION_FAILED", "The Ticket could not be claimed.", {
      version: "Send the version you last read.",
    });
    return;
  }

  const prisma = getPrisma();
  try {
    const outcome = await mutate(prisma, id, version, actor.id, (ticket) => {
      if (isTerminal(ticket.currentStatus)) {
        return { refuse: { status: 409, code: "TICKET_TERMINAL", message: "This Ticket is closed and can no longer change." } };
      }
      // BR-22: claim takes an unassigned ticket only. Someone else having taken
      // it is a different answer from a stale version, and says so.
      if (ticket.ownerId !== null) {
        return { refuse: { status: 409, code: "TICKET_ALREADY_ASSIGNED", message: "Another person already owns this Ticket." } };
      }
      return { write: { ownerId: actor.id } };
    });
    await respond(res, outcome, prisma, id);
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/tickets/:id/claim", error);
  }
}

export async function setTicketOwner(req: Request, res: Response): Promise<void> {
  const actor = currentUser(res);
  const id = ticketId(req.params.ticketId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const version = requestedVersion(body.version);
  const ownerId = body.ownerId;

  if (!id) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  const fieldErrors: Record<string, string> = {};
  if (version === null) fieldErrors.version = "Send the version you last read.";
  const ownerIsNull = ownerId === null;
  const ownerIsId = typeof ownerId === "number" && Number.isSafeInteger(ownerId) && ownerId > 0;
  if (!ownerIsNull && !ownerIsId) fieldErrors.ownerId = "Choose an active IT Staff member or Administrator, or null.";
  if (Object.keys(fieldErrors).length > 0) {
    sendError(res, 400, "VALIDATION_FAILED", "The owner could not be changed.", fieldErrors);
    return;
  }

  const prisma = getPrisma();
  try {
    const outcome = await mutate(prisma, id, version!, actor.id, async (ticket, tx) => {
      if (isTerminal(ticket.currentStatus)) {
        return { refuse: { status: 409, code: "TICKET_TERMINAL", message: "This Ticket is closed and can no longer change." } };
      }
      if (ownerIsId && !(await eligibleOwner(tx, ownerId as number))) {
        // A 400 on the field, not a 404: the caller supplied a value this route
        // rejects, and saying so names the control that needs fixing (BR-21).
        return {
          refuse: {
            status: 400,
            code: "VALIDATION_FAILED",
            message: "The owner could not be changed.",
            fieldErrors: { ownerId: "That person is not an active IT Staff member or Administrator." },
          },
        };
      }
      return { write: { ownerId: ownerIsNull ? null : (ownerId as number) } };
    });
    await respond(res, outcome, prisma, id);
  } catch (error) {
    sendDependencyUnavailable(res, "PATCH /api/tickets/:id/owner", error);
  }
}

export async function setItPriority(req: Request, res: Response): Promise<void> {
  const actor = currentUser(res);
  const id = ticketId(req.params.ticketId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const version = requestedVersion(body.version);
  const itPriority = body.itPriority;
  const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"];

  if (!id) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  const fieldErrors: Record<string, string> = {};
  if (version === null) fieldErrors.version = "Send the version you last read.";
  if (typeof itPriority !== "string" || !PRIORITIES.includes(itPriority)) {
    fieldErrors.itPriority = `Choose one of: ${PRIORITIES.join(", ")}.`;
  }
  if (Object.keys(fieldErrors).length > 0) {
    sendError(res, 400, "VALIDATION_FAILED", "IT Priority could not be changed.", fieldErrors);
    return;
  }

  const prisma = getPrisma();
  try {
    const outcome = await mutate(prisma, id, version!, actor.id, (ticket) => {
      if (isTerminal(ticket.currentStatus)) {
        return { refuse: { status: 409, code: "TICKET_TERMINAL", message: "This Ticket is closed and can no longer change." } };
      }
      // BR-23: only IT Priority moves. Requested Priority is what the Requester
      // asked for and is never rewritten.
      return { write: { itPriority: itPriority as "LOW" | "MEDIUM" | "HIGH" | "URGENT" } };
    });
    await respond(res, outcome, prisma, id);
  } catch (error) {
    sendDependencyUnavailable(res, "PATCH /api/tickets/:id/it-priority", error);
  }
}

export async function changeTicketStatus(req: Request, res: Response): Promise<void> {
  const actor = currentUser(res);
  const id = ticketId(req.params.ticketId);
  const body = (req.body ?? {}) as Record<string, unknown>;
  const version = requestedVersion(body.version);

  if (!id) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }
  if (version === null) {
    sendError(res, 400, "VALIDATION_FAILED", "The status could not be changed.", {
      version: "Send the version you last read.",
    });
    return;
  }

  const prisma = getPrisma();
  try {
    const outcome = await mutate(prisma, id, version, actor.id, (ticket) => {
      const decision = decideStatusChange({
        from: ticket.currentStatus,
        to: body.toStatus,
        ownerId: ticket.ownerId,
        resolutionSummary: body.resolutionSummary,
        reason: body.reason,
      });

      if (decision.kind === "validation") {
        return {
          refuse: {
            status: 400,
            code: "VALIDATION_FAILED",
            message: "The status could not be changed.",
            fieldErrors: decision.fieldErrors,
          },
        };
      }
      if (decision.kind === "conflict") {
        return { refuse: { status: 409, code: decision.code, message: decision.message } };
      }

      const to = body.toStatus as TicketStatus;
      const write: Prisma.TicketUncheckedUpdateManyInput = { currentStatus: to };

      if (to === "RESOLVED") write.resolutionSummary = decision.evidence;
      // BR-30: reopening clears the stored resolution and the Requester's
      // indication, so the reopened ticket does not still claim to be fixed.
      if (to === "REOPENED") {
        write.resolutionSummary = null;
        write.requesterResolvedAt = null;
      }

      return {
        write,
        ...(decision.evidence ? { event: { statusChangedTo: to, content: decision.evidence } } : {}),
      };
    });
    await respond(res, outcome, prisma, id);
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/tickets/:id/status", error);
  }
}
