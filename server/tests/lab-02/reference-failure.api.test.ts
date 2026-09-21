import { describe, it, expect, vi } from "vitest";

// The failure half of API-01. Prisma is mocked here — and only here — because
// the point is what the route does when the database is unreachable, which
// cannot be arranged against a healthy one.
//
// The mock is per-model rather than a blanket stub, so a route querying the
// wrong model fails instead of silently receiving someone else's answer. Issue
// #47 makes that precision do real work: the reference endpoints now sit behind
// a session, so the *session* lookups have to succeed while the *reference*
// query fails. A blanket stub could not express "this dependency is down and
// that one is not", and the test would prove a 503 that came from the wrong
// place — authentication failing, rather than the database being unreachable.
const unreachable = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5433"));

const sessionUser = {
  id: 1,
  fullName: "Reference Failure Suite",
  email: "reference-failure@example.test",
  role: "REQUESTER" as const,
  mustChangePassword: false,
};

vi.mock("../../src/prisma.js", () => ({
  getPrisma: () => ({
    category: { findMany: unreachable },
    relatedSystem: { findMany: unreachable },
    session: {
      findUnique: async () => ({ expiresAt: new Date(Date.now() + 60_000), user: sessionUser }),
    },
    user: { findFirst: async () => sessionUser },
  }),
}));

const { default: request } = await import("supertest");
const { app } = await import("../../src/app.js");
const { SESSION_COOKIE } = await import("../../src/session.js");

// The value is irrelevant — the mocked session lookup ignores it — but the
// cookie has to be present for the request to reach the route at all.
const COOKIE = `${SESSION_COOKIE}=token-the-mock-does-not-read`;

describe("reference endpoints when the database is unreachable", () => {
  it.each([["/api/categories"], ["/api/related-systems"]])(
    "%s returns a safe 503 in the documented envelope",
    async (path) => {
      const res = await request(app).get(path).set("Cookie", COOKIE);

      expect(res.status).toBe(503);
      expect(res.body).toEqual({
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "The service is temporarily unavailable. Please try again.",
        },
      });
    },
  );

  it("never leaks the underlying cause to the client", async () => {
    const res = await request(app).get("/api/categories").set("Cookie", COOKIE);
    const body = JSON.stringify(res.body);

    // BR-41: no stack trace, no SQL, no connection string.
    expect(body).not.toMatch(/ECONNREFUSED/);
    expect(body).not.toMatch(/5433/);
    expect(body).not.toMatch(/at \w+ \(/);
  });
});
