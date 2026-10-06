import { API_ORIGIN, STAFF, addAction, expect, expectUsable, installGuard, openInQueue, openQueue, signIn, test } from "./support";
import { VIEWPORTS } from "../lab-03/support";
import type { Page } from "@playwright/test";

// Negative controls for the suite's own checks (Earth2509's review of PR #106).
// A check that cannot fail proves nothing, so each defect below is planted on a
// real screen and the check must reject it, naming it. These run in the suite,
// so a check that stops catching its defect turns the suite red.

test.describe.configure({ mode: "serial" });

const MOBILE = VIEWPORTS[2];

/** Runs `expectUsable` and returns its failure message, or "" if it passed. */
async function usableFailure(page: Page, what: string): Promise<string> {
  try {
    await expectUsable(page, "mobile", what);
    return "";
  } catch (error) {
    return String((error as Error).message);
  }
}

test("guard: an undeclared connection failure is caught; a declared one and a declared HTTP refusal are not", async ({ page }) => {
  // A second page in the same context, guarded by its own installGuard, so the
  // planted failure is inspected here rather than failing this test's own guard.
  const probe = await page.context().newPage();
  const guard = installGuard(probe);
  await probe.goto("/login");
  await probe.evaluate(() => fetch("http://127.0.0.1:59997/refused").catch(() => undefined));
  await expect.poll(() => guard.problems.join("\n")).toMatch(/undeclared request failure \(net::ERR_CONNECTION_REFUSED\): GET http:\/\/127\.0\.0\.1:59997\/refused/);

  const declared = await page.context().newPage();
  const quiet = installGuard(declared);
  quiet.expectRequestFailure("GET", /^http:\/\/127\.0\.0\.1:59997\/refused$/);
  quiet.expectHttp("GET", /^\/api\/tickets$/, 401);
  await declared.goto("/login");
  await declared.evaluate(async (origin) => {
    await fetch("http://127.0.0.1:59997/refused").catch(() => undefined);
    await fetch(`${origin}/api/tickets`, { credentials: "omit" });
  }, API_ORIGIN);
  await declared.waitForTimeout(300);
  expect(quiet.problems).toEqual([]);
  await probe.close();
  await declared.close();
});

test("targets: an undersized dashboard link and an undersized Action select fail at mobile", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await signIn(page, STAFF);
  await expect(page.getByRole("link", { name: /^Unassigned: \d+/ })).toBeVisible();
  expect(await usableFailure(page, "control: the real dashboard")).toBe("");
  await page.addStyleTag({ content: ".zen-metric { min-height: 0 !important; height: 20px !important; padding: 0 !important; overflow: hidden !important; }" });
  expect(await usableFailure(page, "a 20 px card")).toMatch(/touch targets under 44 px[\s\S]*Unassigned: \d+/);

  await openQueue(page);
  const ticket = await page.locator("table a[href^='/queue/']").first().innerText();
  await openInQueue(page, ticket);
  await addAction(page, { description: "Self-test: never saved." });
  expect(await usableFailure(page, "control: the real Action form")).toBe("");
  await page.addStyleTag({ content: "form.zen-action-form select { min-height: 0 !important; height: 20px !important; padding: 0 !important; }" });
  expect(await usableFailure(page, "a 20 px select")).toMatch(/touch targets under 44 px[\s\S]*select/);
});

test("overlap: two controls laid over each other, and a control under an overlay, both fail", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await signIn(page, STAFF);
  await expect(page.getByRole("link", { name: /^Unassigned: \d+/ })).toBeVisible();
  // Shift the second card up over the first by 80 px.
  await page.addStyleTag({ content: ".zen-metrics > .zen-metric:nth-child(2) { position: relative; top: -80px; }" });
  expect(await usableFailure(page, "overlapping cards")).toMatch(/overlapping targets[\s\S]*Unassigned[\s\S]*My active tickets|overlapping targets[\s\S]*My active tickets[\s\S]*Unassigned/);

  await page.reload();
  await expect(page.getByRole("link", { name: /^Unassigned: \d+/ })).toBeVisible();
  await page.evaluate(() => {
    const card = document.querySelector(".zen-metric")!.getBoundingClientRect();
    const veil = document.createElement("div");
    Object.assign(veil.style, { position: "absolute", left: `${card.left + scrollX}px`, top: `${card.top + scrollY}px`, width: `${card.width}px`, height: `${card.height}px`, zIndex: "10", background: "transparent" });
    veil.className = "selftest-veil";
    document.body.appendChild(veil);
  });
  expect(await usableFailure(page, "a covered card")).toMatch(/targets covered by something else[\s\S]*Unassigned[\s\S]*selftest-veil/);
});
