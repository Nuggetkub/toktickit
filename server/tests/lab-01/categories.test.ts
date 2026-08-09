import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";

// Requires the DB to be migrated and seeded first:
//   npx prisma migrate dev  &&  npm run prisma:seed
const SEEDED_NAMES = ["Account and Access", "Hardware", "Software", "Network"];

describe("GET /api/categories", () => {
  it("returns the four seeded categories in id order", async () => {
    const res = await request(app).get("/api/categories");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(4);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(SEEDED_NAMES);
  });

  it("returns ids in ascending order and exposes only id and name", async () => {
    const res = await request(app).get("/api/categories");

    const ids = res.body.map((c: { id: number }) => c.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    // createdAt is an internal detail — the API contract is { id, name }.
    for (const category of res.body) {
      expect(Object.keys(category).sort()).toEqual(["id", "name"]);
    }
  });
});
