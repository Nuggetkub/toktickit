import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

// UI-06 in docs/lab-04/tests.md (AC-02, AC-19, AC-20): the Requester Dashboard
// of Lab 4 ui-spec §3, on the real screen. Labels, explanation lines and empty
// messages are transcribed from the ui-spec.

const REQUESTER = { id: 3, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", mustChangePassword: false };
const ACTIVE = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED";

const row = (id: number, status: string, extra: Record<string, unknown> = {}) => ({
  id, ticketNumber: `TKT-2026-000${id}`, summary: `Ticket ${id}`, currentStatus: status, requestedPriority: "MEDIUM",
  updatedAt: "2026-10-02T09:00:00.000Z", ...extra,
});

function data(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-10-03T08:00:00.000Z",
    windowStart: "2026-09-26T08:00:00.000Z",
    cards: {
      activeTickets: { value: 3, query: { currentStatus: ACTIVE } },
      waitingForMe: { value: 1, query: { currentStatus: "WAITING_FOR_REQUESTER" } },
      resolvedAwaitingClosure: { value: 2, query: { currentStatus: "RESOLVED" } },
      resolvedLast7Days: { value: 1, query: null },
    },
    lists: {
      needsAttention: { total: 3, items: [row(11, "WAITING_FOR_REQUESTER"), row(12, "RESOLVED"), row(13, "RESOLVED")] },
      recentlyUpdated: { total: 9, items: [row(21, "OPEN"), row(22, "NEW")] },
      recentlyResolved: { total: 1, items: [row(31, "CLOSED", { resolvedAt: "2026-10-01T10:00:00.000Z" })] },
    },
    ...overrides,
  };
}

type Reply = { status: number; body: unknown } | "defer";

function mockApi(replies: Reply[]) {
  const calls: string[] = [];
  const queue = [...replies];
  const held: Array<() => void> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(`${url.pathname}${url.search}`);
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (url.pathname === "/api/auth/me") return answer(200, { user: REQUESTER });
    if (url.pathname === "/api/dashboard/requester") {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next === "defer") return new Promise((resolve) => held.push(() => resolve(answer(200, data()))));
      return answer(next.status, next.body);
    }
    if (url.pathname === "/api/tickets") return answer(200, { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
    if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    throw new Error(`Unexpected request: ${url.pathname}`);
  }));
  return { calls, held };
}

const ok = (body: unknown = data()): Reply => ({ status: 200, body });

async function renderDashboard() {
  render(<MemoryRouter initialEntries={["/dashboard"]}><App /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Dashboard" });
}

const hrefOf = (name: string) => screen.getByRole("link", { name }).getAttribute("href");

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-06 the four cards", () => {
  it("show each count as a sentence with its explanation, and link into My Tickets filtered", async () => {
    mockApi([ok()]);
    await renderDashboard();
    await screen.findByRole("link", { name: "My active tickets: 3 tickets" });
    expect(hrefOf("My active tickets: 3 tickets")).toBe(`/tickets?currentStatus=${encodeURIComponent(ACTIVE)}`);
    expect(hrefOf("Waiting for me: 1 ticket")).toBe("/tickets?currentStatus=WAITING_FOR_REQUESTER");
    expect(hrefOf("Resolved — please check: 2 tickets")).toBe("/tickets?currentStatus=RESOLVED");
    expect(hrefOf("Resolved in the last 7 days: 1 ticket")).toBe("#recently-resolved");
    for (const line of ["Submitted and still being worked on", "IT Staff need information from you", "Fixed by IT Staff, awaiting closure", "Including tickets now closed"]) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
  });

  it("drill down: Waiting for me opens My Tickets already asking for that status", async () => {
    const { calls } = mockApi([ok()]);
    await renderDashboard();
    await userEvent.click(await screen.findByRole("link", { name: "Waiting for me: 1 ticket" }));
    await screen.findByRole("heading", { name: "My Tickets" });
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/tickets?") && c.includes("currentStatus=WAITING_FOR_REQUESTER"))).toBe(true));
    expect(screen.getByLabelText("Current Status")).toHaveValue("WAITING_FOR_REQUESTER");
  });

  it("drill down: My active tickets opens My Tickets with Active tickets chosen", async () => {
    const { calls } = mockApi([ok()]);
    await renderDashboard();
    await userEvent.click(await screen.findByRole("link", { name: "My active tickets: 3 tickets" }));
    await screen.findByRole("heading", { name: "My Tickets" });
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/tickets?") && c.includes(`currentStatus=${encodeURIComponent(ACTIVE)}`))).toBe(true));
    expect(screen.getByLabelText("Current Status")).toHaveValue("ACTIVE");
  });
});

describe("UI-06 the three panels", () => {
  it("each row links to the Requester's Ticket Detail, with its status in words and a time", async () => {
    mockApi([ok()]);
    await renderDashboard();
    const attention = await screen.findByRole("region", { name: "Needs your attention" });
    expect(within(attention).getByText("Showing 3 of 3")).toBeInTheDocument();
    expect(within(attention).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/tickets/11", "/tickets/12", "/tickets/13"]);
    expect(within(attention).getByText("Waiting for Requester")).toBeInTheDocument();

    const updated = screen.getByRole("region", { name: "Recently updated" });
    expect(within(updated).getByText("Showing 2 of 9")).toBeInTheDocument();
    expect(within(updated).getByRole("link", { name: "View all" })).toHaveAttribute("href", "/tickets");

    const resolved = screen.getByRole("region", { name: "Recently resolved" });
    expect(within(resolved).getByRole("link", { name: /TKT-2026-00031/ })).toHaveAttribute("href", "/tickets/31");
    expect(within(resolved).getByText(/^Resolved /)).toBeInTheDocument();
  });

  it("say what is empty when a panel has nothing", async () => {
    mockApi([ok(data({ lists: { needsAttention: { total: 0, items: [] }, recentlyUpdated: { total: 2, items: [row(21, "OPEN"), row(22, "NEW")] }, recentlyResolved: { total: 0, items: [] } } }))]);
    await renderDashboard();
    expect(await screen.findByText("Nothing needs your attention.")).toBeInTheDocument();
    expect(screen.getByText("No ticket was resolved in the last 7 days.")).toBeInTheDocument();
  });
});

describe("UI-06 the states", () => {
  it("a Requester with no tickets at all sees zeros, the empty message and Create Ticket", async () => {
    const zero = (q: Record<string, string> | null) => ({ value: 0, query: q });
    const none = { total: 0, items: [] };
    mockApi([ok(data({
      cards: { activeTickets: zero({ currentStatus: ACTIVE }), waitingForMe: zero({ currentStatus: "WAITING_FOR_REQUESTER" }), resolvedAwaitingClosure: zero({ currentStatus: "RESOLVED" }), resolvedLast7Days: zero(null) },
      lists: { needsAttention: none, recentlyUpdated: none, recentlyResolved: none },
    }))]);
    await renderDashboard();
    expect(await screen.findByRole("link", { name: "My active tickets: 0 tickets" })).toBeInTheDocument();
    expect(screen.getByText("You have not submitted any tickets yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Create Ticket" })).toHaveAttribute("href", "/create");
  });

  it("loading: says so before any number", async () => {
    const { held } = mockApi(["defer"]);
    await renderDashboard();
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard…");
    expect(screen.queryByRole("link", { name: /My active tickets/ })).not.toBeInTheDocument();
    await waitFor(() => expect(held).toHaveLength(1));
    held[0]();
    expect(await screen.findByRole("link", { name: "My active tickets: 3 tickets" })).toBeInTheDocument();
  });

  it("failure: an alert with Retry and nothing stale beside it; Retry loads", async () => {
    mockApi([ok(), { status: 503, body: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "x" } } }, ok()]);
    await renderDashboard();
    await screen.findByRole("link", { name: "My active tickets: 3 tickets" });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The dashboard could not be loaded. Please try again.");
    expect(screen.queryByRole("link", { name: /My active tickets/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "My active tickets: 3 tickets" })).toBeInTheDocument();
  });
});

describe("UI-06 the role boundary", () => {
  it("never requests the staff dashboard or any /api/staff path", async () => {
    const { calls } = mockApi([ok()]);
    await renderDashboard();
    await screen.findByRole("link", { name: "My active tickets: 3 tickets" });
    expect(calls.some((c) => c.startsWith("/api/dashboard/staff") || c.startsWith("/api/staff"))).toBe(false);
  });

  it("lands on the Dashboard, the first item of the Requester's navigation", async () => {
    mockApi([ok()]);
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Dashboard" });
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const items = within(nav).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual(["Dashboard", "My Tickets", "Create Ticket"]);
    expect(items[0]).toHaveAttribute("aria-current", "page");
  });
});
