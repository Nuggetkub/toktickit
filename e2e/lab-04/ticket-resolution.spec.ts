import { REQUESTER, STAFF, actionRow, addAction, createTicket, expect, openInQueue, signIn, signOut, test, uniqueSummary } from "./support";
import type { Page } from "@playwright/test";

// E2E-02 in docs/lab-04/tests.md: the resolution gate (BR-19) and the status
// history (BR-22), and the cancel cascade (BR-20), in a browser.

test.describe.configure({ mode: "serial" });

const statusSelect = (page: Page) => page.getByLabel("Status", { exact: true });
const resolvedOption = (page: Page) => statusSelect(page).locator("option", { hasText: /^Resolved$/ });

async function newClaimedTicket(page: Page, summary: string): Promise<string> {
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary: uniqueSummary(summary) });
  await signOut(page);
  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  await expect(page.getByLabel("Owner")).toHaveValue(/\d+/);
  return ticketNumber;
}

/**
 * A status change through the Work panel. Resolved, Closed, Reopened and
 * Cancelled ask for confirmation (with the evidence they need); the others apply
 * at once, so `evidence` says which kind this is.
 */
async function changeStatus(page: Page, label: string, evidence?: string) {
  await statusSelect(page).selectOption({ label });
  await page.getByRole("button", { name: "Change status", exact: true }).click();
  if (evidence !== undefined) {
    const dialog = page.getByRole("dialog", { name: `Change status to ${label}?` });
    await dialog.getByRole("textbox").fill(evidence);
    await dialog.getByRole("button", { name: `Change status to ${label}` }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.getByText(`Current status: ${label}.`)).toBeVisible();
}

async function planOpenAction(page: Page, description: string) {
  const form = await addAction(page, { open: true, description });
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(actionRow(page, description)).toContainText("Open");
}

test("E2E-02 Resolved is disabled with its reasons until the work is done, then resolving succeeds and the History shows each change", async ({ page }) => {
  test.setTimeout(150_000);
  await newClaimedTicket(page, "Lecture hall projector flickers");
  await changeStatus(page, "In Progress");

  const planned = "Replace the projector's HDMI extender.";
  await planOpenAction(page, planned);

  // Closed gate: Resolved is listed but disabled, and the reasons are named.
  await expect(resolvedOption(page)).toBeDisabled();
  const needs = page.locator("#work-status-needs");
  await expect(needs).toContainText("Resolution needs:");
  await expect(needs).toContainText("Complete or cancel 1 open action");
  await expect(needs).toContainText("Record at least one completed action");

  // Completing the Action opens the gate.
  await actionRow(page, planned).getByRole("button", { name: "Complete" }).click();
  const complete = page.getByRole("dialog", { name: "Complete action" });
  await complete.getByLabel(/^Result/).fill("New extender fitted; no flicker over a full lecture.");
  await complete.getByRole("button", { name: "Complete action" }).click();
  await expect(actionRow(page, planned)).toContainText("Completed");
  await expect(resolvedOption(page)).toBeEnabled();
  await expect(needs).toHaveCount(0);

  await changeStatus(page, "Resolved", "Replaced the HDMI extender; the projector is stable.");

  // The History, oldest first: created, then each change in order.
  await page.getByRole("button", { name: /^History/ }).click();
  const history = page.getByRole("list", { name: "Status history, oldest first" });
  const lines = await history.getByRole("listitem").allInnerTexts();
  expect(lines[0]).toMatch(/created this ticket as\s+New/);
  expect(lines.at(-2)).toMatch(/moved this from\s+.+\s+to\s+In Progress/);
  expect(lines.at(-1)).toMatch(/moved this from\s+In Progress\s+to\s+Resolved/);
});

test("E2E-02 cancelling a Ticket with an open Action says so, and cancels the Action with it", async ({ page }) => {
  test.setTimeout(120_000);
  await newClaimedTicket(page, "Duplicate of an existing Wi-Fi report");
  const planned = "Check the access point logs in Building 4.";
  await planOpenAction(page, planned);

  await statusSelect(page).selectOption({ label: "Cancelled" });
  await page.getByRole("button", { name: "Change status", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Change status to Cancelled?" });
  await expect(dialog).toContainText("1 open action will also be cancelled.");
  await dialog.getByRole("textbox").fill("Duplicate of the earlier Building 4 report.");
  await dialog.getByRole("button", { name: "Change status to Cancelled" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Current status: Cancelled.")).toBeVisible();
  await expect(actionRow(page, planned)).toContainText("Cancelled");
});
