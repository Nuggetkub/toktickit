import { expect, type Page } from "@playwright/test";

// Shared steps for the Lab 2 end-to-end suite. Every helper drives the real
// screens through their visible labels — the same names a person reads — so a
// rename that would confuse a user also fails the suite.

export const REQUESTER_A = "Nadia Rahman";
export const REQUESTER_B = "Somchai Pattana";

/**
 * The seeded accounts these journeys sign in as, and the one development
 * password every seeded account shares (BR-45, `server/src/seed-data.ts`).
 *
 * Issue #48 retired the Development Requester selector, so identity now comes
 * from a real session. These suites kept driving `/select-requester` — a route
 * that no longer exists — which is why they had to be repaired here rather than
 * merely re-run.
 */
export const EMAIL_A = "nadia.rahman@toktickit.local";
export const EMAIL_B = "somchai.pattana@toktickit.local";
export const DEVELOPMENT_PASSWORD = process.env.SEED_PASSWORD ?? "TokTickIT-dev-2026";

/**
 * A real PNG: the eight-byte signature followed by filler. The server decides an
 * attachment's type from its leading bytes and ignores the declared
 * `Content-Type` (BR-31), so an upload fixture has to *be* a PNG rather than
 * merely claim to be one.
 *
 * Written as bytes rather than as a string literal: an escape that survives into
 * a source file as a real control character makes git treat the file as binary,
 * and the diff then shows nothing at all.
 */
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(512, 0x2a),
]);

/** Unique per run, so a Ticket created now cannot be confused with an earlier one. */
export function uniqueSummary(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * Signs in as the given Requester and lands on My Tickets.
 *
 * Every seeded account is issued an initial password, and BR-12 leaves the
 * mandatory-change gate on for all of them — so a first sign-in always lands on
 * "Choose a new password" rather than on the requested screen. The helper
 * completes that gate once, with the same password, which BR-11 forbids: it
 * therefore sets a distinct session password the rest of the run uses.
 *
 * The fallback is deliberate rather than defensive. The E2E schema is dropped
 * and recreated per run, so the first sign-in of a run always meets the gate;
 * but a spec that signs the same account in twice must not meet it again, and a
 * developer re-running against a warm schema should not have to reset it by
 * hand.
 */
export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();

  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(DEVELOPMENT_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();

  const gate = page.getByRole("heading", { name: "Choose a new password" });
  const landing = page.getByRole("heading", { name: "My Tickets" });
  const failure = page.getByRole("alert");
  await expect(gate.or(landing).or(failure)).toBeVisible();

  // Already past the gate on a warm schema: the seeded password was replaced by
  // a previous run, so sign in with the session password instead.
  if (await failure.isVisible()) {
    await page.getByLabel(/^Email/).fill(email);
    await page.getByLabel(/^Password/).fill(SESSION_PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(landing).toBeVisible();
    return;
  }

  if (await gate.isVisible()) {
    await page.getByLabel("Current password").fill(DEVELOPMENT_PASSWORD);
    // Anchored regex, not `{ exact: true }`, and not a bare substring.
    //
    // `Field` renders the required marker *inside* the <label>, so the label
    // text is "New password*" and an exact match never lands — while a bare
    // substring would also match "Confirm new password" and fail strict mode on
    // two elements. `/^New password/` is the only form that selects exactly one.
    await page.getByLabel(/^New password/).fill(SESSION_PASSWORD);
    await page.getByLabel(/^Confirm new password/).fill(SESSION_PASSWORD);
    await page.getByRole("button", { name: "Save new password" }).click();
  }

  await expect(landing).toBeVisible();
}

/**
 * The password each account holds after its first sign-in of the run. BR-11
 * refuses a new password equal to the current one, so the gate cannot be
 * completed by re-entering the seeded value.
 */
export const SESSION_PASSWORD = "TokTickIT-e2e-session-2026";

/** Ends the session through the control a user would use. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
}

export type TicketDraft = {
  summary: string;
  description?: string;
  category?: string;
  relatedSystem?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
};

/**
 * Creates a Ticket through the form and returns the official Ticket Number the
 * server assigned. Reading the number off the success screen rather than
 * constructing it is the point: the client never invents it (BR-01).
 */
export async function createTicket(page: Page, draft: TicketDraft): Promise<string> {
  // The shell navigation carries this on every requester-scoped screen.
  await page.getByRole("button", { name: "Create Ticket" }).first().click();
  await expect(page.getByRole("heading", { name: "Create Ticket" })).toBeVisible();

  // The reference dropdowns are loaded from the API; the form is not usable
  // until they arrive, and the screen disables them until then.
  await expect(page.getByLabel("Category")).toBeEnabled();

  await page.getByLabel("Category").selectOption({ label: draft.category ?? "Network" });
  await page.getByLabel("Related System").selectOption({ label: draft.relatedSystem ?? "Campus Wi-Fi" });
  await page.getByLabel("Ticket Summary").fill(draft.summary);
  await page.getByLabel("Requested Priority").selectOption(draft.priority ?? "HIGH");
  await page
    .getByLabel("Description")
    .fill(draft.description ?? "Raised by the Playwright requester flow to exercise the real API end to end.");

  await page.getByRole("button", { name: "Submit Ticket" }).click();

  await expect(page.getByRole("heading", { name: "Ticket created" })).toBeVisible();
  const ticketNumber = await page.getByRole("status").getByRole("strong").first().innerText();
  expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{5}$/);
  return ticketNumber;
}

/** Opens a Ticket from the My Tickets table by its number. */
export async function openTicketFromList(page: Page, ticketNumber: string): Promise<void> {
  await page.getByRole("link", { name: ticketNumber }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
}

/** The numeric id in the current Ticket Detail URL. */
export function ticketIdFromUrl(page: Page): string {
  const match = /\/tickets\/(\d+)/.exec(page.url());
  if (!match) throw new Error(`Not on a Ticket Detail URL: ${page.url()}`);
  return match[1];
}
