import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { REQUESTER_HEADER } from "../../src/requester-context.js";

// API-06, API-07, API-08, API-09 — AC-08, AC-09, AC-10.
//
// Against the real database. Scoping is the security-relevant claim in this
// sprint and a mocked `findMany` cannot make it: it returns what the mock was
// told, so the test would prove the route builds a `where` clause and nothing
// about whether PostgreSQL honours it.

const prisma = getPrisma();

let ownerId = 0;
let otherId = 0;
let networkId = 0;
let hardwareId = 0;
let wifiId = 0;

const ticketIds: number[] = [];

async function create(
  requesterId: number,
  summary: string,
  priority: string,
  categoryId: number,
  relatedSystemId: number,
) {
  const res = await request(app)
    .post("/api/tickets")
    .set(REQUESTER_HEADER, String(requesterId))
    .set("Idempotency-Key", randomUUID())
    .send({
      categoryId,
      relatedSystemId,
      summary,
      description: "Seeded by the My Tickets suite so the list has something to page through.",
      requestedPriority: priority,
    });
  if (res.status !== 201) throw new Error(`create failed ${res.status}: ${JSON.stringify(res.body)}`);
  ticketIds.push(res.body.id);
  return res.body;
}

function list(requesterId: number, query: Record<string, string | number> = {}) {
  return request(app).get("/api/tickets").set(REQUESTER_HEADER, String(requesterId)).query(query);
}

beforeAll(async () => {
  const [requesters, network, hardware, wifi] = await Promise.all([
    prisma.requester.findMany({ where: { isActive: true }, orderBy: { id: "asc" }, take: 2 }),
    prisma.category.findFirstOrThrow({ where: { name: "Network" } }),
    prisma.category.findFirstOrThrow({ where: { name: "Hardware" } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { name: "Campus Wi-Fi" } }),
  ]);
  ownerId = requesters[0].id;
  otherId = requesters[1].id;
  networkId = network.id;
  hardwareId = hardware.id;
  wifiId = wifi.id;

  // Created through the API, sequentially, so ticket numbers ascend with time.
  await create(ownerId, "ALPHA campus wifi drops nightly", "LOW", networkId, wifiId);
  await create(ownerId, "BRAVO laptop will not boot", "URGENT", hardwareId, wifiId);
  await create(ownerId, "CHARLIE vpn refuses the handshake", "MEDIUM", networkId, wifiId);
  await create(otherId, "DELTA mailbox is full", "HIGH", hardwareId, wifiId);
}, 60000);

describe("GET /api/tickets — ownership", () => {
  it("returns only the header requester's tickets", async () => {
    const mine = await list(ownerId, { pageSize: 50 });
    const theirs = await list(otherId, { pageSize: 50 });

    expect(mine.status).toBe(200);
    expect(mine.body.items.map((t: { summary: string }) => t.summary)).toEqual(
      expect.arrayContaining(["ALPHA campus wifi drops nightly"]),
    );
    expect(mine.body.items.some((t: { summary: string }) => t.summary.startsWith("DELTA"))).toBe(false);
    expect(theirs.body.items.every((t: { summary: string }) => t.summary.startsWith("DELTA"))).toBe(true);
  });

  it("refuses a request with no requester context", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("REQUESTER_CONTEXT_REQUIRED");
  });
});

describe("GET /api/tickets — search and filters", () => {
  it("matches Summary case-insensitively", async () => {
    const res = await list(ownerId, { search: "alpha" });
    expect(res.body.totalItems).toBe(1);
    expect(res.body.items[0].summary).toBe("ALPHA campus wifi drops nightly");
  });

  it("matches Ticket Number as well as Summary", async () => {
    const all = await list(ownerId, { pageSize: 50 });
    const number = all.body.items[0].ticketNumber as string;

    const res = await list(ownerId, { search: number.toLowerCase() });
    expect(res.body.items.map((t: { ticketNumber: string }) => t.ticketNumber)).toContain(number);
  });

  it("filters by Category and by Requested Priority", async () => {
    const byCategory = await list(ownerId, { categoryId: networkId, pageSize: 50 });
    expect(byCategory.body.items.every((t: { category: { id: number } }) => t.category.id === networkId)).toBe(true);

    const byPriority = await list(ownerId, { requestedPriority: "URGENT", pageSize: 50 });
    expect(byPriority.body.items.every((t: { requestedPriority: string }) => t.requestedPriority === "URGENT")).toBe(true);
  });

  it("returns an empty page rather than an error when nothing matches", async () => {
    const res = await list(ownerId, { search: "zzzz-nothing-matches-this" });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalItems).toBe(0);
    // A reader is always on page 1 of at least 1 — never "page 1 of 0".
    expect(res.body.totalPages).toBe(1);
  });
});

describe("GET /api/tickets — sorting", () => {
  it("sorts Requested Priority by severity, not alphabetically", async () => {
    const res = await list(ownerId, { sortBy: "requestedPriority", sortOrder: "asc", pageSize: 50 });
    const order = res.body.items.map((t: { requestedPriority: string }) => t.requestedPriority);

    // Alphabetical would be LOW, MEDIUM, URGENT — the same here by coincidence,
    // so assert against the declared enum order explicitly.
    const severity = ["LOW", "MEDIUM", "HIGH", "URGENT"];
    const ranks = order.map((priority: string) => severity.indexOf(priority));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(order).toContain("URGENT");
  });

  it("defaults to newest first and breaks ties by Ticket Number", async () => {
    const res = await list(ownerId, { pageSize: 50 });
    const dates = res.body.items.map((t: { ticketDate: string }) => new Date(t.ticketDate).getTime());
    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });
});

describe("GET /api/tickets — pagination", () => {
  it("reports page metadata and pages through without repeating a ticket", async () => {
    const first = await list(ownerId, { pageSize: 10, page: 1 });
    expect(first.body.page).toBe(1);
    expect(first.body.pageSize).toBe(10);
    expect(first.body.totalItems).toBeGreaterThanOrEqual(3);
    expect(first.body.totalPages).toBe(Math.max(1, Math.ceil(first.body.totalItems / 10)));
  });

  it("returns an empty list beyond the last page, not an error", async () => {
    const res = await list(ownerId, { page: 99 });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });
});

describe("GET /api/tickets — invalid queries are rejected, not ignored", () => {
  it.each([
    ["sortBy", { sortBy: "summary" }],
    ["sortOrder", { sortOrder: "sideways" }],
    ["pageSize", { pageSize: 11 }],
    ["page", { page: 0 }],
    ["requestedPriority", { requestedPriority: "SOMEDAY" }],
    ["categoryId", { categoryId: "abc" }],
  ])("rejects an invalid %s with a field error", async (field, query) => {
    const res = await list(ownerId, query as Record<string, string | number>);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fieldErrors).toHaveProperty(field);
  });

  it("rejects a Current Status filter rather than silently ignoring it", async () => {
    // BR-30: it does not exist in Lab 2. Ignoring it would hand back unfiltered
    // results to a caller who believes they are filtered.
    const res = await list(ownerId, { currentStatus: "NEW" });
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("currentStatus");
  });

  it("rejects a repeated parameter instead of quietly choosing one", async () => {
    const res = await request(app)
      .get("/api/tickets?page=1&page=99")
      .set(REQUESTER_HEADER, String(ownerId));

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("page");
  });
});

describe("GET /api/tickets — response shape", () => {
  it("carries what the table shows and omits the description", async () => {
    const res = await list(ownerId);
    const row = res.body.items[0];

    expect(Object.keys(row).sort()).toEqual([
      "attachmentCount",
      "category",
      "currentStatus",
      "id",
      "relatedSystem",
      "requestedPriority",
      "summary",
      "ticketDate",
      "ticketNumber",
    ]);
    // 4000 characters per row that no column renders.
    expect(row).not.toHaveProperty("description");
  });
});
