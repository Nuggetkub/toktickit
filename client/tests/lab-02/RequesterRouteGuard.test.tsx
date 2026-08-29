import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import { REQUESTER_STORAGE_KEY } from "../../src/requester/index.js";

// UI-02 — AC-02. A requester-scoped route opened directly must show the
// selector, and must not fetch or render any ticket data on the way.

const REQUESTERS = [{ id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local" }];

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function mockFetch(body: unknown = REQUESTERS) {
  const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("requester route guard", () => {
  it.each(["/tickets", "/create"])("sends an unselected visitor at %s to the selector", async (path) => {
    mockFetch();
    renderAt(path);

    expect(
      await screen.findByRole("heading", { name: "Development Requester Selection" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create Ticket" })).not.toBeInTheDocument();
  });

  it("hides the requester navigation until a requester is chosen", async () => {
    mockFetch();
    renderAt("/tickets");

    await screen.findByRole("heading", { name: "Development Requester Selection" });
    expect(screen.queryByRole("button", { name: "My Tickets" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change Requester" })).not.toBeInTheDocument();
  });

  it("restores a stored requester and lets the guarded route render", async () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "1");
    mockFetch();
    renderAt("/tickets");

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
    // The name appears in the shell banner and again in the page body.
    expect(screen.getAllByText("Nadia Rahman").length).toBeGreaterThan(0);
  });

  it("drops a stored requester who is no longer active", async () => {
    // BR-06: a requester deactivated since the id was stored must not remain the
    // context. The API no longer lists them, so the stored claim resolves to
    // nothing and is discarded.
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "999");
    mockFetch();
    renderAt("/tickets");

    expect(
      await screen.findByRole("heading", { name: "Development Requester Selection" }),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(REQUESTER_STORAGE_KEY)).toBeNull();
  });

  it("does not bounce a returning requester while the stored id is being resolved", async () => {
    window.localStorage.setItem(REQUESTER_STORAGE_KEY, "1");
    mockFetch();
    renderAt("/tickets");

    // Before resolution completes the guard must wait, not redirect.
    expect(screen.getByRole("status")).toHaveTextContent(/Restoring your Development Requester/i);
    expect(
      screen.queryByRole("heading", { name: "Development Requester Selection" }),
    ).not.toBeInTheDocument();

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
  });
});
