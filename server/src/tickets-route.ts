import type { Request, Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { resolveRequester } from "./requester-context.js";
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

function serialize(ticket: TicketRow) {
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
    attachments: [] as unknown[],
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
