import { defineConfig } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

// The E2E run is the only place the client, the API, PostgreSQL and the
// attachment storage are exercised together. Everything it touches is kept away
// from development state: its own database schema (`lab2_e2e`, prepared by
// server/scripts/prepare-e2e.ts), its own upload directory, and its own ports.

const runtimeDirectory = path.resolve("artifacts/lab-02/e2e-runtime");

const API_PORT = 3101;
const CLIENT_PORT = 4173;
const CLIENT_ORIGIN = `http://127.0.0.1:${CLIENT_PORT}`;

export default defineConfig({
  testDir: "./e2e/lab-02",

  // Serial. The suite creates Tickets in one shared schema and asserts on what
  // a requester owns; parallel workers would interleave those Tickets and make
  // the ownership assertions depend on timing.
  fullyParallel: false,
  workers: 1,

  timeout: 45_000,
  expect: { timeout: 10_000 },

  outputDir: "artifacts/lab-02/test-results",
  reporter: [["line"], ["html", { outputFolder: "artifacts/lab-02/playwright-report", open: "never" }]],

  use: {
    baseURL: CLIENT_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  webServer: [
    {
      // Prepares the schema and then serves the real API — not a mock, and not
      // the development database.
      command: "npm run e2e:server --prefix server",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: "pipe",
      env: {
        ...process.env,
        PORT: String(API_PORT),
        DATABASE_URL: schemaUrl("lab2_e2e"),
        ATTACHMENT_STORAGE_DIR: path.join(runtimeDirectory, "uploads"),
        // CORS is pinned to the Vite dev server by default (server/src/config.ts).
        // The E2E client is on a different origin, so it has to be named here or
        // every request from the browser fails preflight.
        CLIENT_ORIGIN,
      },
    },
    {
      command: `npm run dev --prefix client -- --host 127.0.0.1 --port ${CLIENT_PORT} --strictPort`,
      url: CLIENT_ORIGIN,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});

/**
 * The E2E database URL, derived from the same `server/.env` the application
 * uses, with the schema swapped. Reading the file here means `npm run e2e` works
 * from a normal development setup with no extra environment variable, and
 * `E2E_DATABASE_URL` stays available for a machine that keeps its URL elsewhere.
 */
function schemaUrl(schema: string): string {
  const configured = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? databaseUrlFromServerEnv();
  if (!configured) {
    throw new Error(
      "The E2E run needs a database URL. Copy server/.env.example to server/.env, " +
        "or set E2E_DATABASE_URL.",
    );
  }
  const url = new URL(configured);
  url.searchParams.set("schema", schema);
  return url.toString();
}

function databaseUrlFromServerEnv(): string | undefined {
  const envPath = path.resolve("server/.env");
  if (!existsSync(envPath)) return undefined;
  const match = readFileSync(envPath, "utf8").match(/^\s*DATABASE_URL\s*=\s*["']?([^\r\n"']+)["']?\s*$/m);
  return match?.[1];
}
