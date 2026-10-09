import { ADMINISTRATOR, REQUESTER, STAFF, countIn, expect, listedTotal, signIn, test } from "./support";
import type { Page } from "@playwright/test";

// E2E-03 in docs/lab-04/tests.md (AC-02, AC-18, AC-20, AC-21): every number on
// each dashboard, clicked through, lands on a list whose total equals it. The
// lab4_e2e schema carries the demo seed, so the numbers are not all zero.

test.describe.configure({ mode: "serial" });

const openDashboard = async (page: Page) => {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByText("Loading dashboard…")).toHaveCount(0);
};

/** Clicks the link named `name`, reads the list's total, and returns to the dashboard. */
async function drillDown(page: Page, name: RegExp, landing: string): Promise<{ stated: number; listed: number }> {
  const stated = await countIn(page, name);
  await page.getByRole("link", { name }).click();
  await expect(page.getByRole("heading", { name: landing, level: 1 })).toBeVisible();
  const listed = await listedTotal(page);
  await openDashboard(page);
  return { stated, listed };
}

/** A same-page panel's total: "Showing n of N", or its empty message when N is 0. */
async function panelTotal(page: Page, region: string): Promise<number> {
  const panel = page.getByRole("region", { name: region });
  const showing = panel.getByText(/^Showing \d+ of \d+$/);
  return (await showing.count()) ? Number((await showing.innerText()).match(/of (\d+)/)![1]) : 0;
}

test("E2E-03 Requester: each card lands on exactly what it counts, and the queue is Forbidden", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, REQUESTER);
  await openDashboard(page);
  const seen: Record<string, { stated: number; listed: number }> = {};
  for (const card of [/^My active tickets: \d+/, /^Waiting for me: \d+/, /^Resolved — please check: \d+/]) {
    seen[card.source] = await drillDown(page, card, "My Tickets");
  }
  for (const [card, { stated, listed }] of Object.entries(seen)) expect(listed, card).toBe(stated);
  expect(Object.values(seen).some(({ stated }) => stated > 0), "the demo seed gives this Requester tickets").toBe(true);

  // R-4 links to its own panel on this page, whose total is the card's.
  const recent = await countIn(page, /^Resolved in the last 7 days: \d+/);
  await page.getByRole("link", { name: /^Resolved in the last 7 days/ }).click();
  expect(new URL(page.url()).hash).toBe("#recently-resolved");
  expect(await panelTotal(page, "Recently resolved")).toBe(recent);

  // AC-21: a Requester opening the queue sees Forbidden.
  await page.goto("/queue");
  await expect(page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();
});

test("E2E-03 IT Staff: cards and both breakdowns land on what they count; no User accounts", async ({ page }) => {
  test.setTimeout(240_000);
  await signIn(page, STAFF);
  await openDashboard(page);
  const links = [
    /^Unassigned: \d+/,
    /^My active tickets: \d+/,
    /^Requester says resolved: \d+/,
    ...["New", "Open", "In Progress", "Waiting for Requester", "Resolved", "Closed", "Reopened", "Cancelled"].map((s) => new RegExp(`^${s}: \\d+ tickets?$`)),
    ...["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => new RegExp(`^Active, IT Priority ${p}: \\d+`)),
  ];
  const mismatches: string[] = [];
  let anyNonZero = false;
  for (const link of links) {
    const { stated, listed } = await drillDown(page, link, "Ticket Queue");
    if (stated !== listed) mismatches.push(`${link.source}: card ${stated}, list ${listed}`);
    anyNonZero ||= stated > 0;
  }
  expect(mismatches).toEqual([]);
  expect(anyNonZero, "the demo seed gives the queue tickets").toBe(true);

  const actions = await countIn(page, /^My open actions: \d+/);
  await page.getByRole("link", { name: /^My open actions: \d+/ }).click();
  expect(new URL(page.url()).hash).toBe("#my-open-actions");
  expect(await panelTotal(page, "My open actions")).toBe(actions);

  await expect(page.getByRole("heading", { name: "User accounts" })).toHaveCount(0);
});

test("E2E-03 Administrator: User accounts rows land on lists of that many accounts", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, ADMINISTRATOR);
  await openDashboard(page);
  await expect(page.getByRole("heading", { name: "User accounts" })).toBeVisible();
  for (const role of ["Requester", "IT Staff", "Administrator"]) {
    const row = page.getByRole("link", { name: new RegExp(`^${role} \\d+ active · \\d+ inactive$`) });
    const [, active, inactive] = (await row.innerText()).match(/(\d+) active · (\d+) inactive/)!;
    await row.click();
    await expect(page.getByRole("heading", { name: "User Management", level: 1 })).toBeVisible();
    const rows = page.getByRole("table", { name: "All user accounts" }).locator("tbody tr");
    await expect(rows).toHaveCount(Number(active) + Number(inactive));
    await openDashboard(page);
  }
});
