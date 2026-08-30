import express, { Request, Response } from "express";
import cors from "cors";
import { getPrisma } from "./prisma.js";
import { CLIENT_ORIGIN, SERVICE_NAME } from "./config.js";
import { sendDependencyUnavailable } from "./errors.js";
import { createTicket } from "./tickets-route.js";

// The Express app is exported separately from app.listen() (see index.ts) so
// Supertest can import `app` without opening a port. Do not merge these files.
export const app = express();

// Least privilege: only the configured client origin may call this API, rather
// than the wildcard that cors() sends by default.
app.use(cors({ origin: CLIENT_ORIGIN }));
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
    const requesters = await getPrisma().requester.findMany({
      where: { isActive: true },
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

export default app;
