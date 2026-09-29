import type { Prisma, PrismaClient } from "@prisma/client";
import { gateSummary, type GateEvidence, type GateSummary } from "./resolution-gate.js";

// Loads what the resolution gate decides on (BR-19): the Ticket's Actions and
// the time of its latest reopen. Kept out of resolution-gate.ts so that module
// stays free of Prisma. The status route calls this under the Ticket row lock
// (BR-14); a read for Ticket Detail calls it without one, because there the
// answer is only advice.

type Db = PrismaClient | Prisma.TransactionClient;

export async function loadGateEvidence(db: Db, ticketId: number): Promise<GateEvidence> {
  const [actions, reopen] = await Promise.all([
    db.actionTaken.findMany({
      where: { ticketId },
      select: { id: true, status: true, actionAt: true, completedAt: true, completionSeq: true, followUpRequired: true },
    }),
    db.ticketStatusEvent.findFirst({
      where: { ticketId, toStatus: "REOPENED" },
      orderBy: { seq: "desc" },
      select: { seq: true },
    }),
  ]);
  return { actions, latestReopenSeq: reopen?.seq ?? null };
}

export async function loadGateSummary(db: Db, ticketId: number): Promise<GateSummary> {
  return gateSummary(await loadGateEvidence(db, ticketId));
}
