import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { REQUESTER_HEADER } from "../../src/requester-context.js";

// API-05 — AC-12. The identity seam is the one place Lab 3 will replace, so the
// rules it enforces are worth testing directly rather than only through the
// routes that depend on it.

const prisma = getPrisma();
let categoryId = 0;
let relatedSystemId = 0;
let inactiveRequesterId = 0;

const validBody = () => ({
  categoryId,
  relatedSystemId,
  summary: "Cannot connect to Campus Wi-Fi in Building 4",
  description: "The laptop reports an authentication failure on the campus network every morning.",
  requestedPriority: "HIGH",
});

beforeAll(async () => {
  const [category, relatedSystem, inactive] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { isActive: true } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } }),
    prisma.requester.findFirstOrThrow({ where: { isActive: false } }),
  ]);
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;
  inactiveRequesterId = inactive.id;
});

function post(header?: string) {
  const req = request(app).post("/api/tickets").set("Idempotency-Key", randomUUID());
  if (header !== undefined) req.set(REQUESTER_HEADER, header);
  return req.send(validBody());
}

describe("Development Requester context", () => {
  it.each([
    ["missing", undefined],
    ["empty", "   "],
    ["not a number", "abc"],
    ["negative", "-1"],
    ["zero", "0"],
    ["unknown id", "999999"],
  ])("rejects a %s requester header with 401", async (_label, header) => {
    const res = await post(header as string | undefined);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("REQUESTER_CONTEXT_REQUIRED");
  });

  it("rejects an inactive Requester — BR-06, they cannot become the active context", async () => {
    const before = await prisma.ticket.count();
    const res = await post(String(inactiveRequesterId));

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("REQUESTER_CONTEXT_REQUIRED");
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("never reveals whether the id was unknown, inactive, or malformed", async () => {
    // Three different internal causes, one external answer.
    const responses = await Promise.all([post("abc"), post("999999"), post(String(inactiveRequesterId))]);
    const bodies = responses.map((res) => JSON.stringify(res.body));

    expect(new Set(bodies).size).toBe(1);
  });
});
