import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { CATEGORY_NAMES, RELATED_SYSTEM_NAMES, REQUESTERS } from "../../src/seed-data.js";

// API-01 — the three reference endpoints (specification.md AC-01).
//
// These run against the real migrated and seeded database, like the Lab 1
// suite, because what is being asserted is that the *query* excludes inactive
// rows. A mocked Prisma would only prove that the mock returned what the mock
// was told to return.
//
//   npx prisma migrate dev  &&  npm run prisma:seed

const activeRequesters = REQUESTERS.filter((requester) => requester.isActive);
const inactiveRequesters = REQUESTERS.filter((requester) => !requester.isActive);

function sorted(values: readonly string[]): string[] {
  return [...values].sort((a, b) => a.localeCompare(b));
}

describe("GET /api/categories", () => {
  it("returns active categories ordered by name, exposing only id and name", async () => {
    const res = await request(app).get("/api/categories");

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

      const res = await request(app).get("/api/categories");
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
    const res = await request(app).get("/api/related-systems");

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

      const res = await request(app).get("/api/related-systems");
      const names = res.body.map((system: { name: string }) => system.name);

      expect(names).not.toContain("VPN");
      expect(names).toHaveLength(RELATED_SYSTEM_NAMES.length - 1);
    } finally {
      await prisma.relatedSystem.update({ where: { id: target.id }, data: { isActive: true } });
    }
  });
});

describe("GET /api/requesters", () => {
  it("returns only active Development Requesters, ordered by name", async () => {
    const res = await request(app).get("/api/requesters");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(activeRequesters.length);
    expect(res.body.map((requester: { fullName: string }) => requester.fullName)).toEqual(
      sorted(activeRequesters.map((requester) => requester.fullName)),
    );
  });

  it("never exposes the inactive requester to the selector", async () => {
    // BR-06. This is the rule the seeded inactive row exists to prove.
    expect(inactiveRequesters.length).toBeGreaterThan(0);

    const res = await request(app).get("/api/requesters");
    const emails = res.body.map((requester: { email: string }) => requester.email);

    for (const requester of inactiveRequesters) {
      expect(emails).not.toContain(requester.email);
    }
  });

  it("exposes only id, fullName and email — no timestamps or isActive", async () => {
    const res = await request(app).get("/api/requesters");

    for (const requester of res.body) {
      expect(Object.keys(requester).sort()).toEqual(["email", "fullName", "id"]);
    }
  });
});
