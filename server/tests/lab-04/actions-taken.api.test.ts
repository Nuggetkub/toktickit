import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor, TEST_ORIGIN } from "../support/session.js";

// API-01 to API-09 in docs/lab-04/tests.md (AC-01 to AC-10), against the real
// database. The claims worth making here are about transactions, locks and
// constraints: two edits from one version, one Action from a doubled create, no
// write reaching a Ticket that closed mid-request. A mocked Prisma answers
// whatever it is told and could fail none of them.

const prisma = getPrisma();
const DOMAIN = "@actions-test.local";

let categoryId = 0;
let relatedSystemId = 0;
const ids = { staff: 0, other: 0, admin: 0, owner: 0, stranger: 0, inactive: 0 };
const cookies = { staff: "", other: "", admin: "", owner: "", stranger: "" };

async function newTicket(status = "IN_PROGRESS", ownerId: number | null = null) {
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2097-${randomUUID().slice(0, 12)}`,
      requesterId: ids.owner,
      categoryId,
      relatedSystemId,
      summary: "Actions suite ticket",
      description: "Created by the Actions Taken suite so there is work to record.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: status as never,
      ownerId: ownerId ?? ids.staff,
      idempotencyKey: randomUUID(),
    },
    select: { id: true, version: true, updatedAt: true, createdAt: true },
  });
}

/** A valid create body; the Action is dated now, after its Ticket exists. */
function body(overrides: Record<string, unknown> = {}) {
  return {
    status: "COMPLETED",
    actionAt: new Date().toISOString(),
    description: "Reset the Wi-Fi profile and rejoined the network.",
    result: "Connected at full signal; browsing works.",
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    assigneeId: ids.other,
    ...overrides,
  };
}

function post(path: string, cookie: string, payload: object, key?: string) {
  const req = request(app).post(path).set("Cookie", cookie).set("Origin", TEST_ORIGIN);
  return (key ? req.set("Idempotency-Key", key) : req).send(payload);
}
const patch = (path: string, cookie: string, payload: object) =>
  request(app).patch(path).set("Cookie", cookie).set("Origin", TEST_ORIGIN).send(payload);
const get = (path: string, cookie: string) => request(app).get(path).set("Cookie", cookie);

async function created(ticketId: number, overrides: Record<string, unknown> = {}, cookie = cookies.staff) {
  const res = await post(`/api/tickets/${ticketId}/actions`, cookie, body(overrides), randomUUID());
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: number; version: number; status: string };
}

beforeAll(async () => {
  await cleanUp();
  const [category, system] = await Promise.all([
    prisma.category.create({ data: { name: `Actions probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Actions system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;

  const make = async (fullName: string, role: string, isActive = true) =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: role as never, isActive }, select: { id: true } })).id;
  ids.staff = await make("Grace Okafor", "IT_STAFF");
  ids.other = await make("Daniel Reyes", "IT_STAFF");
  ids.admin = await make("Pim Srisawat", "ADMINISTRATOR");
  ids.owner = await make("Nadia Rahman", "REQUESTER");
  ids.stranger = await make("Somchai Pattana", "REQUESTER");
  ids.inactive = await make("Wichai Boonmee", "IT_STAFF", false);
  for (const who of ["staff", "other", "admin", "owner", "stranger"] as const) cookies[who] = await sessionCookieFor(ids[who]);
}, 60_000);

async function cleanUp() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  // RESTRICT on every Lab 4 foreign key: Actions and history go first.
  await prisma.actionTaken.deleteMany({ where: { OR: [{ ticket: { requesterId: { in: userIds } } }, { createdById: { in: userIds } }] } });
  await prisma.ticketStatusEvent.deleteMany({ where: { actorId: { in: userIds } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

/**
 * Holds the Ticket's row lock while `fire` is dispatched, runs `during` inside
 * the locking transaction, then releases. `.then()` is what dispatches a
 * supertest request: holding the Test object alone sends nothing, which made
 * our first Lab 3 race tests blind (PR #66).
 */
async function whileLocked<T>(ticketId: number, fire: () => Promise<T>, during: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<unknown> = async () => undefined) {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const locker = prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Ticket" WHERE "id" = ${ticketId} FOR UPDATE`;
      await during(tx);
      await held;
    },
    { timeout: 20_000 },
  );
  await new Promise((r) => setTimeout(r, 150));
  const pending = fire();
  await new Promise((r) => setTimeout(r, 300));
  release();
  await locker;
  return pending;
}

describe("API-01 creating an Action (AC-01)", () => {
  it("saves a completed Action under the path's Ticket with the caller as recorder and performer", async () => {
    const ticket = await newTicket();
    const res = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, body(), randomUUID());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      ticketId: ticket.id,
      status: "COMPLETED",
      createdBy: { id: ids.staff, role: "IT_STAFF" },
      performedBy: { id: ids.staff },
      assignee: { id: ids.other },
      version: 1,
    });
    expect(res.body.completedAt).not.toBeNull();
    // The internal fields never leave the server.
    expect(res.body).not.toHaveProperty("idempotencyKey");
    expect(res.body).not.toHaveProperty("requestFingerprint");

    // Last Updated moves, the Ticket version does not (BR-13, D-11).
    const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id }, select: { version: true, updatedAt: true } });
    expect(after.version).toBe(ticket.version);
    expect(after.updatedAt.getTime()).toBeGreaterThan(ticket.updatedAt.getTime());
  });

  it("lets an Administrator create one, and leaves an open Action with no performer", async () => {
    const ticket = await newTicket();
    const byAdmin = await created(ticket.id, {}, cookies.admin);
    expect(byAdmin).toMatchObject({ createdBy: { id: ids.admin }, performedBy: { id: ids.admin } });
    const open = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, body({ status: "OPEN", result: null }), randomUUID());
    expect(open.status).toBe(201);
    expect(open.body).toMatchObject({ status: "OPEN", performedBy: null, completedAt: null });
  });
});

describe("API-02 invalid input (AC-03)", () => {
  it("names every failing field, ignores server-owned fields in the body, and writes nothing", async () => {
    const ticket = await newTicket();
    const bad = await post(
      `/api/tickets/${ticket.id}/actions`,
      cookies.staff,
      body({ description: "tiny", result: null, followUpRequired: true, followUpNote: null, attachmentNotes: "x".repeat(501) }),
      randomUUID(),
    );
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(bad.body.error.fieldErrors).sort()).toEqual(["attachmentNotes", "description", "followUpNote", "result"]);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);

    // An impossible date is refused, never saved as the date JavaScript rolls it into.
    for (const actionAt of ["2027-02-31T12:00:00Z", "2027-02-29T12:00:00Z"]) {
      const res = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, body({ status: "OPEN", result: null, actionAt }), randomUUID());
      expect(res.status, actionAt).toBe(400);
      expect(Object.keys(res.body.error.fieldErrors), actionAt).toEqual(["actionAt"]);
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);

    const forged = await post(
      `/api/tickets/${ticket.id}/actions`,
      cookies.staff,
      { ...body(), createdById: ids.admin, performedById: ids.admin, createdAt: "2020-01-01T00:00:00Z" },
      randomUUID(),
    );
    expect(forged.status).toBe(201);
    expect(forged.body).toMatchObject({ createdBy: { id: ids.staff }, performedBy: { id: ids.staff } });
    expect(new Date(forged.body.createdAt).getFullYear()).toBeGreaterThan(2020);
  });
});

describe("API-03 who can be assigned (AC-04)", () => {
  it("refuses an inactive user, a Requester and an unknown id on assigneeId", async () => {
    const ticket = await newTicket();
    for (const assigneeId of [ids.inactive, ids.owner, 99_999_999]) {
      const res = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, body({ assigneeId }), randomUUID());
      expect(res.status, String(assigneeId)).toBe(400);
      expect(Object.keys(res.body.error.fieldErrors)).toEqual(["assigneeId"]);
    }
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });

  it("accepts an active colleague who is not the Ticket Owner, and leaves the owner alone (BR-02)", async () => {
    const ticket = await newTicket("IN_PROGRESS", ids.staff);
    const action = await created(ticket.id, { assigneeId: ids.other });
    expect(action).toMatchObject({ assignee: { id: ids.other } });
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).ownerId).toBe(ids.staff);
  });
});

describe("API-04 edit, complete, cancel, and finality (AC-05)", () => {
  it("edits only the fields sent and bumps the version", async () => {
    const ticket = await newTicket();
    const action = await created(ticket.id, { status: "OPEN", result: null });
    const res = await patch(`/api/tickets/${ticket.id}/actions/${action.id}`, cookies.staff, { version: 1, description: "Replace the access point instead." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ description: "Replace the access point instead.", version: 2, assignee: { id: ids.other }, status: "OPEN" });
  });

  it("makes the completer Performed by, not the recorder", async () => {
    const ticket = await newTicket();
    const action = await created(ticket.id, { status: "OPEN", result: null });
    const res = await post(`/api/tickets/${ticket.id}/actions/${action.id}/complete`, cookies.other, { version: 1, result: "Replaced it; signal is strong." });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "COMPLETED", createdBy: { id: ids.staff }, performedBy: { id: ids.other }, result: "Replaced it; signal is strong." });
    expect(res.body.completedAt).not.toBeNull();
  });

  it("will not complete planned work dated in the future without a real date", async () => {
    const ticket = await newTicket();
    const planned = await created(ticket.id, { status: "OPEN", result: null, actionAt: new Date(Date.now() + 2 * 86_400_000).toISOString() });
    const res = await post(`/api/tickets/${ticket.id}/actions/${planned.id}/complete`, cookies.staff, { version: 1, result: "Done early." });
    expect(res.status).toBe(400);
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(["actionAt"]);
    const ok = await post(`/api/tickets/${ticket.id}/actions/${planned.id}/complete`, cookies.staff, { version: 1, result: "Done early.", actionAt: new Date().toISOString() });
    expect(ok.status).toBe(200);
  });

  it("records the canceller, and then refuses every change to a final Action, whatever its version", async () => {
    const ticket = await newTicket();
    const toCancel = await created(ticket.id, { status: "OPEN", result: null });
    const cancel = await post(`/api/tickets/${ticket.id}/actions/${toCancel.id}/cancel`, cookies.other, { version: 1, reason: "Duplicate of the router action." });
    expect(cancel.status).toBe(200);
    expect(cancel.body).toMatchObject({ status: "CANCELLED", cancelledBy: { id: ids.other }, cancellationReason: "Duplicate of the router action.", performedBy: null });

    const done = await created(ticket.id);
    for (const [final, version] of [[toCancel.id, 2], [done.id, 1]] as const) {
      const base = `/api/tickets/${ticket.id}/actions/${final}`;
      const answers = [
        await patch(base, cookies.staff, { version, description: "Rewrite history." }),
        await post(`${base}/complete`, cookies.staff, { version, result: "Again." }),
        await post(`${base}/cancel`, cookies.staff, { version, reason: "Never mind." }),
      ];
      for (const res of answers) {
        expect(res.status).toBe(409);
        expect(res.body.error.code).toBe("ACTION_FINAL");
      }
    }
    expect((await request(app).delete(`/api/tickets/${ticket.id}/actions/${done.id}`).set("Cookie", cookies.staff).set("Origin", TEST_ORIGIN)).status).toBe(404);
  });
});

describe("API-05 two edits from one version (AC-06)", () => {
  it("lets exactly one win and gives the other the current Action", async () => {
    const ticket = await newTicket();
    const action = await created(ticket.id, { status: "OPEN", result: null });
    const path = `/api/tickets/${ticket.id}/actions/${action.id}`;
    // Both requests queue behind the test's lock, carrying the same version.
    const [a, b] = await whileLocked(ticket.id, () =>
      Promise.all([
        patch(path, cookies.staff, { version: 1, description: "First editor's plan." }).then((r) => r),
        patch(path, cookies.other, { version: 1, description: "Second editor's plan." }).then((r) => r),
      ]),
    );
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    const winner = a.status === 200 ? a : b;
    expect(loser.body.error.code).toBe("ACTION_VERSION_CONFLICT");
    expect(loser.body.error.action).toMatchObject({ id: action.id, version: 2, description: winner.body.description });
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: action.id } })).description).toBe(winner.body.description);
  });
});

describe("API-06 idempotent create (AC-07, AC-26)", () => {
  it("replays the same key and payload, refuses a different payload, and requires a UUID key", async () => {
    const ticket = await newTicket();
    const key = randomUUID();
    const payload = body({ status: "OPEN", result: null });
    const first = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, key);
    const second = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, key);
    expect([first.status, second.status]).toEqual([201, 200]);
    expect(second.body.id).toBe(first.body.id);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);

    const different = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, { ...payload, description: "A different action altogether." }, key);
    expect(different.status).toBe(409);
    expect(different.body.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    const otherCaller = await post(`/api/tickets/${ticket.id}/actions`, cookies.other, payload, key);
    expect(otherCaller.status).toBe(409);

    for (const bad of [undefined, "not-a-uuid"]) {
      const res = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, bad);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    }
  });

  it("still recognises a retry after the Action was edited, and after the Ticket was resolved", async () => {
    // The reason requestFingerprint exists: the row has changed, the request has not.
    const ticket = await newTicket();
    const key = randomUUID();
    const payload = body({ status: "OPEN", result: null });
    const first = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, key);
    await patch(`/api/tickets/${ticket.id}/actions/${first.body.id}`, cookies.staff, { version: 1, description: "Edited after it was created." });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { currentStatus: "RESOLVED" } });
    const retry = await post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, key);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ id: first.body.id, description: "Edited after it was created." });
  });

  it("creates one Action from two identical requests dispatched together", async () => {
    const ticket = await newTicket();
    const key = randomUUID();
    const payload = body();
    const results = await Promise.all([
      post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, key).then((r) => r),
      post(`/api/tickets/${ticket.id}/actions`, cookies.staff, payload, key).then((r) => r),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(results[0].body.id).toBe(results[1].body.id);
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(1);
  });
});

describe("API-07 Tickets that are resolved or finished (AC-08, BR-14)", () => {
  it("answers ACTION_NOT_ALLOWED on RESOLVED and TICKET_TERMINAL on CLOSED and CANCELLED, changing nothing", async () => {
    for (const [status, code] of [["RESOLVED", "ACTION_NOT_ALLOWED"], ["CLOSED", "TICKET_TERMINAL"], ["CANCELLED", "TICKET_TERMINAL"]] as const) {
      const ticket = await newTicket();
      const open = await created(ticket.id, { status: "OPEN", result: null });
      await prisma.ticket.update({ where: { id: ticket.id }, data: { currentStatus: status } });
      const base = `/api/tickets/${ticket.id}/actions`;
      const answers = [
        await post(base, cookies.staff, body(), randomUUID()),
        await patch(`${base}/${open.id}`, cookies.staff, { version: 1, description: "Too late to change." }),
        await post(`${base}/${open.id}/complete`, cookies.staff, { version: 1, result: "Too late." }),
        await post(`${base}/${open.id}/cancel`, cookies.staff, { version: 1, reason: "Too late." }),
      ];
      for (const res of answers) {
        expect(res.status, status).toBe(409);
        expect(res.body.error.code, status).toBe(code);
      }
      const stored = await prisma.actionTaken.findMany({ where: { ticketId: ticket.id } });
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ status: "OPEN", version: 1 });
    }
  });

  it("refuses a create whose Ticket closed while the request waited on the row lock", async () => {
    const ticket = await newTicket();
    const res = await whileLocked(
      ticket.id,
      () => post(`/api/tickets/${ticket.id}/actions`, cookies.staff, body(), randomUUID()).then((r) => r),
      (tx) => tx.ticket.update({ where: { id: ticket.id }, data: { currentStatus: "CLOSED" } }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("TICKET_TERMINAL");
    expect(await prisma.actionTaken.count({ where: { ticketId: ticket.id } })).toBe(0);
  });
});

describe("API-08 who sees what, and in what order (AC-09)", () => {
  it("shows the owning Requester, IT Staff and an Administrator every Action and field; another Requester gets 404", async () => {
    const ticket = await newTicket();
    await created(ticket.id, { followUpRequired: true, followUpNote: "Check again Friday.", attachmentNotes: "photo.png" });
    for (const who of ["owner", "staff", "admin"] as const) {
      const res = await get(`/api/tickets/${ticket.id}/actions`, cookies[who]);
      expect(res.status, who).toBe(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ followUpNote: "Check again Friday.", attachmentNotes: "photo.png", createdBy: { id: ids.staff } });
    }
    const theirs = await get(`/api/tickets/${ticket.id}/actions`, cookies.stranger);
    const missing = await get(`/api/tickets/99999999/actions`, cookies.stranger);
    expect(theirs.status).toBe(404);
    expect(theirs.body).toEqual(missing.body);
  });

  it("orders newest first with the id breaking a tie", async () => {
    const ticket = await newTicket();
    const at = new Date().toISOString();
    const made = [];
    for (let i = 0; i < 3; i += 1) made.push(await created(ticket.id, { actionAt: at, description: `Same instant, action ${i}.` }));
    const res = await get(`/api/tickets/${ticket.id}/actions`, cookies.staff);
    expect(res.body.items.map((a: { id: number }) => a.id)).toEqual(made.map((a) => a.id).reverse());
  });

  it("refuses a Requester's write before any lookup, and an Action from another Ticket is not found", async () => {
    const ticket = await newTicket();
    const action = await created(ticket.id, { status: "OPEN", result: null });
    for (const target of [ticket.id, 99_999_999]) {
      const res = await post(`/api/tickets/${target}/actions`, cookies.owner, body(), randomUUID());
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    const elsewhere = await newTicket();
    const cross = await patch(`/api/tickets/${elsewhere.id}/actions/${action.id}`, cookies.staff, { version: 1, description: "Wrong ticket." });
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe("ACTION_NOT_FOUND");
  });
});

describe("an assignment cannot race a deactivation (BR-06, BR-17; Earth2509's review of PR #94)", () => {
  // The deactivation below is done exactly as the admin route does it: update
  // the user, clear their open Actions and Tickets, and only then commit. It is
  // held open while the assignment is dispatched. A plain read of the user sees
  // the last committed version, active, so without a lock on the user's row the
  // assignment passes its check, writes after the cleanup, and leaves open work
  // with an assignee who can no longer sign in.
  async function whileDeactivating<T>(userId: number, fire: () => Promise<T>) {
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const admin = prisma.$transaction(
      async (tx) => {
        await tx.user.update({ where: { id: userId }, data: { isActive: false } });
        await tx.actionTaken.updateMany({ where: { assigneeId: userId, status: "OPEN" }, data: { assigneeId: null, version: { increment: 1 } } });
        await tx.ticket.updateMany({ where: { ownerId: userId, currentStatus: { notIn: ["CLOSED", "CANCELLED"] } }, data: { ownerId: null, version: { increment: 1 } } });
        await held;
      },
      { timeout: 20_000 },
    );
    await new Promise((r) => setTimeout(r, 150));
    const pending = fire();
    await new Promise((r) => setTimeout(r, 300));
    release();
    await admin;
    return pending;
  }

  const newLeaver = async () =>
    (await prisma.user.create({ data: { fullName: "Racing Rae", email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: "IT_STAFF" } })).id;

  it("refuses to create an Action for a user being deactivated", async () => {
    const leaver = await newLeaver();
    const ticket = await newTicket();
    const res = await whileDeactivating(leaver, () =>
      post(`/api/tickets/${ticket.id}/actions`, cookies.staff, body({ status: "OPEN", result: null, assigneeId: leaver }), randomUUID()).then((r) => r),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(["assigneeId"]);
    expect(await prisma.actionTaken.count({ where: { assigneeId: leaver, status: "OPEN" } })).toBe(0);
  });

  it("refuses to reassign an open Action to a user being deactivated", async () => {
    const leaver = await newLeaver();
    const ticket = await newTicket();
    const action = await created(ticket.id, { status: "OPEN", result: null });
    const res = await whileDeactivating(leaver, () =>
      patch(`/api/tickets/${ticket.id}/actions/${action.id}`, cookies.staff, { version: 1, assigneeId: leaver }).then((r) => r),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(Object.keys(res.body.error.fieldErrors)).toEqual(["assigneeId"]);
    expect(await prisma.actionTaken.count({ where: { assigneeId: leaver, status: "OPEN" } })).toBe(0);
  });

  it("refuses to make a user being deactivated the Ticket Owner (the Lab 3 sibling, BR-21 and BR-25)", async () => {
    const leaver = await newLeaver();
    const ticket = await newTicket("IN_PROGRESS", ids.staff);
    const res = await whileDeactivating(leaver, () =>
      patch(`/api/tickets/${ticket.id}/owner`, cookies.staff, { ownerId: leaver, version: ticket.version }).then((r) => r),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).ownerId).toBe(ids.staff);
  });

  it("refuses a claim by a user who is deactivated while claiming (the Lab 3 sibling, BR-22 and BR-25)", async () => {
    // The caller passed the session check before the deactivation committed; the
    // claim itself re-checks under the lock and ends the session instead.
    const leaver = await newLeaver();
    const leaverCookie = await sessionCookieFor(leaver);
    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2097-${randomUUID().slice(0, 12)}`, requesterId: ids.owner, categoryId, relatedSystemId,
        summary: "Unowned ticket", description: "Nobody owns this yet, so it can be claimed.",
        requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: "OPEN", idempotencyKey: randomUUID(),
      },
    });
    const res = await whileDeactivating(leaver, () =>
      post(`/api/tickets/${ticket.id}/claim`, leaverCookie, { version: ticket.version }).then((r) => r),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).ownerId).toBeNull();
  });
});

describe("API-09 a deactivation unassigns open Actions (AC-10, BR-17)", () => {
  it("clears the assignee on open Actions only, reports both counts, and then requires a new assignee", async () => {
    const leaver = (await prisma.user.create({ data: { fullName: "Leaving Lee", email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: "IT_STAFF" } })).id;
    const ticket = await newTicket();
    const openA = await created(ticket.id, { status: "OPEN", result: null, assigneeId: leaver });
    const openB = await created(ticket.id, { status: "OPEN", result: null, assigneeId: leaver });
    const done = await prisma.actionTaken.create({
      data: {
        ticketId: ticket.id, actionAt: new Date(), description: "Finished by the leaver.", result: "It worked.",
        followUpRequired: false, status: "COMPLETED", assigneeId: leaver, createdById: leaver, performedById: leaver,
        completedAt: new Date(), idempotencyKey: randomUUID(),
      },
    });

    const res = await patch(`/api/admin/users/${leaver}`, cookies.admin, { isActive: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ unassignedActionCount: 2 });
    expect(res.body).toHaveProperty("unassignedTicketCount");

    for (const open of [openA, openB]) {
      expect(await prisma.actionTaken.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ assigneeId: null, version: 2 });
    }
    // History keeps every name.
    expect(await prisma.actionTaken.findUniqueOrThrow({ where: { id: done.id } })).toMatchObject({ assigneeId: leaver, performedById: leaver });

    const path = `/api/tickets/${ticket.id}/actions/${openA.id}`;
    const withoutAssignee = await patch(path, cookies.staff, { version: 2, description: "Still to be done by someone." });
    expect(withoutAssignee.status).toBe(400);
    expect(Object.keys(withoutAssignee.body.error.fieldErrors)).toEqual(["assigneeId"]);
    expect((await patch(path, cookies.staff, { version: 2, description: "Still to be done by someone.", assigneeId: ids.other })).status).toBe(200);
    // It can also be completed as it is (BR-17).
    expect((await post(`/api/tickets/${ticket.id}/actions/${openB.id}/complete`, cookies.staff, { version: 2, result: "Done by a colleague." })).status).toBe(200);
  });

  it("does the same when the user is demoted to Requester", async () => {
    const leaver = (await prisma.user.create({ data: { fullName: "Moving Mo", email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: "IT_STAFF" } })).id;
    const ticket = await newTicket();
    const open = await created(ticket.id, { status: "OPEN", result: null, assigneeId: leaver });
    const res = await patch(`/api/admin/users/${leaver}`, cookies.admin, { role: "REQUESTER" });
    expect(res.status).toBe(200);
    expect(res.body.unassignedActionCount).toBe(1);
    expect((await prisma.actionTaken.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBeNull();
  });
});
