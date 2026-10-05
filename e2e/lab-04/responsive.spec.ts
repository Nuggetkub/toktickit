import {
  ADMINISTRATOR,
  API_ORIGIN,
  EMPTY_REQUESTER,
  REQUESTER,
  STAFF,
  actionRow,
  actionsCard,
  addAction,
  capture,
  createTicket,
  expect,
  openInQueue,
  openQueue,
  openMyTickets,
  signIn,
  signOut,
  test,
  ticketIdFromUrl,
  uniqueSummary,
} from "./support";
import { VIEWPORTS } from "../lab-03/support";
import type { Page } from "@playwright/test";

// RESP-01 in docs/lab-04/tests.md (AC-28): both dashboards, both Actions
// sections, the Action form and the resolution-blocked state at 1440×900,
// 834×1112 and 390×844, written to the paths ui-spec §9 names. `capture` fails
// the run first if the page scrolls sideways, clips a label, pushes a control
// out of view or (on mobile) offers a target under 44 px; the console guard in
// support.ts fails it on any console error.

test.describe.configure({ mode: "serial" });

let ticketNumber = "";
// Long on purpose: ui-spec §7 says long Action text wraps and never widens the table.
const LONG = "Traced the intermittent drop to the second-floor switch, replaced the uplink module, re-terminated both patch cables at the wall plate, and confirmed a clean link for thirty minutes under load from three laptops at once.";
const PLANNED = "Replace the wall plate in room 204 next visit.";

const openDashboard = async (page: Page) => {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText("Loading dashboard…")).toHaveCount(0);
};

test("RESP-01 fixture: an In Progress Ticket with a long completed Action and an open one", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, REQUESTER);
  ticketNumber = await createTicket(page, { summary: uniqueSummary("Second-floor Wi-Fi drops every afternoon") });
  await signOut(page);
  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);
  await page.getByRole("button", { name: "Claim", exact: true }).click();
  // The claim's answer resets the Work panel, so choose a status only after it lands.
  await expect(page.getByLabel("Owner")).toHaveValue(/\d+/);
  await page.getByLabel("Status", { exact: true }).selectOption({ label: "In Progress" });
  await page.getByRole("button", { name: "Change status", exact: true }).click();
  await expect(page.getByText("Current status: In Progress.")).toBeVisible();
  let form = await addAction(page, { description: LONG, result: "Link stable under load; the user confirmed by phone." });
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(actionRow(page, "Traced the intermittent drop")).toContainText("Completed");
  form = await addAction(page, { open: true, description: PLANNED });
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(actionRow(page, PLANNED)).toContainText("Open");
});

test("RESP-01 IT Staff: the dashboard, the Actions section, the form, and the resolution-blocked state", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, STAFF);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openDashboard(page);
    await capture(page, viewport.name, `staff-dashboard/staff-${viewport.name}.png`);

    await openInQueue(page, ticketNumber);
    await expect(actionRow(page, PLANNED)).toBeVisible();
    // The long description wraps inside its cell rather than widening the page.
    await capture(page, viewport.name, `actions-taken/staff-list-${viewport.name}.png`);
    if (viewport.name === "desktop") {
      await expect(page.locator("#work-status-needs")).toContainText("Complete or cancel 1 open action");
      await capture(page, viewport.name, "actions-taken/resolution-blocked-desktop.png");
    }

    const form = await addAction(page, { open: true, description: "Check the replacement wall plate's continuity." });
    await form.getByLabel("Follow-up required").check();
    await expect(form.getByLabel(/^Follow-up note/)).toBeVisible();
    await capture(page, viewport.name, `actions-taken/staff-form-${viewport.name}.png`);
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(form).toHaveCount(0);
  }
});

test("RESP-01 Administrator: the dashboard with User accounts", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMINISTRATOR);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openDashboard(page);
    await expect(page.getByRole("heading", { name: "User accounts" })).toBeVisible();
    await capture(page, viewport.name, `staff-dashboard/administrator-${viewport.name}.png`);
  }
});

test("RESP-01 Requester: a populated dashboard, and the Actions section read-only", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, REQUESTER);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openDashboard(page);
    // One column at every width: the panels sit below the cards, left-aligned
    // with them, never beside them (ui-spec §3; the #104 grid-area regression).
    const layout = await page.evaluate(() => {
      const cards = document.querySelector(".zen-metrics")!.closest(".zen-card")!.getBoundingClientRect();
      const lists = document.querySelector(".zen-dashboard__lists")!.getBoundingClientRect();
      return { cardsLeft: cards.left, cardsBottom: cards.bottom, cardsWidth: cards.width, listsLeft: lists.left, listsTop: lists.top, listsWidth: lists.width };
    });
    expect(Math.abs(layout.listsLeft - layout.cardsLeft), `panels left-aligned with the cards at ${viewport.name}`).toBeLessThanOrEqual(1);
    expect(layout.listsTop, `panels below the cards at ${viewport.name}`).toBeGreaterThanOrEqual(layout.cardsBottom);
    expect(Math.abs(layout.listsWidth - layout.cardsWidth), `panels as wide as the cards at ${viewport.name}`).toBeLessThanOrEqual(1);
    await capture(page, viewport.name, `requester-dashboard/populated-${viewport.name}.png`);
    await openMyTickets(page);
    await page.getByRole("link", { name: ticketNumber }).click();
    await expect(actionRow(page, PLANNED)).toBeVisible();
    await expect(actionsCard(page).getByRole("button", { name: "Add action" })).toHaveCount(0);
    await capture(page, viewport.name, `actions-taken/requester-list-${viewport.name}.png`);
  }
});

test("RESP-01 Requester with no tickets: the empty dashboard", async ({ page }) => {
  test.setTimeout(90_000);
  await signIn(page, EMPTY_REQUESTER);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openDashboard(page);
    await expect(page.getByText("You have not submitted any tickets yet.")).toBeVisible();
    await capture(page, viewport.name, `requester-dashboard/empty-${viewport.name}.png`);
  }
});

test("RESP-01 states: loading, failure, Action validation and a real Action conflict", async ({ page, expectHttp }) => {
  test.setTimeout(120_000);
  await signIn(page, STAFF);
  await page.setViewportSize(VIEWPORTS[0]);

  // Loading: the real request, held at the network edge until captured.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/dashboard/staff", async (route) => { await held; await route.continue(); });
  await openQueue(page);
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Loading dashboard…" })).toBeVisible();
  await capture(page, "desktop", "states/dashboard-loading.png");
  release();
  await expect(page.getByText("Loading dashboard…")).toHaveCount(0);
  await page.unroute("**/api/dashboard/staff");

  // Failure: a 503 forced at the network edge (the server's own body shape), then Retry recovers.
  expectHttp("GET", /^\/api\/dashboard\/staff$/, 503);
  await page.route("**/api/dashboard/staff", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "The service is unavailable. Please try again." } }) }),
  );
  await page.getByRole("button", { name: "Refresh" }).click();
  const failure = page.getByRole("alert").filter({ hasText: "The dashboard could not be loaded. Please try again." });
  await expect(failure).toBeVisible();
  await expect(page.getByRole("link", { name: /^Unassigned: \d+/ })).toHaveCount(0);
  await capture(page, "desktop", "states/dashboard-failure.png");
  await page.unroute("**/api/dashboard/staff");
  await failure.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("link", { name: /^Unassigned: \d+/ })).toBeVisible();

  // Validation: an empty Description, refused beneath its own field before any request.
  await openInQueue(page, ticketNumber);
  let form = await addAction(page, { description: "" });
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(form.getByLabel(/^Description/)).toHaveAttribute("aria-invalid", "true");
  await capture(page, "desktop", "states/action-validation.png");
  await form.getByRole("button", { name: "Cancel", exact: true }).click();

  // Conflict: a real one. The open Action is edited elsewhere while this form is open.
  const ticketId = ticketIdFromUrl(page);
  await actionRow(page, PLANNED).getByRole("button", { name: "Edit" }).click();
  form = page.locator("form.zen-action-form");
  await form.getByLabel(/^Description/).fill(`${PLANNED} Bring a spare.`);
  const changed = await page.evaluate(async ({ origin, id, planned }) => {
    const list = await (await fetch(`${origin}/api/tickets/${id}/actions`, { credentials: "include" })).json();
    const action = list.items.find((item: { description: string }) => item.description === planned);
    const response = await fetch(`${origin}/api/tickets/${id}/actions/${action.id}`, {
      method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: action.version, attachmentNotes: "Photo of the faulty plate is in the Attachments tab." }),
    });
    return response.status;
  }, { origin: API_ORIGIN, id: ticketId, planned: PLANNED });
  expect(changed).toBe(200);
  expectHttp("PATCH", /^\/api\/tickets\/\d+\/actions\/\d+$/, 409);
  await form.getByRole("button", { name: "Save action" }).click();
  await expect(form.getByRole("alert")).toContainText("Someone else changed this action. Reload to see the latest version.");
  await expect(form.getByLabel(/^Description/)).toHaveValue(`${PLANNED} Bring a spare.`);
  await capture(page, "desktop", "states/action-conflict.png");
});

test("RESP-01 focus is visible, and Tab follows the reading order at every width (ui-spec §7)", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMINISTRATOR);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await openDashboard(page);
    // Earth2509's note on PR #103: the outline as the browser computes it on a
    // focused control, not only as the stylesheet declares it.
    await page.getByRole("link", { name: /^Unassigned: \d+/ }).focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const style = getComputedStyle(el);
      return { visible: el.matches(":focus-visible"), style: style.outlineStyle, width: parseFloat(style.outlineWidth), name: el.getAttribute("aria-label") ?? el.textContent };
    });
    expect(ring.name).toMatch(/^Unassigned: \d+/);
    expect(ring.visible && ring.style !== "none" && ring.width > 0, `focus ring at ${viewport.name}: ${JSON.stringify(ring)}`).toBe(true);

    // Earth2509's note on PR #104: Tab order, in the browser, at each breakpoint.
    // Cards, then breakdowns, then panels; below 992 px they stack, so each stop
    // must also sit no higher on the page than the one before.
    const stops: Array<{ zone: number; top: number }> = [];
    for (let i = 0; i < 40; i++) {
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const zone = el.closest(".zen-metrics") ? 0 : el.closest(".zen-dashboard__breakdowns") ? 1 : el.closest(".zen-dashboard__lists") ? 2 : -1;
        return { zone, top: el.getBoundingClientRect().top + window.scrollY };
      });
      if (stop.zone === -1) break;
      stops.push(stop);
      await page.keyboard.press("Tab");
    }
    const zones = stops.map((s) => s.zone);
    expect(zones, `zones in Tab order at ${viewport.name}`).toEqual([...zones].sort((a, b) => a - b));
    expect(new Set(zones), `all three zones reached at ${viewport.name}`).toEqual(new Set([0, 1, 2]));
    if (viewport.name !== "desktop") {
      const tops = stops.map((s) => Math.round(s.top));
      const jumpsUp = tops.filter((top, i) => i > 0 && top < tops[i - 1] - 1 && zones[i] !== zones[i - 1]);
      expect(jumpsUp, `Tab never jumps back up between zones at ${viewport.name}`).toEqual([]);
    }
  }
});
