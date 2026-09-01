import type { Request, Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { resolveRequester } from "./requester-context.js";
import { attachmentSelect, type AttachmentView } from "./attachment-view.js";
import {
  DEFAULT_PAGE_SIZE,
  totalPages as pageCount,
  validateTicketListQuery,
  type TicketListQuery,
} from "./ticket-query.js";
import {
  formatTicketNumber,
  isSameTicket,
  validateTicketCreate,
  type NormalizedTicket,
} from "./ticket-create.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// The fields every Ticket response carries (api-spec.md §3).
const ticketSelect = {
  id: true,
  ticketNumber: true,
  summary: true,
  description: true,
  requestedPriority: true,
  currentStatus: true,
  createdAt: true,
  updatedAt: true,
  categoryId: true,
  relatedSystemId: true,
  requester: { select: { id: true, fullName: true } },
  category: { select: { id: true, name: true } },
  relatedSystem: { select: { id: true, name: true } },
} satisfies Prisma.TicketSelect;

type TicketRow = Prisma.TicketGetPayload<{ select: typeof ticketSelect }>;

/**
 * `attachments` defaults to empty because a Ticket has none at the moment it is
 * created — the create response in api-spec.md §3 shows exactly that. Ticket
 * Detail passes the real rows, removed ones included (BR-39).
 */
function serialize(ticket: TicketRow, attachments: AttachmentView[] = []) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    // Ticket Date is the server-assigned creation timestamp (BR-04). It is named
    // separately from createdAt because it is a field the Requester sees, not an
    // audit column that happens to be visible.
    ticketDate: ticket.createdAt,
    requester: ticket.requester,
    category: ticket.category,
    relatedSystem: ticket.relatedSystem,
    summary: ticket.summary,
    description: ticket.description,
    requestedPriority: ticket.requestedPriority,
    currentStatus: ticket.currentStatus,
    attachments,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

export async function createTicket(req: Request, res: Response): Promise<void> {
  const context = await resolveRequester(req).catch(() => null);
  if (context === null) {
    sendDependencyUnavailable(res, "POST /api/tickets (requester lookup)", new Error("requester lookup failed"));
    return;
  }
  if (!context.requester) {
    sendError(
      res,
      401,
      "REQUESTER_CONTEXT_REQUIRED",
      "Select a Development Requester before creating a Ticket.",
    );
    return;
  }

  const idempotencyKey = req.header("idempotency-key")?.trim() ?? "";
  if (!UUID.test(idempotencyKey)) {
    sendError(
      res,
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "An Idempotency-Key header containing a UUID is required.",
    );
    return;
  }

  const validation = validateTicketCreate(req.body);
  if (!validation.value) {
    sendError(res, 400, "VALIDATION_FAILED", "The Ticket could not be created.", validation.fieldErrors);
    return;
  }

  const input = validation.value;
  const requesterId = context.requester.id;
  const prisma = getPrisma();

  try {
    // A replay of the same key is answered before anything is created.
    const existing = await prisma.ticket.findUnique({ where: { idempotencyKey }, select: ticketSelect });
    if (existing) {
      respondToReplay(res, existing, input, requesterId);
      return;
    }

    const [category, relatedSystem] = await Promise.all([
      prisma.category.findFirst({ where: { id: input.categoryId, isActive: true }, select: { id: true } }),
      prisma.relatedSystem.findFirst({ where: { id: input.relatedSystemId, isActive: true }, select: { id: true } }),
    ]);

    // BR-15: both must exist and be active at the moment of creation.
    if (!category || !relatedSystem) {
      sendError(res, 404, "REFERENCE_NOT_FOUND", "The selected Category or Related System is unavailable.");
      return;
    }

    const created = await createWithNumber(prisma, requesterId, input, idempotencyKey);
    res.status(201).json(serialize(created));
  } catch (error) {
    // Two requests can pass the replay check at the same moment; the unique
    // index on idempotencyKey is what actually decides. The loser re-reads and
    // returns the winner's Ticket rather than failing (BR-19).
    if (isUniqueViolation(error)) {
      try {
        const winner = await prisma.ticket.findUnique({ where: { idempotencyKey }, select: ticketSelect });
        if (winner) {
          respondToReplay(res, winner, input, requesterId);
          return;
        }
      } catch {
        // Fall through to the generic failure below.
      }
    }

    sendDependencyUnavailable(res, "POST /api/tickets", error);
  }
}

function respondToReplay(res: Response, existing: TicketRow, input: NormalizedTicket, requesterId: number): void {
  const sameTicket = isSameTicket(
    {
      categoryId: existing.categoryId,
      relatedSystemId: existing.relatedSystemId,
      summary: existing.summary,
      description: existing.description,
      requestedPriority: existing.requestedPriority,
    },
    input,
  );

  // A key reused by a different Requester is a conflict even if the body matches.
  if (!sameTicket || existing.requester.id !== requesterId) {
    sendError(
      res,
      409,
      "IDEMPOTENCY_KEY_CONFLICT",
      "That Idempotency-Key has already been used for a different Ticket.",
    );
    return;
  }

  res.status(200).json(serialize(existing));
}

/**
 * BR-20: the Ticket and its official number are written in one transaction, so a
 * failure rolls back both and no number is consumed by a Ticket that does not
 * exist.
 *
 * The number is taken from a per-year counter *before* the insert, so the row is
 * never written with a placeholder number that would have to be corrected by a
 * second statement.
 */
async function createWithNumber(
  prisma: PrismaClient,
  requesterId: number,
  input: NormalizedTicket,
  idempotencyKey: string,
): Promise<TicketRow> {
  return prisma.$transaction(async (tx) => {
    const year = new Date().getUTCFullYear();

    // ON CONFLICT DO UPDATE takes a row lock, so concurrent creates in the same
    // year are serialised and cannot be issued the same sequence value.
    const rows = await tx.$queryRaw<{ lastValue: number }[]>`
      INSERT INTO "TicketNumberSequence" ("year", "lastValue")
      VALUES (${year}, 1)
      ON CONFLICT ("year") DO UPDATE SET "lastValue" = "TicketNumberSequence"."lastValue" + 1
      RETURNING "lastValue"
    `;

    return tx.ticket.create({
      data: {
        ticketNumber: formatTicketNumber(year, rows[0].lastValue),
        requesterId,
        categoryId: input.categoryId,
        relatedSystemId: input.relatedSystemId,
        summary: input.summary,
        description: input.description,
        requestedPriority: input.requestedPriority,
        idempotencyKey,
      },
      select: ticketSelect,
    });
  });
}

// ---------------------------------------------------------------------------
// Issue 23 — My Tickets (api-spec.md §3)
// ---------------------------------------------------------------------------

// The list carries what the table shows and nothing more. `description` runs to
// 4000 characters and is never rendered in a row, so shipping it would send up
// to 200 kB of unused text per page — it belongs on the detail response only.
const listSelect = {
  id: true,
  ticketNumber: true,
  summary: true,
  requestedPriority: true,
  currentStatus: true,
  createdAt: true,
  category: { select: { id: true, name: true } },
  relatedSystem: { select: { id: true, name: true } },
  _count: { select: { attachments: { where: { removedAt: null } } } },
} satisfies Prisma.TicketSelect;

type ListRow = Prisma.TicketGetPayload<{ select: typeof listSelect }>;

function serializeRow(ticket: ListRow) {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    ticketDate: ticket.createdAt,
    summary: ticket.summary,
    category: ticket.category,
    relatedSystem: ticket.relatedSystem,
    requestedPriority: ticket.requestedPriority,
    currentStatus: ticket.currentStatus,
    attachmentCount: ticket._count.attachments,
  };
}

function orderBy(query: TicketListQuery): Prisma.TicketOrderByWithRelationInput[] {
  const direction = query.sortOrder;
  const primary =
    query.sortBy === "ticketDate"
      ? { createdAt: direction }
      : query.sortBy === "ticketNumber"
        ? { ticketNumber: direction }
        : { requestedPriority: direction };

  // Ticket Number descending is always the tie-breaker, so paging is stable:
  // without it, two tickets sharing a timestamp can swap between pages and one
  // of them is never seen (BR-24).
  return [primary, { ticketNumber: "desc" }];
}

export async function listTickets(req: Request, res: Response): Promise<void> {
  const context = await resolveRequester(req).catch(() => null);
  if (context === null) {
    sendDependencyUnavailable(res, "GET /api/tickets (requester lookup)", new Error("lookup failed"));
    return;
  }
  if (!context.requester) {
    sendError(res, 401, "REQUESTER_CONTEXT_REQUIRED", "Select a Development Requester to see your Tickets.");
    return;
  }

  const validation = validateTicketListQuery(req.query as Record<string, unknown>);
  if (!validation.value) {
    sendError(res, 400, "VALIDATION_FAILED", "The Ticket list query is not valid.", validation.fieldErrors);
    return;
  }

  const query = validation.value;

  // Scoped to the requester before anything else is applied (BR-21). This is the
  // whole of the ownership guarantee for the list: it is a database predicate,
  // not something the caller can influence.
  const where: Prisma.TicketWhereInput = {
    requesterId: context.requester.id,
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.relatedSystemId ? { relatedSystemId: query.relatedSystemId } : {}),
    ...(query.requestedPriority ? { requestedPriority: query.requestedPriority } : {}),
    ...(query.search
      ? {
          OR: [
            { ticketNumber: { contains: query.search, mode: "insensitive" } },
            { summary: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  try {
    const prisma = getPrisma();
    const [totalItems, items] = await Promise.all([
      prisma.ticket.count({ where }),
      prisma.ticket.findMany({
        where,
        orderBy: orderBy(query),
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: listSelect,
      }),
    ]);

    res.status(200).json({
      items: items.map(serializeRow),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: pageCount(totalItems, query.pageSize),
    });
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets", error);
  }
}

export async function getTicket(req: Request, res: Response): Promise<void> {
  const context = await resolveRequester(req).catch(() => null);
  if (context === null) {
    sendDependencyUnavailable(res, "GET /api/tickets/:id (requester lookup)", new Error("lookup failed"));
    return;
  }
  if (!context.requester) {
    sendError(res, 401, "REQUESTER_CONTEXT_REQUIRED", "Select a Development Requester to open a Ticket.");
    return;
  }

  const ticketId = Number(req.params.ticketId);
  if (!Number.isSafeInteger(ticketId) || ticketId < 1) {
    // Indistinguishable from a ticket that exists but is not yours (D-04).
    sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
    return;
  }

  try {
    // Ownership is part of the query, so another requester's ticket is not
    // fetched and then refused — it is never read at all (BR-10).
    const ticket = await getPrisma().ticket.findFirst({
      where: { id: ticketId, requesterId: context.requester.id },
      select: ticketSelect,
    });

    if (!ticket) {
      sendError(res, 404, "TICKET_NOT_FOUND", "That Ticket could not be found.");
      return;
    }

    // Read only after ownership is established, and only for this ticket, so the
    // detail response cannot become a way to enumerate someone else's files.
    // Removed rows are included: BR-39 keeps them visible as marked metadata.
    const attachments = await getPrisma().attachment.findMany({
      where: { ticketId: ticket.id },
      orderBy: { uploadedAt: "asc" },
      select: attachmentSelect,
    });

    res.status(200).json(serialize(ticket, attachments));
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/tickets/:id", error);
  }
}
