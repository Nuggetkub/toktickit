import { execFileSync } from "node:child_process";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { baseDatabaseUrl, withSchema } from "../../src/database-url.js";

// Helpers for the Lab 3 database tests.
//
// These tests need schemas of their own rather than the shared `lab2_test` one:
// the seed test creates about thirty demo tickets, and the migration test builds
// a Lab 2-shaped database on purpose. Either would change what the Lab 2 suites
// see, and a test that only passes depending on which file ran first is worse
// than no test.

const serverDirectory = process.cwd();
const prismaCli = path.join(serverDirectory, "node_modules", "prisma", "build", "index.js");

/** A URL for a disposable schema on the same database the suite already uses. */
export function scratchUrl(schema: string): string {
  if (!schema.startsWith("lab3_") || schema === "public") {
    throw new Error(`Refusing to use schema "${schema}": scratch schemas must be named lab3_*.`);
  }
  return withSchema(schema);
}

/** Drops and recreates the schema, so every run starts from a known empty state. */
export async function resetSchema(schema: string): Promise<void> {
  if (!schema.startsWith("lab3_") || schema === "public") {
    throw new Error(`Refusing to drop schema "${schema}".`);
  }
  const admin = new PrismaClient({ datasourceUrl: baseDatabaseUrl() });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  } finally {
    await admin.$disconnect();
  }
}

export async function dropSchema(schema: string): Promise<void> {
  if (!schema.startsWith("lab3_") || schema === "public") return;
  const admin = new PrismaClient({ datasourceUrl: baseDatabaseUrl() });
  try {
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  } finally {
    await admin.$disconnect();
  }
}

/** Applies every committed migration. `deploy`, never `dev`: a test may not invent one. */
export function deployMigrations(url: string): void {
  execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: serverDirectory,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "pipe",
  });
}

/** Applies one migration directory's SQL, so a test can stop at the Lab 2 state. */
export function applyMigration(directory: string, url: string): void {
  const file = path.join(serverDirectory, "prisma", "migrations", directory, "migration.sql");
  execFileSync(process.execPath, [prismaCli, "db", "execute", "--url", url, "--file", file], {
    cwd: serverDirectory,
    stdio: "pipe",
  });
}

/**
 * True when the live schema matches schema.prisma. `migrate diff --exit-code`
 * answers 0 for "no difference" and 2 for "there is one".
 */
export function schemaMatchesDatamodel(url: string): boolean {
  try {
    execFileSync(
      process.execPath,
      [prismaCli, "migrate", "diff", "--from-url", url, "--to-schema-datamodel", "prisma/schema.prisma", "--exit-code"],
      { cwd: serverDirectory, env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

/** The migrations that existed at the end of Lab 2, in order. */
export const LAB2_MIGRATIONS = [
  "20260808153643_init",
  "20260829081823_lab2_data_model",
  "20260829152516_lab2_ticket_number_sequence",
] as const;

export const LAB3_MIGRATION = "20260914090000_lab3_user_and_workflow";
