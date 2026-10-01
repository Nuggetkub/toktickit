import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { sessionCookieFor, TEST_ORIGIN } from "../support/session.js";
import { deleteTickets } from "../support/tickets.js";

// API-14 in docs/lab-03/tests.md (AC-10). Lab 3 named this file and never wrote
// it, and its first clause was untrue until the server accepted the filter; both
// are issue #78, delivered in Lab 4 (Lab 4 BR-30). The Lab 4 list rules, which
// go further (lists, repeats, commas), are Lab 4 API-14.
//
// Clause 1: My Tickets filters by each of the eight statuses and refuses any
// other value with 400. Clause 2: IT Staff and Administrators can read any
// Ticket and download its active attachments, but get 403 for upload and removal.

const prisma = getPrisma();
const DOMAIN = "@requester-tickets-lab3.local";
const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"] as const;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 9)]);

const cookies = { requester: "", staff: "", admin: "" };
const byStatus = new Map<string, number>();
let requesterId = 0;
let categoryId = 0;
let relatedSystemId = 0;
let ticketId = 0;
let attachmentId = 0;

const send = (test: request.Test, cookie: string) => test.set("Origin", TEST_ORIGIN).set("Cookie", cookie);

async function cleanUp() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((user) => user.id);
  const tickets = await prisma.ticket.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
  await prisma.attachment.deleteMany({ where: { ticketId: { in: tickets.map((t) => t.id) } } });
  await deleteTickets({ requesterId: { in: ids } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  await cleanUp();
  const [category, system] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { isActive: true } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;

  const make = async (fullName: string, role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR") =>
    (await prisma.user.create({ data: { fullName, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role } })).id;
  requesterId = await make("Nadia Rahman", "REQUESTER");
  cookies.requester = await sessionCookieFor(requesterId);
  cookies.staff = await sessionCookieFor(await make("Grace Okafor", "IT_STAFF"));
  cookies.admin = await sessionCookieFor(await make("Pim Srisawat", "ADMINISTRATOR"));

  for (const status of STATUSES) {
    const created = await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2097-${randomUUID().slice(0, 12)}`, requesterId, categoryId, relatedSystemId,
        summary: `A ${status} ticket`, description: "Created by the Lab 3 API-14 suite.",
        requestedPriority: "MEDIUM", itPriority: "MEDIUM", currentStatus: status, idempotencyKey: randomUUID(),
      },
      select: { id: true },
    });
    byStatus.set(status, created.id);
  }

  // A Ticket and attachment made through the API, as a Requester would.
  const ticket = await send(request(app).post("/api/tickets"), cookies.requester)
    .set("Idempotency-Key", randomUUID())
    .send({ categoryId, relatedSystemId, summary: "A ticket with evidence attached", description: "Staff must be able to read this and download the file.", requestedPriority: "LOW" });
  if (ticket.status !== 201) throw new Error(`ticket setup failed ${ticket.status}`);
  ticketId = ticket.body.id;
  const attachment = await send(request(app).post(`/api/tickets/${ticketId}/attachments`), cookies.requester)
    .attach("file", PNG, { filename: "evidence.png", contentType: "image/png" });
  if (attachment.status !== 201) throw new Error(`attachment setup failed ${attachment.status}`);
  attachmentId = attachment.body.id;
}, 60_000);

afterAll(cleanUp);

describe("API-14 (Lab 3) — My Tickets filters by each of the eight statuses", () => {
  it.each(STATUSES)("currentStatus=%s returns exactly the caller's Tickets in that status", async (status) => {
    const res = await send(request(app).get("/api/tickets"), cookies.requester).query({ currentStatus: status, pageSize: "50" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    // Against an independent count, because the attachment Ticket below is NEW too.
    const stored = await prisma.ticket.findMany({ where: { requesterId, currentStatus: status }, select: { id: true } });
    const ids = res.body.items.map((item: { id: number }) => item.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual(stored.map((t) => t.id).sort((a, b) => a - b));
    expect(ids).toContain(byStatus.get(status));
    expect(res.body.items.every((item: { currentStatus: string }) => item.currentStatus === status)).toBe(true);
  });

  it.each(["DONE", "new", "Open", "", "PENDING"])("refuses currentStatus=%j with 400", async (value) => {
    const res = await send(request(app).get("/api/tickets"), cookies.requester).query({ currentStatus: value });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_FAILED");
    expect(res.body.error.fieldErrors).toHaveProperty("currentStatus");
  });
});

describe.each([["IT Staff", "staff"], ["an Administrator", "admin"]] as const)(
  "API-14 (Lab 3) — %s reads any Ticket and its active attachments, but cannot change them",
  (_label, who) => {
    it("reads the Requester's Ticket and lists its attachment", async () => {
      const detail = await send(request(app).get(`/api/tickets/${ticketId}`), cookies[who]);
      expect(detail.status).toBe(200);
      expect(detail.body.id).toBe(ticketId);
      const list = await send(request(app).get(`/api/tickets/${ticketId}/attachments`), cookies[who]);
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.body)).toContain(`"id":${attachmentId}`);
    });

    it("downloads the active attachment, byte for byte", async () => {
      const res = await send(request(app).get(`/api/tickets/${ticketId}/attachments/${attachmentId}/download`), cookies[who])
        .buffer(true)
        .parse((response, done) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () => done(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
    });

    it("gets 403 for upload and for removal, and the attachment is untouched", async () => {
      const upload = await send(request(app).post(`/api/tickets/${ticketId}/attachments`), cookies[who])
        .attach("file", PNG, { filename: "staff.png", contentType: "image/png" });
      expect(upload.status).toBe(403);
      const removal = await send(request(app).patch(`/api/tickets/${ticketId}/attachments/${attachmentId}`), cookies[who])
        .send({ removalReason: "Staff should not be able to remove this." });
      expect(removal.status).toBe(403);

      expect(await prisma.attachment.count({ where: { ticketId } })).toBe(1);
      expect(await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } })).toMatchObject({ removedAt: null });
    });
  },
);
