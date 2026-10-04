import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";

// API-15 in docs/lab-04/tests.md (D-17), against the real database: My Tickets
// sorts by last update, which the Requester dashboard's Recently updated View
// all links to. The Tickets are created in one order and updated in another, so
// a list that sorted by Ticket date or by id could not pass.

const prisma = getPrisma();
const DOMAIN = "@my-tickets-sort-lab4.local";
const TAG = randomUUID().slice(0, 8);
const ids = { owner: 0, other: 0 };
const cookies = { owner: "", other: "" };
let categoryId = 0;
let relatedSystemId = 0;
// Ticket number suffix -> id. Created A, B, C, D in that order.
const t = new Map<string, number>();
let canary = 0;

async function ticket(requesterId: number, suffix: string, createdAt: string, updatedAt: string) {
  const created = await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2097-${TAG}-${suffix}`, requesterId, categoryId, relatedSystemId,
      summary: `Sort probe ${suffix}`, description: "Created by the Lab 4 My Tickets sort suite.",
      requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: "OPEN", idempotencyKey: randomUUID(),
      createdAt: new Date(createdAt),
    },
    select: { id: true },
  });
  // Set after the insert, so @updatedAt cannot overwrite it.
  await prisma.$executeRaw`UPDATE "Ticket" SET "updatedAt" = ${new Date(updatedAt)} WHERE id = ${created.id}`;
  return created.id;
}

const myTickets = (cookie: string, query: Record<string, string>) =>
  request(app).get("/api/tickets").query({ pageSize: "50", ...query }).set("Cookie", cookie);

const order = (body: { items: Array<{ id: number }> }) => body.items.map((item) => item.id);

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
    prisma.category.create({ data: { name: `Sort probe ${TAG}` } }),
    prisma.relatedSystem.create({ data: { name: `Sort probe system ${TAG}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (fullName: string) =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: "REQUESTER" } })).id;
  ids.owner = await make("Nadia Sortprobe");
  ids.other = await make("Somchai Sortprobe");
  cookies.owner = await sessionCookieFor(ids.owner);
  cookies.other = await sessionCookieFor(ids.other);
  // Last updated: B, then C and D at the same instant, then A.
  t.set("A", await ticket(ids.owner, "A", "2026-09-01T09:00:00Z", "2026-09-02T09:00:00Z"));
  t.set("B", await ticket(ids.owner, "B", "2026-09-03T09:00:00Z", "2026-09-20T09:00:00Z"));
  t.set("C", await ticket(ids.owner, "C", "2026-09-05T09:00:00Z", "2026-09-10T09:00:00Z"));
  t.set("D", await ticket(ids.owner, "D", "2026-09-07T09:00:00Z", "2026-09-10T09:00:00Z"));
  // The newest update of all, but another Requester's.
  canary = await ticket(ids.other, "X", "2026-09-08T09:00:00Z", "2026-09-30T09:00:00Z");
}, 60_000);

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("API-15 My Tickets sorts by last update (D-17)", () => {
  it("updatedAt desc lists the most recently updated first, ties by Ticket Number high to low", async () => {
    const res = await myTickets(cookies.owner, { sortBy: "updatedAt", sortOrder: "desc" });
    expect(res.status).toBe(200);
    expect(order(res.body)).toEqual(["B", "D", "C", "A"].map((k) => t.get(k)));
  });

  it("updatedAt asc reverses the dates; Ticket Number high to low still breaks the tie", async () => {
    const res = await myTickets(cookies.owner, { sortBy: "updatedAt", sortOrder: "asc" });
    expect(res.status).toBe(200);
    expect(order(res.body)).toEqual(["A", "D", "C", "B"].map((k) => t.get(k)));
  });

  it("is not the Ticket date order, which the default still gives", async () => {
    const res = await myTickets(cookies.owner, {});
    expect(order(res.body)).toEqual(["D", "C", "B", "A"].map((k) => t.get(k)));
  });

  it("stays scoped to the caller: another Requester's newer update never appears", async () => {
    const res = await myTickets(cookies.owner, { sortBy: "updatedAt", sortOrder: "desc" });
    expect(order(res.body)).not.toContain(canary);
    expect(res.body.totalItems).toBe(4);
  });

  it("still refuses a sort the API does not offer", async () => {
    const res = await myTickets(cookies.owner, { sortBy: "summary", sortOrder: "desc" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fieldErrors).toHaveProperty("sortBy");
  });
});
