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

// Explicit bytes rather than a string literal: an escape that survives into the
// file as a real control character makes git treat the whole source as binary.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

/** A fresh owned ticket, so one test's attachments cannot colour another's. */
async function newDetailTicket(summary: string): Promise<number> {
  const [category, relatedSystem] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { isActive: true } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } }),
  ]);

  const res = await request(app)
    .post("/api/tickets")
    .set(REQUESTER_HEADER, String(ownerId))
    .set("Idempotency-Key", randomUUID())
    .send({
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary,
      description: "Created by the ticket detail suite so there is something to attach to.",
      requestedPriority: "MEDIUM",
    });
  if (res.status !== 201) throw new Error(`ticket setup failed ${res.status}`);
  return res.body.id as number;
}

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

// The detail response is what Ticket Detail draws its attachment section from
// (api-spec.md §3). An empty array here would leave the screen with nothing to
// show for a ticket that does have files, so the promise is worth asserting.
describe("GET /api/tickets/:ticketId — attachment metadata", () => {
  it("carries active and removed attachments, and never the storage key", async () => {
    const ticketId = await newDetailTicket("Detail attachments ticket");

    const kept = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set(REQUESTER_HEADER, String(ownerId))
      .attach("file", PNG, { filename: "kept.png", contentType: "image/png" });
    const doomed = await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set(REQUESTER_HEADER, String(ownerId))
      .attach("file", PNG, { filename: "withdrawn.png", contentType: "image/png" });
    expect([kept.status, doomed.status]).toEqual([201, 201]);

    await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${doomed.body.id}`)
      .set(REQUESTER_HEADER, String(ownerId))
      .send({ removalReason: "Uploaded the wrong screenshot" });

    const res = await request(app).get(`/api/tickets/${ticketId}`).set(REQUESTER_HEADER, String(ownerId));

    expect(res.status).toBe(200);
    expect(res.body.attachments).toHaveLength(2);

    const [active, removed] = res.body.attachments as Record<string, unknown>[];
    expect(active.originalFilename).toBe("kept.png");
    expect(active.removedAt).toBeNull();

    // BR-39: the removed row keeps its metadata and is marked, rather than
    // disappearing from the Ticket it belonged to.
    expect(removed.originalFilename).toBe("withdrawn.png");
    expect(removed.removedAt).not.toBeNull();
    expect(removed.removalReason).toBe("Uploaded the wrong screenshot");
    expect(removed.removedByRequesterId).toBe(ownerId);

    for (const attachment of res.body.attachments as Record<string, unknown>[]) {
      expect(attachment).not.toHaveProperty("storageKey");
    }
  });

  it("does not disclose attachments to a requester who does not own the ticket", async () => {
    const ticketId = await newDetailTicket("Detail attachments ownership");
    await request(app)
      .post(`/api/tickets/${ticketId}/attachments`)
      .set(REQUESTER_HEADER, String(ownerId))
      .attach("file", PNG, { filename: "private.png", contentType: "image/png" });

    const res = await request(app).get(`/api/tickets/${ticketId}`).set(REQUESTER_HEADER, String(otherId));

    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("private.png");
  });
});
