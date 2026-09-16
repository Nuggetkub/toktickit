import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor, TEST_ORIGIN } from "../support/session.js";

// API-15 and API-16 — AC-13 (docs/lab-03/tests.md).
//
// The queue is a *shared* view: it returns every ticket in the schema, including
// the ones the Lab 2 suites create. So nothing here asserts an absolute total.
// Every query is scoped to a category this file owns, which makes each claim
// about *these* tickets rather than about whichever files happened to run first.
// An absolute count would pass alone and fail in the suite, which is the kind of
// test that gets deleted rather than fixed.

const prisma = getPrisma();
const DOMAIN = "@queue-test.local";

let staffId = 0;
let otherStaffId = 0;
let adminId = 0;
let requesterId = 0;

let staff = "";
let otherStaff = "";
let admin = "";
let requester = "";

let categoryId = 0;
let relatedSystemId = 0;

/** Ticket numbers are unique, so each fixture carries its own recognisable one. */
const numbers: Record<string, string> = {};

type Fixture = {
  key: string;
  summary: string;
  status: string;
  itPriority: string;
  requestedPriority?: string;
  owner?: "staff" | "otherStaff" | null;
  indicated?: boolean;
};

const FIXTURES: Fixture[] = [
  { key: "alpha", summary: "ALPHA campus wifi drops nightly", status: "NEW", itPriority: "LOW", owner: null },
  { key: "bravo", summary: "BRAVO laptop will not boot", status: "OPEN", itPriority: "URGENT", owner: "staff" },
  { key: "charlie", summary: "CHARLIE vpn refuses the handshake", status: "IN_PROGRESS", itPriority: "MEDIUM", owner: "staff", indicated: true },
  { key: "delta", summary: "DELTA mailbox is full", status: "RESOLVED", itPriority: "HIGH", owner: "otherStaff" },
  { key: "echo", summary: "ECHO printer jams on duplex", status: "CLOSED", itPriority: "LOW", owner: "otherStaff" },
];

async function seedTicket(fixture: Fixture, index: number) {
  const ownerId =
    fixture.owner === "staff" ? staffId : fixture.owner === "otherStaff" ? otherStaffId : null;
  const ticketNumber = `TKT-2099-${String(index + 1).padStart(5, "0")}-${randomUUID().slice(0, 4)}`;
  numbers[fixture.key] = ticketNumber;

  await prisma.ticket.create({
    data: {
      ticketNumber,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: fixture.summary,
      description: "Seeded by the staff queue suite so the queue has something to page through.",
      requestedPriority: (fixture.requestedPriority ?? fixture.itPriority) as never,
      itPriority: fixture.itPriority as never,
      currentStatus: fixture.status as never,
      ownerId,
      ...(fixture.indicated ? { requesterResolvedAt: new Date() } : {}),
      idempotencyKey: randomUUID(),
    },
  });
}

/** Every request is scoped to this file's category unless a test says otherwise. */
function queue(cookie: string, query: Record<string, string | number> = {}) {
  return request(app)
    .get("/api/staff/tickets")
    .set("Cookie", cookie)
    .query({ categoryId, pageSize: 50, ...query });
}

function summaries(body: { items: { summary: string }[] }): string[] {
  return body.items.map((item) => item.summary);
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

  const category = await prisma.category.create({ data: { name: `Queue probe ${randomUUID().slice(0, 8)}` } });
  const relatedSystem = await prisma.relatedSystem.create({
    data: { name: `Queue system ${randomUUID().slice(0, 8)}` },
  });
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;

  const make = (fullName: string, role: string) =>
    prisma.user.create({
      data: { fullName, email: `${role.toLowerCase()}${randomUUID().slice(0, 8)}${DOMAIN}`, role: role as never },
      select: { id: true },
    });

  staffId = (await make("Grace Okafor", "IT_STAFF")).id;
  otherStaffId = (await make("Hassan Ali", "IT_STAFF")).id;
  adminId = (await make("Admin Aurelia", "ADMINISTRATOR")).id;
  requesterId = (await make("Nadia Rahman", "REQUESTER")).id;

  staff = await sessionCookieFor(staffId);
  otherStaff = await sessionCookieFor(otherStaffId);
  admin = await sessionCookieFor(adminId);
  requester = await sessionCookieFor(requesterId);

  // Sequentially, so createdAt ascends with the fixture order and the default
  // "newest first" sort is a claim this file can actually make.
  for (const [index, fixture] of FIXTURES.entries()) await seedTicket(fixture, index);
}, 60000);

afterAll(async () => {
  await prisma.ticket.deleteMany({ where: { categoryId } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  await prisma.session.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("API-15 — the queue returns the right subset", () => {
  it("shows every ticket in the category to IT Staff, not only their own", async () => {
    // The whole point of a shared queue: My Tickets is scoped to one requester,
    // this is not.
    const res = await queue(staff);

    expect(res.status).toBe(200);
    expect(summaries(res.body).sort()).toEqual(FIXTURES.map((f) => f.summary).sort());
  });

  it("gives an Administrator the same queue as IT Staff (D-08)", async () => {
    const forStaff = await queue(staff);
    const forAdmin = await queue(admin);

    expect(forAdmin.status).toBe(200);
    expect(summaries(forAdmin.body).sort()).toEqual(summaries(forStaff.body).sort());
  });

  it("filters by Current Status", async () => {
    const res = await queue(staff, { currentStatus: "IN_PROGRESS" });
    expect(summaries(res.body)).toEqual(["CHARLIE vpn refuses the handshake"]);
  });

  it("filters by IT Priority, which is not the Requested Priority", async () => {
    const res = await queue(staff, { itPriority: "URGENT" });
    expect(summaries(res.body)).toEqual(["BRAVO laptop will not boot"]);
  });

  it("filters by owner: me, unassigned, and a named user", async () => {
    const mine = await queue(staff, { owner: "me" });
    expect(summaries(mine.body).sort()).toEqual([
      "BRAVO laptop will not boot",
      "CHARLIE vpn refuses the handshake",
    ]);

    // `me` is resolved from the session, so the same query means something
    // different to a different caller — which is the assertion worth making.
    const theirs = await queue(otherStaff, { owner: "me" });
    expect(summaries(theirs.body).sort()).toEqual([
      "DELTA mailbox is full",
      "ECHO printer jams on duplex",
    ]);

    const unassigned = await queue(staff, { owner: "unassigned" });
    expect(summaries(unassigned.body)).toEqual(["ALPHA campus wifi drops nightly"]);

    const byId = await queue(staff, { owner: otherStaffId });
    expect(summaries(byId.body).sort()).toEqual([
      "DELTA mailbox is full",
      "ECHO printer jams on duplex",
    ]);
  });

  it("filters by the Requester's resolution indication (BR-33)", async () => {
    const res = await queue(staff, { requesterIndicated: "true" });

    expect(summaries(res.body)).toEqual(["CHARLIE vpn refuses the handshake"]);
    expect(res.body.items[0].requesterResolvedAt).not.toBeNull();
  });

  it("searches Ticket Number, Summary and the Requester's name", async () => {
    const bySummary = await queue(staff, { search: "vpn" });
    expect(summaries(bySummary.body)).toEqual(["CHARLIE vpn refuses the handshake"]);

    const byNumber = await queue(staff, { search: numbers.bravo.toLowerCase() });
    expect(summaries(byNumber.body)).toEqual(["BRAVO laptop will not boot"]);

    // Searching for a person is a real need on a shared queue in a way it never
    // was on My Tickets, where every row is already yours.
    const byPerson = await queue(staff, { search: "nadia" });
    expect(summaries(byPerson.body).sort()).toEqual(FIXTURES.map((f) => f.summary).sort());
  });

  it("combines filters with AND", async () => {
    const res = await queue(staff, { owner: "me", currentStatus: "OPEN" });
    expect(summaries(res.body)).toEqual(["BRAVO laptop will not boot"]);
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    const res = await queue(staff, { search: "zzzz-nothing-matches-this" });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalItems).toBe(0);
    // A reader is always on page 1 of at least 1 — never "page 1 of 0".
    expect(res.body.totalPages).toBe(1);
  });
});

describe("API-15 — sorting follows severity and lifecycle, not the alphabet", () => {
  it("sorts IT Priority by severity", async () => {
    const res = await queue(staff, { sortBy: "itPriority", sortOrder: "asc" });
    const order = res.body.items.map((item: { itPriority: string }) => item.itPriority);

    // Alphabetical would be HIGH, LOW, LOW, MEDIUM, URGENT — meaningless when
    // triaging. The enum's declared order is the severity order.
    expect(order).toEqual(["LOW", "LOW", "MEDIUM", "HIGH", "URGENT"]);
  });

  it("sorts Current Status by lifecycle", async () => {
    const res = await queue(staff, { sortBy: "currentStatus", sortOrder: "asc" });
    const order = res.body.items.map((item: { currentStatus: string }) => item.currentStatus);

    // Alphabetical would put CLOSED first and RESOLVED before OPEN.
    expect(order).toEqual(["NEW", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
  });

  it("defaults to newest first", async () => {
    const res = await queue(staff);
    const dates = res.body.items.map((item: { ticketDate: string }) => new Date(item.ticketDate).getTime());

    expect(dates).toEqual([...dates].sort((a, b) => b - a));
  });

  it("breaks a tie on Ticket Number descending, so paging is stable", async () => {
    // api-spec.md §5 promises this and nothing above proved it. Without a
    // tie-breaker two tickets sharing a timestamp can swap between pages, and a
    // reader paging past them never sees one of the two — a silent omission
    // rather than a visible error.
    const sharedMoment = new Date("2099-01-01T00:00:00.000Z");
    const tied = await Promise.all(
      ["TKT-2099-90001", "TKT-2099-90002", "TKT-2099-90003"].map((ticketNumber) =>
        prisma.ticket.create({
          data: {
            ticketNumber,
            requesterId,
            categoryId,
            relatedSystemId,
            summary: `TIED ${ticketNumber}`,
            description: "Three tickets sharing one timestamp, to prove the tie-breaker.",
            requestedPriority: "LOW",
            itPriority: "LOW",
            currentStatus: "NEW",
            createdAt: sharedMoment,
            idempotencyKey: randomUUID(),
          },
          select: { id: true },
        }),
      ),
    );

    try {
      const res = await queue(staff, { sortBy: "ticketDate", sortOrder: "desc" });
      const ordered = res.body.items
        .filter((item: { summary: string }) => item.summary.startsWith("TIED "))
        .map((item: { ticketNumber: string }) => item.ticketNumber);

      // Descending by number, whatever order the database happened to return.
      expect(ordered).toEqual(["TKT-2099-90003", "TKT-2099-90002", "TKT-2099-90001"]);
    } finally {
      await prisma.ticket.deleteMany({ where: { id: { in: tied.map((ticket) => ticket.id) } } });
    }
  });
});

describe("API-15 — paging", () => {
  it("reports honest metadata and pages without repeating a ticket", async () => {
    const first = await queue(staff, { pageSize: 10, page: 1, sortBy: "ticketNumber", sortOrder: "asc" });
    expect(first.body.page).toBe(1);
    expect(first.body.pageSize).toBe(10);
    expect(first.body.totalItems).toBe(FIXTURES.length);
    expect(first.body.totalPages).toBe(1);
  });

  it("answers a page beyond the last with an empty list and correct totals", async () => {
    const res = await queue(staff, { page: 99 });

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    // Never silently clamped back to page 1, which would show a reader results
    // for a page they did not ask for.
    expect(res.body.page).toBe(99);
    expect(res.body.totalItems).toBe(FIXTURES.length);
  });
});

describe("API-15 — the row shape", () => {
  it("carries what the queue table shows, and omits the description", async () => {
    const res = await queue(staff, { currentStatus: "OPEN" });
    const row = res.body.items[0];

    expect(Object.keys(row).sort()).toEqual([
      "category",
      "currentStatus",
      "id",
      "itPriority",
      "owner",
      "requestedPriority",
      "requester",
      "requesterResolvedAt",
      "summary",
      "ticketDate",
      "ticketNumber",
      "updatedAt",
    ]);
    expect(row).not.toHaveProperty("description");
    expect(row.owner).toMatchObject({ id: staffId, fullName: "Grace Okafor", role: "IT_STAFF" });
    expect(row.requester).toMatchObject({ fullName: "Nadia Rahman", role: "REQUESTER" });
  });

  it("reports an unassigned ticket as owner null, not as a missing field", async () => {
    const res = await queue(staff, { owner: "unassigned" });

    // The screen shows "Unassigned"; it must be able to tell that from an owner
    // that failed to load.
    expect(res.body.items[0]).toHaveProperty("owner");
    expect(res.body.items[0].owner).toBeNull();
  });
});

describe("API-16 — refusals", () => {
  it("refuses a Requester with 403 FORBIDDEN", async () => {
    const res = await queue(requester);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    expect(res.body).not.toHaveProperty("items");
  });

  it("refuses a Requester before the query is even parsed (BR-18)", async () => {
    // Role is step 4 and validation is step 6. If this answered 400 it would
    // mean the server had begun working on a request it was going to refuse,
    // and the difference would tell a Requester which parameters exist.
    const res = await request(app)
      .get("/api/staff/tickets")
      .set("Cookie", requester)
      .query({ currentStatus: "unknown", itPriorty: "HIGH" });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses an unauthenticated caller with 401", async () => {
    const res = await request(app).get("/api/staff/tickets");

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it.each([
    ["currentStatus", "unknown"],
    ["itPriority", "NOW"],
    ["owner", "nobody"],
    ["pageSize", "11"],
    ["requesterIndicated", "false"],
  ])("rejects an invalid %s with a field error rather than ignoring it", async (field, value) => {
    const res = await request(app)
      .get("/api/staff/tickets")
      .set("Cookie", staff)
      .query({ [field]: value });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fieldErrors).toHaveProperty(field);
  });

  it("rejects an unrecognised parameter instead of answering the unfiltered queue", async () => {
    const res = await request(app).get("/api/staff/tickets").set("Cookie", staff).query({ itPriorty: "HIGH" });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("itPriorty");
  });
});

describe("API-16 — the assignee list", () => {
  it("offers only active IT Staff and Administrators, ordered by name", async () => {
    const res = await request(app).get("/api/staff/assignees").set("Cookie", staff);

    expect(res.status).toBe(200);
    const mine = res.body.filter((user: { id: number }) =>
      [staffId, otherStaffId, adminId, requesterId].includes(user.id),
    );

    // BR-21 lets a ticket be assigned to nobody else, so offering a Requester
    // would be a control that exists only to be refused.
    expect(mine.map((user: { fullName: string }) => user.fullName)).toEqual([
      "Admin Aurelia",
      "Grace Okafor",
      "Hassan Ali",
    ]);
    expect(mine.every((user: { role: string }) => user.role !== "REQUESTER")).toBe(true);
  });

  it("refuses a Requester", async () => {
    const res = await request(app).get("/api/staff/assignees").set("Cookie", requester);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("excludes a deactivated member of staff", async () => {
    await prisma.user.update({ where: { id: otherStaffId }, data: { isActive: false } });
    try {
      const res = await request(app).get("/api/staff/assignees").set("Cookie", staff);
      const ids = res.body.map((user: { id: number }) => user.id);

      expect(ids).not.toContain(otherStaffId);
      expect(ids).toContain(staffId);
    } finally {
      await prisma.user.update({ where: { id: otherStaffId }, data: { isActive: true } });
    }
  });
});

/** The Origin guard applies to mutations only; the queue is a read (BR-16). */
describe("API-16 — reads need no Origin", () => {
  it("answers a queue request that carries no Origin header", async () => {
    const res = await request(app).get("/api/staff/tickets").set("Cookie", staff).query({ categoryId });
    expect(res.status).toBe(200);
  });

  it("still answers when one is present, so the client is not a special case", async () => {
    const res = await request(app)
      .get("/api/staff/tickets")
      .set("Cookie", staff)
      .set("Origin", TEST_ORIGIN)
      .query({ categoryId });
    expect(res.status).toBe(200);
  });
});
