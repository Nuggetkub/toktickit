import { test, expect } from "@playwright/test";
import {
  ADMINISTRATOR,
  DEVELOPMENT_PASSWORD,
  SESSION_PASSWORD,
  STAFF,
  signIn,
  signOut,
  submitSignIn,
} from "./support.js";

// E2E-03 — AC-20 … AC-23. The Administrator's screen, and the two refusals that
// make it safe to hand someone.

/** A fresh account per run: the schema survives a re-run against a warm database. */
function newStaffEmail(): string {
  return `e2e-staff-${Date.now()}-${Math.random().toString(16).slice(2, 6)}@toktickit.local`;
}

const NEW_STAFF_PASSWORD = "TokTickIT-issued-2026";

test("an Administrator searches, filters by role, and creates an IT Staff account that must change its password", async ({
  page,
}) => {
  // AC-20, AC-21. The created account is then proven real by signing in as it —
  // a user that appears in a table but cannot sign in has not been created.
  test.setTimeout(120_000);

  const email = newStaffEmail();
  const fullName = "Evelyn Marsh";

  await signIn(page, ADMINISTRATOR);

  // Search narrows to one known seeded account…
  await page.getByLabel(/^Search by name or email/).fill(STAFF.fullName);
  const staffRow = page.getByRole("row").filter({ hasText: STAFF.email });
  await expect(staffRow).toHaveCount(1);
  await expect(staffRow).toContainText("IT Staff");
  await expect(staffRow).toContainText("Active");

  // …and the role filter excludes, which is the half a presence check misses.
  await page.getByLabel(/^Search by name or email/).fill("");
  await page.getByLabel(/^Role/).selectOption("REQUESTER");
  await expect(page.getByRole("row").filter({ hasText: STAFF.email })).toHaveCount(0);
  await expect(page.getByRole("row").filter({ hasText: "nadia.rahman@toktickit.local" })).toHaveCount(1);
  await page.getByLabel(/^Role/).selectOption("");

  // AC-20 — create an IT Staff account.
  await page.getByRole("button", { name: "Create user" }).click();
  const panel = page.getByRole("region", { name: "Create user" });
  await panel.getByLabel(/^Full name/).fill(fullName);
  await panel.getByLabel(/^Email address/).fill(email);
  await panel.getByLabel(/^Role/).selectOption("IT_STAFF");
  await panel.getByLabel(/^Initial password/).fill(NEW_STAFF_PASSWORD);

  // The button is disabled until BR-11's rules are met, so its becoming enabled
  // is itself the assertion that the password was acceptable — and if it never
  // enables, that fails here rather than as a mystery timeout on the click.
  const create = panel.getByRole("button", { name: "Create user" });
  await expect(create).toBeEnabled();
  await create.click();

  await expect(page.getByText(`User saved. ${fullName} must choose a new password at their next sign-in.`)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText("IT Staff");
  await signOut(page);

  // AC-21 — BR-12: an issued password is a one-time credential.
  await submitSignIn(page, email, NEW_STAFF_PASSWORD);
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel(/^Current password/).fill(NEW_STAFF_PASSWORD);
  await page.getByLabel(/^New password/).fill(SESSION_PASSWORD);
  await page.getByLabel(/^Confirm new password/).fill(SESSION_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();

  // And they land on the queue their new role grants, not a Requester screen.
  await expect(page.getByRole("heading", { name: "Ticket Queue" })).toBeVisible();
  await signOut(page);

  // AC-22 — deactivation is immediate and is reported in the words BR-07 fixes.
  await signIn(page, ADMINISTRATOR);
  await page.getByLabel(/^Search by name or email/).fill(email);
  await page.getByRole("button", { name: `Edit ${fullName}` }).click();
  const edit = page.getByRole("region", { name: "Edit user" });
  await edit.getByLabel("Active account").uncheck();
  await edit.getByRole("button", { name: "Save user" }).click();
  await expect(page.getByText(/^User saved/)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: email })).toContainText("Inactive");
  await signOut(page);

  await submitSignIn(page, email, SESSION_PASSWORD);
  await expect(page.getByRole("alert")).toContainText(
    "This account has been deactivated. Contact your administrator.",
  );
});

test("an Administrator cannot deactivate themselves or change their own role", async ({ page }) => {
  // AC-22, BR-41. The screen states the rule where the controls are, rather than
  // letting someone try and answering with a 409 afterwards.
  await signIn(page, ADMINISTRATOR);

  await page.getByLabel(/^Search by name or email/).fill(ADMINISTRATOR.email);
  await page.getByRole("button", { name: `Edit ${ADMINISTRATOR.fullName}` }).click();

  const edit = page.getByRole("region", { name: "Edit user" });
  await expect(edit.getByLabel("Active account")).toBeDisabled();
  await expect(edit.getByLabel(/^Role/)).toBeDisabled();
  await expect(edit.getByText("You cannot deactivate your own account or change your own role.")).toBeVisible();

  // Renaming yourself stays allowed — the rule is about role and activation.
  await expect(edit.getByLabel(/^Full name/)).toBeEnabled();
});

test("IT Staff are refused the Users screen and are never offered it", async ({ page }) => {
  // AC-23. Two separate claims: the control is absent, and the URL is refused
  // even when typed. The server refuses the API regardless; this is what the
  // browser does.
  await signIn(page, STAFF);
  await expect(page.getByRole("button", { name: "Users" })).toHaveCount(0);

  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();
  await expect(page.getByText("Your role does not include this screen.")).toBeVisible();

  // The refusal discloses nothing about what is on the screen it withheld.
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Create user" })).toHaveCount(0);
  await expect(page.getByText(ADMINISTRATOR.email)).toHaveCount(0);
});

test("a deactivated account's sign-in is refused before it reaches any screen", async ({ page }) => {
  // BR-07 with the seeded retired account, so the claim holds even if the test
  // above is skipped or reordered.
  await submitSignIn(page, "priya.anand@toktickit.local", DEVELOPMENT_PASSWORD);
  await expect(page.getByRole("alert")).toContainText(
    "This account has been deactivated. Contact your administrator.",
  );
  await expect(page.getByRole("navigation", { name: "Primary" })).toHaveCount(0);
});
