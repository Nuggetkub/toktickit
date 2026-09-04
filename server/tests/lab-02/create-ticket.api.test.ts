import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { REQUESTER_HEADER } from "../../src/requester-context.js";

// API-02, API-03, API-04 — AC-04, AC-05, AC-06.
//
// These run against the real migrated database in the isolated lab2_test schema.
// Creation is where a mocked Prisma would be least convincing: the unique index
// on idempotencyKey and the per-year counter are database behaviour, and a mock
// can only return what it was told.

const prisma = getPrisma();

let requesterId = 0;
let otherRequesterId = 0;
let categoryId = 0;
let relatedSystemId = 0;

function body(overrides: Record<string, unknown> = {}) {
  return {
    categoryId,
    relatedSystemId,
    summary: "Cannot connect to Campus Wi-Fi in Building 4",
    description: "The laptop reports an authentication failure on the campus network every morning.",
    requestedPriority: "HIGH",
    ...overrides,
  };
}

// `key` is typed as plain string rather than inferred from randomUUID(), whose
// template-literal type would reject the deliberately malformed key below.
function post(overrides: Record<string, unknown> = {}, key: string = randomUUID(), asRequester?: number) {
  return request(app)
    .post("/api/tickets")
    .set(REQUESTER_HEADER, String(asRequester ?? requesterId))
    .set("Idempotency-Key", key)
    .send(body(overrides));
}

beforeAll(async () => {
  const [active, category, relatedSystem] = await Promise.all([
    prisma.requester.findMany({ where: { isActive: true }, orderBy: { id: "asc" }, take: 2 }),
    prisma.category.findFirstOrThrow({ where: { isActive: true } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } }),
  ]);
  requesterId = active[0].id;
  otherRequesterId = active[1].id;
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
});

describe("POST /api/tickets — success", () => {
  it("saves one ticket owned by the header's requester, with a server-assigned number", async () => {
    const before = await prisma.ticket.count();
    const res = await post();

    expect(res.status).toBe(201);
    expect(res.body.ticketNumber).toMatch(/^TKT-\d{4}-\d{5,}$/);
    expect(res.body.currentStatus).toBe("NEW");
    expect(res.body.requester.id).toBe(requesterId);
    expect(res.body.ticketDate).toBeTruthy();
    expect(res.body.attachments).toEqual([]);

    // AC-04 asks that the ticket is *saved*, so check the row, not the response.
    const saved = await prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(saved.requesterId).toBe(requesterId);
    expect(saved.currentStatus).toBe("NEW");
    expect(await prisma.ticket.count()).toBe(before + 1);
  });

  it("never returns a placeholder number — the number is issued before the insert", async () => {
    const res = await post();
    expect(res.body.ticketNumber).not.toMatch(/PENDING|TEMP|null|undefined/i);
  });

  it("issues increasing numbers within the same year", async () => {
    const first = await post();
    const second = await post();

    const sequence = (n: string) => Number(n.split("-")[2]);
    expect(sequence(second.body.ticketNumber)).toBe(sequence(first.body.ticketNumber) + 1);
    expect(first.body.ticketNumber.slice(0, 8)).toBe(second.body.ticketNumber.slice(0, 8));
  });
});

describe("POST /api/tickets — validation", () => {
  it("returns field errors and saves nothing", async () => {
    const before = await prisma.ticket.count();
    const res = await post({ summary: "no", description: "too short", requestedPriority: "SOMEDAY" });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      "description",
      "requestedPriority",
      "summary",
    ]);
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("rejects an inactive or unknown Category as not found", async () => {
    const inactive = await prisma.category.create({
      data: { name: `Retired category ${randomUUID()}`, isActive: false },
    });

    try {
      const res = await post({ categoryId: inactive.id });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("REFERENCE_NOT_FOUND");
    } finally {
      await prisma.category.delete({ where: { id: inactive.id } });
    }
  });

  it("requires an Idempotency-Key header containing a UUID", async () => {
    const missing = await request(app)
      .post("/api/tickets")
      .set(REQUESTER_HEADER, String(requesterId))
      .send(body());
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");

    const malformed = await post({}, "not-a-uuid");
    expect(malformed.body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });
});

describe("POST /api/tickets — idempotency", () => {
  it("replaying the same key and payload returns the original and creates nothing", async () => {
    const key = randomUUID();
    const first = await post({}, key);
    const before = await prisma.ticket.count();

    const replay = await post({}, key);

    expect(replay.status).toBe(200);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.body.ticketNumber).toBe(first.body.ticketNumber);
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("reusing a key with a different payload is a conflict and creates nothing", async () => {
    const key = randomUUID();
    await post({}, key);
    const before = await prisma.ticket.count();

    const conflict = await post({ summary: "A completely different problem entirely" }, key);

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("reusing a key from a different requester is a conflict even when the body matches", async () => {
    const key = randomUUID();
    await post({}, key);

    const conflict = await post({}, key, otherRequesterId);

    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("IDEMPOTENCY_KEY_CONFLICT");
  });

  it("two simultaneous requests with one key create exactly one ticket", async () => {
    // The replay check and the insert are not atomic together, so the unique
    // index is what actually decides. The loser must return the winner's ticket
    // rather than a 500.
    const key = randomUUID();
    const before = await prisma.ticket.count();

    const [a, b] = await Promise.all([post({}, key), post({}, key)]);

    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(await prisma.ticket.count()).toBe(before + 1);
  });
});
