import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dropSchema, deployMigrations, resetSchema, scratchUrl } from "./support.js";

// API-25 to API-29 — AC-20, AC-21, AC-22, AC-23 (docs/lab-03/tests.md).
//
// **This suite owns a schema.** BR-42 counts *every* active Administrator in the
// database, so the rule can only be tested where the Administrator population is
// known: in the shared test schema the seed and the other suites contribute
// Administrators of their own, and "deactivating this one would leave none"
// could never become true. A test that can never reach its own rule is worse
// than no test, because the row still reads as covered.
//
// The schema is reset and migrated in beforeAll and dropped afterwards, using
// the same helpers migration.test.ts uses. It is deliberately **not** opt-in
// behind an environment variable: it runs in an ordinary `npm test`, so deleting
// the row lock reddens the suite everyone runs rather than one nobody sets up.
const SCHEMA = "lab3_users_admin";
process.env.DATABASE_URL = scratchUrl(SCHEMA);

// Imported after the URL is set. `getPrisma()` is a lazy singleton built on
// first *call*, and nothing here calls it at import time, so the client binds to
// the schema above rather than to the shared one.
const { app } = await import("../../src/app.js");
const { getPrisma } = await import("../../src/prisma.js");
const { rawSessionCookieFor, sessionCookieFor, TEST_ORIGIN } = await import("../support/session.js");

const prisma = getPrisma();
const DOMAIN = "@users-admin-test.local";
const GOOD_PASSWORD = "correct-horse-battery-staple";

let adminOneId = 0;
let adminTwoId = 0;
let staffId = 0;
let requesterId = 0;

let adminOne = "";
let adminTwo = "";
let staff = "";
let requester = "";

let categoryId = 0;
let relatedSystemId = 0;

function makeUser(fullName: string, role: string, isActive = true) {
  return prisma.user.create({
    data: {
      fullName,
      email: `${randomUUID().slice(0, 8)}${DOMAIN}`,
      role: role as never,
      isActive,
      mustChangePassword: false,
    },
    select: { id: true, email: true },
  });
}

function newTicket(ownerId: number | null, status: string) {
  return prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2099-${randomUUID().slice(0, 12)}`,
      requesterId,
      categoryId,
      relatedSystemId,
      summary: "User administration suite ticket",
      description: "Created so deactivation has real work to unassign.",
      requestedPriority: "MEDIUM",
      itPriority: "MEDIUM",
      currentStatus: status as never,
      ownerId,
      idempotencyKey: randomUUID(),
    },
    select: { id: true, version: true },
  });
}

function get(path: string, cookie: string) {
  return request(app).get(path).set("Cookie", cookie);
}

function send(method: "post" | "patch", path: string, cookie: string, body: object) {
  const agent = request(app) as unknown as Record<string, (p: string) => request.Test>;
  return agent[method](path).set("Cookie", cookie).set("Origin", TEST_ORIGIN).send(body);
}

/** Every active Administrator in the database — the invariant BR-42 protects. */
function activeAdministrators() {
  return prisma.user.count({ where: { role: "ADMINISTRATOR", isActive: true } });
}

beforeAll(async () => {
  await resetSchema(SCHEMA);
  deployMigrations(scratchUrl(SCHEMA));

  const [category, relatedSystem] = await Promise.all([
    prisma.category.create({ data: { name: `Admin probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Admin system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;

  adminOneId = (await makeUser("Aurelia Admin", "ADMINISTRATOR")).id;
  adminTwoId = (await makeUser("Bruno Admin", "ADMINISTRATOR")).id;
  staffId = (await makeUser("Grace Okafor", "IT_STAFF")).id;
  requesterId = (await makeUser("Nadia Rahman", "REQUESTER")).id;

  adminOne = await sessionCookieFor(adminOneId);
  adminTwo = await sessionCookieFor(adminTwoId);
  staff = await sessionCookieFor(staffId);
  requester = await sessionCookieFor(requesterId);
}, 120000);

afterAll(async () => {
  await prisma.$disconnect();
  await dropSchema(SCHEMA);
});

describe("API-25 — the user list, its search and its role filter", () => {
  it("searches name and email case-insensitively and orders by name then id", async () => {
    const byName = await get(`/api/admin/users?search=AURELIA`, adminOne);
    expect(byName.status).toBe(200);
    expect(byName.body.items.map((user: { id: number }) => user.id)).toContain(adminOneId);

    const target = await prisma.user.findUniqueOrThrow({ where: { id: staffId }, select: { email: true } });
    const byEmail = await get(`/api/admin/users?search=${target.email.slice(0, 6).toUpperCase()}`, adminOne);
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.items.map((user: { id: number }) => user.id)).toContain(staffId);

    const all = await get("/api/admin/users", adminOne);
    const names = all.body.items.map((user: { fullName: string }) => user.fullName);
    expect(names).toEqual([...names].sort((a: string, b: string) => a.localeCompare(b)));
  });

  it("filters by each role, and combines the filter with a search", async () => {
    const administrators = await get("/api/admin/users?role=ADMINISTRATOR", adminOne);
    expect(administrators.status).toBe(200);
    expect(administrators.body.items.map((user: { id: number }) => user.id).sort()).toEqual(
      [adminOneId, adminTwoId].sort(),
    );

    const combined = await get("/api/admin/users?role=ADMINISTRATOR&search=Bruno", adminOne);
    expect(combined.body.items.map((user: { id: number }) => user.id)).toEqual([adminTwoId]);
  });

  it("rejects an unknown role, an empty search and an unknown parameter rather than ignoring them", async () => {
    // Lab 2 BR-27. Silently dropping a filter returns a result set the caller
    // believes is filtered, and "no matches" then means the wrong thing.
    const badRole = await get("/api/admin/users?role=SUPERUSER", adminOne);
    expect(badRole.status).toBe(400);
    expect(badRole.body.error.code).toBe("VALIDATION_FAILED");
    expect(badRole.body.error.fieldErrors).toHaveProperty("role");

    const emptySearch = await get("/api/admin/users?search=", adminOne);
    expect(emptySearch.status).toBe(400);

    const unknown = await get("/api/admin/users?page=2", adminOne);
    expect(unknown.status).toBe(400);
    expect(unknown.body.error.fieldErrors).toHaveProperty("page");
  });
});

describe("API-26 — creating a user", () => {
  it("creates a pending-password account, never echoes the password, and lets it sign in only with that password", async () => {
    const email = `new.hire.${randomUUID().slice(0, 8)}${DOMAIN}`;
    const created = await send("post", "/api/admin/users", adminOne, {
      fullName: "New Hire",
      email,
      role: "IT_STAFF",
      isActive: true,
      initialPassword: GOOD_PASSWORD,
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ fullName: "New Hire", email, role: "IT_STAFF", mustChangePassword: true });
    // Neither the password nor its hash may appear anywhere in the response.
    expect(JSON.stringify(created.body)).not.toContain(GOOD_PASSWORD);
    expect(created.body).not.toHaveProperty("passwordHash");

    const wrong = await request(app)
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .send({ email, password: "not-the-password-at-all" });
    expect(wrong.status).toBe(401);

    const right = await request(app)
      .post("/api/auth/login")
      .set("Origin", TEST_ORIGIN)
      .send({ email, password: GOOD_PASSWORD });
    expect(right.status).toBe(200);
    // BR-39: whoever created it and whatever password they chose, the account
    // starts out having to change it.
    expect(right.body.user.mustChangePassword).toBe(true);
  });

  it("refuses a duplicate email compared after normalisation", async () => {
    const email = `dup.${randomUUID().slice(0, 8)}${DOMAIN}`;
    const first = await send("post", "/api/admin/users", adminOne, {
      fullName: "First Claimant",
      email,
      role: "REQUESTER",
      isActive: true,
      initialPassword: GOOD_PASSWORD,
    });
    expect(first.status).toBe(201);

    const second = await send("post", "/api/admin/users", adminOne, {
      fullName: "Second Claimant",
      email: `  ${email.toUpperCase()}  `,
      role: "REQUESTER",
      isActive: true,
      initialPassword: GOOD_PASSWORD,
    });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  it.each([
    ["fullName", { fullName: "A" }],
    ["email", { email: "not-an-address" }],
    ["role", { role: "SUPERUSER" }],
    ["isActive", { isActive: "yes" }],
    ["initialPassword", { initialPassword: "short" }],
  ])("reports an invalid %s beside its own field", async (field, override) => {
    const res = await send("post", "/api/admin/users", adminOne, {
      fullName: "Valid Name",
      email: `valid.${randomUUID().slice(0, 8)}${DOMAIN}`,
      role: "REQUESTER",
      isActive: true,
      initialPassword: GOOD_PASSWORD,
      ...override,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fieldErrors).toHaveProperty(field as string);
  });
});

describe("API-27 — editing a user and setting a new initial password", () => {
  it("persists name, email, role and activation", async () => {
    const target = await makeUser("Editable Person", "REQUESTER");
    const email = `renamed.${randomUUID().slice(0, 8)}${DOMAIN}`;

    const res = await send("patch", `/api/admin/users/${target.id}`, adminOne, {
      fullName: "Renamed Person",
      email: email.toUpperCase(),
      role: "IT_STAFF",
      isActive: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ fullName: "Renamed Person", email, role: "IT_STAFF", isActive: false });
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(stored).toMatchObject({ fullName: "Renamed Person", email, role: "IT_STAFF", isActive: false });
  });

  it("answers 404 for a user that does not exist", async () => {
    const res = await send("patch", "/api/admin/users/99999999", adminOne, { fullName: "Ghost" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("sets an initial password, forces the next sign-in to change it, and ends the account's open session", async () => {
    const target = await makeUser("Locked Out", "IT_STAFF");
    const theirCookie = await rawSessionCookieFor(target.id);
    await prisma.user.update({ where: { id: target.id }, data: { mustChangePassword: false } });

    // Their session works before the reset...
    expect((await get("/api/auth/me", theirCookie)).status).toBe(200);

    const res = await send("post", `/api/admin/users/${target.id}/initial-password`, adminOne, {
      initialPassword: GOOD_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.mustChangePassword).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(GOOD_PASSWORD);

    // ...and is gone afterwards (BR-15), so the old credential cannot outlive
    // the new one.
    expect((await get("/api/auth/me", theirCookie)).status).toBe(401);
  });

  it("does not end sessions for a rename", async () => {
    const target = await makeUser("Merely Renamed", "REQUESTER");
    const theirCookie = await rawSessionCookieFor(target.id);
    await prisma.user.update({ where: { id: target.id }, data: { mustChangePassword: false } });

    const res = await send("patch", `/api/admin/users/${target.id}`, adminOne, { fullName: "Still Signed In" });
    expect(res.status).toBe(200);
    // BR-15 names role changes, deactivation and a new password. A rename is
    // none of those, and signing somebody out for it would be a surprise.
    expect((await get("/api/auth/me", theirCookie)).status).toBe(200);
  });
});

describe("API-28 — the Administrator safety rules", () => {
  it("refuses self-deactivation and an own-role change", async () => {
    const deactivateSelf = await send("patch", `/api/admin/users/${adminOneId}`, adminOne, { isActive: false });
    expect(deactivateSelf.status).toBe(409);
    expect(deactivateSelf.body.error.code).toBe("CANNOT_DEACTIVATE_SELF");

    const demoteSelf = await send("patch", `/api/admin/users/${adminOneId}`, adminOne, { role: "IT_STAFF" });
    expect(demoteSelf.status).toBe(409);
    expect(demoteSelf.body.error.code).toBe("CANNOT_CHANGE_OWN_ROLE");

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: adminOneId } });
    expect(stored).toMatchObject({ isActive: true, role: "ADMINISTRATOR" });
  });

  it("lets an Administrator rename themselves", async () => {
    // BR-41 removes access, not identity. Refusing a self-rename would be a
    // rule nobody wrote.
    const res = await send("patch", `/api/admin/users/${adminOneId}`, adminOne, { fullName: "Aurelia Admin" });
    expect(res.status).toBe(200);
  });

  it("answers BR-41 rather than BR-42 when the last Administrator edits themselves", async () => {
    // Worth stating plainly, because it surprised me while writing these tests:
    // **sequentially, BR-42 can never fire.** The caller must be an active
    // Administrator to reach the route at all, so either the target is somebody
    // else — and the caller is themselves a second active Administrator, leaving
    // one behind — or the target is the caller, and BR-41 answers first.
    //
    // The one path that reaches LAST_ACTIVE_ADMINISTRATOR is two requests
    // racing, where the loser re-reads the count after the winner commits. That
    // is the concurrency test below, and it is the only place this response is
    // asserted. A rule reachable solely under concurrency is exactly the kind
    // that gets a plausible-looking test which never executes it.
    const lonely = await makeUser("Solo Admin", "ADMINISTRATOR");
    const lonelyCookie = await sessionCookieFor(lonely.id);
    await prisma.user.updateMany({
      where: { role: "ADMINISTRATOR", isActive: true, id: { not: lonely.id } },
      data: { isActive: false },
    });
    expect(await activeAdministrators()).toBe(1);

    const demote = await send("patch", `/api/admin/users/${lonely.id}`, lonelyCookie, { role: "IT_STAFF" });
    expect(demote.status).toBe(409);
    expect(demote.body.error.code).toBe("CANNOT_CHANGE_OWN_ROLE");

    const deactivate = await send("patch", `/api/admin/users/${lonely.id}`, lonelyCookie, { isActive: false });
    expect(deactivate.status).toBe(409);
    expect(deactivate.body.error.code).toBe("CANNOT_DEACTIVATE_SELF");

    // Still exactly one, and still an Administrator: a refusal wrote nothing.
    expect(await activeAdministrators()).toBe(1);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: lonely.id } })).toMatchObject({
      isActive: true,
      role: "ADMINISTRATOR",
    });

    // Restore the pair the other tests rely on.
    await prisma.user.update({ where: { id: lonely.id }, data: { isActive: false } });
    await prisma.user.updateMany({
      where: { id: { in: [adminOneId, adminTwoId] } },
      data: { isActive: true, role: "ADMINISTRATOR" },
    });
    adminOne = await sessionCookieFor(adminOneId);
    adminTwo = await sessionCookieFor(adminTwoId);
  });

  it("ends the account's sessions when it is deactivated or its role changes (BR-15)", async () => {
    const deactivated = await makeUser("About To Go", "IT_STAFF");
    const theirCookie = await rawSessionCookieFor(deactivated.id);
    await prisma.user.update({ where: { id: deactivated.id }, data: { mustChangePassword: false } });
    expect((await get("/api/auth/me", theirCookie)).status).toBe(200);

    const off = await send("patch", `/api/admin/users/${deactivated.id}`, adminOne, { isActive: false });
    expect(off.status).toBe(200);
    expect((await get("/api/auth/me", theirCookie)).status).toBe(401);

    const demoted = await makeUser("About To Be Demoted", "IT_STAFF");
    const demotedCookie = await rawSessionCookieFor(demoted.id);
    await prisma.user.update({ where: { id: demoted.id }, data: { mustChangePassword: false } });
    expect((await get("/api/auth/me", demotedCookie)).status).toBe(200);

    const down = await send("patch", `/api/admin/users/${demoted.id}`, adminOne, { role: "REQUESTER" });
    expect(down.status).toBe(200);
    // A role change ends the session even though the account is still active:
    // the session was issued to somebody with different permissions.
    expect((await get("/api/auth/me", demotedCookie)).status).toBe(401);
  });

  it("leaves exactly one active Administrator when two deactivate each other at the same instant", async () => {
    // The test BR-42's row lock exists for. Without the lock both requests read
    // "two active", both decide the rule is satisfied, and the system ends with
    // none — an outcome no single request could ever produce.
    await prisma.user.updateMany({
      where: { role: "ADMINISTRATOR" },
      data: { isActive: false },
    });
    await prisma.user.updateMany({
      where: { id: { in: [adminOneId, adminTwoId] } },
      data: { isActive: true, role: "ADMINISTRATOR" },
    });
    adminOne = await sessionCookieFor(adminOneId);
    adminTwo = await sessionCookieFor(adminTwoId);
    expect(await activeAdministrators()).toBe(2);

    // `.then()` is what dispatches a supertest request: holding the Test object
    // sends nothing, and the two would run one after the other rather than
    // together. That mistake cost a whole round on PR #66.
    const [first, second] = await Promise.all([
      send("patch", `/api/admin/users/${adminTwoId}`, adminOne, { isActive: false }).then((res) => res),
      send("patch", `/api/admin/users/${adminOneId}`, adminTwo, { isActive: false }).then((res) => res),
    ]);

    const statuses = [first.status, second.status];
    expect(statuses).toContain(200);
    // The loser is refused by BR-42, or is already unauthenticated because the
    // winner revoked its session first. Both prevent the second deactivation;
    // the database invariant below is the claim, and it is the same either way.
    const loser = [first, second].find((res) => res.status !== 200)!;
    expect([401, 409]).toContain(loser.status);
    // And when it is the rule rather than the revoked session that refused, it
    // must be BR-42 saying so. This is the **only** place the API can answer
    // LAST_ACTIVE_ADMINISTRATOR at all — see the note on the test above — so an
    // unasserted code here would leave that response entirely uncovered.
    if (loser.status === 409) expect(loser.body.error.code).toBe("LAST_ACTIVE_ADMINISTRATOR");
    expect(await activeAdministrators()).toBe(1);

    await prisma.user.updateMany({
      where: { id: { in: [adminOneId, adminTwoId] } },
      data: { isActive: true },
    });
    adminOne = await sessionCookieFor(adminOneId);
    adminTwo = await sessionCookieFor(adminTwoId);
  });

  it("unassigns a deactivated operator's open tickets, keeps their finished ones, and reports the count", async () => {
    const departing = await makeUser("Departing Staff", "IT_STAFF");
    const open = await newTicket(departing.id, "IN_PROGRESS");
    const waiting = await newTicket(departing.id, "WAITING_FOR_REQUESTER");
    const closed = await newTicket(departing.id, "CLOSED");

    const res = await send("patch", `/api/admin/users/${departing.id}`, adminOne, { isActive: false });

    expect(res.status).toBe(200);
    // The count is part of the contract (api-spec.md §8), so the Administrator
    // learns what their change did to the queue.
    expect(res.body.unassignedTicketCount).toBe(2);

    const [openAfter, waitingAfter, closedAfter] = await Promise.all([
      prisma.ticket.findUniqueOrThrow({ where: { id: open.id } }),
      prisma.ticket.findUniqueOrThrow({ where: { id: waiting.id } }),
      prisma.ticket.findUniqueOrThrow({ where: { id: closed.id } }),
    ]);

    expect(openAfter.ownerId).toBeNull();
    expect(waitingAfter.ownerId).toBeNull();
    // BR-27: a finished ticket keeps its history, including who closed it.
    expect(closedAfter.ownerId).toBe(departing.id);
    // BR-24: the ticket really changed, so a stale editor is refused rather
    // than overwriting this.
    expect(openAfter.version).toBe(open.version + 1);
  });

  it("unassigns on a demotion to Requester as well, and reports zero when there is nothing to unassign", async () => {
    const demoted = await makeUser("Moving To Requester", "IT_STAFF");
    const owned = await newTicket(demoted.id, "OPEN");

    const res = await send("patch", `/api/admin/users/${demoted.id}`, adminOne, { role: "REQUESTER" });
    expect(res.status).toBe(200);
    expect(res.body.unassignedTicketCount).toBe(1);
    expect((await prisma.ticket.findUniqueOrThrow({ where: { id: owned.id } })).ownerId).toBeNull();

    const quiet = await makeUser("Owns Nothing", "IT_STAFF");
    const second = await send("patch", `/api/admin/users/${quiet.id}`, adminOne, { isActive: false });
    expect(second.status).toBe(200);
    expect(second.body.unassignedTicketCount).toBe(0);
  });
});

describe("API-29 — everyone else is refused before any lookup", () => {
  const endpoints = (id: number) =>
    [
      ["get", "/api/admin/users"],
      ["post", "/api/admin/users"],
      ["patch", `/api/admin/users/${id}`],
      ["post", `/api/admin/users/${id}/initial-password`],
    ] as const;

  it.each([
    ["IT Staff", () => staff],
    ["a Requester", () => requester],
  ])("refuses %s on every endpoint", async (_label, cookieFor) => {
    const cookie = cookieFor();
    for (const [method, path] of endpoints(staffId)) {
      const res =
        method === "get" ? await get(path, cookie) : await send(method, path, cookie, { fullName: "Nice Try" });
      expect(res.status, `${method.toUpperCase()} ${path}`).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
  });

  it("answers identically for a user id that does not exist", async () => {
    // The refusal must not depend on the resource, or it discloses whether the
    // resource is there (BR-18, decision D-07).
    const real = await send("patch", `/api/admin/users/${staffId}`, staff, { fullName: "Nice Try" });
    const ghost = await send("patch", "/api/admin/users/99999999", staff, { fullName: "Nice Try" });

    expect(real.status).toBe(403);
    expect(ghost.status).toBe(403);
    expect(ghost.body).toEqual(real.body);
  });

  it("changed nothing while refusing", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    await send("patch", `/api/admin/users/${staffId}`, requester, { fullName: "Nice Try", isActive: false });
    const after = await prisma.user.findUniqueOrThrow({ where: { id: staffId } });
    expect(after).toMatchObject({ fullName: before.fullName, isActive: before.isActive });
  });
});
