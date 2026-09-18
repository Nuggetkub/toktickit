import type { Request, Response } from "express";
import type { Prisma, PrismaClient, TicketStatus } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import { attachmentSelect } from "./attachment-view.js";
import { serializeTicketDetail, ticketDetailSelect } from "./tickets-route.js";
import { indicationAllowedFrom, validateContent } from "./discussion.js";
import { isTerminal } from "./ticket-workflow.js";

// Ticket discussion and the Requester's resolution indication (api-spec.md §7).
//
// Internal Notes are mounted behind requireRole, so a Requester never reaches
// this file for them: the refusal happens at step 4, before any lookup, and is
// identical whether or not the ticket exists (BR-35).

const authorSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect;

const commentSelect = {
  id: true,
  ticketId: true,
  content: true,
  statusChangedTo: true,
  createdAt: true,
  author: { select: authorSelect },
} satisfies Prisma.PublicCommentSelect;

const noteSelect = {
  id: true,
  ticketId: true,
  content: true,
  createdAt: true,
  author: { select: authorSelect },
} satisfies Prisma.InternalNoteSelect;

function ticketIdOf(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

type Visible = { id: number; currentStatus: Prisma.TicketGetPayload<{ select: { currentStatus: true } }>["currentStatus"] };

/**
 * The ticket this caller is allowed to see, or null.
 *
 * The Requester predicate is the same one `getTicket` uses: ownership is part of
 * the query, so another Requester's ticket is never read and the refusal cannot
 * be told apart from one that does not exist (BR-10, D-04).
 */
async function visibleTicket(prisma: PrismaClient, role: string, userId: number, id: number): Promise<Visible | null> {
  return prisma.ticket.findFirst({
    where: role === "REQUESTER" ? { id, requesterId: userId } : { id },
    select: { id: true, currentStatus: true },
  });
}

function notFound(res: Response): void {
  sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
}

type LockedTicket = { id: number; currentStatus: TicketStatus; requesterId: number };

/**
 * The same ticket `visibleTicket` finds, but locked for the life of the
 * transaction — so the status cannot change between being read and being acted
 * on.
 *
 * Reading the status and writing afterwards is a check-then-write: a concurrent
 * transition to CLOSED lands in the gap and the write reaches a frozen Ticket.
 * Our own attachment upload already locks the row for exactly this reason
 * (attachments-route.ts); the discussion routes did not, which Earth2509 caught
 * reviewing PR #66.
 *
 * The ownership predicate is applied after the lock rather than inside the
 * WHERE, so a Requester and a stranger both wait on the same row and receive the
 * same `404` — the refusal stays indistinguishable from a Ticket that does not
 * exist (BR-10, D-04).
 */
async function lockTicket(
  tx: Prisma.TransactionClient,
  role: string,
  userId: number,
  id: number,
): Promise<LockedTicket | null> {
  const rows = await tx.$queryRaw<LockedTicket[]>`
    SELECT "id", "currentStatus", "requesterId" FROM "Ticket" WHERE "id" = ${id} FOR UPDATE
  `;
  if (rows.length === 0) return null;
  if (role === "REQUESTER" && rows[0].requesterId !== userId) return null;
  return rows[0];
}

export async function listComments(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const id = ticketIdOf(req.params.ticketId);
  if (id === null) {
    notFound(res);
    return;
  }

  const prisma = getPrisma();
  try {
    const ticket = await visibleTicket(prisma, user.role, user.id, id);
    if (!ticket) {
      notFound(res);
      return;
    }

    // Newest first (BR-37). Reading works on a closed ticket — only posting stops.
    //
    // `id` descending is the tie-breaker, and it is not decoration: createdAt has
    // millisecond precision, so two entries posted in the same instant would
    // otherwise come back in whatever order the database felt like, and the
    // thread would appear to shuffle between reloads.
    const comments = await prisma.publicComment.findMany({
      where: { ticketId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: commentSelect,
    });

    res.status(200).json(comments);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:id/comments", error);
  }
}

export async function createComment(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const id = ticketIdOf(req.params.ticketId);
  if (id === null) {
    notFound(res);
    return;
  }

  const prisma = getPrisma();
  try {
    // api-spec.md §1: resource (step 5) before input (step 6) before state
    // (step 7). So a comment on someone else's ticket is 404 whatever its
    // content, and an empty comment on a closed ticket is 400 before 409.
    // The lock changes when the status is read, never which answer wins.
    const outcome = await prisma.$transaction(async (tx) => {
      const ticket = await lockTicket(tx, user.role, user.id, id);
      if (!ticket) return { kind: "missing" as const };

      const content = validateContent((req.body ?? {}).content);
      if (content.kind === "invalid") return { kind: "invalid" as const, fieldErrors: content.fieldErrors };

      if (isTerminal(ticket.currentStatus)) return { kind: "terminal" as const };

      // Author and time are the server's (BR-36). Anything the body says about
      // either is ignored rather than rejected: there is no legitimate request
      // that carries them, so there is no error worth reporting.
      const comment = await tx.publicComment.create({
        data: { ticketId: id, authorId: user.id, content: content.content },
        select: commentSelect,
      });
      return { kind: "created" as const, comment };
    });

    if (outcome.kind === "missing") {
      notFound(res);
      return;
    }
    if (outcome.kind === "invalid") {
      sendError(res, 400, "VALIDATION_FAILED", "The comment could not be posted.", outcome.fieldErrors);
      return;
    }
    if (outcome.kind === "terminal") {
      sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change.");
      return;
    }

    res.status(201).json(outcome.comment);
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/tickets/:id/comments", error);
  }
}

export async function listInternalNotes(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const id = ticketIdOf(req.params.ticketId);
  if (id === null) {
    notFound(res);
    return;
  }

  const prisma = getPrisma();
  try {
    const ticket = await visibleTicket(prisma, user.role, user.id, id);
    if (!ticket) {
      notFound(res);
      return;
    }

    // Same tie-breaker as the comment thread, for the same reason (BR-37).
    const notes = await prisma.internalNote.findMany({
      where: { ticketId: id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: noteSelect,
    });

    res.status(200).json(notes);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:id/internal-notes", error);
  }
}

export async function createInternalNote(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const id = ticketIdOf(req.params.ticketId);
  if (id === null) {
    notFound(res);
    return;
  }

  const prisma = getPrisma();
  try {
    // Locked for the life of the transaction, exactly as the comment route is:
    // a note written to a Ticket that closed mid-request is the same defect.
    const outcome = await prisma.$transaction(async (tx) => {
      const ticket = await lockTicket(tx, user.role, user.id, id);
      if (!ticket) return { kind: "missing" as const };

      const content = validateContent((req.body ?? {}).content);
      if (content.kind === "invalid") return { kind: "invalid" as const, fieldErrors: content.fieldErrors };

      if (isTerminal(ticket.currentStatus)) return { kind: "terminal" as const };

      const note = await tx.internalNote.create({
        data: { ticketId: id, authorId: user.id, content: content.content },
        select: noteSelect,
      });
      return { kind: "created" as const, note };
    });

    if (outcome.kind === "missing") {
      notFound(res);
      return;
    }
    if (outcome.kind === "invalid") {
      sendError(res, 400, "VALIDATION_FAILED", "The note could not be posted.", outcome.fieldErrors);
      return;
    }
    if (outcome.kind === "terminal") {
      sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change.");
      return;
    }

    res.status(201).json(outcome.note);
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/tickets/:id/internal-notes", error);
  }
}

export async function indicateResolved(req: Request, res: Response): Promise<void> {
  // Mounted behind requireRole("REQUESTER"), so IT Staff and Administrators are
  // refused with 403 before this runs (api-spec.md §7).
  const user = currentUser(res);
  const id = ticketIdOf(req.params.ticketId);
  if (id === null) {
    notFound(res);
    return;
  }

  const prisma = getPrisma();
  try {
    // Locked for the life of the transaction. Checking the status and writing
    // afterwards let a concurrent transition to RESOLVED or a terminal status
    // land in the gap, leaving an indication on a status BR-32 forbids while the
    // endpoint still answered 200 — Earth2509's finding on PR #66.
    const outcome = await prisma.$transaction(async (tx) => {
      const ticket = await lockTicket(tx, "REQUESTER", user.id, id);
      if (!ticket) return { kind: "missing" as const };

      if (!indicationAllowedFrom(ticket.currentStatus)) return { kind: "refused" as const };

      // Repeating it keeps the first time and changes nothing (BR-32). The WHERE
      // is the whole of that rule: a second request matches no row, so there is
      // nothing to overwrite.
      //
      // There was an `if (ticket.requesterResolvedAt === null)` wrapped around
      // this. It was removed deliberately. It expressed the same rule a second
      // time, and because it caught every sequential repeat on its own, the WHERE
      // below could be deleted entirely without a single test failing — the
      // break-the-code run for #52 proved exactly that. One guard that is tested
      // beats two guards where the outer one hides the inner one.
      await tx.ticket.updateMany({
        where: { id, requesterResolvedAt: null },
        data: { requesterResolvedAt: new Date() },
      });

      const detail = await tx.ticket.findUniqueOrThrow({ where: { id }, select: ticketDetailSelect });
      const attachments = await tx.attachment.findMany({
        where: { ticketId: id },
        orderBy: { uploadedAt: "asc" },
        select: attachmentSelect,
      });
      return { kind: "ok" as const, body: serializeTicketDetail(detail, attachments) };
    });

    if (outcome.kind === "missing") {
      notFound(res);
      return;
    }
    if (outcome.kind === "refused") {
      sendError(
        res,
        409,
        "INDICATION_NOT_ALLOWED",
        "This Ticket can no longer be marked as appearing resolved.",
      );
      return;
    }

    res.status(200).json(outcome.body);
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/tickets/:id/resolution-indication", error);
  }
}
