import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";

// API-11, the staff half of API-12, and API-13 in docs/lab-04/tests.md
// (AC-18 to AC-21), against the real database: the IT Staff and Administrator
// dashboard of BR-27 and BR-28.
//
// The staff dashboard counts across every Ticket in the test schema, so each
// global card is compared with an independent Prisma count taken just after
// the request. Test files run one at a time (vitest.config.ts), so no other
// suite writes in between. The caller's own cards (S-2, S-3) are compared with
// expectations written by hand, because every row they count is this file's.

const prisma = getPrisma();
const DOMAIN = "@staff-dashboard-lab4.local";
const ACTIVE = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] as const;
const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"] as const;
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const ids = { requester: 0, me: 0, colleague: 0, idle: 0, admin: 0, inactive: 0 };
const cookies = { requester: "", me: "", colleague: "", idle: "", admin: "" };
let categoryId = 0;
let relatedSystemId = 0;
const myOpenActionIds: number[] = [];

async function ticket(status: string, extra: Record<string, unknown> = {}) {
  return (await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2099-${randomUUID().slice(0, 12)}`, requesterId: ids.requester, categoryId, relatedSystemId,
      summary: `Staff dashboard ${status}`, description: "Created by the Lab 4 staff dashboard suite.",
      requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: status as never, idempotencyKey: randomUUID(),
      ...extra,
    },
    select: { id: true },
  })).id;
}

async function action(ticketId: number, assigneeId: number, actionAt: Date, status: "OPEN" | "COMPLETED" = "OPEN") {
  return (await prisma.actionTaken.create({
    data: {
      ticketId, assigneeId, createdById: assigneeId, actionAt, description: `Work at ${actionAt.toISOString()}`,
      followUpRequired: false, status, idempotencyKey: randomUUID(),
      ...(status === "COMPLETED" ? { performedById: assigneeId, completedAt: actionAt, result: "Done." } : {}),
    },
    select: { id: true },
  })).id;
}

const dashboard = (cookie: string, query: Record<string, string> = {}) =>
  request(app).get("/api/dashboard/staff").query(query).set("Cookie", cookie);

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
    prisma.category.create({ data: { name: `Staff dashboard probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Staff dashboard system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (fullName: string, role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR", isActive = true) =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role, isActive } })).id;
  ids.requester = await make("Nadia Rahman", "REQUESTER");
  ids.me = await make("Grace Okafor", "IT_STAFF");
  ids.colleague = await make("Lalita Chai", "IT_STAFF");
  ids.idle = await make("Wichai Boonmee", "IT_STAFF");
  ids.admin = await make("Pim Srisawat", "ADMINISTRATOR");
  ids.inactive = await make("Former Staff", "IT_STAFF", false);
  for (const who of ["requester", "me", "colleague", "idle", "admin"] as const) cookies[who] = await sessionCookieFor(ids[who]);

  // S-2: mine and active (three), mine but not active (two, excluded).
  for (const status of ["OPEN", "IN_PROGRESS", "REOPENED"]) await ticket(status, { ownerId: ids.me });
  for (const status of ["RESOLVED", "CLOSED"]) await ticket(status, { ownerId: ids.me });
  // S-1 and S-4 fixtures: unassigned active, and indicated active and resolved.
  await ticket("NEW");
  await ticket("WAITING_FOR_REQUESTER", { requesterResolvedAt: new Date() });
  await ticket("RESOLVED", { requesterResolvedAt: new Date() });
  // S-6 and Urgent active: six urgent active (the list shows five), one urgent closed.
  for (let i = 0; i < 6; i += 1) await ticket("OPEN", { itPriority: "URGENT", ownerId: ids.colleague });
  await ticket("CLOSED", { itPriority: "URGENT" });

  // S-3: eleven open Actions assigned to me on an active Ticket (the list shows
  // ten), two of them sharing an Action Date/Time so the id decides; plus work
  // that must not count: open but a colleague's, and mine but completed.
  const workTicket = await ticket("IN_PROGRESS", { ownerId: ids.colleague });
  const base = Date.UTC(2026, 8, 20, 9, 0);
  for (let i = 0; i < 10; i += 1) myOpenActionIds.push(await action(workTicket, ids.me, new Date(base + i * 3_600_000)));
  myOpenActionIds.push(await action(workTicket, ids.me, new Date(base + 2 * 3_600_000)));
  await action(workTicket, ids.colleague, new Date(base));
  await action(workTicket, ids.me, new Date(base - 3_600_000), "COMPLETED");
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

const activeWhere = { currentStatus: { in: [...ACTIVE] } };

describe("API-11 every staff card and breakdown equals an independent count (BR-27)", () => {
  it("S-1 and S-4 match the database; S-2 and S-3 match this staff member's own rows", async () => {
    const res = await dashboard(cookies.me);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const { cards } = res.body;
    expect(cards.unassignedActive.value).toBe(await prisma.ticket.count({ where: { ...activeWhere, ownerId: null } }));
    expect(cards.requesterIndicated.value).toBe(await prisma.ticket.count({ where: { ...activeWhere, requesterResolvedAt: { not: null } } }));
    expect(cards.myActive.value).toBe(3);
    expect(cards.myOpenActions).toEqual({ value: 11, query: null });
  });

  it("S-5 has all eight statuses, zeros included, each equal to its count, summing to every Ticket", async () => {
    const { byStatus } = (await dashboard(cookies.me)).body;
    expect(Object.keys(byStatus)).toEqual([...STATUSES]);
    for (const status of STATUSES) {
      expect(byStatus[status].value).toBe(await prisma.ticket.count({ where: { currentStatus: status } }));
    }
    const sum = STATUSES.reduce((total, status) => total + byStatus[status].value, 0);
    expect(sum).toBe(await prisma.ticket.count());
  });

  it("S-6 has all four priorities among active Tickets, each equal to its count", async () => {
    const { activeByItPriority } = (await dashboard(cookies.me)).body;
    expect(Object.keys(activeByItPriority)).toEqual([...PRIORITIES]);
    for (const priority of PRIORITIES) {
      expect(activeByItPriority[priority].value).toBe(await prisma.ticket.count({ where: { ...activeWhere, itPriority: priority } }));
    }
  });

  it("lists My open Actions oldest first with the id breaking a tie, capped at 10, each with its Ticket", async () => {
    const { myOpenActions } = (await dashboard(cookies.me)).body.lists;
    expect(myOpenActions.total).toBe(11);
    // By hand: hours 0, 1, then the two at hour 2 (lower id first), 3 ... 8.
    const [h0, h1, h2, h3, h4, h5, h6, h7, h8, , extraAtH2] = myOpenActionIds;
    expect(myOpenActions.items.map((item: { actionId: number }) => item.actionId)).toEqual([h0, h1, h2, extraAtH2, h3, h4, h5, h6, h7, h8]);
    expect(Object.keys(myOpenActions.items[0]).sort()).toEqual(["actionAt", "actionId", "description", "summary", "ticketId", "ticketNumber"]);
  });

  it("no Action counted by S-3 belongs to a Ticket that is not active (the invariant BR-27 relies on)", async () => {
    const stray = await prisma.actionTaken.count({ where: { status: "OPEN", ticket: { currentStatus: { notIn: [...ACTIVE] } } } });
    expect(stray).toBe(0);
  });

  it("lists Urgent active Tickets longest-waiting first, capped at 5, and Recently updated newest first, capped at 10", async () => {
    const { urgentActive, recentlyUpdated } = (await dashboard(cookies.me)).body.lists;
    const urgentWhere = { ...activeWhere, itPriority: "URGENT" as const };
    expect(urgentActive.total).toBe(await prisma.ticket.count({ where: urgentWhere }));
    const urgentExpected = await prisma.ticket.findMany({ where: urgentWhere, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 5, select: { id: true } });
    expect(urgentActive.items.map((t: { id: number }) => t.id)).toEqual(urgentExpected.map((t) => t.id));
    expect(urgentActive.items.every((t: { itPriority: string; currentStatus: string }) => t.itPriority === "URGENT" && (ACTIVE as readonly string[]).includes(t.currentStatus))).toBe(true);

    expect(recentlyUpdated.total).toBe(await prisma.ticket.count());
    expect(recentlyUpdated.items).toHaveLength(10);
    const times = recentlyUpdated.items.map((t: { updatedAt: string }) => new Date(t.updatedAt).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(Object.keys(recentlyUpdated.items[0]).sort()).toEqual(["currentStatus", "id", "itPriority", "owner", "summary", "ticketNumber", "updatedAt"]);
  });

  it("gives a staff member with no work 0 on S-2 and S-3, and an empty My open Actions", async () => {
    const res = await dashboard(cookies.idle);
    expect(res.body.cards.myActive.value).toBe(0);
    expect(res.body.cards.myOpenActions.value).toBe(0);
    expect(res.body.lists.myOpenActions).toEqual({ total: 0, items: [] });
  });
});

describe("API-12 every staff card's query, sent to the Queue as the same user, returns what it counted (BR-30)", () => {
  it("the four cards with a query, every status row and every priority row", async () => {
    const body = (await dashboard(cookies.me)).body;
    const withQuery = [
      ...Object.entries(body.cards).filter(([, c]) => (c as { query: unknown }).query !== null),
      ...Object.entries(body.byStatus).map(([k, c]) => [`byStatus.${k}`, c] as const),
      ...Object.entries(body.activeByItPriority).map(([k, c]) => [`activeByItPriority.${k}`, c] as const),
    ] as Array<[string, { value: number; query: Record<string, string> }]>;
    expect(withQuery).toHaveLength(3 + 8 + 4);
    for (const [name, c] of withQuery) {
      const list = await request(app).get("/api/staff/tickets").query(c.query).set("Cookie", cookies.me);
      expect(list.status, `${name}: ${JSON.stringify(list.body)}`).toBe(200);
      expect(list.body.totalItems, name).toBe(c.value);
    }
  });
});

describe("API-13 roles and the Administrator's user counts (BR-28, BR-29)", () => {
  it("adds the user-account block for an Administrator, matching the User table", async () => {
    const res = await dashboard(cookies.admin);
    expect(res.status).toBe(200);
    for (const role of ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"] as const) {
      expect(res.body.users[role]).toEqual({
        active: await prisma.user.count({ where: { role, isActive: true } }),
        inactive: await prisma.user.count({ where: { role, isActive: false } }),
        query: { role },
      });
    }
    expect(res.body.users.IT_STAFF.inactive).toBeGreaterThanOrEqual(1);
  });

  it("gives the Administrator S-2 and S-3 for themselves", async () => {
    const res = await dashboard(cookies.admin);
    expect(res.body.cards.myActive.value).toBe(await prisma.ticket.count({ where: { ...activeWhere, ownerId: ids.admin } }));
    expect(res.body.cards.myOpenActions.value).toBe(0);
  });

  it("leaves the key out entirely for IT Staff", async () => {
    const res = await dashboard(cookies.me);
    expect(res.body).not.toHaveProperty("users");
  });

  it("refuses a Requester with 403, and any query parameter with 400", async () => {
    const asRequester = await dashboard(cookies.requester);
    expect(asRequester.status).toBe(403);
    expect(asRequester.body.error.code).toBe("FORBIDDEN");
    const withParameter = await dashboard(cookies.me, { owner: "me" });
    expect(withParameter.status).toBe(400);
    expect(withParameter.body.error.fieldErrors).toHaveProperty("owner");
  });
});
