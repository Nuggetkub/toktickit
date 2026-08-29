import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { seedReferenceData } from "../src/seed-data.js";
import { TEST_SCHEMA, baseDatabaseUrl, testDatabaseUrl } from "./test-database.js";

// Runs once, before any worker starts.
//
// The schema is dropped and recreated first, so every run begins from a known
// empty state. `prisma migrate deploy` only applies migrations that have not
// been applied yet — it does not clear data — so without the drop, rows created
// by one run would survive into the next. That matters as soon as a suite
// creates Tickets: seed.test.ts asserts there are none, and that assertion
// would quietly start depending on what the previous run happened to leave
// behind rather than on anything this run did.
//
// `migrate deploy` rather than `migrate dev`, so a test run can only ever apply
// migrations that are already committed and can never invent one.

export default async function setup(): Promise<void> {
  // Guard: this function drops a schema. It must never be pointed at the
  // development data by a bad edit to TEST_SCHEMA.
  if (!TEST_SCHEMA || TEST_SCHEMA === "public") {
    throw new Error(`Refusing to reset schema "${TEST_SCHEMA}" — the test schema must not be "public".`);
  }

  const url = testDatabaseUrl();

  // Connect outside the test schema to drop and recreate it.
  const admin = new PrismaClient({ datasourceUrl: baseDatabaseUrl() });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${TEST_SCHEMA}"`);
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

  console.log(`[test setup] schema "${TEST_SCHEMA}" reset, migrated and seeded`);
}
