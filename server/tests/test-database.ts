import { baseDatabaseUrl, withSchema } from "../src/database-url.js";

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
// Typed as `string` rather than the literal, so the safety check in
// global-setup.ts — which refuses to drop "public" — stays meaningful code
// instead of a comparison TypeScript can prove is always false.
export const TEST_SCHEMA: string = "lab2_test";

// The E2E run uses `lab2_e2e`, prepared by scripts/prepare-e2e.ts. Both live on
// the same database as the development schema and neither may ever be "public";
// the URL handling they share is in src/database-url.ts.
export { baseDatabaseUrl };

export function testDatabaseUrl(): string {
  return withSchema(TEST_SCHEMA);
}
