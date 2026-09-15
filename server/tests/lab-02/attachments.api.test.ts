import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { REQUESTER_HEADER } from "../../src/requester-context.js";
import { MAX_ACTIVE, MAX_BYTES } from "../../src/attachment-rules.js";

// API-11 to API-14 — AC-13, AC-14, AC-15.
//
// Against the real database and the real filesystem. The five-active limit and
// the ownership rules are enforced by a transaction and by query predicates, and
// a mock would only replay what it was told about either.

const prisma = getPrisma();

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
// Explicit bytes rather than a string literal: an escape that survives into
// the file as a real control character makes git classify the whole source
// as binary, and the diff then shows nothing at all.
const EXECUTABLE = Buffer.concat([Buffer.from([0x4d, 0x5a, 0x90, 0x00]), Buffer.alloc(64, 3)]);

let ownerId = 0;
let otherId = 0;

async function newTicket(requesterId: number, summary: string): Promise<number> {
  const category = await prisma.category.findFirstOrThrow({ where: { isActive: true } });
  const relatedSystem = await prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } });
  const res = await request(app)
    .post("/api/tickets")
    .set(REQUESTER_HEADER, String(requesterId))
    .set("Idempotency-Key", randomUUID())
    .send({
      categoryId: category.id,
      relatedSystemId: relatedSystem.id,
      summary,
      description: "Created by the attachments suite so there is something to attach to.",
      requestedPriority: "LOW",
    });
  if (res.status !== 201) throw new Error(`ticket setup failed ${res.status}`);
  return res.body.id as number;
}

function upload(ticketId: number, requesterId: number, bytes: Buffer, filename: string, declaredType: string) {
  return request(app)
    .post(`/api/tickets/${ticketId}/attachments`)
    .set(REQUESTER_HEADER, String(requesterId))
    .attach("file", bytes, { filename, contentType: declaredType });
}

async function activeCount(ticketId: number, requesterId: number): Promise<number> {
  const res = await request(app)
    .get(`/api/tickets/${ticketId}/attachments`)
    .set(REQUESTER_HEADER, String(requesterId));
  return (res.body as { removedAt: string | null }[]).filter((a) => a.removedAt === null).length;
}

beforeAll(async () => {
  const requesters = await prisma.user.findMany({ where: { isActive: true, role: "REQUESTER" }, orderBy: { id: "asc" }, take: 2 });
  ownerId = requesters[0].id;
  otherId = requesters[1].id;
}, 60000);

describe("upload", () => {
  it("stores a permitted file and never returns its storage key", async () => {
    const ticketId = await newTicket(ownerId, "Upload happy path");
    const res = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    expect(res.status).toBe(201);
    expect(res.body.mimeType).toBe("image/png");
    expect(res.body.removedAt).toBeNull();
    expect(res.body).not.toHaveProperty("storageKey");

    // The key is generated, never derived from what the uploader called the file.
    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.storageKey).not.toContain("evidence");
    expect(stored.storageKey).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("refuses a file whose content is not permitted, however it is declared", async () => {
    // The defect this exact test exists for: trusting the client's declared
    // Content-Type would accept this.
    const ticketId = await newTicket(ownerId, "Type sniffing");
    const before = await prisma.attachment.count({ where: { ticketId } });

    const lying = await upload(ticketId, ownerId, EXECUTABLE, "totally-safe.png", "image/png");

    expect(lying.status).toBe(415);
    expect(lying.body.error.code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(before);
  });

  it("refuses an oversized file before it becomes a row", async () => {
    const ticketId = await newTicket(ownerId, "Oversize");
    const res = await upload(ticketId, ownerId, Buffer.alloc(MAX_BYTES + 1024, 1), "big.png", "image/png");

    expect(res.status).toBe(413);
    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(0);
  });

  it("refuses an upload to another requester's ticket as not found", async () => {
    const ticketId = await newTicket(ownerId, "Cross-owner upload");
    const res = await upload(ticketId, otherId, PNG, "evidence.png", "image/png");

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TICKET_NOT_FOUND");
    expect(await prisma.attachment.count({ where: { ticketId } })).toBe(0);
  });
});

describe("the five-active limit", () => {
  it("refuses the sixth attachment", async () => {
    const ticketId = await newTicket(ownerId, "Sequential limit");
    for (let index = 0; index < MAX_ACTIVE; index += 1) {
      expect((await upload(ticketId, ownerId, PNG, `shot-${index}.png`, "image/png")).status).toBe(201);
    }

    const sixth = await upload(ticketId, ownerId, PNG, "sixth.png", "image/png");
    expect(sixth.status).toBe(409);
    expect(sixth.body.error.code).toBe("ATTACHMENT_LIMIT_REACHED");
  });

  it("holds when six uploads arrive at once", async () => {
    // Counting and inserting without a lock is a check-then-write: six parallel
    // uploads each read a count below the limit and each proceed. A multi-file
    // picker uploading in parallel is the ordinary case, not an exotic one.
    const ticketId = await newTicket(ownerId, "Concurrent limit");

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, index) => upload(ticketId, ownerId, PNG, `race-${index}.png`, "image/png")),
    );

    const created = results.filter((res) => res.status === 201).length;
    const refused = results.filter((res) => res.status === 409).length;

    expect(created).toBe(MAX_ACTIVE);
    expect(refused).toBe(1);
    expect(await activeCount(ticketId, ownerId)).toBe(MAX_ACTIVE);
  }, 60000);

  it("frees a slot when an attachment is removed", async () => {
    // BR-33 counts active rows only. A limit that never releases would strand
    // any Ticket that has ever held five.
    const ticketId = await newTicket(ownerId, "Slot reuse");
    const uploaded = [];
    for (let index = 0; index < MAX_ACTIVE; index += 1) {
      uploaded.push(await upload(ticketId, ownerId, PNG, `slot-${index}.png`, "image/png"));
    }

    expect((await upload(ticketId, ownerId, PNG, "before.png", "image/png")).status).toBe(409);

    const removal = await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${uploaded[0].body.id}`)
      .set(REQUESTER_HEADER, String(ownerId))
      .send({ removalReason: "Uploaded the wrong screenshot." });
    expect(removal.status).toBe(200);

    expect((await upload(ticketId, ownerId, PNG, "after.png", "image/png")).status).toBe(201);
    expect(await activeCount(ticketId, ownerId)).toBe(MAX_ACTIVE);
  }, 60000);
});

describe("metadata and download", () => {
  it("downloads an active attachment with its detected type and a safe filename", async () => {
    const ticketId = await newTicket(ownerId, "Download");
    const created = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    const res = await request(app)
      .get(`/api/tickets/${ticketId}/attachments/${created.body.id}/download`)
      .set(REQUESTER_HEADER, String(ownerId));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["content-disposition"]).toContain("attachment;");
    expect(res.headers["content-disposition"]).toContain("evidence.png");
  });

  it("refuses another requester's attachment as not found", async () => {
    const ticketId = await newTicket(ownerId, "Cross-owner download");
    const created = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    const res = await request(app)
      .get(`/api/tickets/${ticketId}/attachments/${created.body.id}/download`)
      .set(REQUESTER_HEADER, String(otherId));

    expect(res.status).toBe(404);
  });
});

describe("soft removal", () => {
  it("records who removed it and why, keeps the metadata, and blocks the download", async () => {
    const ticketId = await newTicket(ownerId, "Soft removal");
    const created = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    const removal = await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${created.body.id}`)
      .set(REQUESTER_HEADER, String(ownerId))
      .send({ removalReason: "  It shows another person's account.  " });

    expect(removal.status).toBe(200);
    expect(removal.body.removedAt).not.toBeNull();
    expect(removal.body.removedByRequesterId).toBe(ownerId);
    expect(removal.body.removalReason).toBe("It shows another person's account.");

    // BR-39: still listed as metadata, no longer downloadable.
    const metadata = await request(app)
      .get(`/api/tickets/${ticketId}/attachments`)
      .set(REQUESTER_HEADER, String(ownerId));
    expect(metadata.body).toHaveLength(1);
    expect(metadata.body[0].removalReason).toBe("It shows another person's account.");

    const download = await request(app)
      .get(`/api/tickets/${ticketId}/attachments/${created.body.id}/download`)
      .set(REQUESTER_HEADER, String(ownerId));
    expect(download.status).toBe(404);
  });

  it("refuses a second removal without overwriting the first reason", async () => {
    const ticketId = await newTicket(ownerId, "Double removal");
    const created = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${created.body.id}`)
      .set(REQUESTER_HEADER, String(ownerId))
      .send({ removalReason: "The original reason." });

    const second = await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${created.body.id}`)
      .set(REQUESTER_HEADER, String(ownerId))
      .send({ removalReason: "A different reason entirely." });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ATTACHMENT_ALREADY_REMOVED");

    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.removalReason).toBe("The original reason.");
  });

  it("requires a reason of the documented length", async () => {
    const ticketId = await newTicket(ownerId, "Removal reason");
    const created = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    const res = await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${created.body.id}`)
      .set(REQUESTER_HEADER, String(ownerId))
      .send({ removalReason: "no" });

    expect(res.status).toBe(400);
    expect(res.body.error.fieldErrors).toHaveProperty("removalReason");

    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.removedAt).toBeNull();
  });

  it("refuses to remove another requester's attachment", async () => {
    const ticketId = await newTicket(ownerId, "Cross-owner removal");
    const created = await upload(ticketId, ownerId, PNG, "evidence.png", "image/png");

    const res = await request(app)
      .patch(`/api/tickets/${ticketId}/attachments/${created.body.id}`)
      .set(REQUESTER_HEADER, String(otherId))
      .send({ removalReason: "Not mine to remove." });

    expect(res.status).toBe(404);
    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.removedAt).toBeNull();
  });
});
