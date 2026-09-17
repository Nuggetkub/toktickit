import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor, TEST_ORIGIN } from "../support/session.js";

// API-22, API-23, API-24 — AC-04, AC-17, AC-18, AC-19 (docs/lab-03/tests.md).
//
// Against the real database. Issue #52's Done when is a negative claim — "a
// Requester can never read or write an Internal Note through any endpoint" — and
// a negative claim is exactly what a mocked Prisma cannot support: a mock
// returns the rows the test handed it, so a response that wrongly includes notes
// would still look clean. The canary sweep below only means something if the
// note is really in the database and the real serialisation really runs.

const prisma = getPrisma();
const DOMAIN = "@discussion-test.local";

/** A string that exists nowhere else, so finding it anywhere is proof of a leak. */
const CANARY = `CANARY-${randomUUID()}`;

let ownerRequesterId = 0;
let otherRequesterId = 0;
let staffId = 0;
let adminId = 0;

let owner = "";
let other = "";
let staff = "";
let admin = "";

let categoryId = 0;
let relatedSystemId = 0;

async function newTicket(overrides: { status?: string; resolvedAt?: Date | null } = {}) {
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2097-${randomUUID().slice(0, 12)}`,
      requesterId: ownerRequesterId,
      categoryId,
      relatedSystemId,
      summary: "Discussion suite ticket",
      description: "Created by the comments and notes suite so there is something to talk about.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: (overrides.status ?? "OPEN") as never,
      ownerId: staffId,
      ...(overrides.resolvedAt ? { requesterResolvedAt: overrides.resolvedAt } : {}),
      idempotencyKey: randomUUID(),
    },
    select: { id: true, version: true },
  });
}

function post(path: string, cookie: string, body: object) {
  return request(app).post(path).set("Cookie", cookie).set("Origin", TEST_ORIGIN).send(body);
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

  const [category, relatedSystem] = await Promise.all([
    prisma.category.create({ data: { name: `Discussion probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Discussion system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;

  const make = (fullName: string, role: string) =>
    prisma.user.create({
      data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: role as never, isActive: true },
      select: { id: true },
    });

  ownerRequesterId = (await make("Nadia Rahman", "REQUESTER")).id;
  otherRequesterId = (await make("Peter Osei", "REQUESTER")).id;
  staffId = (await make("Grace Okafor", "IT_STAFF")).id;
  adminId = (await make("Admin Aurelia", "ADMINISTRATOR")).id;

  owner = await sessionCookieFor(ownerRequesterId);
  other = await sessionCookieFor(otherRequesterId);
  staff = await sessionCookieFor(staffId);
  admin = await sessionCookieFor(adminId);
}, 60000);

afterAll(async () => {
  await prisma.internalNote.deleteMany({ where: { ticket: { categoryId } } });
  await prisma.publicComment.deleteMany({ where: { ticket: { categoryId } } });
  // Before the tickets: the foreign key refuses to delete a ticket that still
  // has attachment rows pointing at it.
  await prisma.attachment.deleteMany({ where: { ticket: { categoryId } } });
  await prisma.ticket.deleteMany({ where: { categoryId } });
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("API-22 — Public Comments", () => {
  it("lets the owning Requester post, and takes author and time from the server", async () => {
    const ticket = await newTicket();
    const res = await post(`/api/tickets/${ticket.id}/comments`, owner, {
      content: "  I have restarted the laptop as suggested.  ",
      // Both of these are ignored rather than rejected (BR-36): there is no
      // legitimate request that carries them.
      author: { id: staffId, fullName: "Not Me" },
      authorId: staffId,
      createdAt: "1999-01-01T00:00:00.000Z",
    });

    expect(res.status).toBe(201);
    expect(res.body.author).toMatchObject({ id: ownerRequesterId, fullName: "Nadia Rahman", role: "REQUESTER" });
    expect(res.body.content).toBe("I have restarted the laptop as suggested.");
    expect(new Date(res.body.createdAt).getUTCFullYear()).toBeGreaterThan(2020);
    expect(res.body.statusChangedTo).toBeNull();
  });

  it.each([
    ["IT Staff", () => staff],
    ["an Administrator", () => admin],
  ])("lets %s post and read", async (_label, cookie) => {
    const ticket = await newTicket();
    const created = await post(`/api/tickets/${ticket.id}/comments`, cookie(), { content: "Looking into this now." });
    expect(created.status).toBe(201);

    const list = await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", cookie());
    expect(list.status).toBe(200);
    expect(list.body.map((c: { content: string }) => c.content)).toContain("Looking into this now.");
  });

  it("returns them newest first (BR-37)", async () => {
    const ticket = await newTicket();
    for (const content of ["first", "second", "third"]) {
      const res = await post(`/api/tickets/${ticket.id}/comments`, staff, { content });
      expect(res.status).toBe(201);
    }

    const list = await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", staff);
    expect(list.body.map((c: { content: string }) => c.content)).toEqual(["third", "second", "first"]);
  });

  it("breaks a timestamp tie by id, so a thread cannot shuffle between reloads (BR-37)", async () => {
    const ticket = await newTicket();
    const sameInstant = new Date("2026-09-17T10:00:00.000Z");

    // A forced collision. createdAt has millisecond precision, and two entries
    // in one millisecond is ordinary — a status change writes its comment in the
    // same transaction as the change. Without a tie-breaker the database may
    // return these in any order it likes, and the "post three and read them
    // back" test above would still pass by luck, because three separate HTTP
    // round trips rarely share a millisecond.
    const created = await Promise.all(
      ["alpha", "bravo", "charlie"].map((content) =>
        prisma.publicComment.create({
          data: { ticketId: ticket.id, authorId: staffId, content, createdAt: sameInstant },
          select: { id: true, content: true },
        }),
      ),
    );

    const list = await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", staff);
    const expected = [...created].sort((a, b) => b.id - a.id).map((row) => row.content);

    expect(list.status).toBe(200);
    expect(list.body.map((row: { content: string }) => row.content)).toEqual(expected);
  });

  it("shows another Requester nothing, on read and on write (BR-10)", async () => {
    const ticket = await newTicket();
    await post(`/api/tickets/${ticket.id}/comments`, owner, { content: "Something private to this ticket." });

    const read = await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", other);
    const write = await post(`/api/tickets/${ticket.id}/comments`, other, { content: "I should not be able to say this." });

    expect(read.status).toBe(404);
    expect(write.status).toBe(404);
    expect(JSON.stringify(read.body)).not.toContain("Something private");
    expect(await prisma.publicComment.count({ where: { ticketId: ticket.id, authorId: otherRequesterId } })).toBe(0);
  });

  it.each([
    ["empty", ""],
    ["whitespace alone", "     "],
    ["over the maximum", "x".repeat(2001)],
    ["missing", undefined],
  ])("refuses content that is %s", async (_label, content) => {
    const ticket = await newTicket();
    const res = await post(`/api/tickets/${ticket.id}/comments`, owner, content === undefined ? {} : { content });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("content");
    expect(await prisma.publicComment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("carries the status-change comment issue #51 writes, with statusChangedTo set (BR-30)", async () => {
    const ticket = await newTicket({ status: "OPEN" });
    const changed = await post(`/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "RESOLVED",
      version: ticket.version,
      resolutionSummary: "The access point was replaced and the connection verified.",
    });
    expect(changed.status).toBe(200);

    // The Requester sees why their ticket moved, in the thread, without being
    // shown anything private.
    const list = await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", owner);
    expect(list.status).toBe(200);
    expect(list.body[0]).toMatchObject({
      statusChangedTo: "RESOLVED",
      content: "The access point was replaced and the connection verified.",
    });
  });

  it("refuses a post on a closed ticket but still serves the thread (BR-27)", async () => {
    const ticket = await newTicket({ status: "CLOSED" });
    await prisma.publicComment.create({
      data: { ticketId: ticket.id, authorId: staffId, content: "Closing note for the record." },
    });

    const write = await post(`/api/tickets/${ticket.id}/comments`, owner, { content: "One more thing." });
    const read = await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", owner);

    expect(write.status).toBe(409);
    expect(write.body.error.code).toBe("TICKET_TERMINAL");
    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);
  });

  it.each(["put", "patch", "delete"] as const)("has no %s route, so editing answers 404 (BR-37)", async (method) => {
    const ticket = await newTicket();
    const created = await post(`/api/tickets/${ticket.id}/comments`, owner, { content: "Cannot be edited later." });

    const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
    const res = await agent[method](`/api/tickets/${ticket.id}/comments/${created.body.id}`)
      .set("Cookie", owner)
      .set("Origin", TEST_ORIGIN)
      .send({ content: "edited" });

    expect(res.status).toBe(404);
    const stored = await prisma.publicComment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.content).toBe("Cannot be edited later.");
  });
});

describe("API-23 — Internal Notes stay internal", () => {
  it.each([
    ["IT Staff", () => staff],
    ["an Administrator", () => admin],
  ])("lets %s post and read them", async (_label, cookie) => {
    const ticket = await newTicket();
    const created = await post(`/api/tickets/${ticket.id}/internal-notes`, cookie(), {
      content: "Suspect the switch port, not the laptop.",
    });
    expect(created.status).toBe(201);
    expect(created.body).not.toHaveProperty("statusChangedTo");

    const list = await request(app).get(`/api/tickets/${ticket.id}/internal-notes`).set("Cookie", cookie());
    expect(list.status).toBe(200);
    expect(list.body.map((n: { content: string }) => n.content)).toContain("Suspect the switch port, not the laptop.");
  });

  it("refuses a Requester with 403, identically for a ticket that does not exist (BR-35)", async () => {
    const ticket = await newTicket();
    const onReal = await request(app).get(`/api/tickets/${ticket.id}/internal-notes`).set("Cookie", owner);
    const onGhost = await request(app).get("/api/tickets/98765432/internal-notes").set("Cookie", owner);

    // 403 and not 404: the role check precedes the lookup, so the answer cannot
    // be used to discover which tickets exist — not even the Requester's own.
    expect(onReal.status).toBe(403);
    expect(onGhost.status).toBe(403);
    expect(onGhost.body).toEqual(onReal.body);
    expect(onReal.body.error.code).toBe("FORBIDDEN");
  });

  it("refuses a Requester writing one, on their own ticket", async () => {
    const ticket = await newTicket();
    const res = await post(`/api/tickets/${ticket.id}/internal-notes`, owner, { content: "Let me in." });

    expect(res.status).toBe(403);
    expect(await prisma.internalNote.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("refuses a new note on a closed ticket but still serves the ones already written (BR-27)", async () => {
    const ticket = await newTicket({ status: "CLOSED" });
    await prisma.internalNote.create({
      data: { ticketId: ticket.id, authorId: staffId, content: "Recorded before it was closed." },
    });

    const write = await post(`/api/tickets/${ticket.id}/internal-notes`, staff, { content: "One more thought." });
    const read = await request(app).get(`/api/tickets/${ticket.id}/internal-notes`).set("Cookie", staff);

    // Frozen means nothing new is added, not that the history disappears.
    expect(write.status).toBe(409);
    expect(write.body.error.code).toBe("TICKET_TERMINAL");
    expect(read.status).toBe(200);
    expect(read.body).toHaveLength(1);
  });

  it("never leaks a note through ANY surface a Requester can reach (the Done when)", async () => {
    const ticket = await newTicket();

    // A real note, in the real database, on the Requester's own ticket.
    await post(`/api/tickets/${ticket.id}/internal-notes`, staff, { content: `Internal only: ${CANARY}` });
    await post(`/api/tickets/${ticket.id}/comments`, staff, { content: "We are investigating." });
    expect(await prisma.internalNote.count({ where: { ticketId: ticket.id } })).toBe(1);

    const surfaces = {
      "ticket detail": await request(app).get(`/api/tickets/${ticket.id}`).set("Cookie", owner),
      "ticket list": await request(app).get("/api/tickets").set("Cookie", owner),
      comments: await request(app).get(`/api/tickets/${ticket.id}/comments`).set("Cookie", owner),
      "the notes refusal itself": await request(app)
        .get(`/api/tickets/${ticket.id}/internal-notes`)
        .set("Cookie", owner),
      "the indication response": await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {}),
    };

    for (const [name, res] of Object.entries(surfaces)) {
      expect(JSON.stringify(res.body), `${name} leaked the note`).not.toContain(CANARY);
      expect(JSON.stringify(res.body), `${name} exposed an internalNotes field`).not.toContain("internalNotes");
    }

    // And the note really was readable by someone — otherwise this test would
    // pass just as well against a feature that does not work at all.
    const asStaff = await request(app).get(`/api/tickets/${ticket.id}/internal-notes`).set("Cookie", staff);
    expect(JSON.stringify(asStaff.body)).toContain(CANARY);
  });
});

describe("API-21 — BR-27 freezes attachments too", () => {
  // The same byte pattern the Lab 2 attachments suite uses. Content decides the
  // type (BR-31), and input validity is answered before state, so a real PNG
  // signature is needed to reach the status check at all — a dummy buffer would
  // be refused as a type violation and prove nothing about BR-27.
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

  function upload(ticketId: number, cookie: string) {
    return request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set("Cookie", cookie)
      .set("Origin", TEST_ORIGIN)
      .attach("file", PNG, { filename: "evidence.png", contentType: "image/png" });
  }

  it("refuses upload and removal once the ticket is closed, while every read still works", async () => {
    const ticket = await newTicket({ status: "OPEN" });

    // Attached while the ticket is still open, so there is a real file both to
    // attempt to remove and to download afterwards.
    const attached = await upload(ticket.id, owner);
    expect(attached.status).toBe(201);

    await prisma.ticket.update({ where: { id: ticket.id }, data: { currentStatus: "CLOSED" } });

    const secondUpload = await upload(ticket.id, owner);
    const removal = await request(app)
      .patch(`/api/tickets/${ticket.id}/attachments/${attached.body.id}`)
      .set("Cookie", owner)
      .set("Origin", TEST_ORIGIN)
      .send({ removalReason: "Uploaded the wrong file by mistake." });

    expect(secondUpload.status).toBe(409);
    expect(secondUpload.body.error.code).toBe("TICKET_TERMINAL");
    expect(removal.status).toBe(409);
    expect(removal.body.error.code).toBe("TICKET_TERMINAL");

    // A refusal writes nothing: still exactly one attachment, still active.
    const stored = await prisma.attachment.findMany({ where: { ticketId: ticket.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0].removedAt).toBeNull();

    // Frozen means unchanging, not unreadable (BR-39).
    const detail = await request(app).get(`/api/tickets/${ticket.id}`).set("Cookie", owner);
    const list = await request(app).get(`/api/tickets/${ticket.id}/attachments`).set("Cookie", owner);
    const download = await request(app)
      .get(`/api/tickets/${ticket.id}/attachments/${attached.body.id}/download`)
      .set("Cookie", owner);

    expect([detail.status, list.status, download.status]).toEqual([200, 200, 200]);
  });

  it("answers an invalid removal reason before the terminal refusal (api-spec.md §1)", async () => {
    const ticket = await newTicket({ status: "OPEN" });
    const attached = await upload(ticket.id, owner);
    expect(attached.status).toBe(201);
    await prisma.ticket.update({ where: { id: ticket.id }, data: { currentStatus: "CLOSED" } });

    const res = await request(app)
      .patch(`/api/tickets/${ticket.id}/attachments/${attached.body.id}`)
      .set("Cookie", owner)
      .set("Origin", TEST_ORIGIN)
      .send({ removalReason: "no" });

    // Step 6 (400 VALIDATION_FAILED) precedes step 7 (the 409 family) — the same
    // order pinned for status changes in ticket-workflow.test.ts. It is worth an
    // explicit test because it reads oddly: the ticket is finished, and the
    // field error still wins. Writing my own test with the wrong field name is
    // what sent me looking for a bug that was not there.
    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("removalReason");

    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: attached.body.id } });
    expect(stored.removedAt).toBeNull();
  });

  it("refuses an upload on a cancelled ticket as well, and leaves no file behind", async () => {
    const ticket = await newTicket({ status: "CANCELLED" });
    const res = await upload(ticket.id, owner);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_TERMINAL");
    // The check sits inside the lock and before the write, so a refusal must not
    // leave an orphaned file or a row pointing at one.
    expect(await prisma.attachment.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});

describe("API-24 — the Requester's resolution indication", () => {
  it("records the time without touching the status (BR-32)", async () => {
    const ticket = await newTicket({ status: "IN_PROGRESS" });
    const res = await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {});

    expect(res.status).toBe(200);
    expect(res.body.requesterResolvedAt).not.toBeNull();
    expect(res.body.currentStatus).toBe("IN_PROGRESS");
  });

  it("keeps the first time when repeated", async () => {
    const ticket = await newTicket();
    const first = await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {});
    const second = await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {});

    expect(second.status).toBe(200);
    expect(second.body.requesterResolvedAt).toBe(first.body.requesterResolvedAt);
  });

  it("gives one timestamp even when two requests arrive together", async () => {
    const ticket = await newTicket();
    const [a, b] = await Promise.all([
      post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {}),
      post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {}),
    ]);

    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.requesterResolvedAt).toBe(b.body.requesterResolvedAt);
  });

  it("is the Requester's own signal: IT Staff get 403, another Requester 404", async () => {
    const ticket = await newTicket();
    const byStaff = await post(`/api/tickets/${ticket.id}/resolution-indication`, staff, {});
    const byOther = await post(`/api/tickets/${ticket.id}/resolution-indication`, other, {});

    expect(byStaff.status).toBe(403);
    expect(byOther.status).toBe(404);
    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
    expect(stored.requesterResolvedAt).toBeNull();
  });

  it.each([
    ["RESOLVED", "RESOLVED"],
    ["CLOSED", "CLOSED"],
    ["CANCELLED", "CANCELLED"],
  ])("refuses it on a %s ticket with INDICATION_NOT_ALLOWED", async (_label, status) => {
    const ticket = await newTicket({ status });
    const res = await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {});

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("INDICATION_NOT_ALLOWED");
  });

  it("shows on the staff queue as a marker and through the filter (BR-33)", async () => {
    const ticket = await newTicket();
    await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {});

    const queue = await request(app)
      .get(`/api/staff/tickets?requesterIndicated=true&categoryId=${categoryId}`)
      .set("Cookie", staff);

    expect(queue.status).toBe(200);
    const row = queue.body.items.find((item: { id: number }) => item.id === ticket.id);
    expect(row, "the indicated ticket should appear under requesterIndicated=true").toBeDefined();
    expect(row.requesterResolvedAt).not.toBeNull();
  });

  it("is cleared when IT Staff reopen the ticket (BR-30)", async () => {
    const ticket = await newTicket({ status: "OPEN" });
    await post(`/api/tickets/${ticket.id}/resolution-indication`, owner, {});

    const current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { version: true } });
    const resolved = await post(`/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "RESOLVED",
      version: current.version,
      resolutionSummary: "Replaced the faulty cable and confirmed the link.",
    });
    expect(resolved.status).toBe(200);

    const reopened = await post(`/api/tickets/${ticket.id}/status`, staff, {
      toStatus: "REOPENED",
      version: resolved.body.version,
      reason: "The Requester says it has come back.",
    });

    expect(reopened.status).toBe(200);
    expect(reopened.body.requesterResolvedAt).toBeNull();
  });
});
