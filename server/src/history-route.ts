import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";

// GET /api/tickets/:ticketId/history (docs/lab-04/api-spec.md §3, BR-22 to BR-24).
//
// Append-only: this is the only route on the path, so POST, PATCH, PUT and
// DELETE meet a 404, as for comments. Readable by every role that can read the
// Ticket; a Requester is narrowed to their own, and another Requester's Ticket
// answers exactly as a missing one (Lab 3 BR-19).

const actorSelect = { id: true, fullName: true, role: true } satisfies Prisma.UserSelect;

export async function listHistory(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const parsed = Number(req.params.ticketId);
  const ticketId = Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  if (ticketId === null) {
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  const prisma = getPrisma();
  try {
    const ticket = await prisma.ticket.findFirst({
      where: user.role === "REQUESTER" ? { id: ticketId, requesterId: user.id } : { id: ticketId },
      select: { id: true },
    });
    if (!ticket) {
      sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
      return;
    }

    // BR-23: oldest first, a timeline from creation, the id breaking a tie.
    const items = await prisma.ticketStatusEvent.findMany({
      where: { ticketId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, fromStatus: true, toStatus: true, actor: { select: actorSelect }, createdAt: true },
    });

    // BR-24: a Ticket from before the migration has no creation event, so its
    // history does not start at creation. The screen says so rather than
    // implying nothing happened before.
    res.status(200).json({ items, recordedFromCreation: items[0]?.fromStatus === null });
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:ticketId/history", error);
  }
}
