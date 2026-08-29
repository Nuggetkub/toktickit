import { execSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { seedReferenceData } from "../src/seed-data.js";
import { TEST_SCHEMA, testDatabaseUrl } from "./test-database.js";

// Runs once, before any worker starts: create the test schema, apply every
// committed migration to it, and seed the reference data the suites expect.
//
// `migrate deploy` rather than `migrate dev` — deploy only applies what is
// already committed, so the tests can never invent a migration that is missing
// from the repository.
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();

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

  console.log(`[test setup] schema "${TEST_SCHEMA}" migrated and seeded`);
}
