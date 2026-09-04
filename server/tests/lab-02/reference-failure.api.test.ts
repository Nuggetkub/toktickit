import { describe, it, expect, vi } from "vitest";

// The failure half of API-01. Prisma is mocked here — and only here — because
// the point is what the route does when the database is unreachable, which
// cannot be arranged against a healthy one.
//
// The mock is per-model rather than a blanket stub, so a route querying the
// wrong model fails instead of silently receiving someone else's answer.
const unreachable = () => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:5433"));

vi.mock("../../src/prisma.js", () => ({
  getPrisma: () => ({
    category: { findMany: unreachable },
    relatedSystem: { findMany: unreachable },
    requester: { findMany: unreachable },
  }),
}));

const { default: request } = await import("supertest");
const { app } = await import("../../src/app.js");

describe("reference endpoints when the database is unreachable", () => {
  it.each([
    ["/api/categories"],
    ["/api/related-systems"],
    ["/api/requesters"],
  ])("%s returns a safe 503 in the documented envelope", async (path) => {
    const res = await request(app).get(path);

    expect(res.status).toBe(503);
    expect(res.body).toEqual({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "The service is temporarily unavailable. Please try again.",
      },
    });
  });

  it("never leaks the underlying cause to the client", async () => {
    const res = await request(app).get("/api/categories");
    const body = JSON.stringify(res.body);

    // BR-41: no stack trace, no SQL, no connection string.
    expect(body).not.toMatch(/ECONNREFUSED/);
    expect(body).not.toMatch(/5433/);
    expect(body).not.toMatch(/at \w+ \(/);
  });
});
