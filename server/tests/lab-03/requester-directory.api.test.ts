import { describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { REQUESTER_HEADER } from "../../src/requester-context.js";
import { USERS } from "../../src/seed-data.js";

// Privileged accounts must not leak through the Lab 2 surfaces (BR-16, BR-17).
//
// In Lab 2 this could not go wrong: the table held Requesters and nothing else,
// so "every active row" and "every active Requester" were the same set. The Lab 3
// migration puts IT Staff and Administrators in that same table, which turns two
// harmless Lab 2 queries into account enumeration unless both filter by role.
//
// This is a real defect, not a hypothetical one: I found exactly it while
// reviewing my peer's authentication foundation (Earth2509 PR #37), where the
// unchanged Lab 2 endpoint returned every staff and administrator address to an
// unauthenticated caller. The tests below exist so the same mistake cannot be
// made here quietly — each one fails if its role filter is removed.

describe("GET /api/requesters after the Lab 3 migration", () => {
  it("never returns an IT Staff or Administrator account", async () => {
    const privileged = USERS.filter((user) => user.role !== "REQUESTER");
    expect(privileged.length).toBeGreaterThan(0);

    const res = await request(app).get("/api/requesters");
    expect(res.status).toBe(200);

    const emails: string[] = res.body.map((requester: { email: string }) => requester.email);
    for (const user of privileged) {
      expect(emails).not.toContain(user.email);
    }
  });

  it("returns only rows whose role really is REQUESTER, checked against the database", async () => {
    const res = await request(app).get("/api/requesters");
    const emails: string[] = res.body.map((requester: { email: string }) => requester.email);
    expect(emails.length).toBeGreaterThan(0);

    // Asserted against the stored role rather than against the fixture list, so
    // the test still means something if the seed changes.
    const rows = await getPrisma().user.findMany({
      where: { email: { in: emails } },
      select: { email: true, role: true, isActive: true },
    });

    expect(rows).toHaveLength(emails.length);
    for (const row of rows) {
      expect(row.role).toBe("REQUESTER");
      expect(row.isActive).toBe(true);
    }
  });
});

describe("the Development Requester header after the Lab 3 migration", () => {
  it("refuses an IT Staff or Administrator id", async () => {
    const prisma = getPrisma();

    for (const role of ["IT_STAFF", "ADMINISTRATOR"] as const) {
      const privileged = await prisma.user.findFirstOrThrow({ where: { role, isActive: true } });

      const res = await request(app).get("/api/tickets").set(REQUESTER_HEADER, String(privileged.id));

      // Identical to the response for an unknown or inactive id: the header
      // cannot be used to borrow a privileged identity, and the refusal says
      // nothing about which ids exist.
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("REQUESTER_CONTEXT_REQUIRED");
    }
  });

  it("still accepts an active Requester, so the refusal above is the role check", async () => {
    const requester = await getPrisma().user.findFirstOrThrow({
      where: { role: "REQUESTER", isActive: true },
    });

    const res = await request(app).get("/api/tickets").set(REQUESTER_HEADER, String(requester.id));

    expect(res.status).toBe(200);
  });
});
