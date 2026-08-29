import { PrismaClient } from "@prisma/client";

// Lazy singleton: the client is created on first use, not at import time.
// This keeps route modules and tests that don't touch the DB (e.g. /api/health)
// free of database side effects.
let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!client) {
    // Prisma resolves DATABASE_URL from server/.env on its own. Passing it
    // explicitly when it *is* present in the environment lets the test run
    // redirect the client to an isolated schema (tests/setup-env.ts) without
    // changing how the application behaves in development or production.
    const url = process.env.DATABASE_URL;
    client = url ? new PrismaClient({ datasourceUrl: url }) : new PrismaClient();
  }
  return client;
}
