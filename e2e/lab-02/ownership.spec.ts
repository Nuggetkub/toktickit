import { test, expect } from "@playwright/test";
import {
  EMAIL_A,
  EMAIL_B,
  REQUESTER_A,
  createTicket,
  signIn,
  signOut,
  ticketIdFromUrl,
  uniqueSummary,
} from "./support.js";

// E2E-02 — AC-08, AC-12. Signing in as another Requester must not merely hide
// the first one's Tickets in the interface: the URL has to be refused as well,
// which is the part a screenshot of a filtered list can never demonstrate.
//
// Updated for issue #48: identity is a real session, so the two requesters are
// separated by signing out and back in rather than by switching a selector.

test("signing in as another Requester hides the first one's Tickets, and their URL is refused", async ({ page }) => {
  const summary = uniqueSummary("Printer jams on duplex jobs");

  await signIn(page, EMAIL_A);
  const ticketNumber = await createTicket(page, { summary, relatedSystem: "Printer" });

  await page.getByRole("link", { name: "Open this Ticket" }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
  const ticketId = ticketIdFromUrl(page);

  // Through the controls a user would use, not by editing storage — and the
  // session really ends, which is the stronger claim the selector never made.
  await signOut(page);
  await signIn(page, EMAIL_B);

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
  await signIn(page, EMAIL_B);

  await page.goto("/tickets/98765432");
  await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
  // Identical wording to the cross-owner refusal above: if the two differed, the
  // difference would itself disclose which ids are real (D-04, BR-19).
  await expect(page.getByRole("alert")).toContainText(
    "That Ticket could not be found. It may not exist, or it may belong to someone else",
  );
});

test("opening a requester-scoped URL while signed out shows Login", async ({ page }) => {
  // AC-02, checked at the URL rather than at a component boundary. Issue #48
  // replaced the selector with a session, so the answer to "who are you?" is now
  // Login rather than a dropdown — and nothing of the list may render behind it.
  await page.goto("/tickets");

  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});
