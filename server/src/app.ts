import express, { Request, Response } from "express";
import cors from "cors";
import { getPrisma } from "./prisma.js";
import { CLIENT_ORIGIN, SERVICE_NAME } from "./config.js";

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

app.get("/api/categories", async (_req: Request, res: Response) => {
  try {
    const categories = await getPrisma().category.findMany({
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    });
    res.status(200).json(categories);
  } catch (err) {
    // Log the real cause for us, but never leak it to the client.
    console.error("GET /api/categories failed:", err);
    res.status(500).json({ error: "Could not load categories." });
  }
});

export default app;
