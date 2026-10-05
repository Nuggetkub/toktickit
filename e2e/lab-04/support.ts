import { test as base, expect, type Page } from "@playwright/test";
import path from "node:path";
import {
  expectControlsUsable,
  expectNoHorizontalOverflow,
  expectNothingClipped,
  type Account,
} from "../lab-03/support";

// Shared steps for the Lab 4 browser suite (issue #90). Signing in, the password
// gate, the queue and the layout checks are Lab 3's, imported rather than
// copied: the two suites sign in identically, and a copy would drift.
export {
  ADMINISTRATOR,
  API_ORIGIN,
  REQUESTER,
  STAFF,
  createTicket,
  expectControlsUsable,
  openInQueue,
  openMyTickets,
  openQueue,
  signIn,
  signOut,
  uniqueSummary,
  type Account,
} from "../lab-03/support";

/** More seeded accounts (server/src/seed-data.ts) the Lab 4 journeys need. */
export const COLLEAGUE: Account = { email: "daniel.reyes@toktickit.local", fullName: "Daniel Reyes", landing: "Dashboard" };
/** Deactivated in the seed: never offered as an Action assignee (BR-06). */
export const INACTIVE_STAFF = { email: "wichai.boonmee@toktickit.local", fullName: "Wichai Boonmee (on leave)" };
/** A Requester the demo seed gives no Tickets: the empty Requester Dashboard. */
export const EMPTY_REQUESTER: Account = { email: "ananya.wong@toktickit.local", fullName: "Ananya Wong", landing: "Dashboard" };

/**
 * Every test fails on an application console error or warning, an uncaught page
 * error, or an HTTP failure it did not declare (ui-spec §9: "No console error
 * during the full E2E run"; AC-28).
 *
 * Chromium also logs "Failed to load resource" for every 4xx and 5xx, including
 * the ones a test provokes on purpose (a forged request, a forced 500). Those
 * lines are the browser's report of a response, so the response itself is what
 * is checked: each must match something the test declared with `expectHttp`
 * before provoking it. Two are declared for every test, both from signing in:
 * `GET /api/auth/me` answering 401 before anyone is signed in (the Lab 3
 * contract, tests.md §7), and `POST /api/auth/login` answering 401 when the
 * shared sign-in helper first tries the development password on an account
 * this run has already rotated, as it is written to.
 */
export const test = base.extend<{ expectHttp: (method: string, pathPattern: RegExp, status: number) => void }>({
  expectHttp: [
    async ({ page }, use) => {
      const declared = [
        { method: "GET", pathPattern: /^\/api\/auth\/me$/, status: 401 },
        { method: "POST", pathPattern: /^\/api\/auth\/login$/, status: 401 },
      ];
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() !== "error" && message.type() !== "warning") return;
        if (message.text().startsWith("Failed to load resource")) return; // checked by its response below
        problems.push(`console.${message.type()}: ${message.text()}`);
      });
      page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
      page.on("response", (response) => {
        if (response.status() < 400) return;
        const method = response.request().method();
        const pathname = new URL(response.url()).pathname;
        const expected = declared.some((d) => d.method === method && d.status === response.status() && d.pathPattern.test(pathname));
        if (!expected) problems.push(`undeclared HTTP ${response.status()}: ${method} ${pathname}`);
      });
      await use((method, pathPattern, status) => declared.push({ method, pathPattern, status }));
      expect(problems, "console errors, page errors and undeclared HTTP failures").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

const SCREENSHOT_ROOT = "artifacts/lab-04/screenshots";

/**
 * Writes a screenshot to the path ui-spec §9 names, after asserting the page is
 * usable at this width: no page-level horizontal scroll, no clipped label, every
 * control inside the viewport, and 44 px targets on mobile (RESP-01).
 */
export async function capture(page: Page, viewport: string, file: string): Promise<void> {
  // Named on failure: which width, and which elements stick out past the edge.
  const overflow = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    return {
      by: document.documentElement.scrollWidth - width,
      culprits: Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => el.getBoundingClientRect().right > width + 1)
        .slice(0, 6)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ").join(".")} "${(el.textContent ?? "").trim().slice(0, 30)}"`),
    };
  });
  expect(overflow.by, `${file} at ${viewport}: the page scrolls sideways; past the edge: ${overflow.culprits.join(" | ")}`).toBeLessThanOrEqual(1);
  await expectNoHorizontalOverflow(page);
  await expectNothingClipped(page);
  await expectControlsUsable(page, viewport);
  // Two defects the eye found that the checks above could not: a badge broken
  // across lines (wrapped text does not overflow, so it is not "clipped"), and
  // a checkbox stretched across its row.
  const broken = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".zen-badge"))
      .filter((el) => {
        const style = getComputedStyle(el);
        const line = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5;
        const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
        return el.offsetParent !== null && el.getBoundingClientRect().height > line + chrome + 2;
      })
      .map((el) => el.textContent?.trim() ?? ""),
  );
  expect(broken, `${file}: badges broken across lines`).toEqual([]);
  const stretched = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"], input[type="radio"]'))
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().width > 32)
      .map((el) => el.closest("label")?.textContent?.trim() ?? el.name),
  );
  expect(stretched, `${file}: checkboxes or radios stretched`).toEqual([]);
  if (viewport === "mobile") {
    // Below 768 px each table cell is a label-and-value row (display: flex), so
    // a cell whose value is more than one node splits into extra columns.
    const split = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>(".zen-table td"))
        .filter((td) => getComputedStyle(td).display === "flex")
        .filter((td) => Array.from(td.childNodes).filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.textContent!.trim() !== "")).length > 1)
        .map((td) => `${td.dataset.label}: "${(td.textContent ?? "").trim().slice(0, 30)}"`),
    );
    expect(split, `${file}: mobile table cells split into columns`).toEqual([]);
  }
  await page.screenshot({ path: path.join(SCREENSHOT_ROOT, file), fullPage: true });
}

/** The number a dashboard link states in its accessible name, e.g. "Unassigned: 3 tickets". */
export async function countIn(page: Page, name: RegExp): Promise<number> {
  const link = page.getByRole("link", { name });
  const label = (await link.getAttribute("aria-label")) ?? (await link.innerText());
  // The count follows the colon: "Resolved in the last 7 days: 3 tickets" is 3, not 7.
  const match = label.match(/:\s*(\d+)/);
  if (!match) throw new Error(`No count in "${label}"`);
  return Number(match[1]);
}

/**
 * The total a list states after a drill-down: "Showing 1–10 of 23 tickets" on
 * the Queue and My Tickets. A list with nothing in it says so instead, and
 * counts as 0 only if its empty state is on screen.
 */
export async function listedTotal(page: Page): Promise<number> {
  const showing = page.getByText(/^Showing \d+–\d+ of \d+/);
  // The four empty states' exact titles (StaffTicketQueue.tsx, MyTickets.tsx).
  const empty = page.getByText(
    /^(No tickets match your search or filters\.|There are no tickets yet\.|No Tickets match your search or filters\.|You have not created any Tickets yet\.)$/,
  );
  await expect(showing.or(empty).first()).toBeVisible();
  if (await showing.count()) {
    const text = await showing.first().innerText();
    return Number(text.match(/of (\d+)/)![1]);
  }
  return 0;
}

/** Creates an Action through the real API from inside the page, as the signed-in user. */
export async function apiCreateAction(page: Page, ticketId: number, body: Record<string, unknown>): Promise<{ status: number; json: any }> {
  return page.evaluate(
    async ({ origin, id, payload }) => {
      const response = await fetch(`${origin}/api/tickets/${id}/actions`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(payload),
      });
      return { status: response.status, json: await response.json() };
    },
    { origin: process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3101", id: ticketId, payload: body },
  );
}

/** The id of the Ticket whose detail is open, from the URL (/queue/:id or /tickets/:id). */
export function ticketIdFromUrl(page: Page): number {
  const match = new URL(page.url()).pathname.match(/\/(?:queue|tickets)\/(\d+)/);
  if (!match) throw new Error(`Not on a Ticket Detail: ${page.url()}`);
  return Number(match[1]);
}

/** The Actions taken card on either Ticket Detail screen, and one of its rows. */
export const actionsCard = (page: Page) => page.locator(".zen-card").filter({ has: page.getByRole("heading", { name: /^Actions taken/ }) });
export const actionRow = (page: Page, description: string) => actionsCard(page).getByRole("row").filter({ hasText: description });

/** Opens the Add action form and fills it, as the signed-in member of staff. Returns the form. */
export async function addAction(page: Page, fields: { open?: boolean; description: string; result?: string; assignee?: string }) {
  await actionsCard(page).getByRole("button", { name: "Add action" }).click();
  const form = page.locator("form.zen-action-form");
  await expect(form).toBeVisible();
  if (fields.open) await form.getByLabel("Plan open work").check();
  await form.getByLabel(/^Description/).fill(fields.description);
  if (fields.result) await form.getByLabel(/^Result/).fill(fields.result);
  if (fields.assignee) await form.getByLabel(/^Assignee/).selectOption({ label: fields.assignee });
  return form;
}
