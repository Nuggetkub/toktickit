import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor } from "../support/session.js";

// Requires the DB to be migrated and seeded first:
//   npx prisma migrate dev  &&  npm run prisma:seed
//
// UPDATED IN LAB 2 (Issue #19). This test previously asserted id order, which
// was the Lab 1 contract. The Lab 2 contract in docs/lab-02/api-spec.md §2 —
// written and merged before this implementation — specifies that all three
// reference endpoints return active rows ordered by name, so that the selector
// and Create Ticket dropdowns read alphabetically. The endpoint follows the
// newer contract and this test follows the endpoint.
//
// UPDATED IN LAB 3 (Issue #47). The endpoint now requires a signed-in user of
// any role (docs/lab-03/api-spec.md §3): Lab 2 left it open so the Requester
// selector could load before anyone was chosen, and Lab 3 has a sign-in screen
// instead. So each call carries a session. Only the identification changed —
// the four seeded categories, their name order and the { id, name } shape are
// asserted exactly as before.
//
// The change is recorded rather than quiet: only the ordering assertions moved
// in Lab 2, and only the session moved in Lab 3. Active-only filtering is
// covered by tests/lab-02/reference.api.test.ts.
const SEEDED_NAMES_IN_NAME_ORDER = ["Account and Access", "Hardware", "Network", "Software"];

let cookie = "";

beforeAll(async () => {
  const requester = await getPrisma().user.findFirstOrThrow({
    where: { isActive: true, role: "REQUESTER" },
    orderBy: { id: "asc" },
  });
  cookie = await sessionCookieFor(requester.id);
}, 30000);

describe("GET /api/categories", () => {
  it("returns the four seeded categories in name order", async () => {
    const res = await request(app).get("/api/categories").set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(SEEDED_NAMES_IN_NAME_ORDER);
  });

  it("exposes only id and name", async () => {
    const res = await request(app).get("/api/categories").set("Cookie", cookie);

    // createdAt and isActive are internal details — the API contract is { id, name }.
    for (const category of res.body) {
      expect(Object.keys(category).sort()).toEqual(["id", "name"]);
    }
  });
});
