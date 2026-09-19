import { test, expect } from "@playwright/test";
import {
  ADMINISTRATOR,
  CAPTURE_REQUESTER,
  DEVELOPMENT_PASSWORD,
  REQUESTER,
  STAFF,
  VIEWPORTS,
  capture,
  createTicket,
  expectControlsUsable,
  signIn,
  signOut,
  submitSignIn,
  uniqueSummary,
} from "./support.js";

// RESP-01 — AC-24. Eight screens at three widths, with the pictures written to
// the paths ui-spec.md §13 names.
//
// The screenshots are the evidence; the assertions are the test. Nobody reviews
// twenty-four images pixel by pixel, so `capture` refuses to photograph a page
// that scrolls sideways or clips a label, and every screen is additionally swept
// for controls pushed outside the viewport and — on mobile — for touch targets
// under 44px. A regression fails the run instead of waiting to be noticed.

for (const viewport of VIEWPORTS) {
  test.describe(`${viewport.name} — ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test(`every Lab 3 screen holds together at ${viewport.name} width`, async ({ page }) => {
      // Six sign-ins, a Ticket, and eight captures.
      test.setTimeout(150_000);
      const name = viewport.name;

      // ---- Signed out: Login -------------------------------------------
      await page.goto("/login");
      await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "authentication", `login-${name}`);

      // ---- The mandatory password gate ---------------------------------
      // A dedicated account that is never taken past it, because by now every
      // other account has completed its gate and would show the voluntary form.
      await submitSignIn(page, CAPTURE_REQUESTER.email, DEVELOPMENT_PASSWORD);
      await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "authentication", `change-password-${name}`);
      await page.getByRole("button", { name: "Log out" }).click();
      await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();

      // ---- The authenticated shell -------------------------------------
      // Photographed on Create Ticket: it is the one screen carrying the full
      // frame — brand, both Requester nav items, the user's name, role badge,
      // Change password and Log out — that §13 does not capture elsewhere.
      await signIn(page, REQUESTER);
      await page.getByRole("button", { name: "Create Ticket" }).first().click();
      await expect(page.getByRole("heading", { name: "Create Ticket" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "authentication", `shell-${name}`);

      // ---- The two Requester screens Lab 3 changed ---------------------
      // A Ticket of this run's own, so both screens have real content at every
      // width rather than an empty state that would prove nothing about layout.
      const ticketNumber = await createTicket(page, {
        summary: uniqueSummary(`Monitor flickers at ${viewport.width}px`),
        relatedSystem: "Corporate Laptop",
      });

      await page.getByRole("link", { name: "View My Tickets" }).click();
      await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
      await expect(page.getByRole("link", { name: ticketNumber })).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "requester", `my-tickets-${name}`);

      await page.getByRole("link", { name: ticketNumber }).click();
      await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
      // §6's Lab 3 additions must be on screen for the capture to be evidence.
      await expect(page.getByText("Current Status")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Comments" })).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "requester", `ticket-detail-${name}`);
      await signOut(page);

      // ---- The two IT Staff screens -------------------------------------
      await signIn(page, STAFF);
      await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
      // The queue is the widest thing in the application: seven columns that
      // become one card per row below 767px.
      await expect(page.getByRole("row").filter({ hasText: ticketNumber })).toHaveCount(1);
      await expectControlsUsable(page, name);
      await capture(page, "staff-queue", name);

      await page.getByRole("link", { name: ticketNumber }).click();
      await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
      // The Work panel stacks beneath the ticket information below 992px (§10);
      // both regions must be present whichever way they are laid out.
      await expect(page.getByRole("heading", { name: "Ticket information" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Work" })).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "staff-ticket-detail", name);
      await signOut(page);

      // ---- User Management ---------------------------------------------
      await signIn(page, ADMINISTRATOR);
      await expect(page.getByRole("heading", { name: "User Management" })).toBeVisible();
      await expect(page.getByRole("table")).toBeVisible();
      await expectControlsUsable(page, name);
      await capture(page, "user-management", name);
    });
  });
}
