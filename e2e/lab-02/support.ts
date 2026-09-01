import { expect, type Page } from "@playwright/test";

// Shared steps for the Lab 2 end-to-end suite. Every helper drives the real
// screens through their visible labels — the same names a person reads — so a
// rename that would confuse a user also fails the suite.

export const REQUESTER_A = "Nadia Rahman";
export const REQUESTER_B = "Somchai Pattana";

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

/** Starts at the selector and lands on My Tickets as the named Requester. */
export async function selectRequester(page: Page, fullName: string): Promise<void> {
  await page.goto("/select-requester");
  await expect(page.getByRole("heading", { name: "Development Requester Selection" })).toBeVisible();

  // Chosen by the name a person reads, not by a hard-coded id: the seed assigns
  // ids and a re-seeded database would silently select someone else.
  const select = page.getByLabel("Development Requester");
  const value = await select.locator("option", { hasText: fullName }).getAttribute("value");
  if (!value) throw new Error(`${fullName} is not offered by the selector — check the E2E seed.`);
  await select.selectOption(value);
  await page.getByRole("button", { name: "Continue" }).click();

  await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
}

/** Clears the stored Requester, so the next visit starts from the selector. */
export async function clearRequester(page: Page): Promise<void> {
  await page.goto("/select-requester");
  await page.evaluate(() => window.localStorage.clear());
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
