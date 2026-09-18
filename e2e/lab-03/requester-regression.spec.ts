import { test, expect } from "@playwright/test";
import {
  OTHER_REQUESTER,
  PNG_BYTES,
  REQUESTER,
  createTicket,
  signIn,
  signOut,
  ticketRecord,
  uniqueSummary,
} from "./support.js";

// E2E-04 — AC-10. The Lab 2 Requester journeys under a real session, with no
// selector anywhere.
//
// The four Lab 2 specs still exist and still run (`npm run e2e`); this is the
// Lab 3 statement of the same claim — that authentication replaced the
// Development Requester without changing what a Requester can do or see — plus
// the two things Lab 3 adds to their screens: Public Comments, and the fact that
// Internal Notes never reach them.

test("a Requester creates, finds and opens a Ticket with no selector in sight", async ({ page }) => {
  const summary = uniqueSummary("Printer in Room 401 jams on every job");

  await signIn(page, REQUESTER);
  // The retired selector is gone from the interface entirely (issue #48).
  await expect(page.getByRole("heading", { name: "Development Requester Selection" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change Requester" })).toHaveCount(0);

  // "Printer", from the seeded catalogue. An invented name here does not fail as
  // a bad fixture; it fails as a 45-second timeout that reads like a slow page.
  const ticketNumber = await createTicket(page, { summary, relatedSystem: "Printer" });
  await page.getByRole("link", { name: "View My Tickets" }).click();

  await page.getByLabel(/^Search/).fill(ticketNumber);
  await expect(page.getByText(/Showing 1–1 of 1/)).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: ticketNumber });
  await expect(row).toContainText(summary);

  await page.getByRole("link", { name: ticketNumber }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();

  // The ticket record stays read-only. Scoped to the record card because Lab 3
  // added a comment composer to this screen — a page-wide assertion would now be
  // false by design.
  const record = ticketRecord(page, ticketNumber);
  await expect(record.getByRole("textbox")).toHaveCount(0);
  await expect(record.getByRole("combobox")).toHaveCount(0);
});

test("an attachment survives upload and soft removal under a session", async ({ page }) => {
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary: uniqueSummary("Docking station drops the display") });
  await page.getByRole("link", { name: "Open this Ticket" }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();

  await page.getByLabel(/^Add an attachment/).setInputFiles({
    name: "dock-error.png",
    mimeType: "image/png",
    buffer: PNG_BYTES,
  });

  const item = page.getByRole("list", { name: "Attachments" }).getByRole("listitem").filter({ hasText: "dock-error.png" });
  await expect(item).toContainText("Active");

  await item.getByRole("button", { name: "Remove dock-error.png" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Remove dock-error.png?" });
  await dialog.getByLabel(/^Removal reason/).fill("Uploaded the wrong screenshot");
  await dialog.getByRole("button", { name: "Remove attachment" }).click();

  // Soft removal: the row stays with its reason, and the download is gone.
  await expect(item).toContainText("Removed");
  await expect(item).toContainText("Uploaded the wrong screenshot");
  await expect(item.getByRole("button", { name: /Download/ })).toHaveCount(0);
});

test("another Requester's Ticket is refused at the URL, in words that disclose nothing", async ({ page }) => {
  const summary = uniqueSummary("Payroll export fails at step three");

  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary });
  await page.getByRole("link", { name: "Open this Ticket" }).click();
  const ticketId = /\/tickets\/(\d+)/.exec(page.url())?.[1];
  expect(ticketId).toBeTruthy();

  await signOut(page);
  await signIn(page, OTHER_REQUESTER);

  await page.goto(`/tickets/${ticketId}`);
  await expect(page.getByRole("heading", { name: "Ticket not found" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "That Ticket could not be found. It may not exist, or it may belong to someone else",
  );

  // Nothing about the other Requester's Ticket leaks into the refusal.
  await expect(page.getByText(summary)).toHaveCount(0);
  await expect(page.getByText(ticketNumber)).toHaveCount(0);
  await expect(page.getByText(REQUESTER.fullName)).toHaveCount(0);
});

test("a Requester is offered no Internal Notes control and asks for none", async ({ page }) => {
  // AC-04, BR-34. A negative claim, so it is swept rather than spot-checked: the
  // screen must neither render the control nor request the endpoint.
  const requested: string[] = [];
  page.on("request", (request) => requested.push(new URL(request.url()).pathname));

  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary: uniqueSummary("Shared drive is read-only") });
  await page.getByRole("link", { name: "Open this Ticket" }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();

  // The Comments panel is there; the notes panel is not.
  await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Internal notes/ })).toHaveCount(0);
  await expect(page.getByLabel(/^Internal note/)).toHaveCount(0);

  expect(requested.some((path) => path.includes("internal-notes"))).toBe(false);
});
