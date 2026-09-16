import express, { Request, Response } from "express";
import cors from "cors";
import { getPrisma } from "./prisma.js";
import { CLIENT_ORIGINS, SERVICE_NAME } from "./config.js";
import { changePassword, login, logout, me } from "./auth-routes.js";
import {
  asyncRoute,
  requireAuthenticatedUser,
  requirePasswordChangeComplete,
  requireRole,
  requireTrustedOrigin,
} from "./auth-middleware.js";
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
// Issue 47 — step 1 of the authorization order (api-spec.md §1, BR-16, D-03).
//
// Issue 46 mounted this on the three auth mutations alone, because the Lab 2
// routes still took their identity from a forgeable development header and so
// had no session worth protecting. Now that every route below runs on the
// session, the check belongs where the contract puts it: first, and everywhere.
// It ignores GET, so capturing read evidence with curl still needs no Origin.
// ---------------------------------------------------------------------------
app.use(requireTrustedOrigin);

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
// ---------------------------------------------------------------------------
app.post("/api/auth/login", asyncRoute(login));
app.get("/api/auth/me", requireAuthenticatedUser, asyncRoute(me));
app.post("/api/auth/change-password", requireAuthenticatedUser, asyncRoute(changePassword));
app.post("/api/auth/logout", asyncRoute(logout));

// ---------------------------------------------------------------------------
// Issue 47 — steps 2 and 3, for every endpoint below (api-spec.md §1).
//
// Spread into each route rather than mounted once with app.use(), so the guards
// are visible at the route they protect. A route added later then has to state
// its own protection instead of inheriting it from where it happened to be
// typed — and the four auth routes above cannot silently acquire the password
// gate that BR-02 says they must not have.
// ---------------------------------------------------------------------------
const signedIn = [requireAuthenticatedUser, requirePasswordChangeComplete];

// ---------------------------------------------------------------------------
// Issue 19 — Lab 2 reference data (api-spec.md §3)
//
// Both return active rows only, ordered by name, so the dropdowns that consume
// them read alphabetically rather than in insertion order. An empty array is a
// valid answer — the interface treats it as an empty state, not as an error.
//
// Lab 2 left these open to anyone because the Requester selector had to load
// before a Requester had been chosen. Lab 3 has a sign-in screen instead, so
// they now require a session of any role: an unauthenticated caller has no
// screen left to fill.
//
// `GET /api/requesters` is gone. It is deliberately not replaced by a route
// answering 403 — the endpoint itself is what Lab 3 retires, because nothing
// selects a Requester from a list any more. An unregistered path answers 404,
// which is exactly what api-spec.md §3 specifies for it.
// ---------------------------------------------------------------------------

app.get("/api/categories", ...signedIn, async (_req: Request, res: Response) => {
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

app.get("/api/related-systems", ...signedIn, async (_req: Request, res: Response) => {
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

// ---------------------------------------------------------------------------
// Issues 21, 23 and 47 — Requester tickets (api-spec.md §4)
//
// Identity is the session's, so these routes describe a Ticket and nothing else
// (BR-03). Creating and listing are Requester operations — IT Staff have the
// queue instead — while Ticket Detail is readable by every role and is narrowed
// to the caller's own ticket inside the handler when that caller is a Requester.
// ---------------------------------------------------------------------------
app.post("/api/tickets", ...signedIn, requireRole("REQUESTER"), createTicket);
app.get("/api/tickets", ...signedIn, requireRole("REQUESTER"), listTickets);
app.get("/api/tickets/:ticketId", ...signedIn, getTicket);

// ---------------------------------------------------------------------------
// Issue 25 — Attachments (api-spec.md §4)
//
// The size limit is enforced by multer as well as by the rules module: without
// it a 500 MB upload is buffered in full before anything gets to reject it, so
// the ceiling has to exist at the point bytes are read, not only after.
// ---------------------------------------------------------------------------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES } });

// The guards precede multer deliberately: an unauthenticated caller, or one
// whose role may not upload at all, is refused before a single byte of their
// body is buffered into memory.
app.post(
  "/api/tickets/:ticketId/attachments",
  ...signedIn,
  requireRole("REQUESTER"),
  upload.single("file"),
  uploadAttachment,
);
app.get("/api/tickets/:ticketId/attachments", ...signedIn, listAttachments);
app.get("/api/tickets/:ticketId/attachments/:attachmentId/download", ...signedIn, downloadAttachment);
app.patch(
  "/api/tickets/:ticketId/attachments/:attachmentId",
  ...signedIn,
  requireRole("REQUESTER"),
  removeAttachment,
);

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
