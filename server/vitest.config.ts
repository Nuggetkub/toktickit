import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],

    // Create, migrate and seed an isolated PostgreSQL schema once per run, so
    // the suite never touches the development database.
    globalSetup: ["tests/global-setup.ts"],

    // Point each worker's PrismaClient at that schema before any test imports it.
    setupFiles: ["tests/setup-env.ts"],

    // Two suites deactivate a row to prove active-only filtering. Vitest runs
    // test files in parallel by default, so a concurrent file could observe that
    // temporary state — categories.test.ts asserting four active categories
    // while another file has one of them switched off. The suite is small and
    // runs in seconds, so serial execution is cheap insurance.
    // An isolated schema stops tests corrupting development data; this stops
    // them corrupting each other.
    fileParallelism: false,
  },
});
