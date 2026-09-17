import type { Request, Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
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
    const ticket = await visibleTicket(prisma, user.role, user.id, id);
    if (!ticket) {
      notFound(res);
      return;
    }

    const content = validateContent((req.body ?? {}).content);
    if (content.kind === "invalid") {
      sendError(res, 400, "VALIDATION_FAILED", "The comment could not be posted.", content.fieldErrors);
      return;
    }

    if (isTerminal(ticket.currentStatus)) {
      sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change.");
      return;
    }

    // Author and time are the server's (BR-36). Anything the body says about
    // either is ignored rather than rejected: there is no legitimate request
    // that carries them, so there is no error worth reporting.
    const comment = await prisma.publicComment.create({
      data: { ticketId: id, authorId: user.id, content: content.content },
      select: commentSelect,
    });

    res.status(201).json(comment);
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
    const ticket = await visibleTicket(prisma, user.role, user.id, id);
    if (!ticket) {
      notFound(res);
      return;
    }

    const content = validateContent((req.body ?? {}).content);
    if (content.kind === "invalid") {
      sendError(res, 400, "VALIDATION_FAILED", "The note could not be posted.", content.fieldErrors);
      return;
    }

    if (isTerminal(ticket.currentStatus)) {
      sendError(res, 409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change.");
      return;
    }

    const note = await prisma.internalNote.create({
      data: { ticketId: id, authorId: user.id, content: content.content },
      select: noteSelect,
    });

    res.status(201).json(note);
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
    const ticket = await prisma.ticket.findFirst({
      where: { id, requesterId: user.id },
      select: { id: true, currentStatus: true, requesterResolvedAt: true },
    });
    if (!ticket) {
      notFound(res);
      return;
    }

    if (!indicationAllowedFrom(ticket.currentStatus)) {
      sendError(
        res,
        409,
        "INDICATION_NOT_ALLOWED",
        "This Ticket can no longer be marked as appearing resolved.",
      );
      return;
    }

    // Repeating it keeps the first time and changes nothing (BR-32). Written as
    // a conditional update rather than read-then-write so two taps in the same
    // instant cannot both set it: `requesterResolvedAt: null` in the WHERE means
    // the second one matches no row.
    if (ticket.requesterResolvedAt === null) {
      await prisma.ticket.updateMany({
        where: { id, requesterResolvedAt: null },
        data: { requesterResolvedAt: new Date() },
      });
    }

    const detail = await prisma.ticket.findUniqueOrThrow({ where: { id }, select: ticketDetailSelect });
    const attachments = await prisma.attachment.findMany({
      where: { ticketId: id },
      orderBy: { uploadedAt: "asc" },
      select: attachmentSelect,
    });

    res.status(200).json(serializeTicketDetail(detail, attachments));
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/tickets/:id/resolution-indication", error);
  }
}
