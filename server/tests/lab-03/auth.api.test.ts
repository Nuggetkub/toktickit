import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { hashPassword } from "../../src/password.js";
import { resetThrottle } from "../../src/login-throttle.js";
import { SESSION_COOKIE } from "../../src/session.js";

// API-01 to API-07 in docs/lab-03/tests.md, against the real database rather
// than a mocked Prisma: what is being asserted is that the *query* and the
// session row behave, and a mock would only prove the mock returned what it was
// told to.
//
// The fixtures are IT Staff on their own domain rather than Requesters, because
// an extra active Requester would change what `/api/requesters` returns and
// break the Lab 2 reference suite, which asserts that list exactly.

const ORIGIN = "http://localhost:5173";
const PASSWORD = "correct horse battery staple";
const DOMAIN = "@auth-test.local";

const ACTIVE = `active${DOMAIN}`;
const PENDING = `pending${DOMAIN}`;
const INACTIVE = `inactive${DOMAIN}`;
const NO_PASSWORD = `nopassword${DOMAIN}`;

/** Supertest sends no Origin of its own, and every mutation requires one (BR-16). */
function post(path: string) {
  return request(app).post(path).set("Origin", ORIGIN);
}

function sessionCookie(response: request.Response): string {
  const header = response.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = header?.find((value) => value.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) throw new Error("Expected a session cookie.");
  return cookie.split(";")[0];
}

async function signIn(email: string, password = PASSWORD) {
  const response = await post("/api/auth/login").send({ email, password });
  expect(response.status).toBe(200);
  return sessionCookie(response);
}

beforeAll(async () => {
  const prisma = getPrisma();
  const passwordHash = await hashPassword(PASSWORD);

  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
  await prisma.user.createMany({
    data: [
      { fullName: "Active Tester", email: ACTIVE, role: "IT_STAFF", isActive: true, passwordHash, mustChangePassword: false },
      { fullName: "Pending Tester", email: PENDING, role: "IT_STAFF", isActive: true, passwordHash, mustChangePassword: true },
      { fullName: "Inactive Tester", email: INACTIVE, role: "IT_STAFF", isActive: false, passwordHash, mustChangePassword: false },
      // Exactly the state the migration leaves a Lab 2 Requester in (BR-43).
      { fullName: "Unprovisioned Tester", email: NO_PASSWORD, role: "IT_STAFF", isActive: true, passwordHash: null, mustChangePassword: true },
    ],
  });
}, 30_000);

afterAll(async () => {
  const prisma = getPrisma();
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  await prisma.session.deleteMany({ where: { userId: { in: users.map((user) => user.id) } } });
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });
});

beforeEach(() => resetThrottle());

describe("POST /api/auth/login", () => {
  it("signs in an active user and sets an HttpOnly session cookie", async () => {
    const response = await post("/api/auth/login").send({ email: ACTIVE, password: PASSWORD });

    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({
      email: ACTIVE,
      fullName: "Active Tester",
      role: "IT_STAFF",
      mustChangePassword: false,
    });
    // Nothing secret travels in the body — the cookie is the only credential.
    expect(JSON.stringify(response.body)).not.toMatch(/scrypt\$|passwordHash|tokenHash/);

    const cookie = (response.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=28800");
  });

  it("accepts the email in any case, because it is normalised before lookup", async () => {
    const response = await post("/api/auth/login").send({ email: `  ACTIVE${DOMAIN.toUpperCase()} `, password: PASSWORD });
    expect(response.status).toBe(200);
  });

  it("answers an unknown email, a wrong password and an account with no password identically", async () => {
    const unknown = await post("/api/auth/login").send({ email: `nobody${DOMAIN}`, password: PASSWORD });
    const wrong = await post("/api/auth/login").send({ email: ACTIVE, password: "not the right password" });
    const unprovisioned = await post("/api/auth/login").send({ email: NO_PASSWORD, password: PASSWORD });

    for (const response of [unknown, wrong, unprovisioned]) {
      expect(response.status).toBe(401);
      expect(response.body).toEqual({
        error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." },
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
  });

  it("spends the same work on an unknown email as on a wrong password", async () => {
    // BR-06 is a claim about *time*, not about the response body, and the body
    // assertions above pass whether or not the dummy hash is used. Without this
    // test, deleting the dummy-hash line would break the defence silently: an
    // unknown email would return before any key derivation, and the difference
    // is measurable from outside.
    const sample = async (email: string) => {
      const timings: number[] = [];
      for (let run = 0; run < 3; run += 1) {
        resetThrottle();
        const started = process.hrtime.bigint();
        await post("/api/auth/login").send({ email, password: "not the right password" });
        timings.push(Number(process.hrtime.bigint() - started) / 1e6);
      }
      return timings.sort((a, b) => a - b)[1]; // median, to blunt scheduler noise
    };

    const unknownAccount = await sample(`nobody${DOMAIN}`);
    const wrongPassword = await sample(ACTIVE);

    // scrypt at the contracted cost dominates both paths, so the ratio is near
    // 1. A missing dummy hash drops the unknown-email path by an order of
    // magnitude, which this bound catches while tolerating ordinary jitter.
    const ratio = unknownAccount / wrongPassword;
    expect(ratio).toBeGreaterThan(0.5);
    expect(ratio).toBeLessThan(2);
  }, 30_000);

  it("names a deactivated account only once its password is correct", async () => {
    const correct = await post("/api/auth/login").send({ email: INACTIVE, password: PASSWORD });
    expect(correct.status).toBe(403);
    expect(correct.body.error.code).toBe("ACCOUNT_INACTIVE");
    expect(correct.headers["set-cookie"]).toBeUndefined();

    // With the wrong password it is indistinguishable from any other failure,
    // so deactivation is never disclosed to someone without the password (BR-07).
    const wrong = await post("/api/auth/login").send({ email: INACTIVE, password: "not the right password" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");
  });

  it("refuses the sixth attempt within the window, even with the correct password", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failure = await post("/api/auth/login").send({ email: ACTIVE, password: "wrong" });
      expect(failure.status).toBe(401);
    }

    const throttled = await post("/api/auth/login").send({ email: ACTIVE, password: PASSWORD });
    expect(throttled.status).toBe(429);
    expect(throttled.body.error.code).toBe("LOGIN_THROTTLED");
    expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
    expect(throttled.headers["set-cookie"]).toBeUndefined();
  });

  it("validates the input and refuses an untrusted origin", async () => {
    const missing = await post("/api/auth/login").send({});
    expect(missing.status).toBe(400);
    expect(missing.body.error.fieldErrors).toEqual({
      email: "Enter your email address.",
      password: "Enter your password.",
    });

    const noOrigin = await request(app).post("/api/auth/login").send({ email: ACTIVE, password: PASSWORD });
    expect(noOrigin.status).toBe(403);
    expect(noOrigin.body.error.code).toBe("ORIGIN_REJECTED");

    const foreign = await request(app)
      .post("/api/auth/login")
      .set("Origin", "http://evil.example")
      .send({ email: ACTIVE, password: PASSWORD });
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe("ORIGIN_REJECTED");
  });
});

describe("GET /api/auth/me", () => {
  it("returns the signed-in user and is not cacheable", async () => {
    const cookie = await signIn(ACTIVE);
    const response = await request(app).get("/api/auth/me").set("Cookie", cookie);

    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(ACTIVE);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("refuses an absent, unknown or expired session with the same 401", async () => {
    const absent = await request(app).get("/api/auth/me");
    const unknown = await request(app).get("/api/auth/me").set("Cookie", `${SESSION_COOKIE}=not-a-real-token`);

    for (const response of [absent, unknown]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe("UNAUTHENTICATED");
    }

    // An expired session is refused on the next request (BR-14). The row is
    // aged directly rather than waiting eight hours.
    const cookie = await signIn(ACTIVE);
    await getPrisma().session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const expired = await request(app).get("/api/auth/me").set("Cookie", cookie);
    expect(expired.status).toBe(401);
  });

  it("stops working as soon as the account is deactivated", async () => {
    const cookie = await signIn(ACTIVE);
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);

    await getPrisma().user.update({ where: { email: ACTIVE }, data: { isActive: false } });
    try {
      const refused = await request(app).get("/api/auth/me").set("Cookie", cookie);
      expect(refused.status).toBe(401);
      expect(refused.body.error.code).toBe("UNAUTHENTICATED");
    } finally {
      await getPrisma().user.update({ where: { email: ACTIVE }, data: { isActive: true } });
    }
  });
});

describe("POST /api/auth/change-password", () => {
  it("reports a wrong current password on its field, and keeps the session alive", async () => {
    const cookie = await signIn(ACTIVE);

    const response = await post("/api/auth/change-password")
      .set("Cookie", cookie)
      .send({ currentPassword: "not my password", newPassword: "a brand new password", confirmPassword: "a brand new password" });

    expect(response.status).toBe(400);
    expect(response.body.error.fieldErrors.currentPassword).toBeDefined();
    // Emphatically not a 401: the client treats that as "your session ended"
    // (BR-47), so a typo would sign the user out.
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
  });

  it("applies every password rule to the new password", async () => {
    const cookie = await signIn(ACTIVE);

    const tooShort = await post("/api/auth/change-password").set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "short", confirmPassword: "short" });
    expect(tooShort.body.error.fieldErrors.newPassword).toBeDefined();

    const mismatch = await post("/api/auth/change-password").set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: "a brand new password", confirmPassword: "a different password" });
    expect(mismatch.body.error.fieldErrors.confirmPassword).toBeDefined();

    const sameAsCurrent = await post("/api/auth/change-password").set("Cookie", cookie)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD, confirmPassword: PASSWORD });
    expect(sameAsCurrent.body.error.fieldErrors.newPassword).toBeDefined();

    for (const response of [tooShort, mismatch, sameAsCurrent]) expect(response.status).toBe(400);
  });

  it("clears the pending flag, replaces the session, and ends every other one", async () => {
    const first = await signIn(PENDING);
    const second = await signIn(PENDING);
    const replacement = "a private password for the pending account";

    const changed = await post("/api/auth/change-password")
      .set("Cookie", first)
      .send({ currentPassword: PASSWORD, newPassword: replacement, confirmPassword: replacement });

    expect(changed.status).toBe(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    const newCookie = sessionCookie(changed);
    expect(newCookie).not.toBe(first);
    expect((await request(app).get("/api/auth/me").set("Cookie", newCookie)).status).toBe(200);
    // Both of the old sessions are gone, which is the point of BR-15: a stolen
    // cookie must stop working the moment the password changes.
    expect((await request(app).get("/api/auth/me").set("Cookie", first)).status).toBe(401);
    expect((await request(app).get("/api/auth/me").set("Cookie", second)).status).toBe(401);

    // Restore the fixture for any later run against the same schema.
    await post("/api/auth/change-password")
      .set("Cookie", newCookie)
      .send({ currentPassword: replacement, newPassword: PASSWORD, confirmPassword: PASSWORD });
    await getPrisma().user.update({ where: { email: PENDING }, data: { mustChangePassword: true } });
  });

  it("lets an account with a pending change reach only me, change-password and logout", async () => {
    const cookie = await signIn(PENDING);

    // The three permitted endpoints (BR-02).
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(200);
    expect(
      (await post("/api/auth/change-password").set("Cookie", cookie).send({})).status,
    ).toBe(400); // reached the handler, rejected on input rather than on the gate
    expect((await post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);

    // The other half of API-04 — business routes answering
    // 403 PASSWORD_CHANGE_REQUIRED — arrives with issue #47, which is what puts
    // those routes behind the session. That row stays Planned until then.
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session and is safe to repeat", async () => {
    const cookie = await signIn(ACTIVE);

    const response = await post("/api/auth/logout").set("Cookie", cookie);
    expect(response.status).toBe(204);
    expect((response.headers["set-cookie"] as unknown as string[])[0]).toContain("Max-Age=0");

    // The server forgot the session; the cookie alone is worth nothing.
    expect((await request(app).get("/api/auth/me").set("Cookie", cookie)).status).toBe(401);
    expect((await post("/api/auth/logout").set("Cookie", cookie)).status).toBe(204);
    expect((await post("/api/auth/logout")).status).toBe(204);
  });
});
