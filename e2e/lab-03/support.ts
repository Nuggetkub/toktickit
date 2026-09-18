import { expect, type Page } from "@playwright/test";
import path from "node:path";

// Shared steps for the Lab 3 browser suite.
//
// Every helper drives the real screens through their visible labels — the same
// names a person reads — so a rename that would confuse a user also fails the
// suite. The Lab 2 rig does the same; this is a separate module rather than an
// import because the two labs sign in differently at the edges (roles, the
// mandatory gate, and per-role landing screens) and a shared helper would end up
// carrying flags for both.

/** The seeded accounts (server/src/seed-data.ts). */
export const REQUESTER = {
  email: "nadia.rahman@toktickit.local",
  fullName: "Nadia Rahman",
  landing: "My Tickets",
} as const;

export const OTHER_REQUESTER = {
  email: "somchai.pattana@toktickit.local",
  fullName: "Somchai Pattana",
  landing: "My Tickets",
} as const;

export const STAFF = {
  email: "grace.okafor@toktickit.local",
  fullName: "Grace Okafor",
  landing: "Ticket Queue",
} as const;

export const ADMINISTRATOR = {
  email: "pim.srisawat@toktickit.local",
  fullName: "Pim Srisawat",
  landing: "User Management",
} as const;

/** Deactivated in the seed — E2E-01's "inactive account" case (BR-07). */
export const INACTIVE_REQUESTER = {
  email: "priya.anand@toktickit.local",
  fullName: "Priya Anand (retired account)",
} as const;

/**
 * An account no other spec signs in as, for the one test that **rotates a
 * password**.
 *
 * The suite runs serially against a single shared schema, so a test that leaves
 * an account's password changed — or, worse, leaves it sitting mid-gate — breaks
 * every later spec that signs in as it. That happened twice while writing this
 * suite: first on the shared IT Staff account, then on the shared second
 * Requester. Mutating fixtures needs its own seat, not a different shared one.
 */
export const ROTATION_REQUESTER = {
  email: "marisa.chen@toktickit.local",
  fullName: "Marisa Chen",
  landing: "My Tickets",
} as const;

/**
 * An account that is signed in but never taken past the mandatory gate.
 *
 * The §13 evidence has to include the Change Password screen in *mandatory*
 * mode, and by the time the responsive spec runs every other account has already
 * completed its gate — a screenshot taken then would show the voluntary form
 * with a Cancel button, which is a different screen making a different claim.
 * This account is signed in and abandoned at the gate, three times, on purpose.
 */
export const CAPTURE_REQUESTER = {
  email: "tobias.lindqvist@toktickit.local",
  fullName: "Tobias Lindqvist",
  landing: "My Tickets",
} as const;

export type Account = { email: string; fullName: string; landing: string };

/** The one development password every seeded account shares (BR-45). */
export const DEVELOPMENT_PASSWORD = process.env.SEED_PASSWORD ?? "TokTickIT-dev-2026";

/**
 * Where the API actually lives during an E2E run.
 *
 * The client is served from 127.0.0.1:4173 and calls `${VITE_API_URL}${path}`
 * against 127.0.0.1:3101 — there is no Vite proxy, so the two are genuinely
 * different origins. An in-page `fetch("/api/...")` is therefore answered by the
 * *dev server* with index.html and a cheerful 200, which is exactly how a probe
 * can report a session as alive when it is not. Every direct API assertion must
 * name this origin.
 */
export const API_ORIGIN = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3101";

/** Calls the real API from inside the page, carrying whatever cookie it holds. */
export async function apiStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async ({ origin, target }) => {
    const response = await fetch(`${origin}${target}`, { credentials: "include" });
    return response.status;
  }, { origin: API_ORIGIN, target: path });
}

/**
 * The password each account holds after its first sign-in of the run.
 *
 * BR-11 refuses a new password equal to the current one, so the mandatory gate
 * cannot be completed by re-entering the seeded value.
 */
export const SESSION_PASSWORD = "TokTickIT-e2e-session-2026";

/**
 * Fills the sign-in form and submits, without deciding what happens next.
 *
 * Separated from `signIn` because three different specs need the three different
 * outcomes: the landing screen, the mandatory gate still on screen (E2E-01 and
 * the §13 change-password capture), and a refusal.
 */
export async function submitSignIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();

  // Anchored regexes throughout: `Field` renders the required marker inside the
  // <label>, so the label text is "Email*" and an exact match never lands, while
  // a bare "Password" substring also matches "Confirm new password".
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Completes the mandatory first-login gate, which every seeded account meets. */
export async function completePasswordGate(page: Page): Promise<void> {
  await expect(page.getByRole("heading", { name: "Choose a new password" })).toBeVisible();
  await page.getByLabel(/^Current password/).fill(DEVELOPMENT_PASSWORD);
  await page.getByLabel(/^New password/).fill(SESSION_PASSWORD);
  await page.getByLabel(/^Confirm new password/).fill(SESSION_PASSWORD);
  await page.getByRole("button", { name: "Save new password" }).click();
}

/**
 * Signs in and lands on the account's own start screen.
 *
 * The gate is completed on the first sign-in of a run and absent afterwards, so
 * both paths are handled. The fallback to `SESSION_PASSWORD` is deliberate
 * rather than defensive: the schema is dropped per run, but a spec may sign the
 * same account in twice, and a developer re-running against a warm schema should
 * not have to reset it by hand.
 */
export async function signIn(page: Page, account: Account): Promise<void> {
  await submitSignIn(page, account.email, DEVELOPMENT_PASSWORD);

  const gate = page.getByRole("heading", { name: "Choose a new password" });
  const landing = page.getByRole("heading", { name: account.landing });
  const failure = page.getByRole("alert");
  await expect(gate.or(landing).or(failure)).toBeVisible();

  if (await failure.isVisible()) {
    await submitSignIn(page, account.email, SESSION_PASSWORD);
    await expect(landing).toBeVisible();
    return;
  }

  if (await gate.isVisible()) await completePasswordGate(page);

  await expect(landing).toBeVisible();
  // The shell names who is signed in, which is what makes the role visible in
  // every screenshot taken afterwards.
  await expect(page.getByText(account.fullName).first()).toBeVisible();
}

/** Ends the session through the control a user would use. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your account" })).toBeVisible();
}

/** Unique per run, so a Ticket created now cannot be confused with an earlier one. */
export function uniqueSummary(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

/**
 * A real PNG: the eight-byte signature followed by filler. The server decides an
 * attachment's type from its leading bytes and ignores the declared
 * `Content-Type` (BR-31), so an upload fixture has to *be* a PNG.
 */
export const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(512, 0x2a),
]);

export type TicketDraft = {
  summary: string;
  description?: string;
  category?: string;
  relatedSystem?: string;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
};

/**
 * Picks an option by its visible text, and fails immediately — naming what it
 * wanted and what was actually on offer — when that text is not in the list.
 *
 * `selectOption` answers an absent option with "did not find some options" and
 * then waits out the full timeout, so a fixture asking for a value the seed has
 * never contained looks exactly like a slow page. It cost this suite five wrong
 * hypotheses (a missing seed row, an `isActive` filter, an enablement race, an
 * empty list, a mid-action re-render) before anyone compared the requested name
 * against the seven names in `RELATED_SYSTEM_NAMES`: the spec was asking for a
 * "Projector", which is not one of them.
 */
async function chooseByLabel(page: Page, field: RegExp, wanted: string): Promise<void> {
  const select = page.getByLabel(field);
  // `textContent`, not `innerText`: options inside a collapsed <select> are not
  // laid out, so the rendered-text accessor can legitimately return nothing.
  const available = (await select.locator("option").allTextContents()).map((text) => text.trim());

  if (!available.includes(wanted)) {
    throw new Error(
      `No option "${wanted}" for ${field.source}. On offer: ${available.join(" | ")}.\n` +
        "That is a fixture mistake in the spec, not a product failure — the catalogue is " +
        "seeded from server/src/seed-data.ts and does not change at runtime.",
    );
  }

  await select.selectOption({ label: wanted });
}

/**
 * Creates a Ticket through the form as the signed-in Requester and returns the
 * official Ticket Number the server assigned — read off the success screen
 * rather than constructed, because the client never invents it (BR-01).
 */
export async function createTicket(page: Page, draft: TicketDraft): Promise<string> {
  await page.getByRole("button", { name: "Create Ticket" }).first().click();
  await expect(page.getByRole("heading", { name: "Create Ticket" })).toBeVisible();

  // Wait for the *options*, not for the control being enabled. Both dropdowns
  // are gated on one `referenceState`, so "Category is enabled" says nothing
  // about Related System, and a select can hold nothing but its placeholder for
  // a frame after it is enabled.
  //
  // These waits are honest about what they buy: they make the list present. They
  // do not make a given name exist — `chooseByLabel` is what says so out loud.
  await expect(page.getByText("Loading Categories and Related Systems…")).toHaveCount(0);
  await expect(page.getByLabel(/^Category/).locator("option")).not.toHaveCount(1);
  await expect(page.getByLabel(/^Related System/).locator("option")).not.toHaveCount(1);

  await chooseByLabel(page, /^Category/, draft.category ?? "Network");
  await chooseByLabel(page, /^Related System/, draft.relatedSystem ?? "Campus Wi-Fi");
  await page.getByLabel(/^Ticket Summary/).fill(draft.summary);
  await page.getByLabel(/^Requested Priority/).selectOption(draft.priority ?? "HIGH");
  await page
    .getByLabel(/^Description/)
    .fill(draft.description ?? "Raised by the Lab 3 browser suite to exercise the real stack end to end.");

  await page.getByRole("button", { name: "Submit Ticket" }).click();

  await expect(page.getByRole("heading", { name: "Ticket created" })).toBeVisible();
  const ticketNumber = await page.getByRole("status").getByRole("strong").first().innerText();
  expect(ticketNumber).toMatch(/^TKT-\d{4}-\d{5}$/);
  return ticketNumber;
}

/** Opens a Ticket from the IT Staff queue by its number. */
export async function openInQueue(page: Page, ticketNumber: string): Promise<void> {
  await page.getByLabel(/^Search/).fill(ticketNumber);
  const row = page.getByRole("row").filter({ hasText: ticketNumber });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: ticketNumber }).click();
  await expect(page.getByRole("heading", { name: `Ticket ${ticketNumber}` })).toBeVisible();
}

/**
 * The ticket record card on either Ticket Detail screen.
 *
 * `Card` renders a bare <section> with no accessible name, so this is located by
 * class and heading rather than by `getByRole("region")`, which would resolve to
 * nothing. Scoping matters because both detail screens now carry composers: a
 * page-wide "no editable control" assertion is false by design since issue #53.
 */
export function ticketRecord(page: Page, ticketNumber: string) {
  return page.locator(".zen-card").filter({
    has: page.getByRole("heading", { name: `Ticket ${ticketNumber}` }),
  });
}

const SCREENSHOT_ROOT = "artifacts/lab-03/screenshots";

/**
 * Writes a screenshot to the exact path ui-spec.md §13 documents, and asserts
 * the page is actually usable at this width first.
 *
 * The assertions are the point and the image is the evidence: a picture proves
 * nothing on its own, and nobody reviews twenty-one of them pixel by pixel. A
 * regression therefore fails the run rather than waiting to be noticed later —
 * the same rule the Lab 2 responsive spec follows.
 */
export async function capture(page: Page, directory: string, name: string): Promise<void> {
  await expectNoHorizontalOverflow(page);
  await expectNothingClipped(page);
  await page.screenshot({ path: path.join(SCREENSHOT_ROOT, directory, `${name}.png`), fullPage: true });
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  // The page itself must never scroll sideways. A wide element may scroll inside
  // its own container — that is what .zen-table-wrap is for — so this measures
  // the document, not its contents.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the page scrolls horizontally").toBeLessThanOrEqual(1);
}

/** Labels and headings are what get clipped first when a column narrows. */
export async function expectNothingClipped(page: Page): Promise<void> {
  const clipped = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(".zen-field__label, .zen-card__title, .zen-table th, .zen-badge"),
    )
      .filter((element) => element.scrollWidth - element.clientWidth > 1)
      .map((element) => element.textContent?.trim() ?? ""),
  );
  expect(clipped, "clipped labels").toEqual([]);
}

/** Controls must stay inside the viewport, and stay tappable on mobile. */
export async function expectControlsUsable(page: Page, viewport: string): Promise<void> {
  const offscreen = await page.evaluate(() => {
    const width = window.innerWidth;
    return Array.from(document.querySelectorAll<HTMLElement>("button:not([disabled]), .zen-button"))
      .map((element) => ({ text: element.textContent?.trim() ?? "", rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > width + 1))
      .map(({ text }) => text);
  });
  expect(offscreen, `controls outside the viewport at ${viewport} width`).toEqual([]);

  if (viewport !== "mobile") return;

  // 44px is the touch target ui-spec.md §10 asks for below 768px.
  const small = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button:not([disabled]), .zen-button"))
      .map((element) => ({ text: element.textContent?.trim() ?? "", rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0 && rect.height < 44)
      .map(({ text }) => text),
  );
  expect(small, "touch targets under 44px at mobile width").toEqual([]);
}

export const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "mobile", width: 390, height: 844 },
] as const;
