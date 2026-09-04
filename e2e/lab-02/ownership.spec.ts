import { test, expect } from "@playwright/test";
import {
  REQUESTER_A,
  REQUESTER_B,
  createTicket,
  selectRequester,
  ticketIdFromUrl,
  uniqueSummary,
} from "./support.js";

// E2E-02 — AC-08, AC-12. Switching Requester must not merely hide another
// Requester's Tickets in the interface: the URL has to be refused as well, which
// is the part a screenshot of a filtered list can never demonstrate.

test("switching Requester removes the first Requester's Tickets, and their URL is refused", async ({ page }) => {
  const summary = uniqueSummary("Printer jams on duplex jobs");

  await selectRequester(page, REQUESTER_A);
  const ticketNumber = await createTicket(page, { summary, relatedSystem: "Printer" });

  await page.getByRole("link", { name: "Open this Ticket" }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
  const ticketId = ticketIdFromUrl(page);

  // Change Requester through the control a user would use, not by editing storage.
  await page.getByRole("button", { name: "Change Requester" }).click();
  await expect(page.getByRole("heading", { name: "Development Requester Selection" })).toBeVisible();
  await selectRequester(page, REQUESTER_B);

  // The list is scoped by identity, so searching for the other Requester's
  // Ticket Number finds nothing — and says so as a no-results message rather
  // than as an empty account.
  await page.getByLabel("Search").fill(ticketNumber);
  await expect(page.getByText("No Tickets match your search or filters.")).toBeVisible();
  await expect(page.getByText(summary)).toHaveCount(0);

  // The direct URL is the real test. B knows the id and asks for it anyway.
  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("could not be found");

  // Nothing about A's Ticket leaks into the refusal — not the summary, not the
  // number, not the owner's name.
  await expect(page.getByText(summary)).toHaveCount(0);
  await expect(page.getByText(ticketNumber)).toHaveCount(0);
  await expect(page.getByText(REQUESTER_A)).toHaveCount(0);
});

test("a Ticket that never existed is refused in exactly the same words", async ({ page }) => {
  await selectRequester(page, REQUESTER_B);

  await page.goto("/tickets/98765432");
  await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
  // Identical wording to the cross-owner refusal above: if the two differed, the
  // difference would itself disclose which ids are real (D-04).
  await expect(page.getByRole("alert")).toContainText(
    "That Ticket could not be found. It may not exist, or it may belong to a different Development Requester.",
  );
});

test("opening a requester-scoped URL with no Requester selected shows the selector", async ({ page }) => {
  // AC-02, checked at the URL rather than at a component boundary.
  await page.goto("/select-requester");
  await page.evaluate(() => window.localStorage.clear());

  await page.goto("/tickets");
  await expect(page.getByRole("heading", { name: "Development Requester Selection" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
