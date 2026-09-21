import { test, expect } from "@playwright/test";
import { EMAIL_A, REQUESTER_A, createTicket, signIn, uniqueSummary } from "./support.js";

// E2E-01 — AC-04, AC-08. Select a Requester, raise a Ticket, read the official
// number off the success screen, then find that number in My Tickets.

test("a created Ticket keeps its official number and appears in My Tickets", async ({ page }) => {
  const summary = uniqueSummary("Campus Wi-Fi drops in Building 4");

  await signIn(page, EMAIL_A);
  const ticketNumber = await createTicket(page, { summary, priority: "HIGH" });

  // The success screen shows what the server assigned, not what the form held —
  // once in the confirmation sentence and again as the read-only Ticket Number.
  await expect(page.getByText(ticketNumber)).toHaveCount(2);
  await expect(page.getByText("NEW")).toBeVisible();

  await page.getByRole("link", { name: "View My Tickets" }).click();
  await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();

  // Found by searching for the number, so the assertion is about the list the
  // API returned rather than about a row that happened to be on screen.
  await page.getByLabel("Search").fill(ticketNumber);

  // The count proves the search filtered rather than merely that the Ticket is
  // somewhere on the page: one match, and the header row.
  await expect(page.getByText(/Showing 1–1 of 1 Ticket/)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: ticketNumber });
  await expect(row).toHaveCount(1);
  await expect(page.getByRole("row")).toHaveCount(2);
  await expect(row).toContainText(summary);
  await expect(row).toContainText("Campus Wi-Fi");
  await expect(row).toContainText("HIGH");
});

test("the Ticket opens from the list with the description the list omits", async ({ page }) => {
  const summary = uniqueSummary("VPN disconnects every few minutes");
  const description = "The VPN client drops the tunnel roughly every ten minutes from the library building.";

  await signIn(page, EMAIL_A);
  const ticketNumber = await createTicket(page, { summary, description, relatedSystem: "VPN" });

  await page.getByRole("link", { name: "Open this Ticket" }).click();

  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
  await expect(page.getByText(description)).toBeVisible();
  await expect(page.getByText(REQUESTER_A).first()).toBeVisible();

  // Read-only: none of the ticket's values sits in an editable control.
  //
  // Scoped to the ticket card rather than the page, and narrowed deliberately
  // rather than weakened. Lab 3 issue #53 added a Public Comments composer to
  // this screen — a real <textarea> — so the original page-wide
  // `getByRole("textbox")).toHaveCount(0)` became false by design: each change
  // was green alone and broke together, the same semantic merge conflict I
  // raised on Earth2509's Lab 2 PR #33.
  //
  // The claim Lab 2 actually makes is that the ticket *record* is read-only, and
  // that is still true. Relaxing the count to "at most one" would instead pass
  // even if a ticket field became editable.
  const record = page.locator(".zen-card").filter({
    has: page.getByRole("heading", { name: `Ticket ${ticketNumber}` }),
  });
  await expect(record.getByRole("textbox")).toHaveCount(0);
  await expect(record.getByRole("combobox")).toHaveCount(0);

  // And the composer really is the one editable thing on the screen, so the
  // scoping above cannot quietly start passing because the panel disappeared.
  await expect(page.getByLabel(/^Add a comment/)).toBeVisible();
});
