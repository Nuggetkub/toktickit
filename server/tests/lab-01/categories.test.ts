import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

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
// The change is recorded rather than quiet: only the ordering assertions moved.
// The response shape { id, name } and the four seeded categories are unchanged,
// and active-only filtering is covered by tests/lab-02/reference.api.test.ts.
const SEEDED_NAMES_IN_NAME_ORDER = ["Account and Access", "Hardware", "Network", "Software"];

describe("GET /api/categories", () => {
  it("returns the four seeded categories in name order", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(SEEDED_NAMES_IN_NAME_ORDER);
  });

  it("exposes only id and name", async () => {
    const res = await request(app).get("/api/categories");

    // createdAt and isActive are internal details — the API contract is { id, name }.
    for (const category of res.body) {
      expect(Object.keys(category).sort()).toEqual(["id", "name"]);
    }
  });
});
