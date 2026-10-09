import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";

// API-10 and the Requester half of API-12 in docs/lab-04/tests.md (AC-02,
// AC-19, AC-20), against the real database: the Requester dashboard of BR-26.
// Every expected value is built by hand from this file's own fixtures, or
// counted independently with Prisma; none is read back from the route.

const prisma = getPrisma();
const DOMAIN = "@requester-dashboard-lab4.local";
const ACTIVE = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"];
const ids = { me: 0, other: 0, empty: 0, staff: 0 };
const cookies = { me: "", other: "", empty: "", staff: "" };
let categoryId = 0;
let relatedSystemId = 0;
let dbNow = new Date();
const minutesAgo = (m: number) => new Date(dbNow.getTime() - m * 60_000);
const HOUR = 60;

/** My Tickets for each status, and the other Requester's canaries, which must appear nowhere. */
const mine: Record<string, number[]> = {};
const canaryIds = new Set<number>();
const canaryNumbers = new Set<string>();

async function ticket(requesterId: number, status: string, updatedAt: Date, label: string) {
  const number = `TKT-2098-${randomUUID().slice(0, 12)}`;
  const created = await prisma.ticket.create({
    data: {
      ticketNumber: number, requesterId, categoryId, relatedSystemId, summary: label,
      description: "Created by the Lab 4 Requester dashboard suite.",
      requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: status as never,
      idempotencyKey: randomUUID(), updatedAt,
    },
    select: { id: true },
  });
  return { id: created.id, number };
}

async function resolvedAt(ticketId: number, at: Date) {
  await prisma.ticketStatusEvent.create({ data: { ticketId, fromStatus: "IN_PROGRESS", toStatus: "RESOLVED", actorId: ids.staff, createdAt: at } });
}

const dashboard = (cookie: string, query: Record<string, string> = {}) =>
  request(app).get("/api/dashboard/requester").query(query).set("Cookie", cookie);

async function cleanUp() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await deleteTickets({ requesterId: { in: userIds } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

// The fixtures, named so the expected orders below can be written by hand.
const f: Record<string, number> = {};

beforeAll(async () => {
  await cleanUp();
  const [category, system] = await Promise.all([
    prisma.category.create({ data: { name: `Requester dashboard probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Requester dashboard system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (fullName: string, role: "REQUESTER" | "IT_STAFF" = "REQUESTER") =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role } })).id;
  ids.me = await make("Nadia Rahman");
  ids.other = await make("Somchai Pattana");
  ids.empty = await make("Arthit Wongsa");
  ids.staff = await make("Grace Okafor", "IT_STAFF");
  for (const who of ["me", "other", "empty", "staff"] as const) cookies[who] = await sessionCookieFor(ids[who]);

  // The database clock, as the route uses it (D-08), so the window edges below
  // are measured from the same instant source.
  [{ now: dbNow }] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;

  const add = async (key: string, status: string, ageMinutes: number) => {
    const t = await ticket(ids.me, status, minutesAgo(ageMinutes), key);
    f[key] = t.id;
    (mine[status] ??= []).push(t.id);
  };
  // Three waiting, four resolved: Needs your attention has 7 and shows 5,
  // all three waiting first even though a resolved one is newer.
  await add("waitOld", "WAITING_FOR_REQUESTER", 50);
  await add("waitMid", "WAITING_FOR_REQUESTER", 30);
  await add("waitTieA", "WAITING_FOR_REQUESTER", 10);
  await add("resNewest", "RESOLVED", 1);
  await add("resB", "RESOLVED", 20);
  await add("resC", "RESOLVED", 40);
  await add("resD", "RESOLVED", 60);
  await add("new1", "NEW", 5);
  await add("open1", "OPEN", 6);
  await add("reopened1", "REOPENED", 7);
  await add("closed1", "CLOSED", 3);
  await add("cancelled1", "CANCELLED", 2);
  // A second waiting Ticket at exactly waitTieA's instant: the higher id comes first.
  const tie = await ticket(ids.me, "WAITING_FOR_REQUESTER", minutesAgo(10), "waitTieB");
  f.waitTieB = tie.id;
  mine.WAITING_FOR_REQUESTER.push(tie.id);

  // Resolutions. Window = the last 168 hours.
  await resolvedAt(f.resNewest, minutesAgo(30));                 // inside
  await resolvedAt(f.resB, minutesAgo(168 * HOUR - 1));          // just inside
  await resolvedAt(f.resC, minutesAgo(168 * HOUR + 1));          // just outside
  await resolvedAt(f.resD, minutesAgo(200 * HOUR));              // outside ...
  await resolvedAt(f.resD, minutesAgo(90));                      // ... then resolved again, inside: counts once, at 90
  await resolvedAt(f.closed1, minutesAgo(60));                   // since closed: still a resolution in the window

  // The other Requester: one Ticket in every status, resolved inside the window.
  for (const status of ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"]) {
    const t = await ticket(ids.other, status, minutesAgo(0.5), `canary ${status}`);
    canaryIds.add(t.id);
    canaryNumbers.add(t.number);
    await resolvedAt(t.id, minutesAgo(5));
  }
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

const idsIn = (items: Array<{ id: number }>) => items.map((item) => item.id);

describe("API-10 the Requester dashboard counts the caller's Tickets only (BR-26)", () => {
  it("each card equals an independent count over the caller's rows", async () => {
    const res = await dashboard(cookies.me);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const count = (where: object) => prisma.ticket.count({ where: { requesterId: ids.me, ...where } });
    expect(res.body.cards.activeTickets.value).toBe(await count({ currentStatus: { in: ACTIVE } }));
    expect(res.body.cards.waitingForMe.value).toBe(await count({ currentStatus: "WAITING_FOR_REQUESTER" }));
    expect(res.body.cards.resolvedAwaitingClosure.value).toBe(await count({ currentStatus: "RESOLVED" }));
    // And by hand: 4 waiting + NEW + OPEN + REOPENED; 4 waiting; 4 resolved.
    expect(res.body.cards.activeTickets.value).toBe(7);
    expect(res.body.cards.waitingForMe.value).toBe(4);
    expect(res.body.cards.resolvedAwaitingClosure.value).toBe(4);
  });

  it("R-4 counts distinct Tickets whose latest resolution is inside 168 hours, on the window's edges", async () => {
    const res = await dashboard(cookies.me);
    // resNewest, resB (one minute inside), resD (resolved again inside), closed1.
    // Not resC, resolved one minute outside.
    expect(res.body.cards.resolvedLast7Days).toEqual({ value: 4, query: null });
    const start = new Date(res.body.windowStart).getTime();
    expect(new Date(res.body.generatedAt).getTime() - start).toBe(168 * 60 * 60 * 1000);
  });

  it("lists Needs your attention as waiting first, then resolved, newest first with id breaking a tie, capped at 5", async () => {
    const { needsAttention } = (await dashboard(cookies.me)).body.lists;
    expect(needsAttention.total).toBe(8);
    expect(idsIn(needsAttention.items)).toEqual([
      Math.max(f.waitTieA, f.waitTieB), Math.min(f.waitTieA, f.waitTieB), f.waitMid, f.waitOld, f.resNewest,
    ]);
  });

  it("lists Recently updated across every own Ticket, newest first, capped at 5", async () => {
    const { recentlyUpdated } = (await dashboard(cookies.me)).body.lists;
    expect(recentlyUpdated.total).toBe(await prisma.ticket.count({ where: { requesterId: ids.me } }));
    expect(idsIn(recentlyUpdated.items)).toEqual([f.resNewest, f.cancelled1, f.closed1, f.new1, f.open1]);
  });

  it("lists Recently resolved by the latest resolution, newest first, with resolvedAt that event's time", async () => {
    const { recentlyResolved } = (await dashboard(cookies.me)).body.lists;
    expect(recentlyResolved.total).toBe(4);
    expect(idsIn(recentlyResolved.items)).toEqual([f.resNewest, f.closed1, f.resD, f.resB]);
    const resD = recentlyResolved.items.find((item: { id: number }) => item.id === f.resD);
    expect(new Date(resD.resolvedAt).getTime()).toBe(minutesAgo(90).getTime());
  });

  it("returns only the card fields the contract names", async () => {
    const { recentlyUpdated } = (await dashboard(cookies.me)).body.lists;
    expect(Object.keys(recentlyUpdated.items[0]).sort()).toEqual(["currentStatus", "id", "requestedPriority", "summary", "ticketNumber", "updatedAt"]);
  });

  it("never carries another Requester's Ticket, anywhere in the response", async () => {
    const res = await dashboard(cookies.me);
    const text = JSON.stringify(res.body);
    for (const number of canaryNumbers) expect(text).not.toContain(number);
    const everyId = Object.values(res.body.lists).flatMap((list) => idsIn((list as { items: Array<{ id: number }> }).items));
    expect(everyId.some((id) => canaryIds.has(id))).toBe(false);
    // The other Requester sees their own instead.
    const theirs = await dashboard(cookies.other);
    expect(theirs.body.cards.resolvedLast7Days.value).toBe(8);
    expect(theirs.body.cards.activeTickets.value).toBe(5);
  });

  it("gives a Requester with no Tickets every value 0 and every list empty, nothing omitted", async () => {
    const res = await dashboard(cookies.empty);
    expect(res.status).toBe(200);
    for (const name of ["activeTickets", "waitingForMe", "resolvedAwaitingClosure", "resolvedLast7Days"]) {
      expect(res.body.cards[name].value).toBe(0);
    }
    for (const name of ["needsAttention", "recentlyUpdated", "recentlyResolved"]) {
      expect(res.body.lists[name]).toEqual({ total: 0, items: [] });
    }
  });
});

describe("API-12 every Requester card's query, sent to My Tickets, returns what it counted (BR-30)", () => {
  it.each(["activeTickets", "waitingForMe", "resolvedAwaitingClosure"])("%s", async (name) => {
    const { cards } = (await dashboard(cookies.me)).body;
    const list = await request(app).get("/api/tickets").query(cards[name].query).set("Cookie", cookies.me);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.totalItems).toBe(cards[name].value);
  });
});

describe("Requester dashboard refusals (BR-29, api-spec §6)", () => {
  it("refuses IT Staff with 403", async () => {
    const res = await dashboard(cookies.staff);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses any query parameter with 400, naming it", async () => {
    const res = await dashboard(cookies.me, { windowHours: "24" });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("windowHours");
  });
});
