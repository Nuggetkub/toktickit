import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { requirePasswordChangeComplete, requireTrustedOrigin } from "../../src/auth-middleware.js";

// The two guards that have no business routes behind them yet.
//
// `requirePasswordChangeComplete` is applied to the Lab 2 routes by issue #47,
// which is when API-04's second half becomes testable end to end. Until then it
// would be dead code covered by nothing — so it is exercised directly here,
// against a throwaway app, rather than left to be trusted.

function appWith(...middleware: express.RequestHandler[]) {
  const app = express();
  app.use(express.json());
  app.post("/guarded", ...middleware, (_req, res) => res.status(200).json({ reached: true }));
  app.get("/guarded", ...middleware, (_req, res) => res.status(200).json({ reached: true }));
  return app;
}

describe("requirePasswordChangeComplete (BR-02)", () => {
  const pending = { id: 1, fullName: "Pending", email: "pending@toktickit.local", role: "REQUESTER", mustChangePassword: true };
  const settled = { ...pending, mustChangePassword: false };

  function withUser(user: unknown): express.RequestHandler {
    return (_req, res, next) => {
      res.locals.user = user;
      next();
    };
  }

  it("refuses a session whose password change is still pending", async () => {
    const response = await request(appWith(withUser(pending), requirePasswordChangeComplete)).get("/guarded");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(response.body.reached).toBeUndefined();
  });

  it("admits a session once the password has been changed", async () => {
    const response = await request(appWith(withUser(settled), requirePasswordChangeComplete)).get("/guarded");

    expect(response.status).toBe(200);
    expect(response.body.reached).toBe(true);
  });

  it("refuses when no user was resolved at all, rather than admitting one", async () => {
    // A route that forgets requireAuthenticatedUser must fail closed.
    const response = await request(appWith(requirePasswordChangeComplete)).get("/guarded");

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("requireTrustedOrigin (BR-16)", () => {
  const guarded = () => appWith(requireTrustedOrigin);

  it("refuses a state-changing request with no Origin or an unlisted one", async () => {
    const absent = await request(guarded()).post("/guarded").send({});
    const foreign = await request(guarded()).post("/guarded").set("Origin", "http://evil.example").send({});

    for (const response of [absent, foreign]) {
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("ORIGIN_REJECTED");
    }
  });

  it("allows a state-changing request from a configured origin", async () => {
    const response = await request(guarded()).post("/guarded").set("Origin", "http://localhost:5173").send({});

    expect(response.status).toBe(200);
  });

  it("leaves reads alone, so curl evidence and ordinary GETs still work", async () => {
    const response = await request(guarded()).get("/guarded");

    expect(response.status).toBe(200);
  });
});
