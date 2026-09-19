import { test, expect } from "@playwright/test";
import {
  DEVELOPMENT_PASSWORD,
  INACTIVE_REQUESTER,
  REQUESTER,
  ROTATION_REQUESTER,
  SESSION_PASSWORD,
  STAFF,
  apiStatus,
  signIn,
  signOut,
  submitSignIn,
} from "./support.js";

// E2E-01 — AC-01, AC-02, AC-05, AC-07.
//
// The whole authentication story against the real stack: a first sign-in is
// forced through the password gate and then lands on the account's own screen,
// the two refusals say what ui-spec.md §3 fixes, and after logout the session is
// gone from the server rather than merely from the interface.

test("a first sign-in is forced to change its password and then lands on its own screen", async ({ page }) => {
  await submitSignIn(page, REQUESTER.email, DEVELOPMENT_PASSWORD);

  // BR-12: every account the seed issues a password to starts here, whatever it
  // asked for. The gate outranks the landing page (BR-02).
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await expect(page.getByText("You must choose a new password before continuing.")).toBeVisible();

  // Mandatory mode offers no way past it except finishing: no navigation, and no
  // Cancel (ui-spec.md §4).
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);

  // BR-11's rules are shown, and the new password may not repeat the current one.
  await page.getByLabel(/^Current password/).fill(DEVELOPMENT_PASSWORD);
  await page.getByLabel(/^New password/).fill(DEVELOPMENT_PASSWORD);
  await expect(page.getByRole("list", { name: "Password rules" })).toContainText(
    "Different from your current password",
  );

  await page.getByLabel(/^New password/).fill(SESSION_PASSWORD);
  await page.getByLabel(/^Confirm new password/).fill(SESSION_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();

  await expect(page.getByRole("heading", { name: REQUESTER.landing })).toBeVisible();
  // And the gate is genuinely cleared: signing in again goes straight there.
  await signOut(page);
  await submitSignIn(page, REQUESTER.email, SESSION_PASSWORD);
  await expect(page.getByRole("heading", { name: REQUESTER.landing })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toHaveCount(0);
});

test("each role lands on its own start screen", async ({ page }) => {
  // AC-01. The Administrator lands on Users, which issue #55 made their start
  // screen — landing them on a queue they share with IT Staff meant the one
  // screen that is theirs was the one they had to go looking for.
  await signIn(page, STAFF);
  await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);
  await signOut(page);
});

test("a wrong password and a deactivated account are refused in the words the contract fixes", async ({ page }) => {
  // The server returns the same 401 for an unknown email, a wrong password and
  // an account with no password (BR-06), and only names deactivation once the
  // password is correct (BR-07). The screen renders that decision rather than
  // re-making it.
  await submitSignIn(page, REQUESTER.email, "definitely-not-the-password");
  await expect(page.getByRole("alert")).toContainText("Email or password is incorrect.");

  // The email survives a failure and only the password is cleared (ui-spec §3).
  await expect(page.getByLabel(/^Email/)).toHaveValue(REQUESTER.email);
  await expect(page.getByLabel(/^Password/)).toHaveValue("");

  await submitSignIn(page, INACTIVE_REQUESTER.email, DEVELOPMENT_PASSWORD);
  await expect(page.getByRole("alert")).toContainText(
    "This account has been deactivated. Contact your administrator.",
  );
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
});

test("after logout a direct URL shows Login and the old session is refused by the API", async ({ page }) => {
  // AC-07. The interface forgetting who you were is the easy half; the claim
  // worth making is that the cookie is dead on the server (BR-14).
  await signIn(page, REQUESTER);
  await signOut(page);

  await page.goto("/tickets");
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);

  // Asked from inside the page, so it carries whatever cookie the browser still
  // holds — which is the point: the server must refuse it regardless.
  //
  // Addressed to the API's own origin. A relative "/api/tickets" is answered by
  // the Vite dev server with index.html and a 200, because this run is genuinely
  // cross-origin and has no proxy — a probe written that way reports a revoked
  // session as alive.
  expect(await apiStatus(page, "/api/tickets")).toBe(401);
});

test("a password change ends every other session that account holds", async ({ page, context }) => {
  // AC-08, BR-15. Two sessions for one account; changing the password in one
  // must refuse the other.
  //
  // A dedicated account nobody else signs in as. This test rotates the password,
  // and the suite runs serially against one shared schema, so doing it to a
  // shared account leaves every later spec either using a stale password or
  // stranded on the mandatory gate — which is exactly what happened when this
  // test borrowed the IT Staff account, and then the second Requester.
  await signIn(page, ROTATION_REQUESTER);

  const second = await context.browser()!.newContext();
  const other = await second.newPage();
  await submitSignIn(other, ROTATION_REQUESTER.email, SESSION_PASSWORD);
  // The second session must be genuinely signed in before the rotation, or the
  // 401 below would only prove that this context never had a session at all.
  await expect(other.getByRole("heading", { name: ROTATION_REQUESTER.landing })).toBeVisible();
  expect(await apiStatus(other, "/api/auth/me")).toBe(200);

  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel(/^Current password/).fill(SESSION_PASSWORD);
  await page.getByLabel(/^New password/).fill(`${SESSION_PASSWORD}-rotated`);
  await page.getByLabel(/^Confirm new password/).fill(`${SESSION_PASSWORD}-rotated`);
  await page.getByRole("button", { name: "Save new password" }).click();

  // Wait for the change to have actually completed before probing the other
  // session. `changePassword` deletes every session and mints a fresh one for
  // the caller, so until that request returns the other cookie is still valid
  // and 200 is the honest answer — probing immediately measures the race, not
  // the rule.
  //
  // The success message, not the landing screen: ChangePassword only navigates
  // in mandatory mode (`if (mandatory) navigate(...) else setSaved(true)`), and
  // this is a voluntary change from the shell, so it stays on the form.
  await expect(page.getByText("Your password has been changed.")).toBeVisible();

  expect(await apiStatus(other, "/api/auth/me")).toBe(401);
  await second.close();
});
