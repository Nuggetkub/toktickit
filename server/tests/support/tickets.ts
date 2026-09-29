import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "../../src/prisma.js";

// Fixtures for the Lab 2 and Lab 3 suites that Lab 4's rules now reach
// (docs/lab-04/tests.md §7).

/**
 * Deletes Tickets together with the Lab 4 rows that point at them.
 *
 * Every Lab 4 foreign key is ON DELETE RESTRICT, because nothing in the
 * application deletes a Ticket (specification §7). Test cleanup is the one
 * place that does, and since creating a Ticket or changing its status now
 * writes a Status Event (BR-22), a plain ticket.deleteMany is refused. The
 * suites' own earlier steps still delete comments and attachments themselves.
 */
export async function deleteTickets(where: Prisma.TicketWhereInput): Promise<void> {
  const prisma = getPrisma();
  const ids = (await prisma.ticket.findMany({ where, select: { id: true } })).map((t) => t.id);
  if (ids.length === 0) return;
  await prisma.actionTaken.deleteMany({ where: { ticketId: { in: ids } } });
  await prisma.ticketStatusEvent.deleteMany({ where: { ticketId: { in: ids } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ids } } });
}

/**
 * Records one completed Action on a Ticket, directly, so that a Lab 3 test that
 * resolves the Ticket meets Lab 4's resolution gate (BR-19) and goes on to test
 * what it was written to test. The Action is completed now, so it also counts
 * as work done since any earlier reopen.
 */
export async function recordCompletedWork(ticketId: number, userId: number): Promise<void> {
  const now = new Date();
  const [{ seq }] = await getPrisma().$queryRaw<Array<{ seq: bigint }>>`SELECT nextval('"TicketStatusEvent_seq_seq"') AS seq`;
  await getPrisma().actionTaken.create({
    data: {
      ticketId,
      actionAt: now,
      description: "Work recorded so this Lab 3 test meets the Lab 4 resolution gate.",
      result: "Done.",
      followUpRequired: false,
      status: "COMPLETED",
      assigneeId: userId,
      createdById: userId,
      performedById: userId,
      completedAt: now,
      completionSeq: seq,
      idempotencyKey: randomUUID(),
    },
  });
}
