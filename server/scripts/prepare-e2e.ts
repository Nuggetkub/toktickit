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
// Which schema to reset. Issue #56 gives the Lab 3 browser suite a schema of its
// own, so the value now arrives from the Playwright config rather than being
// fixed here — but it defaults to the Lab 2 one, so `npm run e2e` is unchanged.
//
// Typed as `string` rather than as the literal, for the same reason TEST_SCHEMA
// is: otherwise TypeScript proves the guard below can never fire and rejects it
// as an unintentional comparison, and the guard stops being real code.
const E2E_SCHEMA: string = process.env.E2E_SCHEMA ?? "lab2_e2e";

async function main(): Promise<void> {
  // This function drops a schema. The guard is not decoration: a bad edit here,
  // or an empty or hostile value arriving from the environment, would otherwise
  // point it at the development data. Now that the name is configurable the
  // guard has to be a whitelist rather than a check for one bad value — an
  // `E2E_SCHEMA=public` or `E2E_SCHEMA=` would have passed the old one.
  if (!/^lab\d_e2e$/.test(E2E_SCHEMA)) {
    throw new Error(
      `Refusing to reset schema "${E2E_SCHEMA}" — the E2E schema must be named lab<n>_e2e.`,
    );
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
