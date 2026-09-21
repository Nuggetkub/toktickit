import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import {
  staffTotalPages,
  validateStaffQueueQuery,
  type StaffQueueQuery,
} from "./staff-queue-query.js";

// The shared IT Staff queue (api-spec.md §5, FR-09).
//
// Both routes are mounted behind requireRole("IT_STAFF", "ADMINISTRATOR"), so a
// Requester is refused before any of this runs — the refusal does not depend on
// what the query asked for, and so cannot disclose whether a matching ticket
// exists (BR-18).

// What a queue row shows (api-spec.md §5). Deliberately not the ticket's
// description: the table never renders it, and 4000 characters per row is a
// large response for text nobody reads. Internal notes are absent for the same
// reason they are absent everywhere a Requester might see them (BR-34) — the
// queue simply has no business carrying them.
const queueSelect = {
  id: true,
  ticketNumber: true,
  summary: true,
  requestedPriority: true,
  itPriority: true,
  currentStatus: true,
  requesterResolvedAt: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true } },
  requester: { select: { id: true, fullName: true, role: true } },
  owner: { select: { id: true, fullName: true, role: true } },
} satisfies Prisma.TicketSelect;

type QueueRow = Prisma.TicketGetPayload<{ select: typeof queueSelect }>;

function serialize(ticket: QueueRow) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    // Ticket Date is the server-assigned creation time, named as the user sees
    // it rather than as the audit column it comes from (Lab 2 BR-04).
    ticketDate: ticket.createdAt,
    summary: ticket.summary,
    category: ticket.category,
    requester: ticket.requester,
    requestedPriority: ticket.requestedPriority,
    itPriority: ticket.itPriority,
    currentStatus: ticket.currentStatus,
    // Null is the answer, not an omission: the queue shows "Unassigned" and the
    // client must be able to tell that from a ticket whose owner failed to load.
    owner: ticket.owner,
    requesterResolvedAt: ticket.requesterResolvedAt,
    updatedAt: ticket.updatedAt,
  };
}

/** The filters, as one `where`. Absent filters contribute nothing. */
function queueWhere(query: StaffQueueQuery, callerId: number): Prisma.TicketWhereInput {
  const owner =
    query.owner === undefined
      ? {}
      : query.owner === "unassigned"
        ? { ownerId: null }
        : { ownerId: query.owner === "me" ? callerId : query.owner };

  return {
    ...(query.currentStatus ? { currentStatus: query.currentStatus } : {}),
    ...(query.itPriority ? { itPriority: query.itPriority } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...owner,
    // BR-33: the indication is a filter as well as a marker. "Indicated" means
    // the timestamp is set; there is no false value to match.
    ...(query.requesterIndicated ? { requesterResolvedAt: { not: null } } : {}),
    ...(query.search
      ? {
          OR: [
            { ticketNumber: { contains: query.search, mode: "insensitive" as const } },
            { summary: { contains: query.search, mode: "insensitive" as const } },
            // The queue is shared, so searching for a person is a real need in a
            // way it never was on My Tickets, where every row is your own.
            { requester: { fullName: { contains: query.search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
}

/**
 * Sorting (api-spec.md §5).
 *
 * Priority and status sort by their enum declaration order — severity and
 * lifecycle — because both columns are PostgreSQL enums declared in that order
 * (schema.prisma). Sorting them as text would give HIGH, LOW, MEDIUM, URGENT,
 * which is meaningless to whoever is triaging.
 *
 * Ticket Number descending is always the tie-breaker, so paging is stable: two
 * tickets sharing a timestamp cannot swap between pages and hide one of
 * themselves from a reader who pages past.
 */
function queueOrderBy(query: StaffQueueQuery): Prisma.TicketOrderByWithRelationInput[] {
  const direction = query.sortOrder;
  const primary: Prisma.TicketOrderByWithRelationInput =
    query.sortBy === "ticketDate"
      ? { createdAt: direction }
      : query.sortBy === "updatedAt"
        ? { updatedAt: direction }
        : query.sortBy === "ticketNumber"
          ? { ticketNumber: direction }
          : query.sortBy === "itPriority"
            ? { itPriority: direction }
            : query.sortBy === "requestedPriority"
              ? { requestedPriority: direction }
              : { currentStatus: direction };

  return [primary, { ticketNumber: "desc" }];
}

export async function listStaffQueue(req: Request, res: Response): Promise<void> {
  const caller = currentUser(res);

  const validation = validateStaffQueueQuery(req.query as Record<string, unknown>);
  if (!validation.value) {
    sendError(res, 400, "VALIDATION_FAILED", "The Ticket Queue query is not valid.", validation.fieldErrors);
    return;
  }

  const query = validation.value;
  const where = queueWhere(query, caller.id);

  try {
    const prisma = getPrisma();
    const [totalItems, items] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy: queueOrderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: queueSelect,
      }),
    ]);

    // A page beyond the last is an empty list with honest totals, never an
    // error and never a silent clamp back to page 1 (api-spec.md §5).
    res.status(200).json({
      items: items.map(serialize),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: staffTotalPages(totalItems, query.pageSize),
    });
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/staff/tickets", error);
  }
}

/**
 * `GET /api/staff/assignees` — the owner dropdown (api-spec.md §5).
 *
 * Active IT Staff and Administrators only, because BR-21 lets a ticket be
 * assigned to nobody else. Offering an ineligible name would be a control that
 * exists only to be refused.
 */
export async function listAssignees(_req: Request, res: Response): Promise<void> {
  try {
    const assignees = await getPrisma().user.findMany({
      where: { isActive: true, role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
      select: { id: true, fullName: true, role: true },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
    });
    res.status(200).json(assignees);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/staff/assignees", error);
  }
}
