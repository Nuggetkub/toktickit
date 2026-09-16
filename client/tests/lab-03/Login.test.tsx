import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-01 — AC-01, AC-05 (docs/lab-03/tests.md).
//
// Every failure the server can answer sign-in with has its own wording in
// ui-spec.md §3, and the reason they differ is a security decision taken on the
// server: one identical `401` for unknown email, wrong password and an account
// with no password (BR-06), and deactivation named only once the password is
// correct (BR-07). These tests assert the client renders that decision faithfully
// rather than inventing a distinction of its own.

const REQUESTER = {
  id: 1,
  fullName: "Nadia Rahman",
  email: "nadia.rahman@toktickit.local",
  role: "REQUESTER",
  mustChangePassword: false,
};

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };

/** Routed per endpoint, so an ordering mistake cannot hide behind a blanket stub. */
function mockApi(login: Answer | (() => Answer | Error), me: Answer = { status: 401, body: {} }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    calls.push({ url: target, init });

    const answer = (chosen: Answer) => ({
      ok: chosen.status < 400,
      status: chosen.status,
      json: async () => chosen.body ?? {},
      headers: new Headers(chosen.headers ?? {}),
    });

    if (target.endsWith("/api/auth/me")) return answer(me);
    if (target.endsWith("/api/auth/login")) {
      const result = typeof login === "function" ? login() : login;
      if (result instanceof Error) throw result;
      return answer(result);
    }
    // My Tickets loads after a successful sign-in; it is not what is under test.
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

async function renderLogin() {
  render(
    <MemoryRouter initialEntries={["/login"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Sign in to your account" });
}

async function signIn(email = "nadia.rahman@toktickit.local", password = "correct horse battery staple") {
  await userEvent.type(screen.getByLabelText(/^Email/), email);
  await userEvent.type(screen.getByLabelText(/^Password/), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Login — validation", () => {
  it("names each empty field beneath it and sends no request", async () => {
    const { calls } = mockApi({ status: 200, body: { user: REQUESTER } });
    await renderLogin();

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter your email address")).toBeInTheDocument();
    expect(screen.getByText("Enter your password")).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith("/api/auth/login"))).toBe(false);
    // Focus goes to the first offender, so a keyboard user is not left hunting.
    expect(screen.getByLabelText(/^Email/)).toHaveFocus();
  });

  it("rejects an address that is not an email before asking the server", async () => {
    const { calls } = mockApi({ status: 200, body: { user: REQUESTER } });
    await renderLogin();

    await userEvent.type(screen.getByLabelText(/^Email/), "nadia.rahman");
    await userEvent.type(screen.getByLabelText(/^Password/), "whatever it is");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Enter a valid email address")).toBeInTheDocument();
    expect(calls.some((call) => call.url.endsWith("/api/auth/login"))).toBe(false);
  });

  it("offers the password toggle by an accessible name, not an icon alone", async () => {
    mockApi({ status: 200, body: { user: REQUESTER } });
    await renderLogin();

    const password = screen.getByLabelText(/^Password/);
    expect(password).toHaveAttribute("type", "password");

    await userEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toBeInTheDocument();
  });
});

describe("Login — each refusal reads as the contract says", () => {
  it("shows one message for invalid credentials, keeps the email and clears the password", async () => {
    mockApi({
      status: 401,
      body: { error: { code: "INVALID_CREDENTIALS", message: "Email or password is incorrect." } },
    });
    await renderLogin();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent("Email or password is incorrect.");
    // Retyping an address to fix a password typo is a small cruelty.
    expect(screen.getByLabelText(/^Email/)).toHaveValue("nadia.rahman@toktickit.local");
    expect(screen.getByLabelText(/^Password/)).toHaveValue("");
  });

  it("names a deactivated account, because the server already decided to disclose it", async () => {
    mockApi({
      status: 403,
      body: { error: { code: "ACCOUNT_INACTIVE", message: "This account has been deactivated." } },
    });
    await renderLogin();
    await signIn();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This account has been deactivated. Contact your administrator.",
    );
  });

  it("turns Retry-After into minutes rather than showing a raw number of seconds", async () => {
    mockApi({
      status: 429,
      body: { error: { code: "LOGIN_THROTTLED", message: "Too many sign-in attempts." } },
      headers: { "Retry-After": "90" },
    });
    await renderLogin();
    await signIn();

    // 90 seconds rounds up: telling someone to wait "1 minute" when it is 90
    // seconds invites them straight back into another refusal.
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in 2 minutes.");
  });

  it("translates an unreachable API and never shows the browser's own words", async () => {
    mockApi(() => new TypeError("Failed to fetch"));
    await renderLogin();
    await signIn();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to connect to TokTickIT. Please try again.");
    expect(alert).not.toHaveTextContent(/Failed to fetch/);
  });
});

describe("Login — success", () => {
  it("sends the credentials with the session cookie enabled and lands on My Tickets", async () => {
    const { calls } = mockApi({ status: 200, body: { user: REQUESTER } });
    await renderLogin();
    await signIn();

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();

    const login = calls.find((call) => call.url.endsWith("/api/auth/login"))!;
    // Without credentials the cookie never leaves the browser and every later
    // call is a 401 (decision D-02).
    expect(login.init).toMatchObject({ credentials: "include" });
    expect(JSON.parse(String(login.init!.body))).toEqual({
      email: "nadia.rahman@toktickit.local",
      password: "correct horse battery staple",
    });
  });

  it("goes to Change Password first when the account still has its initial password", async () => {
    mockApi({ status: 200, body: { user: { ...REQUESTER, mustChangePassword: true } } });
    await renderLogin();
    await signIn();

    expect(await screen.findByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    // BR-02: nothing else is reachable, so nothing else is offered.
    expect(screen.queryByRole("button", { name: "My Tickets" })).not.toBeInTheDocument();
  });

  it("disables the form while the request is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockApi(() => {
      // Resolve only when the test says so, so the busy state is observable.
      void gate;
      return { status: 200, body: { user: REQUESTER } };
    });

    await renderLogin();
    await userEvent.type(screen.getByLabelText(/^Email/), "nadia.rahman@toktickit.local");
    await userEvent.type(screen.getByLabelText(/^Password/), "correct horse battery staple");

    const button = screen.getByRole("button", { name: "Sign in" });
    await userEvent.click(button);
    release();

    await waitFor(() => expect(screen.queryByRole("heading", { name: "My Tickets" })).toBeInTheDocument());
  });
});

describe("Login — what it must never show", () => {
  it("offers no Forgot password link and no Development Requester selector", async () => {
    mockApi({ status: 200, body: { user: REQUESTER } });
    await renderLogin();

    // Both appear in the labsheet illustrations and neither exists in Lab 3
    // (ui-spec.md §12).
    expect(screen.queryByText(/forgot/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Development Requester/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Change Requester/i })).not.toBeInTheDocument();
  });
});
