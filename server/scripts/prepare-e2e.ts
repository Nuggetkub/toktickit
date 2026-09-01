import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { baseDatabaseUrl, withSchema } from "../src/database-url.js";
import { seedReferenceData } from "../src/seed-data.js";

/**
 * Prepares the database the Playwright run uses.
 *
 * The E2E suite drives the real API against a real PostgreSQL schema, so it
 * needs the same treatment the Vitest suite gets from tests/global-setup.ts: its
 * own schema, dropped and recreated on every run. A browser test that starts
 * from whatever the last run left behind is a test whose failures cannot be
 * reproduced — and this suite creates Tickets, so "whatever was left behind"
 * grows every time.
 *
 * `migrate deploy`, never `migrate dev`: a test run may only apply migrations
 * that are already committed, and can never invent one.
 */
// Typed as `string` rather than as the literal, for the same reason TEST_SCHEMA
// is: otherwise TypeScript proves the guard below can never fire and rejects it
// as an unintentional comparison, and the guard stops being real code.
const E2E_SCHEMA: string = "lab2_e2e";

async function main(): Promise<void> {
  // This function drops a schema. The guard is not decoration: a bad edit to
  // E2E_SCHEMA, or an empty value arriving from the environment, would otherwise
  // point it at the development data.
  if (!E2E_SCHEMA || E2E_SCHEMA === "public") {
    throw new Error(`Refusing to reset schema "${E2E_SCHEMA}" — the E2E schema must not be "public".`);
  }

  const url = withSchema(E2E_SCHEMA);

  const admin = new PrismaClient({ datasourceUrl: baseDatabaseUrl() });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${E2E_SCHEMA}" CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${E2E_SCHEMA}"`);
  } finally {
    await admin.$disconnect();
  }

  execSync("npx prisma migrate deploy", {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    await seedReferenceData(prisma);
  } finally {
    await prisma.$disconnect();
  }

  console.log(`[e2e setup] schema "${E2E_SCHEMA}" reset, migrated and seeded`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
