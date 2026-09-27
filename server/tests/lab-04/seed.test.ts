import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedReferenceData } from "../../src/seed-data.js";
import { seedDemoTickets } from "../../src/demo-tickets.js";
import { DEMO_ACTIONS, demoActionKey, seedDemoActivity } from "../../src/demo-activity.js";
import { deployMigrations, dropSchema, resetSchema, scratchUrl } from "../lab-03/support.js";

// DB-02 in docs/lab-04/tests.md (AC-24): the Lab 4 seed, in a schema of its own
// for the same reason as the Lab 3 seed test — it creates Tickets, and the
// shared test schema must start with none.
//
// Beyond BR-35's list, the seed is held to the rules it demonstrates. A seed
// that shows an open Action on a closed Ticket, or a history that ends in a
// different status from the Ticket, would put impossible states in front of the
// grader.

const SCHEMA = "lab4_seed_test";
const url = scratchUrl(SCHEMA);
const ACTIVE = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] as const;
const WINDOW_MS = 168 * 60 * 60 * 1000;
let prisma: PrismaClient;
let firstRun: Awaited<ReturnType<typeof seedDemoActivity>>;
let secondRun: Awaited<ReturnType<typeof seedDemoActivity>>;
let firstCounts: { actions: number; events: number; tickets: number; users: number };
const EDITED = "Edited between the two seed runs — must survive the second.";

async function counts() {
  return {
    actions: await prisma.actionTaken.count(),
    events: await prisma.ticketStatusEvent.count(),
    tickets: await prisma.ticket.count(),
    users: await prisma.user.count(),
  };
}

beforeAll(async () => {
  await resetSchema(SCHEMA);
  deployMigrations(url);
  prisma = new PrismaClient({ datasourceUrl: url });

  // A Lab 3 database first — accounts and demo Tickets, no activity — which is
  // exactly what an upgraded development database looks like.
  await seedReferenceData(prisma);
  await seedDemoTickets(prisma);
  firstRun = await seedDemoActivity(prisma);
  firstCounts = await counts();

  // Someone edits a seeded Action between the runs.
  await prisma.actionTaken.update({ where: { idempotencyKey: demoActionKey("seed-demo-012", 0) }, data: { description: EDITED } });

  await seedReferenceData(prisma);
  await seedDemoTickets(prisma);
  secondRun = await seedDemoActivity(prisma);
}, 180_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await dropSchema(SCHEMA);
});

describe("the Lab 4 seed", () => {
  it("creates Tickets with zero, one and several Actions, in every Action status", async () => {
    const perTicket = await prisma.ticket.findMany({ select: { _count: { select: { actionsTaken: true } } } });
    const sizes = perTicket.map((t) => t._count.actionsTaken);
    expect(sizes).toContain(0);
    expect(sizes).toContain(1);
    expect(sizes.some((n) => n >= 2)).toBe(true);

    for (const status of ["OPEN", "COMPLETED", "CANCELLED"] as const) {
      expect(await prisma.actionTaken.count({ where: { status } })).toBeGreaterThanOrEqual(1);
    }
    // An open Action whose assignee was cleared by a deactivation (BR-17).
    expect(await prisma.actionTaken.count({ where: { status: "OPEN", assigneeId: null } })).toBe(1);
    // An Action assigned to someone other than the Ticket Owner (BR-02).
    const delegated = await prisma.actionTaken.findMany({ where: { assigneeId: { not: null } }, select: { assigneeId: true, ticket: { select: { ownerId: true } } } });
    expect(delegated.some((a) => a.assigneeId !== a.ticket.ownerId)).toBe(true);
  });

  it("creates every Action DEMO_ACTIONS declares, and nothing else", async () => {
    const declared = Object.values(DEMO_ACTIONS).reduce((sum, list) => sum + list.length, 0);
    expect(firstRun.actionsCreated).toBe(declared);
    expect(await prisma.actionTaken.count()).toBe(declared);
  });

  it("gives every demo Ticket a history that starts at creation and ends at its current status", async () => {
    const tickets = await prisma.ticket.findMany({
      include: { statusEvents: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
    });
    expect(tickets.length).toBeGreaterThan(0);
    for (const ticket of tickets) {
      const events = ticket.statusEvents;
      expect(events.length, ticket.idempotencyKey!).toBeGreaterThanOrEqual(1);
      expect(events[0]).toMatchObject({ fromStatus: null, toStatus: "NEW", actorId: ticket.requesterId });
      expect(events.at(-1)!.toStatus, ticket.idempotencyKey!).toBe(ticket.currentStatus);
      for (const [i, event] of events.entries()) {
        expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(ticket.createdAt.getTime());
        if (i > 0) expect(event.fromStatus).toBe(events[i - 1].toStatus);
      }
    }
    // Some resolutions fall inside the dashboards' 168-hour window (R-4).
    const since = new Date(Date.now() - WINDOW_MS);
    expect(await prisma.ticketStatusEvent.count({ where: { toStatus: "RESOLVED", createdAt: { gte: since } } })).toBeGreaterThanOrEqual(1);
  });

  it("obeys the rules it demonstrates", async () => {
    const actions = await prisma.actionTaken.findMany({ include: { ticket: { select: { currentStatus: true, createdAt: true, idempotencyKey: true } } } });

    // No open Action on a Ticket that is not active (BR-12, BR-20; S-3's invariant).
    for (const action of actions.filter((a) => a.status === "OPEN")) {
      expect(ACTIVE, action.ticket.idempotencyKey!).toContain(action.ticket.currentStatus);
    }
    // No Action predates its Ticket (BR-07).
    for (const action of actions) {
      expect(action.actionAt.getTime()).toBeGreaterThanOrEqual(action.ticket.createdAt.getTime());
    }
    // A completed Action names a performer, and it is never still open work.
    for (const action of actions.filter((a) => a.status === "COMPLETED")) {
      expect(action.performedById).not.toBeNull();
      expect(action.result).not.toBeNull();
    }
    // Every resolved or closed demo Ticket that has Actions passes the gate
    // (BR-19): nothing open, and the latest completed Action asks for no follow-up.
    const finished = await prisma.ticket.findMany({
      where: { currentStatus: { in: ["RESOLVED", "CLOSED"] }, actionsTaken: { some: {} } },
      include: { actionsTaken: { orderBy: [{ actionAt: "desc" }, { id: "desc" }] } },
    });
    expect(finished.length).toBeGreaterThanOrEqual(1);
    for (const ticket of finished) {
      expect(ticket.actionsTaken.some((a) => a.status === "OPEN")).toBe(false);
      const latest = ticket.actionsTaken.find((a) => a.status === "COMPLETED");
      expect(latest, ticket.idempotencyKey!).toBeDefined();
      expect(latest!.followUpRequired).toBe(false);
    }
  });

  it("leaves a Requester and an IT Staff member with nothing to count", async () => {
    const ananya = await prisma.user.findUniqueOrThrow({ where: { email: "ananya.wong@toktickit.local" } });
    expect(ananya).toMatchObject({ role: "REQUESTER", isActive: true });
    expect(await prisma.ticket.count({ where: { requesterId: ananya.id } })).toBe(0);

    const kanya = await prisma.user.findUniqueOrThrow({ where: { email: "kanya.srisuk@toktickit.local" } });
    expect(kanya).toMatchObject({ role: "IT_STAFF", isActive: true });
    expect(await prisma.ticket.count({ where: { ownerId: kanya.id } })).toBe(0);
    expect(await prisma.actionTaken.count({ where: { assigneeId: kanya.id } })).toBe(0);
  });

  it("creates nothing the second time, and does not revert an edit made in between", async () => {
    expect(secondRun).toEqual({ actionsCreated: 0, actionsSkipped: firstRun.actionsCreated, eventsCreated: 0, ticketsGivenHistory: 0 });
    expect(await counts()).toEqual(firstCounts);
    const edited = await prisma.actionTaken.findUniqueOrThrow({ where: { idempotencyKey: demoActionKey("seed-demo-012", 0) } });
    expect(edited.description).toBe(EDITED);
  });

  it("leaves alone a Ticket that already has history of its own", async () => {
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { idempotencyKey: "seed-demo-001" } });
    await prisma.ticketStatusEvent.deleteMany({ where: { ticketId: ticket.id } });
    await prisma.ticketStatusEvent.create({ data: { ticketId: ticket.id, fromStatus: null, toStatus: "NEW", actorId: ticket.requesterId } });

    const run = await seedDemoActivity(prisma);

    expect(run.eventsCreated).toBe(0);
    expect(await prisma.ticketStatusEvent.count({ where: { ticketId: ticket.id } })).toBe(1);
  });
});
