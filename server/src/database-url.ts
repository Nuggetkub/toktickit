import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where the database URL comes from, for the code paths that need it *before*
 * Prisma Client is constructed — the test setup and the E2E preparation script.
 *
 * Prisma loads `server/.env` itself, so `DATABASE_URL` is not necessarily in
 * `process.env` when those run. This reads the file directly rather than adding
 * a dotenv dependency for one variable.
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
export function withSchema(schema: string): string {
  const url = new URL(baseDatabaseUrl());
  url.searchParams.set("schema", schema);
  return url.toString();
}
