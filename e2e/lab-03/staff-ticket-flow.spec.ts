import { test, expect } from "@playwright/test";
import {
  REQUESTER,
  STAFF,
  createTicket,
  openInQueue,
  signIn,
  signOut,
  uniqueSummary,
} from "./support.js";

// E2E-02 — AC-13 … AC-19. One Ticket carried from raised to closed by the people
// who really do it, through the screens they really use.
//
// The queue is shared with every other spec in this run, so nothing here asserts
// an absolute count: each claim is scoped to one Ticket Number this test owns.
// (The same rule the staff-queue API suite follows — an absolute total passes
// alone and fails in the suite.)

test("the queue finds a Ticket by number, by status and by owner", async ({ page }) => {
  // AC-13. The filters are proven by what they *exclude*, not only by what they
  // return: a filter that matched everything would pass a presence-only check.
  const summary = uniqueSummary("Lecture hall speakers crackle");

  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary, relatedSystem: "Campus Wi-Fi" });
  await signOut(page);

  await signIn(page, STAFF);
  const row = page.getByRole("row").filter({ hasText: ticketNumber });

  await page.getByLabel(/^Search/).fill(ticketNumber);
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(summary);
  // A new Ticket arrives unowned and in words, never by colour alone (BR-33).
  await expect(row).toContainText("New");
  await expect(row).toContainText("Unassigned");

  // Still matching when the filter agrees with the Ticket…
  await page.getByLabel(/^Status/).selectOption({ label: "New" });
  await expect(row).toHaveCount(1);
  await page.getByLabel(/^Owner/).selectOption("unassigned");
  await expect(row).toHaveCount(1);

  // …and gone when it does not. Nobody has said this one is resolved.
  await page.getByLabel("Requester says resolved").check();
  await expect(row).toHaveCount(0);

  // Scoped to the toolbar. Emptying the queue is exactly what this filter is
  // supposed to do, and the empty state offers a Clear filters button of its
  // own, so a page-wide query legitimately matches two. The toolbar carries
  // role="search", which names it precisely.
  await page.getByRole("search").getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Requester says resolved")).not.toBeChecked();
  await expect(page.getByLabel(/^Search/)).toHaveValue("");
});

test("a Ticket is claimed, prioritised, worked, indicated, resolved and closed", async ({ page }) => {
  // The whole lifecycle in one run, because that is what E2E-02 claims: each
  // step's precondition is the previous step's result, and splitting it would
  // mean re-manufacturing that state through the API instead of the screens.
  // Six sign-ins and eleven writes do not fit the default 45s budget.
  test.setTimeout(150_000);

  const summary = uniqueSummary("Payroll server unreachable from the annexe");
  const publicComment = "We have reproduced this and are working on it now.";
  const internalNote = "Root cause looks like the annexe switch uplink — do not tell the requester yet.";
  const resolutionSummary = "Replaced the failed uplink module in the annexe switch and confirmed payroll access.";

  // ---- The Requester raises it -------------------------------------------
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary, relatedSystem: "Corporate Laptop" });
  await signOut(page);

  // ---- IT Staff claim it and start work (AC-14, AC-15, AC-16) ------------
  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);

  // Scoped to the header summary. "Unassigned" is also the Owner select's empty
  // option, so a page-wide text query matches two elements — and asserting the
  // element that *states* the owner is the stronger claim anyway.
  const ownerSummary = page.locator(".zen-detail-header__owner");
  await expect(ownerSummary).toHaveText("Unassigned");
  await page.getByRole("button", { name: "Claim" }).click();
  await expect(page.getByText("You now own this ticket.")).toBeVisible();
  await expect(ownerSummary).toHaveText(`Owner: ${STAFF.fullName}`);
  // Claiming does not move the Ticket: ownership and status are separate rules.
  await expect(page.getByLabel(/^Status/)).toHaveValue("");

  // AC-15 — IT Priority is IT's own scale, independent of what was requested.
  await page.getByLabel(/^IT Priority/).selectOption("URGENT");
  await page.getByRole("button", { name: "Save priority" }).click();
  await expect(page.getByText("IT Priority updated")).toBeVisible();

  // AC-16 — BR-29 offers only what NEW permits; the six it forbids are absent,
  // which is the claim ui-spec §8 makes about this control.
  const statusControl = page.getByLabel(/^Status/);
  await expect(statusControl.locator("option")).toHaveText([
    "Choose a new status",
    "Open",
    "In Progress",
    "Cancelled",
  ]);

  await statusControl.selectOption({ label: "In Progress" });
  await page.getByRole("button", { name: "Change status" }).click();
  // In Progress is not one of BR-31's confirmed transitions, so it applies
  // without a dialog.
  //
  // Scoped to the notice element: BR-30 also posts the change into the thread,
  // so these words legitimately appear twice on this screen. Issue #53 lost five
  // tests to exactly this ambiguity.
  await expect(page.getByRole("status")).toContainText("Status changed to In Progress");

  // ---- A public comment and a private note (AC-17, AC-18) ----------------
  //
  // By role, not by label: `getByLabel` matches every labelled element, and the
  // tab panel is labelled by its tab ("Public comments (0)"), so a label query
  // here resolves to both the panel and the composer inside it.
  await page.getByRole("textbox", { name: "Public comment" }).fill(publicComment);
  await page.getByRole("button", { name: "Post public comment" }).click();
  await expect(page.getByRole("list", { name: "Public comments" })).toContainText(publicComment);

  await page.getByRole("tab", { name: /^Internal notes/ }).click();
  await page.getByRole("textbox", { name: "Internal note" }).fill(internalNote);
  await page.getByRole("button", { name: "Add internal note" }).click();
  await expect(page.getByRole("list", { name: /^Internal notes/ })).toContainText(internalNote);
  await signOut(page);

  // ---- The Requester sees one of them, and says it looks fixed -----------
  await signIn(page, REQUESTER);
  await page.getByLabel(/^Search/).fill(ticketNumber);
  await page.getByRole("link", { name: ticketNumber }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();

  // AC-17 and AC-18 side by side: the comment reached them, the note did not,
  // and the work IT did is visible in words.
  await expect(page.getByText(publicComment)).toBeVisible();
  await expect(page.getByText(internalNote)).toHaveCount(0);
  // The badge rather than the bare words: "In Progress" also appears in the
  // thread's own "Status changed to" marker, and asserting where the status is
  // shown is the stronger claim in any case.
  await expect(page.locator(".zen-badge--status-progress")).toHaveText("In Progress");
  await expect(page.getByText(STAFF.fullName).first()).toBeVisible();

  // AC-19 — BR-32's indication is a message, not a transition.
  await page.getByRole("button", { name: "Problem Appears Resolved" }).click();
  await expect(page.getByRole("heading", { name: "Tell IT Staff the problem appears resolved?" })).toBeVisible();
  await page.getByRole("button", { name: "Tell IT Staff" }).click();
  await expect(page.getByText(/^You told IT Staff the problem appears resolved on /)).toBeVisible();
  // The status is deliberately untouched — the screen must not suggest IT has
  // resolved anything yet.
  await expect(page.locator(".zen-badge--status-progress")).toHaveText("In Progress");
  await signOut(page);

  // ---- IT Staff see the marker, resolve and close (AC-19, AC-16) ---------
  await signIn(page, STAFF);
  await page.getByLabel(/^Search/).fill(ticketNumber);
  const queueRow = page.getByRole("row").filter({ hasText: ticketNumber });
  await expect(queueRow).toContainText("Requester says resolved");
  await queueRow.getByRole("link", { name: ticketNumber }).click();
  await expect(page.getByText(`${REQUESTER.fullName} says the problem appears resolved`)).toBeVisible();

  // Resolving is confirmed and carries evidence (BR-30, BR-31).
  await page.getByLabel(/^Status/).selectOption({ label: "Resolved" });
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByRole("heading", { name: "Change status to Resolved?" })).toBeVisible();
  await page.getByLabel(/^Resolution summary/).fill(resolutionSummary);
  await page.getByRole("button", { name: "Change status to Resolved" }).click();
  await expect(page.getByRole("status")).toContainText("Status changed to Resolved");

  // BR-30: the summary is posted to the Requester as a public comment in the
  // same transaction, labelled with the change it accompanied.
  const thread = page.getByRole("list", { name: "Public comments" });
  await expect(thread).toContainText(resolutionSummary);
  await expect(thread).toContainText("Status changed to Resolved");

  // Closing is confirmed but needs no evidence of its own.
  await page.getByLabel(/^Status/).selectOption({ label: "Closed" });
  await page.getByRole("button", { name: "Change status" }).click();
  await expect(page.getByRole("heading", { name: "Change status to Closed?" })).toBeVisible();
  await page.getByRole("button", { name: "Change status to Closed" }).click();
  await expect(page.getByRole("status")).toContainText("Status changed to Closed");

  // BR-27 — terminal means frozen, and the screen says so rather than leaving
  // controls that would be refused.
  await expect(page.getByText("This ticket is closed and can no longer be changed.")).toBeVisible();
  await expect(page.getByLabel(/^Status/)).toBeDisabled();
  // The composer, not the panel: the tab panel survives a freeze and keeps its
  // label, so a `getByLabel` count here would be 1 even when the composer has
  // correctly gone — the assertion would fail while the rule held.
  await expect(page.getByRole("textbox", { name: "Public comment" })).toHaveCount(0);
  await expect(page.getByText("This ticket is closed, so no new comment can be posted.")).toBeVisible();
});
