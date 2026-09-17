import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-03 — AC-07, AC-09, AC-10 (docs/lab-03/tests.md).
//
// The shell decides what is *offered*, never what is permitted: issue #47 put
// every endpoint behind the authorization matrix, and these tests exist so the
// interface agrees with it rather than substitutes for it. The Forbidden case
// below is the one that matters — a role opening a URL it was never shown.

const USERS = {
  requester: {
    id: 1,
    fullName: "Nadia Rahman",
    email: "nadia.rahman@toktickit.local",
    role: "REQUESTER",
    mustChangePassword: false,
  },
  staff: {
    id: 7,
    fullName: "Grace Okafor",
    email: "grace.okafor@toktickit.local",
    role: "IT_STAFF",
    mustChangePassword: false,
  },
};

function mockApi(user: unknown | null, ticketsAnswer?: { status: number; body?: unknown }) {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string) => {
    const target = String(url);
    calls.push(target);

    const json = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
      headers: new Headers(),
    });

    if (target.endsWith("/api/auth/me")) {
      return user ? json(200, { user }) : json(401, {});
    }
    if (target.endsWith("/api/auth/logout")) return json(204, {});
    if (target.includes("/api/tickets")) {
      const answer = ticketsAnswer ?? {
        status: 200,
        body: { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 },
      };
      return json(answer.status, answer.body ?? {});
    }
    if (target.includes("/api/staff/tickets")) {
      return json(200, { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
    }
    if (target.includes("/api/staff/assignees")) return json(200, []);
    if (target.includes("/api/categories") || target.includes("/api/related-systems")) return json(200, []);
    throw new Error(`Unexpected request: ${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Application shell — who is signed in", () => {
  it("shows the user's name, their role in words, and the way out", async () => {
    mockApi(USERS.requester);
    renderAt("/tickets");

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    expect(screen.getAllByText("Nadia Rahman").length).toBeGreaterThan(0);
    // The role is carried by words, not only by a colour (ui-spec.md §1).
    expect(screen.getByText("Requester")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change password" })).toBeInTheDocument();
  });

  it("offers a Requester their two screens and nothing else", async () => {
    mockApi(USERS.requester);
    renderAt("/tickets");
    await screen.findByRole("heading", { name: "My Tickets" });

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveTextContent("My Tickets");
    expect(nav).toHaveTextContent("Create Ticket");
    expect(nav).not.toHaveTextContent(/Users|Ticket Queue/);
  });

  it("lands IT Staff on the Ticket Queue and offers them none of the Requester screens", async () => {
    // UPDATED IN LAB 3 (Issue #50). This asserted that IT Staff were offered no
    // navigation at all, which was true only while their screens did not exist.
    // The claim it was really making — that the Requester screens are not
    // offered to them — is unchanged and still asserted below.
    mockApi(USERS.staff);
    renderAt("/");

    expect(await screen.findByRole("heading", { name: "Ticket Queue" })).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Primary" });
    expect(nav).toHaveTextContent("Ticket Queue");
    expect(nav).not.toHaveTextContent(/My Tickets|Create Ticket/);

    expect(screen.getByText("Grace Okafor")).toBeInTheDocument();
    expect(screen.getByText("IT Staff")).toBeInTheDocument();
  });
});

describe("Application shell — start-up and direct URLs", () => {
  it("shows nothing private while it is still asking who the visitor is", async () => {
    mockApi(USERS.requester);
    renderAt("/tickets");

    // The answer has not arrived yet on the first paint.
    expect(screen.getByRole("status")).toHaveTextContent("Loading TokTickIT…");
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
  });

  it("sends an unauthenticated visitor to Login rather than to a broken screen", async () => {
    mockApi(null);
    renderAt("/tickets");

    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
  });

  it("shows Forbidden — not the data — when a role opens a screen it was never offered", async () => {
    mockApi(USERS.staff);
    renderAt("/tickets");

    expect(await screen.findByRole("heading", { name: "You do not have access to this page" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
  });

  it("refuses a Requester the Ticket Queue, and never asks the server for it", async () => {
    // The boundary in the other direction. Issue #50 makes /queue an
    // unauthorised destination for Requesters, and testing only the staff side
    // of a rule is the asymmetry that lets the other half rot.
    const { calls } = mockApi(USERS.requester);
    renderAt("/queue");

    expect(await screen.findByRole("heading", { name: "You do not have access to this page" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ticket Queue" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    // The guard runs before the screen mounts, so no queue request is made at
    // all. The server would refuse it anyway (issue #49) — this is about not
    // asking a question we already know the answer to.
    expect(calls.some((url) => url.includes("/api/staff/"))).toBe(false);
  });
});

describe("Application shell — the session ending", () => {
  it("returns to Login with an explanation when any request answers 401", async () => {
    // The ticket list is refused mid-session, as it would be after a logout
    // elsewhere, an expiry, or an administrator deactivating the account.
    mockApi(USERS.requester, { status: 401, body: { error: { code: "UNAUTHENTICATED" } } });
    renderAt("/tickets");

    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your session has ended. Please sign in again.");
    // Nothing of the previous session is left on screen (BR-47).
    expect(screen.queryByText("Nadia Rahman")).not.toBeInTheDocument();
  });

  it("clears the user on Log out", async () => {
    mockApi(USERS.requester);
    renderAt("/tickets");
    await screen.findByRole("heading", { name: "My Tickets" });

    await userEvent.click(screen.getByRole("button", { name: "Log out" }));

    expect(await screen.findByRole("heading", { name: "Sign in to your account" })).toBeInTheDocument();
    expect(screen.queryByText("Nadia Rahman")).not.toBeInTheDocument();
    // Logging out is not a lost session, so it is not announced as one.
    expect(screen.queryByText(/Your session has ended/)).not.toBeInTheDocument();
  });
});

describe("Application shell — the selector is gone", () => {
  it("offers no Development Requester control anywhere", async () => {
    mockApi(USERS.requester);
    renderAt("/tickets");
    await screen.findByRole("heading", { name: "My Tickets" });

    expect(screen.queryByRole("button", { name: /Change Requester/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Development Requester/i)).not.toBeInTheDocument();
  });
});
