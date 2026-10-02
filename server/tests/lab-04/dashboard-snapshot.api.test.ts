import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";
import { whileHolding } from "../support/locks.js";

// BR-25's single snapshot, proven rather than assumed (Earth2509's
// non-blocking follow-up on PR #97). Each dashboard is read in one read-only
// REPEATABLE READ transaction, so everything in one response describes one
// moment. To show it, a request is paused in the middle of that transaction:
//
//   1. A holder transaction takes an exclusive lock on a table the dashboard
//      reads only after its first queries, and inserts a new Ticket, not yet
//      committed.
//   2. The request starts, takes its snapshot (the new Ticket is invisible),
//      reads its first counts, and then waits on the lock.
//   3. The holder commits, so the new Ticket is now visible to any new snapshot,
//      and releases the lock. The request resumes.
//
// Every read after the pause must still exclude the new Ticket. With the
// transaction removed, or its isolation lowered to READ COMMITTED, those later
// reads see it and the response contradicts its own first cards.

const prisma = getPrisma();
const DOMAIN = "@dashboard-snapshot-lab4.local";
const ids = { requester: 0, staff: 0 };
const cookies = { requester: "", staff: "" };
let categoryId = 0;
let relatedSystemId = 0;

const lockTable = (table: "ActionTaken" | "TicketStatusEvent") => (tx: Parameters<Parameters<typeof whileHolding>[0]>[0]) =>
  tx.$executeRawUnsafe(`LOCK TABLE "${table}" IN ACCESS EXCLUSIVE MODE`);

function newTicket(tx: Parameters<Parameters<typeof whileHolding>[0]>[0], status: "NEW" | "WAITING_FOR_REQUESTER") {
  return tx.ticket.create({
    data: {
      ticketNumber: `TKT-2100-${randomUUID().slice(0, 12)}`, requesterId: ids.requester, categoryId, relatedSystemId,
      summary: "Committed while a dashboard was mid-read", description: "Created by the Lab 4 snapshot suite.",
      requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: status, idempotencyKey: randomUUID(),
    },
    select: { id: true },
  });
}

async function cleanUp() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await deleteTickets({ requesterId: { in: userIds } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

beforeAll(async () => {
  await cleanUp();
  const [category, system] = await Promise.all([
    prisma.category.create({ data: { name: `Snapshot probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Snapshot system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (fullName: string, role: "REQUESTER" | "IT_STAFF") =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role } })).id;
  ids.requester = await make("Nadia Rahman", "REQUESTER");
  ids.staff = await make("Grace Okafor", "IT_STAFF");
  cookies.requester = await sessionCookieFor(ids.requester);
  cookies.staff = await sessionCookieFor(ids.staff);
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("BR-25 one snapshot per dashboard response", () => {
  it("the staff dashboard: a Ticket committed while it waits appears in none of its later reads", async () => {
    const before = { tickets: await prisma.ticket.count(), unassigned: await prisma.ticket.count({ where: { ownerId: null, currentStatus: { in: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] } } }) };
    let added = 0;
    // The staff dashboard reads Tickets first, then ActionTaken: it waits there.
    const res = await whileHolding(
      lockTable("ActionTaken"),
      () => request(app).get("/api/dashboard/staff").set("Cookie", cookies.staff).then((r) => r),
      { during: async (tx) => { added = (await newTicket(tx, "NEW")).id; } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // The new Ticket is committed and real...
    expect(await prisma.ticket.count()).toBe(before.tickets + 1);
    // ...but the response, read before and after the pause, never saw it.
    expect(res.body.cards.unassignedActive.value).toBe(before.unassigned);
    const byStatusSum = Object.values(res.body.byStatus as Record<string, { value: number }>).reduce((sum, c) => sum + c.value, 0);
    expect(byStatusSum).toBe(before.tickets);
    expect(res.body.lists.recentlyUpdated.total).toBe(before.tickets);
    expect(res.body.lists.recentlyUpdated.items.map((t: { id: number }) => t.id)).not.toContain(added);
  });

  it("the Requester dashboard: a Ticket committed while it waits appears in none of its later reads", async () => {
    const own = { requesterId: ids.requester };
    const before = {
      all: await prisma.ticket.count({ where: own }),
      waiting: await prisma.ticket.count({ where: { ...own, currentStatus: "WAITING_FOR_REQUESTER" } }),
    };
    let added = 0;
    // The Requester dashboard counts Tickets first, then reads TicketStatusEvent: it waits there.
    const res = await whileHolding(
      lockTable("TicketStatusEvent"),
      () => request(app).get("/api/dashboard/requester").set("Cookie", cookies.requester).then((r) => r),
      { during: async (tx) => { added = (await newTicket(tx, "WAITING_FOR_REQUESTER")).id; } },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prisma.ticket.count({ where: own })).toBe(before.all + 1);
    expect(res.body.cards.waitingForMe.value).toBe(before.waiting);
    // Read after the pause: Needs your attention and Recently updated.
    const listed = [...res.body.lists.needsAttention.items, ...res.body.lists.recentlyUpdated.items].map((t: { id: number }) => t.id);
    expect(listed).not.toContain(added);
    expect(res.body.lists.needsAttention.items).toHaveLength(before.waiting);
  });
});
