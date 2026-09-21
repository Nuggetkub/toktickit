import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-02 — AC-02, AC-06 (docs/lab-03/tests.md).
//
// The checklist is the part worth testing hardest: it promises the user that a
// password will be accepted. If it ever ticks a rule the server enforces
// differently, the screen lies and the save fails for a reason the user was told
// did not apply.

const PENDING = {
  id: 4,
  fullName: "Nadia Rahman",
  email: "nadia.rahman@toktickit.local",
  role: "REQUESTER",
  mustChangePassword: true,
};

type Answer = { status: number; body?: unknown };

function mockApi(change: Answer | (() => Answer), user: unknown = PENDING) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    calls.push({ url: target, init });

    const answer = (chosen: Answer) => ({
      ok: chosen.status < 400,
      status: chosen.status,
      json: async () => chosen.body ?? {},
      headers: new Headers(),
    });

    if (target.endsWith("/api/auth/me")) return answer({ status: 200, body: { user } });
    if (target.endsWith("/api/auth/change-password")) {
      return answer(typeof change === "function" ? change() : change);
    }
    if (target.endsWith("/api/auth/logout")) return answer({ status: 204 });
    if (target.includes("/api/tickets")) {
      return answer({ status: 200, body: { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 } });
    }
    if (target.includes("/api/categories") || target.includes("/api/related-systems")) {
      return answer({ status: 200, body: [] });
    }
    throw new Error(`Unexpected request: ${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function renderChangePassword(path = "/change-password") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Choose a new password" });
}

/** The checklist row carrying this rule, so its met/unmet class can be read. */
function rule(text: RegExp | string): HTMLElement {
  return screen.getByText(text).closest("li") as HTMLElement;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Change Password — mandatory mode", () => {
  it("explains why it cannot be skipped and offers only Log out", async () => {
    mockApi({ status: 200, body: { user: { ...PENDING, mustChangePassword: false } } });
    await renderChangePassword();

    expect(screen.getByText("You must choose a new password before continuing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    // BR-02: no navigation to anything else, and no Cancel that would imply one.
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "My Tickets" })).not.toBeInTheDocument();
  });

  it("redirects a pending account that tries to open a ticket screen directly", async () => {
    mockApi({ status: 200, body: { user: PENDING } });
    render(
      <MemoryRouter initialEntries={["/tickets"]}>
        <App />
      </MemoryRouter>,
    );

    // Not a hidden link but a real URL: the gate has to hold against typing one.
    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
  });
});

describe("Change Password — the live checklist", () => {
  it("ticks each rule only once it is genuinely met", async () => {
    mockApi({ status: 200, body: { user: { ...PENDING, mustChangePassword: false } } });
    await renderChangePassword();

    const list = screen.getByRole("list", { name: "Password rules" });
    expect(list).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/^New password/), "short");
    expect(rule(/At least 12 characters/)).not.toHaveClass("zen-checklist__item--met");

    await userEvent.clear(screen.getByLabelText(/^New password/));
    await userEvent.type(screen.getByLabelText(/^New password/), "a sufficiently long passphrase");
    expect(rule(/At least 12 characters/)).toHaveClass("zen-checklist__item--met");

    // Confirmation is part of the same list, so "ready to submit" is one glance.
    expect(rule(/Matches the confirmation/)).not.toHaveClass("zen-checklist__item--met");
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), "a sufficiently long passphrase");
    expect(rule(/Matches the confirmation/)).toHaveClass("zen-checklist__item--met");
  });

  it("refuses a whitespace-only password and one equal to the account's email", async () => {
    mockApi({ status: 200, body: { user: { ...PENDING, mustChangePassword: false } } });
    await renderChangePassword();

    await userEvent.type(screen.getByLabelText(/^New password/), "                    ");
    // Long enough to pass a naive length check, and still not a password.
    expect(rule(/Not only spaces/)).not.toHaveClass("zen-checklist__item--met");

    await userEvent.clear(screen.getByLabelText(/^New password/));
    await userEvent.type(screen.getByLabelText(/^New password/), PENDING.email);
    expect(rule(/Different from your email address/)).not.toHaveClass("zen-checklist__item--met");
  });
});

describe("Change Password — saving", () => {
  async function fillValid() {
    await userEvent.type(screen.getByLabelText(/^Current password/), "Lab3-Demo-Only!2026");
    await userEvent.type(screen.getByLabelText(/^New password/), "a sufficiently long passphrase");
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), "a sufficiently long passphrase");
  }

  it("sends the three fields and continues to the role's landing page", async () => {
    const { calls } = mockApi({ status: 200, body: { user: { ...PENDING, mustChangePassword: false } } });
    await renderChangePassword();
    await fillValid();

    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    const save = calls.find((call) => call.url.endsWith("/api/auth/change-password"))!;
    expect(JSON.parse(String(save.init!.body))).toEqual({
      currentPassword: "Lab3-Demo-Only!2026",
      newPassword: "a sufficiently long passphrase",
      confirmPassword: "a sufficiently long passphrase",
    });
  });

  it("puts a wrong current password on its own field and keeps the user signed in", async () => {
    mockApi({
      status: 400,
      body: {
        error: {
          code: "VALIDATION_FAILED",
          message: "The password could not be changed.",
          fieldErrors: { currentPassword: "That is not your current password." },
        },
      },
    });
    await renderChangePassword();
    await fillValid();

    await userEvent.click(screen.getByRole("button", { name: "Save new password" }));

    expect(await screen.findByText("That is not your current password.")).toBeInTheDocument();
    // A typo must not be treated as a lost session: the server answers 400 here
    // precisely so the client does not sign the user out (BR-47).
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Sign in to your account" })).not.toBeInTheDocument();
    // The rejected secret is cleared; the rest of the form survives.
    expect(screen.getByLabelText(/^Current password/)).toHaveValue("");
    expect(screen.getByLabelText(/^New password/)).toHaveValue("a sufficiently long passphrase");
  });
});
