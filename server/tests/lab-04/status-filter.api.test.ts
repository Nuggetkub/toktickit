import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";

// API-14 in docs/lab-04/tests.md (AC-22), against the real database: the
// `currentStatus` list filter of BR-30. This file holds the My Tickets half
// (issue #78); the Ticket Queue half arrives with the dashboards (issue #84).

const prisma = getPrisma();
const DOMAIN = "@status-filter-lab4.local";
const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"] as const;
const ACTIVE = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED";
const ids = { owner: 0, other: 0 };
const cookies = { owner: "", other: "" };
// The owner's Ticket id for each status, and the other Requester's, which must never appear.
const mine = new Map<string, number>();
const canaries = new Set<number>();
let categoryId = 0;
let relatedSystemId = 0;

async function ticket(requesterId: number, status: string, requestedPriority = "MEDIUM") {
  const created = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2096-${randomUUID().slice(0, 12)}`, requesterId, categoryId, relatedSystemId,
      summary: `A ${status} ticket`, description: "Created by the Lab 4 status filter suite.",
      requestedPriority: requestedPriority as never, itPriority: "MEDIUM", currentStatus: status as never,
      idempotencyKey: randomUUID(),
    },
    select: { id: true },
  });
  return created.id;
}

const myTickets = (cookie: string, query: Record<string, string>) =>
  request(app).get("/api/tickets").query({ pageSize: "50", ...query }).set("Cookie", cookie);

const idsOf = (body: { items: Array<{ id: number }> }) => body.items.map((item) => item.id).sort((a, b) => a - b);
const expected = (...statuses: string[]) => statuses.map((s) => mine.get(s)!).sort((a, b) => a - b);

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
    prisma.category.create({ data: { name: `Status filter probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Status filter system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (fullName: string) =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: "REQUESTER" } })).id;
  ids.owner = await make("Nadia Rahman");
  ids.other = await make("Somchai Pattana");
  cookies.owner = await sessionCookieFor(ids.owner);
  cookies.other = await sessionCookieFor(ids.other);
  for (const status of STATUSES) {
    mine.set(status, await ticket(ids.owner, status));
    canaries.add(await ticket(ids.other, status));
  }
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("API-14 My Tickets filters by one or more statuses (BR-30, issue #78)", () => {
  it.each(STATUSES)("currentStatus=%s returns exactly the caller's Ticket in that status", async (status) => {
    const res = await myTickets(cookies.owner, { currentStatus: status });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(idsOf(res.body)).toEqual(expected(status));
    expect(res.body.totalItems).toBe(1);
  });

  it("the five active statuses return those five and not RESOLVED, CLOSED or CANCELLED", async () => {
    const res = await myTickets(cookies.owner, { currentStatus: ACTIVE });
    expect(res.status).toBe(200);
    expect(idsOf(res.body)).toEqual(expected("NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"));
    expect(res.body.totalItems).toBe(5);
  });

  it("a list is the union of its members, in any order", async () => {
    const res = await myTickets(cookies.owner, { currentStatus: "CLOSED,RESOLVED" });
    expect(idsOf(res.body)).toEqual(expected("RESOLVED", "CLOSED"));
  });

  it("stays scoped to the caller: the other Requester's Tickets in the same statuses never appear", async () => {
    const all = await myTickets(cookies.owner, { currentStatus: STATUSES.join(",") });
    expect(all.body.totalItems).toBe(8);
    expect(idsOf(all.body).some((id) => canaries.has(id))).toBe(false);
    const theirs = await myTickets(cookies.other, { currentStatus: "RESOLVED" });
    expect(theirs.body.totalItems).toBe(1);
    expect(canaries.has(theirs.body.items[0].id)).toBe(true);
  });

  it("combines with the other filters rather than replacing them", async () => {
    const urgent = await ticket(ids.owner, "OPEN", "URGENT");
    try {
      const res = await myTickets(cookies.owner, { currentStatus: "OPEN,NEW", requestedPriority: "URGENT" });
      expect(idsOf(res.body)).toEqual([urgent]);
    } finally {
      await deleteTickets({ id: urgent });
    }
  });

  it.each([
    ["an unknown member", "NEW,DONE"],
    ["a repeated member", "NEW,NEW"],
    ["an empty value", ""],
    ["a trailing comma", "NEW,"],
    ["a lower-case member", "open"],
  ])("refuses %s with 400 naming currentStatus", async (_label, value) => {
    const res = await myTickets(cookies.owner, { currentStatus: value });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(["currentStatus"]);
  });

  it("no longer answers that the filter arrives in Lab 3", async () => {
    const res = await myTickets(cookies.owner, { currentStatus: "DONE" });
    expect(res.body.error.fieldErrors.currentStatus).not.toMatch(/Lab 3/);
    expect(res.body.error.fieldErrors.currentStatus).toMatch(/comma-separated list/);
  });
});
