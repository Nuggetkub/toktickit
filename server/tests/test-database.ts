import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Tests never run against the development database.
//
// Two of the Lab 2 suites deactivate a row to prove that active-only filtering
// works. Doing that in the shared development schema means a suite that fails
// before its cleanup leaves real data wrong, and — because Vitest runs test
// files in parallel by default — a concurrent file can observe the temporary
// state and fail for reasons that have nothing to do with it.
//
// So the whole suite runs against its own PostgreSQL schema, created, migrated
// and seeded by tests/global-setup.ts. See also `fileParallelism: false` in
// vitest.config.ts: an isolated schema stops tests corrupting development data,
// but only serial execution stops them corrupting each other.
export const TEST_SCHEMA = "lab2_test";

/**
 * Prisma Client loads server/.env itself rather than relying on process.env, so
 * DATABASE_URL is not set in the Vitest process. Read the file directly instead
 * of adding a dotenv dependency for one variable.
 */
function readDatabaseUrlFromEnvFile(): string | undefined {
  try {
    const contents = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = /^\s*DATABASE_URL\s*=\s*(.*)\s*$/.exec(line);
      if (match) return match[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env — fall through to the environment.
  }
  return undefined;
}

export function baseDatabaseUrl(): string {
  const url = process.env.DATABASE_URL ?? readDatabaseUrlFromEnvFile();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set and server/.env could not be read. " +
        "Copy .env.example to .env before running the tests.",
    );
  }
  return url;
}

/** The same database, a different schema. */
export function testDatabaseUrl(): string {
  const url = new URL(baseDatabaseUrl());
  url.searchParams.set("schema", TEST_SCHEMA);
  return url.toString();
}
