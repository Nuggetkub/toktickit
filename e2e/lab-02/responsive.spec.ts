import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { PNG_BYTES, REQUESTER_A, createTicket, selectRequester, uniqueSummary } from "./support.js";

// RESP-01 — AC-16. Create Ticket, My Tickets and Ticket Detail at the three
// widths the labsheet names, with a screenshot of each.
//
// The screenshots are evidence for Part 9, but they are not the test: an image
// proves nothing on its own, and nobody reviews nine of them pixel by pixel. Each
// capture is paired with assertions that a person would otherwise have to make by
// eye — no page-level horizontal scrolling, no clipped label, no control hidden
// or overlapped — so a regression fails the run rather than waiting to be noticed
// in a picture.

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;

const SCREENSHOT_ROOT = "artifacts/lab-02/screenshots";

for (const viewport of VIEWPORTS) {
  test(`the three screens stay usable at ${viewport.name} width`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });

    const summary = uniqueSummary(`Responsive ${viewport.name} check`);
    await selectRequester(page, REQUESTER_A);

    // ---- Create Ticket -----------------------------------------------------
    await page.getByRole("button", { name: "Create Ticket" }).first().click();
    await expect(page.getByRole("heading", { name: "Create Ticket" })).toBeVisible();
    await expect(page.getByLabel("Category")).toBeEnabled();
    await assertUsable(page, viewport.name, ["Category", "Related System", "Ticket Summary", "Description"]);
    await capture(page, "create-ticket", viewport.name);

    // ---- My Tickets --------------------------------------------------------
    const ticketNumber = await createTicket(page, { summary });
    await page.getByRole("link", { name: "View My Tickets" }).click();
    await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
    await page.getByLabel("Search").fill(ticketNumber);
    // Wait for the debounced search to actually land. Asserting only that the
    // matching row exists would pass against the *unfiltered* list, and the
    // screenshot would then show a search box with every Ticket still under it —
    // evidence of something that never happened.
    await expect(page.getByText(/Showing 1–1 of 1 Ticket/)).toBeVisible();
    await expect(page.getByRole("row")).toHaveCount(2);
    await assertUsable(page, viewport.name, ["Search", "Category", "Sort"]);
    await capture(page, "my-tickets", viewport.name);

    // ---- Ticket Detail, with an attachment so the section is not empty ------
    await page.getByRole("link", { name: ticketNumber }).click();
    await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
    await page.getByLabel("Add an attachment").setInputFiles({
      name: "evidence-of-the-fault.png",
      mimeType: "image/png",
      buffer: PNG_BYTES,
    });
    await expect(page.getByRole("list", { name: "Attachments" })).toContainText("evidence-of-the-fault.png");

    // A long filename is where an attachment row overflows if it is going to.
    await assertUsable(page, viewport.name, ["Add an attachment"]);
    await assertAttachmentNameReadable(page);
    await capture(page, "ticket-detail", viewport.name);
  });
}

/**
 * The visual-inspection checklist from ui-spec.md §11, as assertions.
 *
 * "No clipped labels" and "no hidden buttons" are checked by measuring: a label
 * whose scroll width exceeds its client width is clipped, and a control with no
 * box, or one smaller than a usable touch target on mobile, is not operable.
 */
async function assertUsable(page: Page, viewport: string, labels: string[]): Promise<void> {
  await expectNoHorizontalOverflow(page);

  for (const label of labels) {
    // Not an exact match: a required field's <label> carries a decorative
    // asterisk after the text, so "Category" is the substring a reader sees
    // rather than the whole of the element's text.
    const control = page.getByLabel(label).first();
    await expect(control, `${label} is missing at ${viewport} width`).toBeVisible();

    const box = await control.boundingBox();
    expect(box, `${label} has no layout box at ${viewport} width`).not.toBeNull();
    // 44px is the touch target the ui-spec asks for below 768px. Above it, a
    // control under 24px tall is a rendering accident rather than a design.
    const minimumHeight = viewport === "mobile" ? 44 : 24;
    expect(box!.height, `${label} is only ${box!.height}px tall at ${viewport} width`).toBeGreaterThanOrEqual(
      minimumHeight,
    );
  }

  // Labels are what get clipped first when a column narrows.
  const clipped = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".zen-field__label, .zen-card__title, .zen-table th"))
      .filter((element) => element.scrollWidth - element.clientWidth > 1)
      .map((element) => element.textContent?.trim() ?? ""),
  );
  expect(clipped, `clipped labels at ${viewport} width`).toEqual([]);

  // A primary action that has scrolled under the header, or off the viewport, is
  // "hidden" in the sense the checklist means.
  const offscreen = await page.evaluate(() => {
    const width = window.innerWidth;
    return Array.from(document.querySelectorAll<HTMLElement>("button:not([disabled]), .zen-button"))
      .map((element) => ({ text: element.textContent?.trim() ?? "", rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > width + 1))
      .map(({ text }) => text);
  });
  expect(offscreen, `controls outside the viewport at ${viewport} width`).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  // The page itself must never scroll sideways. A wide element may scroll inside
  // its own container — that is what .zen-table-wrap is for — so this measures
  // the document, not its contents.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(1);
}

/** "Attachment names remain readable" — the name wraps rather than overflowing. */
async function assertAttachmentNameReadable(page: Page): Promise<void> {
  const overflowing = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".zen-attachment__name"))
      .filter((element) => element.scrollWidth - element.clientWidth > 1)
      .map((element) => element.textContent?.trim() ?? ""),
  );
  expect(overflowing, "attachment names are cut off").toEqual([]);
}

/**
 * Written to the path ui-spec.md §11 documents, and committed. Evidence that
 * lives only in an ignored output directory is evidence nobody can open from the
 * repository.
 */
async function capture(page: Page, screen: string, viewport: string): Promise<void> {
  await page.screenshot({ path: path.join(SCREENSHOT_ROOT, screen, `${viewport}.png`), fullPage: true });
}
