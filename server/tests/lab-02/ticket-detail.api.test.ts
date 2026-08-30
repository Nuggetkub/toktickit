import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { REQUESTER_HEADER } from "../../src/requester-context.js";

// API-10 — AC-12. Cross-requester access must be indistinguishable from a
// ticket that does not exist (BR-10, D-04): a 403 would confirm the row is real.

const prisma = getPrisma();
let ownerId = 0;
let otherId = 0;
let ownedTicketId = 0;

beforeAll(async () => {
  const [requesters, category, relatedSystem] = await Promise.all([
    prisma.requester.findMany({ where: { isActive: true }, orderBy: { id: "asc" }, take: 2 }),
    prisma.category.findFirstOrThrow({ where: { isActive: true } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } }),
  ]);
  ownerId = requesters[0].id;
  otherId = requesters[1].id;

  const created = await request(app)
    .post("/api/tickets")
    .set(REQUESTER_HEADER, String(ownerId))
    .set("Idempotency-Key", randomUUID())
    .send({
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary: "Detail suite ticket",
      description: "Created by the ticket detail suite so there is something owned to fetch.",
      requestedPriority: "MEDIUM",
    });
  ownedTicketId = created.body.id;
}, 60000);

describe("GET /api/tickets/:ticketId", () => {
  it("returns the ticket to its owner, with the description the list omits", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ownedTicketId}`)
      .set(REQUESTER_HEADER, String(ownerId));

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ownedTicketId);
    expect(res.body.description).toContain("Created by the ticket detail suite");
    expect(res.body.requester.id).toBe(ownerId);
    expect(res.body.attachments).toEqual([]);
  });

  it("refuses another requester's ticket as not found", async () => {
    const res = await request(app)
      .get(`/api/tickets/${ownedTicketId}`)
      .set(REQUESTER_HEADER, String(otherId));

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
  });

  it("answers a foreign ticket and a nonexistent one identically", async () => {
    // If these differed, the difference would itself disclose that the first
    // ticket exists.
    const foreign = await request(app)
      .get(`/api/tickets/${ownedTicketId}`)
      .set(REQUESTER_HEADER, String(otherId));
    const missing = await request(app)
      .get("/api/tickets/98765432")
      .set(REQUESTER_HEADER, String(otherId));
    const malformed = await request(app)
      .get("/api/tickets/not-a-number")
      .set(REQUESTER_HEADER, String(otherId));

    expect(foreign.status).toBe(missing.status);
    expect(foreign.body).toEqual(missing.body);
    expect(malformed.body).toEqual(missing.body);
  });

  it("requires a requester context", async () => {
    const res = await request(app).get(`/api/tickets/${ownedTicketId}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("REQUESTER_CONTEXT_REQUIRED");
  });
});
