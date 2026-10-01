import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { rawSessionCookieFor, sessionCookieFor, TEST_ORIGIN } from "../support/session.js";

// AUTH-01 in docs/lab-04/tests.md (AC-09, AC-21): every Lab 4 endpoint swept as
// nobody, with a password change pending, from an untrusted origin, and as each
// role. The list is built once, as Lab 3's authorization.api.test.ts does, so an
// endpoint added later is added here in one line. The dashboard endpoints join
// this list in issue #84.
//
// A role refusal must come before any lookup (Lab 3 BR-18), so a Requester's
// write is compared for a Ticket that exists and one that does not: the two
// answers must be identical.

const prisma = getPrisma();
const DOMAIN = "@lab4-authz.local";
const MISSING = 99_999_991;

let ticketId = 0;
let actionId = 0;
let categoryId = 0;
let relatedSystemId = 0;
const cookie = { requester: "", staff: "", admin: "", pending: "" };

type Endpoint = {
  name: string;
  method: "get" | "post" | "patch";
  path: (ticket: number, action: number) => string;
  body?: () => object;
  /** Which signed-in roles the matrix admits (specification §8). */
  admits: ReadonlyArray<"requester" | "staff" | "admin">;
};

const actionBody = () => ({
  status: "OPEN",
  actionAt: new Date().toISOString(),
  description: "Authorization sweep action.",
  followUpRequired: false,
  assigneeId: 0, // replaced in beforeAll; eligibility is not what is swept here
});

const ENDPOINTS: Endpoint[] = [
  { name: "list Actions", method: "get", path: (t) => `/api/tickets/${t}/actions`, admits: ["requester", "staff", "admin"] },
  { name: "create an Action", method: "post", path: (t) => `/api/tickets/${t}/actions`, body: actionBody, admits: ["staff", "admin"] },
  { name: "edit an Action", method: "patch", path: (t, a) => `/api/tickets/${t}/actions/${a}`, body: () => ({ version: 1, description: "Sweep edit." }), admits: ["staff", "admin"] },
  { name: "complete an Action", method: "post", path: (t, a) => `/api/tickets/${t}/actions/${a}/complete`, body: () => ({ version: 1, result: "Sweep result." }), admits: ["staff", "admin"] },
  { name: "cancel an Action", method: "post", path: (t, a) => `/api/tickets/${t}/actions/${a}/cancel`, body: () => ({ version: 1, reason: "Sweep reason." }), admits: ["staff", "admin"] },
  // Issue #83.
  { name: "read the status history", method: "get", path: (t) => `/api/tickets/${t}/history`, admits: ["requester", "staff", "admin"] },
  // Issue #84. Each dashboard admits one side only (BR-29), and refuses the
  // other before any query runs.
  { name: "read the Requester dashboard", method: "get", path: () => "/api/dashboard/requester", admits: ["requester"] },
  { name: "read the staff dashboard", method: "get", path: () => "/api/dashboard/staff", admits: ["staff", "admin"] },
];

let staffId = 0;

function call(endpoint: Endpoint, who: string | null, ticket = ticketId, action = actionId, origin: string | null = TEST_ORIGIN) {
  let req = request(app)[endpoint.method](endpoint.path(ticket, action));
  if (who) req = req.set("Cookie", who);
  if (origin && endpoint.method !== "get") req = req.set("Origin", origin);
  if (endpoint.method === "post") req = req.set("Idempotency-Key", randomUUID());
  const payload = endpoint.body?.();
  if (payload && "assigneeId" in payload) (payload as { assigneeId: number }).assigneeId = staffId;
  return payload ? req.send(payload) : req;
}

beforeAll(async () => {
  await cleanUp();
  const [category, system] = await Promise.all([
    prisma.category.create({ data: { name: `Authz probe ${randomUUID().slice(0, 8)}` } }),
    prisma.relatedSystem.create({ data: { name: `Authz system ${randomUUID().slice(0, 8)}` } }),
  ]);
  categoryId = category.id;
  relatedSystemId = system.id;
  const make = async (role: string, mustChangePassword = false) =>
    (await prisma.user.create({ data: { fullName: `Sweep ${role}`, email: `${randomUUID().slice(0, 8)}${DOMAIN}`, role: role as never, mustChangePassword }, select: { id: true } })).id;
  const requesterId = await make("REQUESTER");
  staffId = await make("IT_STAFF");
  const adminId = await make("ADMINISTRATOR");
  const pendingId = await make("IT_STAFF", true);
  cookie.requester = await sessionCookieFor(requesterId);
  cookie.staff = await sessionCookieFor(staffId);
  cookie.admin = await sessionCookieFor(adminId);
  cookie.pending = await rawSessionCookieFor(pendingId);

  ticketId = (await prisma.ticket.create({
    data: {
      ticketNumber: `TKT-2096-${randomUUID().slice(0, 12)}`, requesterId, categoryId, relatedSystemId,
      summary: "Authorization sweep ticket", description: "Exists so each endpoint has something real to refuse.",
      requestedPriority: "LOW", itPriority: "LOW", currentStatus: "IN_PROGRESS", idempotencyKey: randomUUID(),
    },
  })).id;
  actionId = (await prisma.actionTaken.create({
    data: { ticketId, actionAt: new Date(), description: "Sweep target.", followUpRequired: false, assigneeId: staffId, createdById: staffId, idempotencyKey: randomUUID() },
  })).id;
}, 60_000);

async function cleanUp() {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  await prisma.actionTaken.deleteMany({ where: { ticket: { requesterId: { in: userIds } } } });
  await prisma.ticketStatusEvent.deleteMany({ where: { ticket: { requesterId: { in: userIds } } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

afterAll(async () => {
  await cleanUp();
  await prisma.category.deleteMany({ where: { id: categoryId } });
  await prisma.relatedSystem.deleteMany({ where: { id: relatedSystemId } });
});

describe("AUTH-01: every Lab 4 endpoint, as each kind of caller", () => {
  for (const endpoint of ENDPOINTS) {
    describe(endpoint.name, () => {
      it("answers 401 UNAUTHENTICATED with no session", async () => {
        const res = await call(endpoint, null);
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe("UNAUTHENTICATED");
      });

      it("answers 403 PASSWORD_CHANGE_REQUIRED while a password change is pending", async () => {
        const res = await call(endpoint, cookie.pending);
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
      });

      if (endpoint.method !== "get") {
        it("answers 403 ORIGIN_REJECTED from an untrusted origin, even for staff", async () => {
          const res = await call(endpoint, cookie.staff, ticketId, actionId, "http://evil.example");
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe("ORIGIN_REJECTED");
        });
      }

      for (const role of ["requester", "staff", "admin"] as const) {
        const admitted = endpoint.admits.includes(role);
        it(`${admitted ? "admits" : "refuses"} ${role}`, async () => {
          const res = await call(endpoint, cookie[role]);
          if (admitted) {
            expect([401, 403], JSON.stringify(res.body)).not.toContain(res.status);
          } else {
            expect(res.status).toBe(403);
            expect(res.body.error.code).toBe("FORBIDDEN");
            // Before any lookup: the refusal for a Ticket and Action that do
            // not exist is the same, byte for byte.
            const ghost = await call(endpoint, cookie[role], MISSING, MISSING);
            expect(ghost.status).toBe(403);
            expect(ghost.body).toEqual(res.body);
          }
        });
      }
    });
  }
});
