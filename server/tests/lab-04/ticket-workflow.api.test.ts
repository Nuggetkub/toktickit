import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor, TEST_ORIGIN } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";
import { ticketRow, whileHolding } from "../support/locks.js";

// WF-01 to WF-06 in docs/lab-04/tests.md (AC-11 to AC-17), against the real
// database: the resolution gate (BR-19, including D-15's reopen condition), the
// row lock that makes it race-safe (BR-14), the full matrix (BR-18), the cancel
// cascade (BR-20), and the append-only history (BR-22 to BR-24).

const prisma = getPrisma();
const DOMAIN = "@workflow-lab4.local";
const ids = { staff: 0, admin: 0, owner: 0, stranger: 0 };
const cookies = { staff: "", admin: "", owner: "", stranger: "" };
let categoryId = 0;
let relatedSystemId = 0;

async function newTicket(status = "IN_PROGRESS") {
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2095-${randomUUID().slice(0, 12)}`, requesterId: ids.owner, categoryId, relatedSystemId,
      summary: "Workflow gate ticket", description: "Created by the Lab 4 workflow suite.",
      requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: status as never, ownerId: ids.staff, idempotencyKey: randomUUID(),
    },
    select: { id: true },
  });
}

const post = (path: string, cookie: string, body: object, key?: string) => {
  const req = request(app).post(path).set("Cookie", cookie).set("Origin", TEST_ORIGIN);
  return (key ? req.set("Idempotency-Key", key) : req).send(body);
};
const get = (path: string, cookie: string) => request(app).get(path).set("Cookie", cookie);
const versionOf = async (id: number) => (await prisma.ticket.findUniqueOrThrow({ where: { id } })).version;

async function changeStatus(id: number, toStatus: string, extra: object = {}) {
  return post(`/api/tickets/${id}/status`, cookies.staff, {
    toStatus,
    version: await versionOf(id),
    resolutionSummary: "Replaced the access point and confirmed the connection.",
    reason: "The Requester reports the problem is back.",
    ...extra,
  });
}

async function addAction(ticketId: number, overrides: Record<string, unknown> = {}) {
  const res = await post(`/api/tickets/${ticketId}/actions`, cookies.staff, {
    status: "COMPLETED",
    actionAt: new Date().toISOString(),
    description: "Replaced the access point.",
    result: "Signal strong again.",
    followUpRequired: false,
    assigneeId: ids.staff,
    ...overrides,
  }, randomUUID());
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: number; version: number };
}

beforeAll(async () => {
  await cleanUp();
  const [category, system] = await Promise.all([
    prisma.category.create({ data: { name: `Workflow4 probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Workflow4 system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (fullName: string, role: string) =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: role as never } })).id;
  ids.staff = await make("Grace Okafor", "IT_STAFF");
  ids.admin = await make("Pim Srisawat", "ADMINISTRATOR");
  ids.owner = await make("Nadia Rahman", "REQUESTER");
  ids.stranger = await make("Somchai Pattana", "REQUESTER");
  for (const who of ["staff", "admin", "owner", "stranger"] as const) cookies[who] = await sessionCookieFor(ids[who]);
}, 60_000);

async function cleanUp() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.publicComment.deleteMany({ where: { ticket: { requesterId: { in: userIds } } } });
  await deleteTickets({ requesterId: { in: userIds } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("WF-01 the gate refuses unfinished work, through the API directly (AC-11, AC-12)", () => {
  it("names every unmet condition, changes nothing, and passes once the work is done", async () => {
    const ticket = await newTicket();
    const expectBlocked = async (unmet: unknown[]) => {
      const before = await versionOf(ticket.id);
      const res = await changeStatus(ticket.id, "RESOLVED");
      expect(res.status, JSON.stringify(res.body)).toBe(409);
      expect(res.body.error).toMatchObject({ code: "RESOLUTION_BLOCKED", unmet });
      const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(stored).toMatchObject({ currentStatus: "IN_PROGRESS", version: before });
      expect(await prisma.ticketStatusEvent.count({ where: { ticketId: ticket.id, toStatus: "RESOLVED" } })).toBe(0);
    };

    await expectBlocked([{ condition: "NO_COMPLETED_ACTION" }]);
    const open = await addAction(ticket.id, { status: "OPEN", result: null });
    await expectBlocked([{ condition: "OPEN_ACTIONS", count: 1 }, { condition: "NO_COMPLETED_ACTION" }]);
    await post(`/api/tickets/${ticket.id}/actions/${open.id}/complete`, cookies.staff, {
      version: open.version, result: "Half done.", followUpRequired: true, followUpNote: "Recheck on Friday.",
    });
    await expectBlocked([{ condition: "FOLLOW_UP_REQUIRED", actionId: open.id }]);

    // Ticket Detail explains the same thing before the attempt, to every role.
    for (const who of ["owner", "staff"] as const) {
      const detail = await get(`/api/tickets/${ticket.id}`, cookies[who]);
      expect(detail.body.resolutionGate, who).toEqual({ openActions: 0, completedActions: 1, latestFollowUpRequired: true, reopenedSinceWork: false, ready: false });
    }

    await addAction(ticket.id);
    const resolved = await changeStatus(ticket.id, "RESOLVED");
    expect(resolved.status).toBe(200);
    expect(resolved.body.resolutionGate).toMatchObject({ ready: true });
    expect(await prisma.ticketStatusEvent.findMany({ where: { ticketId: ticket.id }, select: { fromStatus: true, toStatus: true, actorId: true } }))
      .toEqual([{ fromStatus: "IN_PROGRESS", toStatus: "RESOLVED", actorId: ids.staff }]);
  });

  it("after a reopen, refuses the old work and accepts new work (BR-19 4, D-15)", async () => {
    const ticket = await newTicket();
    await addAction(ticket.id);
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
    expect((await changeStatus(ticket.id, "REOPENED")).status).toBe(200);

    const detail = await get(`/api/tickets/${ticket.id}`, cookies.staff);
    expect(detail.body.resolutionGate).toMatchObject({ reopenedSinceWork: true, ready: false });
    const again = await changeStatus(ticket.id, "RESOLVED");
    expect(again.status).toBe(409);
    expect(again.body.error.unmet).toEqual([{ condition: "NO_WORK_SINCE_REOPEN" }]);

    await addAction(ticket.id, { description: "Replaced the cable this time." });
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
  });

  it("measures from the latest reopen, so work before a second reopen does not count", async () => {
    const ticket = await newTicket();
    await addAction(ticket.id);
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
    expect((await changeStatus(ticket.id, "REOPENED")).status).toBe(200);
    await addAction(ticket.id, { description: "Replaced the cable after the first reopen." });
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
    expect((await changeStatus(ticket.id, "REOPENED")).status).toBe(200);
    const res = await changeStatus(ticket.id, "RESOLVED");
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.unmet).toEqual([{ condition: "NO_WORK_SINCE_REOPEN" }]);
  });
});

describe("WF-01 the reopen condition does not depend on whose clock is right (Earth2509's review of PR #95)", () => {
  // The API runs in this process, so faking only Node's Date shifts the
  // server's clock while the database keeps its own. That is exactly the skew
  // the gate must survive: one clock set completedAt, the other the reopen event.
  const shiftNode = (ms: number) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.now() + ms));
  };
  afterEach(() => {
    vi.useRealTimers();
  });

  it("accepts work completed straight after a reopen when Node's clock is behind the database's", async () => {
    const ticket = await newTicket();
    await addAction(ticket.id);
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
    shiftNode(-60_000);
    expect((await changeStatus(ticket.id, "REOPENED")).status).toBe(200);
    await addAction(ticket.id, { description: "Replaced the cable straight after the reopen." });
    const res = await changeStatus(ticket.id, "RESOLVED");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("accepts planned work completed straight after a reopen when Node's clock is behind the database's", async () => {
    // The same as above, through the complete route rather than recording finished work.
    const ticket = await newTicket();
    await addAction(ticket.id);
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
    shiftNode(-60_000);
    expect((await changeStatus(ticket.id, "REOPENED")).status).toBe(200);
    const planned = await addAction(ticket.id, { status: "OPEN", result: null, description: "Replace the cable." });
    const done = await post(`/api/tickets/${ticket.id}/actions/${planned.id}/complete`, cookies.staff, { version: planned.version, result: "Replaced it." });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const res = await changeStatus(ticket.id, "RESOLVED");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it("refuses work completed just before a reopen when Node's clock is ahead of the database's", async () => {
    const ticket = await newTicket();
    shiftNode(60_000);
    await addAction(ticket.id);
    expect((await changeStatus(ticket.id, "RESOLVED")).status).toBe(200);
    expect((await changeStatus(ticket.id, "REOPENED")).status).toBe(200);
    const res = await changeStatus(ticket.id, "RESOLVED");
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.unmet).toEqual([{ condition: "NO_WORK_SINCE_REOPEN" }]);
  });
});

describe("WF-02 the gate cannot race an Action write (AC-13, BR-14)", () => {
  it("refuses a resolve that waited while an open Action was being created", async () => {
    const ticket = await newTicket();
    await addAction(ticket.id);
    const version = await versionOf(ticket.id);
    const res = await whileHolding(
      ticketRow(ticket.id),
      () => post(`/api/tickets/${ticket.id}/status`, cookies.staff, { toStatus: "RESOLVED", version, resolutionSummary: "Replaced the access point and confirmed the connection." }).then((r) => r),
      {
        // The Action commits with the lock; the resolve must then see it.
        during: (tx) => tx.actionTaken.create({ data: { ticketId: ticket.id, actionAt: new Date(), description: "New work found.", followUpRequired: false, assigneeId: ids.staff, createdById: ids.staff, idempotencyKey: randomUUID() } }),
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.error.unmet).toEqual([{ condition: "OPEN_ACTIONS", count: 1 }]);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).currentStatus).toBe("IN_PROGRESS");
  });

  it("accepts a resolve that waited while the last open Action was completed, in a serial order", async () => {
    const ticket = await newTicket();
    const open = await addAction(ticket.id, { status: "OPEN", result: null });
    const version = await versionOf(ticket.id);
    const res = await whileHolding(
      ticketRow(ticket.id),
      () => post(`/api/tickets/${ticket.id}/status`, cookies.staff, { toStatus: "RESOLVED", version, resolutionSummary: "Replaced the access point and confirmed the connection." }).then((r) => r),
      {
        during: (tx) => tx.actionTaken.update({ where: { id: open.id }, data: { status: "COMPLETED", result: "Done.", performedById: ids.staff, completedAt: new Date() } }),
      },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id, status: "OPEN" } })).toBe(0);
  });
});

describe("WF-03 all 64 pairs, with completed work present (AC-14)", () => {
  // BR-18, transcribed by hand from the specification.
  const ALLOWED: Record<string, string[]> = {
    NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
    OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
    RESOLVED: ["CLOSED", "REOPENED"],
    REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
    CLOSED: [],
    CANCELLED: [],
  };
  const statuses = Object.keys(ALLOWED);
  const pairs = statuses.flatMap((from) => statuses.map((to) => [from, to] as const));

  it.each(pairs)("%s -> %s", async (from, to) => {
    const ticket = await newTicket(from);
    await prisma.actionTaken.create({
      data: { ticketId: ticket.id, actionAt: new Date(), description: "Done before the move.", result: "Done.", followUpRequired: false, status: "COMPLETED", assigneeId: ids.staff, createdById: ids.staff, performedById: ids.staff, completedAt: new Date(), idempotencyKey: randomUUID() },
    });
    const res = await changeStatus(ticket.id, to);
    const events = await prisma.ticketStatusEvent.findMany({ where: { ticketId: ticket.id }, select: { fromStatus: true, toStatus: true } });
    if (ALLOWED[from].includes(to)) {
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(events).toEqual([{ fromStatus: from, toStatus: to }]);
    } else {
      expect(res.status).toBe(409);
      // Every Lab 3 refusal is the code it always was.
      expect(res.body.error.code).toBe(from === "CLOSED" || from === "CANCELLED" ? "TICKET_TERMINAL" : "INVALID_STATUS_TRANSITION");
      expect(events).toEqual([]);
    }
  });
});

describe("WF-04 cancelling a Ticket cancels its open Actions (AC-15, BR-20)", () => {
  it("cancels exactly the open ones, with the Ticket's reason and actor, in the same transaction", async () => {
    const ticket = await newTicket();
    const a = await addAction(ticket.id, { status: "OPEN", result: null });
    const b = await addAction(ticket.id, { status: "OPEN", result: null });
    const done = await addAction(ticket.id);
    const res = await changeStatus(ticket.id, "CANCELLED", { reason: "Duplicate of an earlier ticket." });
    expect(res.status).toBe(200);
    for (const open of [a, b]) {
      expect(await prisma.actionTaken.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({
        status: "CANCELLED", cancelledById: ids.staff, cancellationReason: "Duplicate of an earlier ticket.", version: 2, performedById: null,
      });
    }
    expect(await prisma.actionTaken.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ status: "COMPLETED", version: 1, cancelledById: null });
  });
});

describe("WF-05 the history is append-only and stably ordered (AC-16)", () => {
  it("records creation and every change, oldest first, to every role that can read the Ticket", async () => {
    const created = await post("/api/tickets", cookies.owner, {
      categoryId, relatedSystemId, summary: "History trail ticket", description: "Created through the API so its creation is recorded.", requestedPriority: "LOW",
    }, randomUUID());
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as number;
    await prisma.ticket.update({ where: { id }, data: { ownerId: ids.staff } });
    for (const to of ["OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "CANCELLED"]) {
      expect((await changeStatus(id, to)).status, to).toBe(200);
    }

    const history = await get(`/api/tickets/${id}/history`, cookies.owner);
    expect(history.status).toBe(200);
    expect(history.body.recordedFromCreation).toBe(true);
    expect(history.body.items.map((e: { fromStatus: string | null; toStatus: string }) => [e.fromStatus, e.toStatus])).toEqual([
      [null, "NEW"], ["NEW", "OPEN"], ["OPEN", "IN_PROGRESS"], ["IN_PROGRESS", "WAITING_FOR_REQUESTER"], ["WAITING_FOR_REQUESTER", "CANCELLED"],
    ]);
    expect(history.body.items[0].actor).toMatchObject({ id: ids.owner, role: "REQUESTER" });
    expect(history.body.items[1].actor).toMatchObject({ id: ids.staff, role: "IT_STAFF" });

    expect((await get(`/api/tickets/${id}/history`, cookies.staff)).status).toBe(200);
    expect((await get(`/api/tickets/${id}/history`, cookies.admin)).status).toBe(200);
    const theirs = await get(`/api/tickets/${id}/history`, cookies.stranger);
    const missing = await get(`/api/tickets/99999999/history`, cookies.stranger);
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);

    // No write exists: every method on the path is a 404.
    for (const method of ["post", "patch", "put", "delete"] as const) {
      const res = await request(app)[method](`/api/tickets/${id}/history`).set("Cookie", cookies.staff).set("Origin", TEST_ORIGIN).send({});
      expect(res.status, method).toBe(404);
    }
  });

  it("breaks a timestamp tie by id, and says when history does not start at creation", async () => {
    const legacy = await newTicket("OPEN");
    const noHistory = await get(`/api/tickets/${legacy.id}/history`, cookies.staff);
    expect(noHistory.body).toEqual({ items: [], recordedFromCreation: false });

    const at = new Date();
    const made = [];
    for (const [from, to] of [["OPEN", "IN_PROGRESS"], ["IN_PROGRESS", "WAITING_FOR_REQUESTER"], ["WAITING_FOR_REQUESTER", "IN_PROGRESS"]] as const) {
      made.push((await prisma.ticketStatusEvent.create({ data: { ticketId: legacy.id, fromStatus: from, toStatus: to, actorId: ids.staff, createdAt: at } })).id);
    }
    const tied = await get(`/api/tickets/${legacy.id}/history`, cookies.staff);
    expect(tied.body.items.map((e: { id: number }) => e.id)).toEqual(made);
    expect(tied.body.recordedFromCreation).toBe(false);
  });
});

describe("WF-06 the Requester's indication is advice, not evidence (AC-17)", () => {
  it("leaves the status unchanged and the gate closed", async () => {
    const ticket = await newTicket("OPEN");
    const indicated = await post(`/api/tickets/${ticket.id}/resolution-indication`, cookies.owner, {});
    expect(indicated.status).toBe(200);
    expect(indicated.body).toMatchObject({ currentStatus: "OPEN", resolutionGate: { ready: false } });
    const res = await changeStatus(ticket.id, "RESOLVED");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("RESOLUTION_BLOCKED");
  });
});
