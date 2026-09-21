import { test, expect, type Route } from "@playwright/test";
import {
  ADMINISTRATOR,
  REQUESTER,
  SESSION_PASSWORD,
  STAFF,
  capture,
  createTicket,
  openInQueue,
  signIn,
  signOut,
  submitSignIn,
  uniqueSummary,
} from "./support.js";

// ui-spec.md §13's last three rows — the interface states, and the Internal
// Notes surface beside the public one.
//
// These are the states a reader only meets when something is slow, empty or
// refused, so they are the ones that ship broken. The other Lab 3 specs assert
// behaviour; this one assets that the *feedback* exists and then photographs it,
// because §13 asks for states "captured from real requests" and a screenshot of
// a loaded happy path proves none of them.
//
// Every state is forced at the network edge rather than by reaching into the
// application, so what is captured is the real screen reacting to a real answer.

test.use({ viewport: { width: 1440, height: 900 } });

/**
 * Fulfils a request with a JSON envelope the client will actually accept.
 *
 * The CORS headers are not decoration. This run is genuinely cross-origin — the
 * page is served from :4173 and the API lives on :3101 with no proxy — so a
 * fulfilled response without them is rejected by the browser before the
 * application ever sees the status, and the screen shows a network failure
 * instead of the refusal being tested.
 */
async function fulfillJson(route: Route, status: number, body: unknown): Promise<void> {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "http://127.0.0.1:4173",
      "access-control-allow-credentials": "true",
    },
    body: JSON.stringify(body),
  });
}

/** Holds a request open long enough for its pending state to be photographed. */
async function delay(route: Route, ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await route.continue();
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

test("loading — My Tickets while the list is still in flight", async ({ page }) => {
  await signIn(page, REQUESTER);

  // Matched by pathname, not by a glob. In Playwright globs `?` is a
  // single-character wildcard rather than a literal, so "**/api/tickets?**"
  // would also intercept "/api/tickets/42" — the detail request, which this
  // test has no business delaying.
  await page.route((url) => url.pathname === "/api/tickets", (route) => delay(route, 4_000));

  // Reload rather than clicking the nav: sign-in has already landed on
  // /tickets, and navigating to the route you are already on does not remount
  // the screen, so no second request would be made and the pending state would
  // never appear.
  await page.reload();

  await expect(page.getByText("Loading your Tickets…")).toBeVisible();
  await capture(page, "states", "loading");
});

test("saving — the Administrator panel while a user is being written", async ({ page }) => {
  await signIn(page, ADMINISTRATOR);

  await page.getByLabel(/^Search by name or email/).fill(STAFF.email);
  await page.getByRole("button", { name: `Edit ${STAFF.fullName}` }).click();
  const panel = page.getByRole("region", { name: "Edit user" });
  await panel.getByLabel(/^Full name/).fill(`${STAFF.fullName} (on call)`);

  // The PATCH to /api/admin/users/<id> only — the list request has no trailing
  // path segment and must stay fast, or the screen behind the panel is empty.
  await page.route("**/api/admin/users/*", (route) => delay(route, 4_000));
  await panel.getByRole("button", { name: "Save user" }).click();

  // The button reports the work rather than going dead under the pointer.
  await expect(page.getByRole("button", { name: "Saving user…" })).toBeVisible();
  await capture(page, "states", "saving");
});

test("success — the Ticket created confirmation, with the number the server assigned", async ({ page }) => {
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary: uniqueSummary("Meeting room display is dim") });

  await expect(page.getByRole("heading", { name: "Ticket created" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText(ticketNumber);
  await capture(page, "states", "success");
});

test("empty — a Requester who has never raised a Ticket", async ({ page }) => {
  // A brand-new account rather than a seeded one: the suite shares a schema and
  // the other specs raise Tickets, so "this requester happens to have none" is
  // true only until someone reorders the files.
  const email = `e2e-empty-${Date.now()}@toktickit.local`;
  const password = "TokTickIT-issued-2026";

  await signIn(page, ADMINISTRATOR);
  await page.getByRole("button", { name: "Create user" }).click();
  const panel = page.getByRole("region", { name: "Create user" });
  await panel.getByLabel(/^Full name/).fill("Quiet Requester");
  await panel.getByLabel(/^Email address/).fill(email);
  await panel.getByLabel(/^Role/).selectOption("REQUESTER");
  await panel.getByLabel(/^Initial password/).fill(password);
  await panel.getByRole("button", { name: "Create user" }).click();
  await expect(page.getByText(/^User saved/)).toBeVisible();
  await signOut(page);

  await submitSignIn(page, email, password);
  await page.getByLabel(/^Current password/).fill(password);
  await page.getByLabel(/^New password/).fill(SESSION_PASSWORD);
  await page.getByLabel(/^Confirm new password/).fill(SESSION_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();

  await expect(page.getByRole("heading", { name: "My Tickets" })).toBeVisible();
  // Empty and no-results are different situations with different fixes, and the
  // screen says so: this one offers Create Ticket, not "clear your filters".
  await expect(page.getByText("You have not created any Tickets yet.")).toBeVisible();
  await capture(page, "states", "empty");
});

test("no-results — a search that matches nothing, offering to clear the filters", async ({ page }) => {
  await signIn(page, REQUESTER);
  await createTicket(page, { summary: uniqueSummary("Keyboard key sticks") });
  await page.getByRole("link", { name: "View My Tickets" }).click();

  await page.getByLabel(/^Search/).fill("no-ticket-will-ever-match-this-term");
  await expect(page.getByText("No Tickets match your search or filters.")).toBeVisible();
  await capture(page, "states", "no-results");
});

test("forbidden — IT Staff at a URL their role does not include", async ({ page }) => {
  await signIn(page, STAFF);
  await page.goto("/users");

  await expect(page.getByRole("heading", { name: "You do not have access to this page" })).toBeVisible();
  await capture(page, "states", "forbidden");
});

test("conflict — someone else changed the Ticket first", async ({ page }) => {
  const summary = uniqueSummary("Server room door sensor is offline");
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary });
  await signOut(page);

  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);

  // BR-24's refusal, forced at the edge. The point of the screen is that a stale
  // version is reported as "someone else moved this", never as a validation
  // error about something the reader typed.
  await page.route("**/api/tickets/*/it-priority", (route) =>
    fulfillJson(route, 409, errorBody("TICKET_VERSION_CONFLICT", "This Ticket changed while you were working on it.")),
  );
  await page.getByLabel(/^IT Priority/).selectOption("LOW");
  await page.getByRole("button", { name: "Save priority" }).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Someone else changed this ticket. Reload to see the latest version.");
  await expect(alert.getByRole("button", { name: "Reload" })).toBeVisible();
  await capture(page, "states", "conflict");
});

test("failure — the list cannot be loaded, and says so with a way back", async ({ page }) => {
  await signIn(page, REQUESTER);

  await page.route(
    (url) => url.pathname === "/api/tickets",
    (route) => fulfillJson(route, 500, errorBody("INTERNAL_ERROR", "Something went wrong.")),
  );
  await page.reload();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Your Tickets could not be loaded.");
  // A dead end is not an error state; the reader is offered the retry. The exact
  // label, because `ErrorAlert` defaults to "Try again" and a loose alternation
  // would keep passing if that default drifted to something unhelpful.
  await expect(alert.getByRole("button", { name: "Try again" })).toBeVisible();
  await capture(page, "states", "failure");
});

test("the Internal Notes surface, so it can be compared with the public one", async ({ page }) => {
  // §13 asks that Public Comments and Internal Notes are unmistakably different
  // surfaces. They are separate tabs, so no single screenshot can show both —
  // this captures the private one, and `staff-ticket-detail/desktop.png` (taken
  // by RESP-01) shows the public one on the same screen at the same width.
  const summary = uniqueSummary("Badge reader rejects new cards");
  await signIn(page, REQUESTER);
  const ticketNumber = await createTicket(page, { summary });
  await signOut(page);

  await signIn(page, STAFF);
  await openInQueue(page, ticketNumber);

  await page.getByRole("tab", { name: /^Internal notes/ }).click();
  await page
    .getByRole("textbox", { name: "Internal note" })
    .fill("Swapped the reader firmware; do not tell the requester until it has held for a day.");
  await page.getByRole("button", { name: "Add internal note" }).click();

  const thread = page.getByRole("list", { name: /^Internal notes/ });
  await expect(thread).toContainText("Swapped the reader firmware");
  // The heading carries the audience in words, not by colour or a lock alone.
  await expect(
    page.getByRole("heading", { name: "Internal notes — visible only to IT Staff and Administrators" }),
  ).toBeVisible();
  await capture(page, "staff-ticket-detail", "internal-notes-desktop");
});
