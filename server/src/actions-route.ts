import type { Request, Response } from "express";
import type { Prisma, TicketStatus } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import {
  actionWriteRefusal,
  isFinal,
  parseCancel,
  parseComplete,
  parseCreate,
  parseEdit,
  requestFingerprint,
  type StoredAction,
} from "./action-rules.js";

// Actions Taken (docs/lab-04/api-spec.md §2). The rules live in action-rules.ts;
// this file owns the transaction.
//
// Every write locks the Ticket row first and decides under that lock (BR-14).
// Reading the Ticket's status and writing afterwards is a check-then-write: a
// status change landing in the gap would put work on a frozen Ticket, or let
// the resolution gate pass on Actions that are about to change. That is the
// race Earth2509 found in our Lab 3 comments (PR #66), and it is locked here from
// the start rather than after a review.
//
// Order of answers (api-spec.md §1): role (on the route) → 404 → key and replay
// (create only) → 400 → 409s in the order TICKET_TERMINAL, ACTION_NOT_ALLOWED,
// ACTION_FINAL, ACTION_VERSION_CONFLICT.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const personSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect;

export const actionSelect = {
  id: true,
  ticketId: true,
  status: true,
  actionAt: true,
  description: true,
  result: true,
  followUpRequired: true,
  followUpNote: true,
  attachmentNotes: true,
  assignee: { select: personSelect },
  performedBy: { select: personSelect },
  completedAt: true,
  cancelledBy: { select: personSelect },
  cancelledAt: true,
  cancellationReason: true,
  createdBy: { select: personSelect },
  createdAt: true,
  updatedAt: true,
  version: true,
} satisfies Prisma.ActionTakenSelect;

type LockedTicket = { id: number; currentStatus: TicketStatus; requesterId: number; createdAt: Date };

function idOf(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function ticketNotFound(res: Response): void {
  sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
}

function actionNotFound(res: Response): void {
  sendError(res, 404, "ACTION_NOT_FOUND", "That action could not be found on this Ticket.");
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

/**
 * The Ticket row, locked for the life of the transaction. Writes are staff-only
 * (the route refused anyone else at step 4), so no ownership predicate is
 * needed here; a missing row is simply 404.
 */
async function lockTicket(tx: Prisma.TransactionClient, id: number): Promise<LockedTicket | null> {
  const rows = await tx.$queryRaw<LockedTicket[]>`
    SELECT "id", "currentStatus", "requesterId", "createdAt" FROM "Ticket" WHERE "id" = ${id} FOR UPDATE
  `;
  return rows[0] ?? null;
}

/** BR-06: an active IT Staff or Administrator user, checked inside the transaction. */
async function isEligibleAssignee(tx: Prisma.TransactionClient, userId: number): Promise<boolean> {
  const user = await tx.user.findFirst({
    where: { id: userId, isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
    select: { id: true },
  });
  return user !== null;
}

const INELIGIBLE = "Choose an active IT Staff member or Administrator.";

/** Recording work moves the Ticket's Last Updated, never its version (BR-13, D-11). */
async function touchTicket(tx: Prisma.TransactionClient, ticketId: number): Promise<void> {
  await tx.ticket.update({ where: { id: ticketId }, data: { updatedAt: new Date() } });
}

type Refusal = { kind: "refused"; status: number; code: Parameters<typeof sendError>[2]; message: string; action?: unknown };

function refusal(code: "TICKET_TERMINAL" | "ACTION_NOT_ALLOWED"): Refusal {
  return code === "TICKET_TERMINAL"
    ? { kind: "refused", status: 409, code, message: "This Ticket is closed and its actions can no longer change." }
    : { kind: "refused", status: 409, code, message: "This Ticket is resolved. Reopen the ticket to record more work." };
}

function sendRefusal(res: Response, outcome: Refusal): void {
  if (outcome.action !== undefined) {
    res.status(outcome.status).json({ error: { code: outcome.code, message: outcome.message, action: outcome.action } });
    return;
  }
  sendError(res, outcome.status, outcome.code, outcome.message);
}

// --- GET /api/tickets/:ticketId/actions ------------------------------------------------

export async function listActions(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const ticketId = idOf(req.params.ticketId);
  if (ticketId === null) return ticketNotFound(res);

  const prisma = getPrisma();
  try {
    // The same ownership predicate as Ticket Detail: another Requester's Ticket
    // is never read, so the refusal equals a missing Ticket (BR-16, Lab 3 BR-19).
    const ticket = await prisma.ticket.findFirst({
      where: user.role === "REQUESTER" ? { id: ticketId, requesterId: user.id } : { id: ticketId },
      select: { id: true },
    });
    if (!ticket) return ticketNotFound(res);

    // BR-11: newest first by Action Date/Time, id as the tie-breaker, not paginated.
    const items = await prisma.actionTaken.findMany({
      where: { ticketId },
      orderBy: [{ actionAt: "desc" }, { id: "desc" }],
      select: actionSelect,
    });
    res.status(200).json({ items });
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:ticketId/actions", error);
  }
}

// --- POST /api/tickets/:ticketId/actions -------------------------------------------------

export async function createAction(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const ticketId = idOf(req.params.ticketId);
  if (ticketId === null) return ticketNotFound(res);
  const idempotencyKey = req.header("idempotency-key")?.trim() ?? "";
  const prisma = getPrisma();

  // BR-15: a retry is the same request if it parses to the same fingerprint.
  // A body that no longer parses cannot be the request that succeeded.
  const replay = (existing: { requestFingerprint: string | null; ticketCreatedAt: Date }, now: Date) => {
    const parsed = parseCreate(req.body, { createdAt: existing.ticketCreatedAt }, now);
    return parsed.kind === "ok" && existing.requestFingerprint === requestFingerprint(ticketId, user.id, parsed.value);
  };

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const ticket = await lockTicket(tx, ticketId);
      if (!ticket) return { kind: "missing" as const };

      // Step 5a: the key, then a replay, before validation and before state. A
      // retry of a create that already succeeded is a question about the past,
      // so it is answered even if the Ticket has been resolved since.
      if (!UUID.test(idempotencyKey)) return { kind: "noKey" as const };
      const now = new Date();
      const existing = await tx.actionTaken.findUnique({
        where: { idempotencyKey },
        select: { ...actionSelect, requestFingerprint: true },
      });
      if (existing) {
        const { requestFingerprint: fingerprint, ...action } = existing;
        return replay({ requestFingerprint: fingerprint, ticketCreatedAt: ticket.createdAt }, now)
          ? { kind: "replayed" as const, action }
          : { kind: "keyConflict" as const };
      }

      const parsed = parseCreate(req.body, ticket, now);
      const fieldErrors = parsed.kind === "invalid" ? { ...parsed.fieldErrors } : {};
      if (parsed.kind === "ok" && !(await isEligibleAssignee(tx, parsed.value.assigneeId))) {
        fieldErrors.assigneeId = INELIGIBLE;
      }
      if (parsed.kind === "invalid" || Object.keys(fieldErrors).length > 0) {
        return { kind: "invalid" as const, fieldErrors };
      }

      const refused = actionWriteRefusal(ticket.currentStatus);
      if (refused) return refusal(refused);

      const input = parsed.value;
      const action = await tx.actionTaken.create({
        data: {
          ticketId,
          status: input.status,
          actionAt: input.actionAt,
          description: input.description,
          result: input.result,
          followUpRequired: input.followUpRequired,
          followUpNote: input.followUpNote,
          attachmentNotes: input.attachmentNotes,
          assigneeId: input.assigneeId,
          createdById: user.id,
          // BR-05: an Action created completed was performed by its recorder, now.
          ...(input.status === "COMPLETED" ? { performedById: user.id, completedAt: now } : {}),
          idempotencyKey,
          requestFingerprint: requestFingerprint(ticketId, user.id, input),
        },
        select: actionSelect,
      });
      await touchTicket(tx, ticketId);
      return { kind: "created" as const, action };
    });

    switch (outcome.kind) {
      case "missing":
        return ticketNotFound(res);
      case "noKey":
        return sendError(res, 400, "IDEMPOTENCY_KEY_REQUIRED", "An Idempotency-Key header containing a UUID is required.");
      case "keyConflict":
        return sendError(res, 409, "IDEMPOTENCY_KEY_CONFLICT", "That Idempotency-Key has already been used for a different action.");
      case "invalid":
        return sendError(res, 400, "VALIDATION_FAILED", "The action could not be saved.", outcome.fieldErrors);
      case "refused":
        return sendRefusal(res, outcome);
      case "replayed":
        res.status(200).json(outcome.action);
        return;
      case "created":
        res.status(201).json(outcome.action);
        return;
    }
  } catch (error) {
    // Two requests with one key on DIFFERENT Tickets do not share a row lock,
    // so both can pass the replay check; the unique index decides. The loser
    // re-reads the winner and answers as a replay would. (On one Ticket the lock
    // already serialises them, and the second finds the first.)
    if (isUniqueViolation(error) && UUID.test(idempotencyKey)) {
      try {
        const winner = await prisma.actionTaken.findUnique({
          where: { idempotencyKey },
          select: { ...actionSelect, requestFingerprint: true, ticket: { select: { createdAt: true } } },
        });
        if (winner) {
          const { requestFingerprint: fingerprint, ticket, ...action } = winner;
          if (replay({ requestFingerprint: fingerprint, ticketCreatedAt: ticket.createdAt }, new Date())) {
            res.status(200).json(action);
          } else {
            sendError(res, 409, "IDEMPOTENCY_KEY_CONFLICT", "That Idempotency-Key has already been used for a different action.");
          }
          return;
        }
      } catch {
        // Fall through to the generic failure.
      }
    }
    sendDependencyUnavailable(res, "POST /api/tickets/:ticketId/actions", error);
  }
}

// --- the three changes to an existing Action ---------------------------------------------

type Loaded = { ticket: LockedTicket; stored: StoredAction & { status: string; version: number } };

/**
 * Shared shape of edit, complete and cancel: lock the Ticket, find the Action on
 * THIS Ticket, validate, then refuse on state in the §1 order, then write with
 * the version in the WHERE. The lock already serialises writers on one Ticket;
 * the conditional write is the rule's own statement, and it stays correct even
 * if a future path forgets the lock.
 */
async function changeAction(
  req: Request,
  res: Response,
  route: string,
  decide: (loaded: Loaded, now: Date, tx: Prisma.TransactionClient) => Promise<
    { kind: "invalid"; fieldErrors: Record<string, string> } | { kind: "write"; version: number; data: Prisma.ActionTakenUncheckedUpdateManyInput }
  >,
): Promise<void> {
  const ticketId = idOf(req.params.ticketId);
  const actionId = idOf(req.params.actionId);
  if (ticketId === null) return ticketNotFound(res);

  const prisma = getPrisma();
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      const ticket = await lockTicket(tx, ticketId);
      if (!ticket) return { kind: "missingTicket" as const };
      if (actionId === null) return { kind: "missingAction" as const };
      const stored = await tx.actionTaken.findFirst({
        where: { id: actionId, ticketId },
        select: { status: true, version: true, actionAt: true, followUpRequired: true, followUpNote: true, assigneeId: true },
      });
      if (!stored) return { kind: "missingAction" as const };

      const now = new Date();
      const decision = await decide({ ticket, stored }, now, tx);
      if (decision.kind === "invalid") return decision;

      const refused = actionWriteRefusal(ticket.currentStatus);
      if (refused) return refusal(refused);
      if (isFinal(stored.status as never)) {
        return { kind: "refused", status: 409, code: "ACTION_FINAL", message: "This action is final. Record a new action to correct it." } satisfies Refusal;
      }

      const written = await tx.actionTaken.updateMany({
        where: { id: actionId, ticketId, version: decision.version, status: "OPEN" },
        data: { ...decision.data, version: { increment: 1 } },
      });
      if (written.count !== 1) {
        const current = await tx.actionTaken.findUnique({ where: { id: actionId }, select: actionSelect });
        return {
          kind: "refused",
          status: 409,
          code: "ACTION_VERSION_CONFLICT",
          message: "Someone else changed this action. Reload to see the latest version.",
          action: current,
        } satisfies Refusal;
      }
      await touchTicket(tx, ticketId);
      const action = await tx.actionTaken.findUniqueOrThrow({ where: { id: actionId }, select: actionSelect });
      return { kind: "updated" as const, action };
    });

    switch (outcome.kind) {
      case "missingTicket":
        return ticketNotFound(res);
      case "missingAction":
        return actionNotFound(res);
      case "invalid":
        return sendError(res, 400, "VALIDATION_FAILED", "The action could not be saved.", outcome.fieldErrors);
      case "refused":
        return sendRefusal(res, outcome);
      case "updated":
        res.status(200).json(outcome.action);
        return;
    }
  } catch (error) {
    sendDependencyUnavailable(res, route, error);
  }
}

/** PATCH /api/tickets/:ticketId/actions/:actionId — edit an open Action (BR-08). */
export async function editAction(req: Request, res: Response): Promise<void> {
  await changeAction(req, res, "PATCH /api/tickets/:ticketId/actions/:actionId", async ({ ticket, stored }, now, tx) => {
    const parsed = parseEdit(req.body, stored, ticket, now);
    const fieldErrors = parsed.kind === "invalid" ? { ...parsed.fieldErrors } : {};
    const assigneeId = parsed.kind === "ok" ? parsed.value.assigneeId : undefined;
    // BR-06: only an assignee being set now is checked. One set earlier stays
    // valid until BR-17 clears it, and that is handled by the deactivation.
    if (assigneeId !== undefined && assigneeId !== stored.assigneeId && !(await isEligibleAssignee(tx, assigneeId))) {
      fieldErrors.assigneeId = INELIGIBLE;
    }
    if (parsed.kind === "invalid" || Object.keys(fieldErrors).length > 0) return { kind: "invalid", fieldErrors };
    const { version, ...changes } = parsed.value;
    return { kind: "write", version, data: changes };
  });
}

/** POST …/complete (BR-04, BR-05). The completer becomes Performed by. */
export async function completeAction(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  await changeAction(req, res, "POST /api/tickets/:ticketId/actions/:actionId/complete", async ({ ticket, stored }, now) => {
    const parsed = parseComplete(req.body, stored, ticket, now);
    if (parsed.kind === "invalid") return parsed;
    const { version, ...changes } = parsed.value;
    return { kind: "write", version, data: { ...changes, status: "COMPLETED", performedById: user.id, completedAt: now } };
  });
}

/** POST …/cancel (BR-04). A cancelled Action has no performer (BR-05). */
export async function cancelAction(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  await changeAction(req, res, "POST /api/tickets/:ticketId/actions/:actionId/cancel", async (_loaded, now) => {
    const parsed = parseCancel(req.body);
    if (parsed.kind === "invalid") return parsed;
    return {
      kind: "write",
      version: parsed.value.version,
      data: { status: "CANCELLED", cancelledById: user.id, cancelledAt: now, cancellationReason: parsed.value.reason },
    };
  });
}
