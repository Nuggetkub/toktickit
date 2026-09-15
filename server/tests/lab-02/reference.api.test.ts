import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { CATEGORY_NAMES, RELATED_SYSTEM_NAMES } from "../../src/seed-data.js";
import { sessionCookieFor } from "../support/session.js";

// API-01 — the reference endpoints (specification.md AC-01).
//
// These run against the real migrated and seeded database, like the Lab 1
// suite, because what is being asserted is that the *query* excludes inactive
// rows. A mocked Prisma would only prove that the mock returned what the mock
// was told to return.
//
//   npx prisma migrate dev  &&  npm run prisma:seed
//
// Changed by issue #47, and only in how the caller is identified: both endpoints
// now require a session of any role (Lab 3 api-spec.md §3), so each call carries
// one. Every assertion about their content is the Lab 2 assertion, unchanged.
//
// The `GET /api/requesters` block that used to live here is gone with the
// endpoint it tested — Lab 3 has a sign-in screen instead of a Requester
// selector. That the path now answers 404, and that no privileged address leaks
// through the surfaces that remain, is asserted in
// `tests/lab-03/authorization.api.test.ts`.

let cookie = "";

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function get(path: string) {
  return request(app).get(path).set("Cookie", cookie);
}

beforeAll(async () => {
  const requester = await getPrisma().user.findFirstOrThrow({
    where: { isActive: true, role: "REQUESTER" },
    orderBy: { id: "asc" },
  });
  cookie = await sessionCookieFor(requester.id);
}, 30000);

describe("GET /api/categories", () => {
  it("returns active categories ordered by name, exposing only id and name", async () => {
    const res = await get("/api/categories");

    expect(res.status).toBe(200);
    expect(res.body.map((category: { name: string }) => category.name)).toEqual(sorted(CATEGORY_NAMES));
    for (const category of res.body) {
      expect(Object.keys(category).sort()).toEqual(["id", "name"]);
    }
  });

  it("excludes a category that has been deactivated", async () => {
    const prisma = getPrisma();
    const target = await prisma.category.findUniqueOrThrow({ where: { name: "Hardware" } });

    try {
      await prisma.category.update({ where: { id: target.id }, data: { isActive: false } });

      const res = await get("/api/categories");
      const names = res.body.map((category: { name: string }) => category.name);

      expect(names).not.toContain("Hardware");
      expect(names).toHaveLength(CATEGORY_NAMES.length - 1);
    } finally {
      // Restore, so the suite leaves the database as it found it.
      await prisma.category.update({ where: { id: target.id }, data: { isActive: true } });
    }
  });
});

describe("GET /api/related-systems", () => {
  it("returns all seeded related systems ordered by name", async () => {
    const res = await get("/api/related-systems");

    expect(res.status).toBe(200);
    // The labsheet requires at least six.
    expect(res.body.length).toBeGreaterThanOrEqual(6);
    expect(res.body.map((system: { name: string }) => system.name)).toEqual(sorted(RELATED_SYSTEM_NAMES));
    for (const system of res.body) {
      expect(Object.keys(system).sort()).toEqual(["id", "name"]);
    }
  });

  it("excludes a related system that has been deactivated", async () => {
    const prisma = getPrisma();
    const target = await prisma.relatedSystem.findUniqueOrThrow({ where: { name: "VPN" } });

    try {
      await prisma.relatedSystem.update({ where: { id: target.id }, data: { isActive: false } });

      const res = await get("/api/related-systems");
      const names = res.body.map((system: { name: string }) => system.name);

      expect(names).not.toContain("VPN");
      expect(names).toHaveLength(RELATED_SYSTEM_NAMES.length - 1);
    } finally {
      await prisma.relatedSystem.update({ where: { id: target.id }, data: { isActive: true } });
    }
  });
});
