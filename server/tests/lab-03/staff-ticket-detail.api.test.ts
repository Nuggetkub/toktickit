import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor, TEST_ORIGIN } from "../support/session.js";
import { ALLOWED_TRANSITIONS, TERMINAL_STATUSES, TICKET_STATUSES } from "../../src/ticket-workflow.js";

// API-17 to API-21 — AC-14, AC-15, AC-16 (docs/lab-03/tests.md).
//
// Against the real database, because the claims worth making here are about
// concurrency and transactions: that two simultaneous claims produce exactly one
// owner, and that a status change and the Public Comment explaining it either
// both exist or neither does. A mocked Prisma answers whatever it was told and
// could not fail either way.

const prisma = getPrisma();
const DOMAIN = "@workflow-test.local";

let staffId = 0;
let otherStaffId = 0;
let adminId = 0;
let requesterId = 0;
let inactiveStaffId = 0;

let staff = "";
let otherStaff = "";
let admin = "";
let requester = "";

let categoryId = 0;
let relatedSystemId = 0;

/** A fresh ticket per test, so one test's writes cannot colour another's. */
async function newTicket(
  overrides: { status?: string; ownerId?: number | null; itPriority?: string; resolvedAt?: Date } = {},
) {
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2098-${randomUUID().slice(0, 12)}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: "Workflow suite ticket",
      description: "Created by the staff ticket detail suite so there is something to move.",
      requestedPriority: "MEDIUM",
      itPriority: (overrides.itPriority ?? "MEDIUM") as never,
      currentStatus: (overrides.status ?? "NEW") as never,
      ownerId: overrides.ownerId ?? null,
      ...(overrides.resolvedAt ? { requesterResolvedAt: overrides.resolvedAt } : {}),
      idempotencyKey: randomUUID(),
    },
    select: { id: true, version: true },
  });
}

function send(method: "post" | "patch", path: string, cookie: string, body: object) {
  const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
  return agent[method](path).set("Cookie", cookie).set("Origin", TEST_ORIGIN).send(body);
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

  const [category, relatedSystem] = await Promise.all([
    prisma.category.create({ data: { name: `Workflow probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Workflow system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;

  const make = (fullName: string, role: string, isActive = true) =>
    prisma.user.create({
      data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: role as never, isActive },
      select: { id: true },
    });

  staffId = (await make("Grace Okafor", "IT_STAFF")).id;
  otherStaffId = (await make("Hassan Ali", "IT_STAFF")).id;
  adminId = (await make("Admin Aurelia", "ADMINISTRATOR")).id;
  requesterId = (await make("Nadia Rahman", "REQUESTER")).id;
  inactiveStaffId = (await make("Departed Dana", "IT_STAFF", false)).id;

  staff = await sessionCookieFor(staffId);
  otherStaff = await sessionCookieFor(otherStaffId);
  admin = await sessionCookieFor(adminId);
  requester = await sessionCookieFor(requesterId);
}, 60000);

afterAll(async () => {
  await prisma.publicComment.deleteMany({ where: { ticket: { categoryId } } });
  await prisma.ticket.deleteMany({ where: { categoryId } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("API-17 — claim", () => {
  it("makes the caller the owner and increments the version", async () => {
    const ticket = await newTicket();
    const res = await send("post", `/api/tickets/${ticket.id}/claim`, staff, { version: ticket.version });

    expect(res.status).toBe(200);
    expect(res.body.owner).toMatchObject({ id: staffId, fullName: "Grace Okafor", role: "IT_STAFF" });
    expect(res.body.version).toBe(ticket.version + 1);
  });

  it("refuses a ticket someone else already owns, and says which refusal it is", async () => {
    const ticket = await newTicket({ ownerId: otherStaffId });
    const res = await send("post", `/api/tickets/${ticket.id}/claim`, staff, { version: ticket.version });

    // Not a version conflict: nothing is stale, someone simply got there first,
    // and the interface should say so rather than suggest reloading (BR-22).
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_ALREADY_ASSIGNED");
  });

  it("refuses a stale version and hands back the current ticket", async () => {
    const ticket = await newTicket();
    await send("post", `/api/tickets/${ticket.id}/claim`, staff, { version: ticket.version });

    const stale = await send("post", `/api/tickets/${ticket.id}/claim`, otherStaff, { version: ticket.version });

    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("TICKET_VERSION_CONFLICT");
    // api-spec.md §6: the body carries the current detail, so the client can
    // show what changed instead of sending the user to look for themselves.
    expect(stale.body.error.ticket).toMatchObject({ id: ticket.id, version: ticket.version + 1 });
  });

  it("gives exactly one winner when two people claim at the same moment", async () => {
    // The pre-read check cannot decide this; only the conditional write can. A
    // mocked Prisma could not fail this test however the code were written.
    const ticket = await newTicket();

    const [first, second] = await Promise.all([
      send("post", `/api/tickets/${ticket.id}/claim`, staff, { version: ticket.version }),
      send("post", `/api/tickets/${ticket.id}/claim`, otherStaff, { version: ticket.version }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 409]);

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect([staffId, otherStaffId]).toContain(stored.ownerId);
    expect(stored.version).toBe(ticket.version + 1);
  });
});

describe("API-18 — assign, reassign and unassign", () => {
  it("assigns an eligible person, then reassigns to another", async () => {
    const ticket = await newTicket();
    const assigned = await send("patch", `/api/tickets/${ticket.id}/owner`, staff, {
      ownerId: otherStaffId,
      version: ticket.version,
    });
    expect(assigned.status).toBe(200);
    expect(assigned.body.owner.id).toBe(otherStaffId);

    const reassigned = await send("patch", `/api/tickets/${ticket.id}/owner`, staff, {
      ownerId: adminId,
      version: assigned.body.version,
    });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.owner.id).toBe(adminId);
  });

  it("unassigns with an explicit null", async () => {
    const ticket = await newTicket({ ownerId: staffId });
    const res = await send("patch", `/api/tickets/${ticket.id}/owner`, staff, { ownerId: null, version: ticket.version });

    expect(res.status).toBe(200);
    expect(res.body.owner).toBeNull();
  });

  it.each([
    ["a Requester", () => requesterId],
    ["a deactivated member of staff", () => inactiveStaffId],
    ["somebody who does not exist", () => 98765432],
  ])("refuses %s with a field error on ownerId (BR-21)", async (_label, target) => {
    const ticket = await newTicket();
    const res = await send("patch", `/api/tickets/${ticket.id}/owner`, staff, {
      ownerId: target(),
      version: ticket.version,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("ownerId");

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.ownerId).toBeNull();
    expect(stored.version).toBe(ticket.version);
  });

  it("lets an Administrator do the same work as IT Staff (D-08)", async () => {
    const ticket = await newTicket();
    const res = await send("patch", `/api/tickets/${ticket.id}/owner`, admin, {
      ownerId: staffId,
      version: ticket.version,
    });

    expect(res.status).toBe(200);
  });
});

describe("API-19 — IT Priority", () => {
  it("starts equal to the Requested Priority on a newly created ticket (BR-23)", async () => {
    // The other half of BR-23, and the half nothing asserted until now: IT
    // Priority has to begin somewhere, and a queue sorted by a column that is
    // null on every new row would be quietly useless.
    const created = await request(app)
      .post("/api/tickets")
      .set("Cookie", requester)
      .set("Origin", TEST_ORIGIN)
      .set("Idempotency-Key", randomUUID())
      .send({
        categoryId,
        relatedSystemId,
        summary: "Projector in the lecture hall will not wake",
        description: "It shows a blue light but never accepts the HDMI input from the lectern.",
        requestedPriority: "HIGH",
      });

    expect(created.status).toBe(201);
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.itPriority).toBe("HIGH");
    expect(stored.requestedPriority).toBe("HIGH");
  });

  it("changes IT Priority and leaves Requested Priority as submitted (BR-23)", async () => {
    const ticket = await newTicket({ itPriority: "MEDIUM" });
    const res = await send("patch", `/api/tickets/${ticket.id}/it-priority`, staff, {
      itPriority: "URGENT",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.itPriority).toBe("URGENT");
    // The Requester asked for MEDIUM and that is a record of what they asked,
    // not a field IT owns.
    expect(res.body.requestedPriority).toBe("MEDIUM");
  });

  it("rejects a priority outside the scale", async () => {
    const ticket = await newTicket();
    const res = await send("patch", `/api/tickets/${ticket.id}/it-priority`, staff, {
      itPriority: "WHENEVER",
      version: ticket.version,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("itPriority");
  });
});

describe("API-20 — status transitions", () => {
  it("moves a ticket along an allowed pair", async () => {
    const ticket = await newTicket({ status: "NEW" });
    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "OPEN",
      version: ticket.version,
    });

    expect(res.status).toBe(200);
    expect(res.body.currentStatus).toBe("OPEN");
  });

  it("refuses a pair that is not in BR-29", async () => {
    const ticket = await newTicket({ status: "NEW" });
    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "RESOLVED",
      version: ticket.version,
      resolutionSummary: "This should never be stored anywhere.",
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.currentStatus).toBe("NEW");
    expect(stored.resolutionSummary).toBeNull();
  });

  it("refuses entering an owner-required status while unassigned (BR-28)", async () => {
    const ticket = await newTicket({ status: "OPEN", ownerId: null });
    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "IN_PROGRESS",
      version: ticket.version,
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OWNER_REQUIRED");
  });

  it("stores the resolution summary and posts it as a status-change comment (BR-30)", async () => {
    const ticket = await newTicket({ status: "OPEN", ownerId: staffId });
    const summary = "The access point was replaced and the connection verified.";

    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "RESOLVED",
      version: ticket.version,
      resolutionSummary: summary,
    });

    expect(res.status).toBe(200);
    expect(res.body.resolutionSummary).toBe(summary);

    // The Requester has to be able to see why, and the thread is where they look.
    const comments = await prisma.publicComment.findMany({ where: { ticketId: ticket.id } });
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({ content: summary, authorId: staffId, statusChangedTo: "RESOLVED" });
  });

  it("refuses a summary that is too short, and changes nothing", async () => {
    const ticket = await newTicket({ status: "OPEN", ownerId: staffId });
    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "RESOLVED",
      version: ticket.version,
      resolutionSummary: "fixed",
    });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("resolutionSummary");
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.currentStatus).toBe("OPEN");
    expect(await prisma.publicComment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("clears the resolution and the Requester's indication when reopening (BR-30)", async () => {
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2098-${randomUUID().slice(0, 12)}`,
        requesterId,
        categoryId,
        relatedSystemId,
        summary: "Reopen suite ticket",
        description: "Resolved once, and about to come back.",
        requestedPriority: "MEDIUM",
        itPriority: "MEDIUM",
        currentStatus: "RESOLVED",
        ownerId: staffId,
        resolutionSummary: "Believed fixed at the time.",
        requesterResolvedAt: new Date(),
        idempotencyKey: randomUUID(),
      },
      select: { id: true, version: true },
    });

    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "REOPENED",
      version: ticket.version,
      reason: "The Requester says the problem has returned.",
    });

    expect(res.status).toBe(200);
    expect(res.body.currentStatus).toBe("REOPENED");
    // A reopened ticket must not still claim to be fixed, nor still carry the
    // Requester's "looks resolved to me".
    expect(res.body.resolutionSummary).toBeNull();
    expect(res.body.requesterResolvedAt).toBeNull();

    const comments = await prisma.publicComment.findMany({ where: { ticketId: ticket.id } });
    expect(comments[0]).toMatchObject({ statusChangedTo: "REOPENED" });
  });
});

describe("API-20 — the whole matrix, against real tickets", () => {
  // Driven from ALLOWED_TRANSITIONS rather than from a second hand-transcribed
  // copy, and that is safe here only because UNIT-03 pins ALLOWED_TRANSITIONS
  // against BR-29 transcribed by hand. Without that test this sweep would be
  // circular; with it, this one is free to ask a different question — not "is
  // the table right" but "does a real ticket in a real database actually move".
  const sources = TICKET_STATUSES.filter((status) => !TERMINAL_STATUSES.includes(status));
  const pairs = sources.flatMap((from) => TICKET_STATUSES.map((to) => [from, to] as const));

  it.each(pairs)("%s -> %s", async (from, to) => {
    // Owned, so an owner-required target fails on the transition rather than on
    // BR-28, and carrying both kinds of evidence so it never fails on BR-30.
    const ticket = await newTicket({ status: from, ownerId: staffId });
    const res = await send("post", `/api/tickets/${ticket.id}/status`, staff, {
      toStatus: to,
      version: ticket.version,
      resolutionSummary: "The access point was replaced and the connection verified.",
      reason: "The Requester confirmed the problem has returned.",
    });

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

    if (ALLOWED_TRANSITIONS[from].includes(to)) {
      expect(res.status, `${from} -> ${to} should be allowed`).toBe(200);
      expect(stored.currentStatus).toBe(to);
      expect(stored.version).toBe(ticket.version + 1);
    } else {
      expect(res.status, `${from} -> ${to} should be refused`).toBe(409);
      expect(res.body.error.code).toBe("INVALID_STATUS_TRANSITION");
      // A refusal writes nothing at all, version included.
      expect(stored.currentStatus).toBe(from);
      expect(stored.version).toBe(ticket.version);
    }
  });
});

describe("API-21 — a terminal ticket is frozen (BR-27)", () => {
  it.each([
    ["status", () => ({ method: "post" as const, path: "status", body: { toStatus: "REOPENED", reason: "Trying anyway." } })],
    ["owner", () => ({ method: "patch" as const, path: "owner", body: { ownerId: staffId } })],
    ["it-priority", () => ({ method: "patch" as const, path: "it-priority", body: { itPriority: "URGENT" } })],
    ["claim", () => ({ method: "post" as const, path: "claim", body: {} })],
  ])("refuses %s on a closed ticket with TICKET_TERMINAL", async (_label, build) => {
    const ticket = await newTicket({ status: "CLOSED" });
    const { method, path, body } = build();

    const res = await send(method, `/api/tickets/${ticket.id}/${path}`, staff, { ...body, version: ticket.version });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_TERMINAL");
  });

  it("still lets it be read", async () => {
    const ticket = await newTicket({ status: "CANCELLED", ownerId: staffId });
    const res = await request(app).get(`/api/tickets/${ticket.id}`).set("Cookie", staff);

    // Frozen means nothing changes, not that it disappears.
    expect(res.status).toBe(200);
    expect(res.body.currentStatus).toBe("CANCELLED");
  });
});

describe("role and shape", () => {
  it.each([
    ["claim", "post" as const, {}],
    ["owner", "patch" as const, { ownerId: null }],
    ["it-priority", "patch" as const, { itPriority: "LOW" }],
    ["status", "post" as const, { toStatus: "OPEN" }],
  ])("refuses a Requester %s with 403", async (path, method, body) => {
    const ticket = await newTicket();
    const res = await send(method, `/api/tickets/${ticket.id}/${path}`, requester, { ...body, version: ticket.version });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses a Requester identically for a ticket that does not exist (BR-18)", async () => {
    const real = await newTicket();
    const onReal = await send("post", `/api/tickets/${real.id}/claim`, requester, { version: real.version });
    const onGhost = await send("post", "/api/tickets/98765432/claim", requester, { version: 1 });

    // The role check precedes the lookup, so the refusal cannot be used to find
    // out which ticket numbers are real.
    expect(onReal.status).toBe(403);
    expect(onGhost.body).toEqual(onReal.body);
  });

  it("returns the Ticket Detail shape api-spec.md §4 describes", async () => {
    const ticket = await newTicket({ ownerId: staffId, status: "OPEN" });
    const res = await send("patch", `/api/tickets/${ticket.id}/it-priority`, staff, {
      itPriority: "HIGH",
      version: ticket.version,
    });

    for (const key of ["owner", "itPriority", "version", "resolutionSummary", "requesterResolvedAt", "attachments"]) {
      expect(res.body, `detail is missing ${key}`).toHaveProperty(key);
    }
  });
});
