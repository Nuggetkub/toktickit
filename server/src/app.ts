import express, { Request, Response } from "express";
import cors from "cors";
import { getPrisma } from "./prisma.js";
import { CLIENT_ORIGINS, SERVICE_NAME } from "./config.js";
import { changePassword, login, logout, me } from "./auth-routes.js";
import { asyncRoute, requireAuthenticatedUser, requireTrustedOrigin } from "./auth-middleware.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { createTicket, getTicket, listTickets } from "./tickets-route.js";
import multer from "multer";
import { MAX_BYTES } from "./attachment-rules.js";
import {
  downloadAttachment,
  listAttachments,
  removeAttachment,
  uploadAttachment,
} from "./attachments-route.js";

// The Express app is exported separately from app.listen() (see index.ts) so
// Supertest can import `app` without opening a port. Do not merge these files.
export const app = express();

// Least privilege: only the configured client origins may call this API, rather
// than the wildcard that cors() sends by default. `credentials` is what lets the
// browser send the session cookie at all — and a wildcard origin is rejected by
// the browser as soon as credentials are involved, so the explicit list is not
// optional (decision D-02).
app.use(cors({ origin: CLIENT_ORIGINS, credentials: true }));
app.use(express.json());

// ---------------------------------------------------------------------------
// Issue 2 — API health check
// Make the test in tests/lab-01/health.test.ts pass.
// It must return HTTP 200 with JSON: { status: "ok", service: "TokTickIT API" }
// ---------------------------------------------------------------------------
app.get("/api/health", (_req: Request, res: Response) => {
  res.status(200).json({ status: "ok", service: SERVICE_NAME });
});

// ---------------------------------------------------------------------------
// Issue 46 — authentication (api-spec.md §2)
//
// These four are the only endpoints a signed-in user may reach while a password
// change is pending (BR-02), which is why none of them carries
// requirePasswordChangeComplete: an account with an initial password has to be
// able to see who it is, fix the password, or leave.
//
// The Origin check guards the state-changing three (BR-16). It is mounted here
// rather than globally because the Lab 2 routes still take their identity from
// the development header; issue #47 moves them onto the session and applies the
// same guard to them.
// ---------------------------------------------------------------------------
app.post("/api/auth/login", requireTrustedOrigin, asyncRoute(login));
app.get("/api/auth/me", requireAuthenticatedUser, asyncRoute(me));
app.post(
  "/api/auth/change-password",
  requireTrustedOrigin,
  requireAuthenticatedUser,
  asyncRoute(changePassword),
);
app.post("/api/auth/logout", requireTrustedOrigin, asyncRoute(logout));

// ---------------------------------------------------------------------------
// Issue 19 — Lab 2 reference data (api-spec.md §2)
//
// These three are not requester-scoped and take no identity header: the
// selector has to be able to load before a Requester has been chosen at all.
//
// All three return active rows only and are ordered by name, so the dropdowns
// that consume them read alphabetically rather than in insertion order. An
// empty array is a valid answer — the interface treats it as an empty state,
// not as an error.
// ---------------------------------------------------------------------------

app.get("/api/categories", async (_req: Request, res: Response) => {
  try {
    const categories = await getPrisma().category.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    res.status(200).json(categories);
  } catch (err) {
    sendDependencyUnavailable(res, "GET /api/categories", err);
  }
});

app.get("/api/related-systems", async (_req: Request, res: Response) => {
  try {
    const relatedSystems = await getPrisma().relatedSystem.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    res.status(200).json(relatedSystems);
  } catch (err) {
    sendDependencyUnavailable(res, "GET /api/related-systems", err);
  }
});

app.get("/api/requesters", async (_req: Request, res: Response) => {
  try {
    // The role filter is load-bearing, not decoration. Lab 2's table held only
    // Requesters, so "every active row" and "every active Requester" were the
    // same set; after the Lab 3 rename the table also holds IT Staff and
    // Administrators, and without this clause an unauthenticated caller would
    // be handed their names and e-mail addresses.
    const requesters = await getPrisma().user.findMany({
      where: { isActive: true, role: "REQUESTER" },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: "asc" },
    });
    res.status(200).json(requesters);
  } catch (err) {
    sendDependencyUnavailable(res, "GET /api/requesters", err);
  }
});

// ---------------------------------------------------------------------------
// Issue 21 — Create Ticket (api-spec.md §3)
//
// Requester-scoped: identity arrives in the X-Dev-Requester-Id header, never in
// the body, so this route describes a Ticket and nothing else (decision D-01).
// ---------------------------------------------------------------------------
app.post("/api/tickets", createTicket);

// Issue 23 — My Tickets. Both are requester-scoped: the list is filtered by the
// header identity and the detail is fetched by (id, requesterId) together.
app.get("/api/tickets", listTickets);
app.get("/api/tickets/:ticketId", getTicket);

// ---------------------------------------------------------------------------
// Issue 25 — Attachments (api-spec.md §4)
//
// The size limit is enforced by multer as well as by the rules module: without
// it a 500 MB upload is buffered in full before anything gets to reject it, so
// the ceiling has to exist at the point bytes are read, not only after.
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

app.post("/api/tickets/:ticketId/attachments", upload.single("file"), uploadAttachment);
app.get("/api/tickets/:ticketId/attachments", listAttachments);
app.get("/api/tickets/:ticketId/attachments/:attachmentId/download", downloadAttachment);
app.patch("/api/tickets/:ticketId/attachments/:attachmentId", removeAttachment);

// Multer rejects an oversized body before the route runs, so its error needs
// translating into the documented envelope rather than reaching Express's
// default handler, which would answer with an HTML stack trace.
app.use((error: unknown, _req: Request, res: Response, next: express.NextFunction) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      sendError(res, 413, "ATTACHMENT_TOO_LARGE", "Each attachment must be 5 MB or smaller.");
      return;
    }
    sendError(res, 400, "VALIDATION_FAILED", "The upload could not be processed.");
    return;
  }

  if (error instanceof SyntaxError && "body" in error) {
    sendError(res, 400, "VALIDATION_FAILED", "The request body is not valid JSON.");
    return;
  }

  if (error) {
    // Anything else is ours, not the caller's: a 500, and never a stack trace.
    console.error("Unhandled error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
    return;
  }

  next();
});

export default app;
