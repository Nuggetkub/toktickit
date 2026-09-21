import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { getPrisma } from "../../src/prisma.js";
import { rawSessionCookieFor, sessionCookieFor, TEST_ORIGIN } from "../support/session.js";

// API-09 to API-12, and the business-route half of API-04 (docs/lab-03/tests.md).
//
// "Hiding a button is not authorization" (specification.md §1). This file is the
// evidence for that claim: it drives every protected endpoint as nobody, as each
// role, and as a user whose password change is still pending, and asserts the
// exact status the authorization matrix gives. Nothing here goes through the
// interface, because the interface is not what enforces any of it.
//
// The endpoint list is built once and reused by each sweep, so an endpoint added
// later is covered by every rule at once rather than by whichever test its
// author remembered.

const prisma = getPrisma();
const DOMAIN = "@authz-test.local";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);

let requesterId = 0;
let otherRequesterId = 0;
let categoryId = 0;
let relatedSystemId = 0;

let requester = "";
let otherRequester = "";
let staff = "";
let admin = "";
let pending = "";

let ticketId = 0;
let attachmentId = 0;

/** Every request carries a trusted Origin unless a test is about the Origin itself. */
function send(test: request.Test, cookie?: string): request.Test {
  const withOrigin = test.set("Origin", TEST_ORIGIN);
  return cookie ? withOrigin.set("Cookie", cookie) : withOrigin;
}

function ticketBody() {
  return {
    categoryId,
    relatedSystemId,
    summary: "Authorization suite ticket for the matrix sweep",
    description: "Created so every protected endpoint has a real resource to be refused against.",
    requestedPriority: "LOW",
  };
}

type Endpoint = {
  name: string;
  /** True where the authorization matrix permits a Requester and nobody else. */
  requesterOnly: boolean;
  call: (cookie?: string) => request.Test;
};

function endpoints(): Endpoint[] {
  return [
    {
      name: "GET /api/categories",
      requesterOnly: false,
      call: (c) => send(request(app).get("/api/categories"), c),
    },
    {
      name: "GET /api/related-systems",
      requesterOnly: false,
      call: (c) => send(request(app).get("/api/related-systems"), c),
    },
    {
      name: "GET /api/tickets",
      requesterOnly: true,
      call: (c) => send(request(app).get("/api/tickets"), c),
    },
    {
      name: "POST /api/tickets",
      requesterOnly: true,
      call: (c) =>
        send(request(app).post("/api/tickets"), c).set("Idempotency-Key", randomUUID()).send(ticketBody()),
    },
    {
      name: "GET /api/tickets/:ticketId",
      requesterOnly: false,
      call: (c) => send(request(app).get(`/api/tickets/${ticketId}`), c),
    },
    {
      name: "GET /api/tickets/:ticketId/attachments",
      requesterOnly: false,
      call: (c) => send(request(app).get(`/api/tickets/${ticketId}/attachments`), c),
    },
    {
      name: "GET /api/tickets/:ticketId/attachments/:attachmentId/download",
      requesterOnly: false,
      call: (c) => send(request(app).get(`/api/tickets/${ticketId}/attachments/${attachmentId}/download`), c),
    },
    {
      name: "POST /api/tickets/:ticketId/attachments",
      requesterOnly: true,
      call: (c) =>
        send(request(app).post(`/api/tickets/${ticketId}/attachments`), c).attach("file", PNG, {
          filename: "sweep.png",
          contentType: "image/png",
        }),
    },
    {
      name: "PATCH /api/tickets/:ticketId/attachments/:attachmentId",
      requesterOnly: true,
      call: (c) =>
        send(request(app).patch(`/api/tickets/${ticketId}/attachments/${attachmentId}`), c).send({
          removalReason: "Removed by the authorization sweep.",
        }),
    },
  ];
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: DOMAIN } } });

  const [category, relatedSystem] = await Promise.all([
    prisma.category.findFirstOrThrow({ where: { isActive: true } }),
    prisma.relatedSystem.findFirstOrThrow({ where: { isActive: true } }),
  ]);
  categoryId = category.id;
  relatedSystemId = relatedSystem.id;

  // Fixtures of this suite's own, on their own email domain, so the sweep can
  // create and refuse things without disturbing what the Lab 2 suites assert
  // about the seeded accounts.
  const created = await Promise.all(
    (
      [
        ["Authz Requester", `requester${DOMAIN}`, "REQUESTER", false],
        ["Authz Other Requester", `other${DOMAIN}`, "REQUESTER", false],
        ["Authz Staff", `staff${DOMAIN}`, "IT_STAFF", false],
        ["Authz Administrator", `admin${DOMAIN}`, "ADMINISTRATOR", false],
        ["Authz Pending", `pending${DOMAIN}`, "REQUESTER", true],
      ] as const
    ).map(([fullName, email, role, mustChangePassword]) =>
      prisma.user.create({
        data: { fullName, email, role, isActive: true, mustChangePassword },
        select: { id: true },
      }),
    ),
  );

  requesterId = created[0].id;
  otherRequesterId = created[1].id;

  requester = await sessionCookieFor(requesterId);
  otherRequester = await sessionCookieFor(otherRequesterId);
  staff = await sessionCookieFor(created[2].id);
  admin = await sessionCookieFor(created[3].id);
  // Not sessionCookieFor: that clears the very flag this account exists to test.
  pending = await rawSessionCookieFor(created[4].id);

  const ticket = await send(request(app).post("/api/tickets"), requester)
    .set("Idempotency-Key", randomUUID())
    .send(ticketBody());
  if (ticket.status !== 201) throw new Error(`ticket setup failed ${ticket.status}`);
  ticketId = ticket.body.id;

  const attachment = await send(request(app).post(`/api/tickets/${ticketId}/attachments`), requester).attach(
    "file",
    PNG,
    { filename: "owned.png", contentType: "image/png" },
  );
  if (attachment.status !== 201) throw new Error(`attachment setup failed ${attachment.status}`);
  attachmentId = attachment.body.id;
}, 60000);

afterAll(async () => {
  const users = await prisma.user.findMany({ where: { email: { endsWith: DOMAIN } }, select: { id: true } });
  const ids = users.map((user) => user.id);

  const tickets = await prisma.ticket.findMany({ where: { requesterId: { in: ids } }, select: { id: true } });
  await prisma.attachment.deleteMany({ where: { ticketId: { in: tickets.map((t) => t.id) } } });
  await prisma.ticket.deleteMany({ where: { requesterId: { in: ids } } });
  await prisma.session.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
});

describe("API-09 — no session", () => {
  it.each(endpoints().map((endpoint) => [endpoint.name, endpoint] as const))(
    "%s answers 401 UNAUTHENTICATED",
    async (_name, endpoint) => {
      const res = await endpoint.call();

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("UNAUTHENTICATED");
    },
  );

  it("creates nothing when an unauthenticated caller tries to write", async () => {
    const before = await prisma.ticket.count();
    await send(request(app).post("/api/tickets")).set("Idempotency-Key", randomUUID()).send(ticketBody());

    expect(await prisma.ticket.count()).toBe(before);
  });
});

describe("API-04 — a pending password change", () => {
  it.each(endpoints().map((endpoint) => [endpoint.name, endpoint] as const))(
    "%s answers 403 PASSWORD_CHANGE_REQUIRED",
    async (_name, endpoint) => {
      // BR-02: an account with an initial password may reach `me`,
      // `change-password` and `logout`, and nothing else — including by calling
      // the API directly rather than through a screen that hides the links.
      const res = await endpoint.call(pending);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    },
  );
});

describe("API-09 — the role matrix", () => {
  const privileged = () => [
    ["IT Staff", () => staff] as const,
    ["Administrator", () => admin] as const,
  ];

  for (const [role, cookie] of privileged()) {
    it.each(endpoints().filter((endpoint) => endpoint.requesterOnly).map((e) => [e.name, e] as const))(
      `${role} is refused 403 FORBIDDEN by %s`,
      async (_name, endpoint) => {
        const res = await endpoint.call(cookie());

        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("FORBIDDEN");
      },
    );

    it.each(endpoints().filter((endpoint) => !endpoint.requesterOnly).map((e) => [e.name, e] as const))(
      `${role} may use %s`,
      async (_name, endpoint) => {
        // The matrix gives IT Staff and Administrators read access to any
        // ticket's detail and attachments, and to the reference data.
        const res = await endpoint.call(cookie());

        expect(res.status).toBe(200);
      },
    );
  }

  it("refuses a privileged role before looking the resource up", async () => {
    // BR-18 puts the role check at step 4 and the lookup at step 5, so the two
    // answers must be identical. If they differed, an IT Staff member could
    // learn which attachment ids exist by reading the refusal.
    const existing = await send(
      request(app).patch(`/api/tickets/${ticketId}/attachments/${attachmentId}`),
      staff,
    ).send({ removalReason: "Should never be applied." });

    const nonexistent = await send(
      request(app).patch("/api/tickets/98765432/attachments/98765432"),
      staff,
    ).send({ removalReason: "Should never be applied." });

    expect(existing.status).toBe(403);
    expect(existing.body).toEqual(nonexistent.body);

    const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
    expect(stored.removedAt).toBeNull();
  });
});

describe("API-10 — identity comes from the session, never the client", () => {
  it("ignores another Requester's id in the query string", async () => {
    const res = await send(request(app).get("/api/tickets"), otherRequester).query({
      requesterId: String(requesterId),
    });

    // The forged id belongs to the Requester who owns the fixture ticket. If it
    // were honoured, this caller would see it.
    expect(res.status).toBe(200);
    expect(res.body.items.some((item: { id: number }) => item.id === ticketId)).toBe(false);
  });

  it("ignores a requesterId in the body and owns the ticket to the session user", async () => {
    const res = await send(request(app).post("/api/tickets"), otherRequester)
      .set("Idempotency-Key", randomUUID())
      .send({ ...ticketBody(), requesterId, requester: { id: requesterId } });

    expect(res.status).toBe(201);
    expect(res.body.requester.id).toBe(otherRequesterId);

    const stored = await prisma.ticket.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.requesterId).toBe(otherRequesterId);
  });

  it("ignores the retired X-Dev-Requester-Id header", async () => {
    // The header is gone from the server (issue #47). This proves it is gone
    // rather than merely unused: sending it must not change who the caller is.
    const res = await send(request(app).get("/api/tickets"), otherRequester).set(
      "X-Dev-Requester-Id",
      String(requesterId),
    );

    expect(res.status).toBe(200);
    expect(res.body.items.some((item: { id: number }) => item.id === ticketId)).toBe(false);
  });

  it("still answers 404 for another Requester's ticket, not 403", async () => {
    // BR-19: indistinguishable from a ticket that does not exist, because a 403
    // would confirm the row is real.
    const foreign = await send(request(app).get(`/api/tickets/${ticketId}`), otherRequester);
    const missing = await send(request(app).get("/api/tickets/98765432"), otherRequester);

    expect(foreign.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });
});

describe("API-11 — the Origin check", () => {
  it("refuses a state-changing request with no Origin, and changes nothing", async () => {
    const before = await prisma.ticket.count();

    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", requester)
      .set("Idempotency-Key", randomUUID())
      .send(ticketBody());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORIGIN_REJECTED");
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("refuses an Origin that is not configured", async () => {
    const before = await prisma.ticket.count();

    const res = await request(app)
      .post("/api/tickets")
      .set("Cookie", requester)
      .set("Origin", "http://localhost:5174")
      .set("Idempotency-Key", randomUUID())
      .send(ticketBody());

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ORIGIN_REJECTED");
    expect(await prisma.ticket.count()).toBe(before);
  });

  it("leaves reads alone, so curl evidence needs no Origin", async () => {
    const res = await request(app).get("/api/tickets").set("Cookie", requester);
    expect(res.status).toBe(200);
  });

  it("allows a credentialed preflight from a configured origin only", async () => {
    const allowed = await request(app)
      .options("/api/tickets")
      .set("Origin", TEST_ORIGIN)
      .set("Access-Control-Request-Method", "POST");

    expect(allowed.headers["access-control-allow-origin"]).toBe(TEST_ORIGIN);
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");

    const refused = await request(app)
      .options("/api/tickets")
      .set("Origin", "http://localhost:5174")
      .set("Access-Control-Request-Method", "POST");

    // No wildcard, and not this origin either (D-02).
    expect(refused.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("API-12 — the retired Requester directory", () => {
  it("answers 404 for GET /api/requesters, for every role", async () => {
    for (const cookie of [undefined, requester, staff, admin]) {
      const res = await send(request(app).get("/api/requesters"), cookie);
      expect(res.status).toBe(404);
    }
  });

  it("never discloses an IT Staff or Administrator address to a Requester", async () => {
    // Carried forward from the defect found in the peer's PR #37, where the
    // unchanged Lab 2 directory handed every staff and administrator address to
    // an unauthenticated caller after the table rename. The endpoint is gone
    // now; this asserts that no Requester-facing response grew the leak back.
    const privileged = await prisma.user.findMany({
      where: { role: { in: ["IT_STAFF", "ADMINISTRATOR"] } },
      select: { email: true },
    });
    expect(privileged.length).toBeGreaterThan(0);

    const responses = await Promise.all([
      send(request(app).get("/api/tickets"), requester),
      send(request(app).get(`/api/tickets/${ticketId}`), requester),
      send(request(app).get("/api/categories"), requester),
      send(request(app).get("/api/related-systems"), requester),
    ]);

    const body = responses.map((res) => JSON.stringify(res.body)).join("");
    for (const user of privileged) {
      expect(body).not.toContain(user.email);
    }
  });

  it("requires a session for the reference data, and serves every role", async () => {
    for (const path of ["/api/categories", "/api/related-systems"]) {
      expect((await send(request(app).get(path))).status).toBe(401);

      for (const cookie of [requester, staff, admin]) {
        expect((await send(request(app).get(path), cookie)).status).toBe(200);
      }
    }
  });
});
