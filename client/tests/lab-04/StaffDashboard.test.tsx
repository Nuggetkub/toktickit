import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

// UI-05 in docs/lab-04/tests.md (AC-18 to AC-21): the IT Staff and
// Administrator Dashboard of Lab 4 ui-spec §3, on the real screen. Labels,
// sentences and link targets are transcribed from the ui-spec and api-spec §6.

const STAFF = { id: 7, fullName: "Grace Okafor", email: "grace.okafor@toktickit.local", role: "IT_STAFF", mustChangePassword: false };
const ADMIN = { id: 1, fullName: "Pim Srisawat", email: "pim.srisawat@toktickit.local", role: "ADMINISTRATOR", mustChangePassword: false };
const REQUESTER = { id: 3, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", mustChangePassword: false };
const ACTIVE = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED";
const STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
const PAST = "2026-09-20T09:00:00.000Z";
const FUTURE = "2099-01-01T09:00:00.000Z";

function ticketCard(id: number, overrides: Record<string, unknown> = {}) {
  return { id, ticketNumber: `TKT-2026-000${id}`, summary: `Ticket ${id}`, currentStatus: "OPEN", itPriority: "URGENT", owner: null, updatedAt: PAST, ...overrides };
}

function staffData(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: "2026-10-03T08:00:00.000Z",
    windowStart: "2026-09-26T08:00:00.000Z",
    cards: {
      unassignedActive: { value: 4, query: { owner: "unassigned", currentStatus: ACTIVE } },
      myActive: { value: 1, query: { owner: "me", currentStatus: ACTIVE } },
      myOpenActions: { value: 2, query: null },
      requesterIndicated: { value: 0, query: { requesterIndicated: "true", currentStatus: ACTIVE } },
    },
    byStatus: Object.fromEntries(STATUSES.map((s, i) => [s, { value: i === 5 ? 0 : i + 1, query: { currentStatus: s } }])),
    activeByItPriority: Object.fromEntries(["URGENT", "HIGH", "MEDIUM", "LOW"].map((p, i) => [p, { value: i, query: { itPriority: p, currentStatus: ACTIVE } }])),
    lists: {
      myOpenActions: { total: 2, items: [
        { actionId: 31, ticketId: 41, ticketNumber: "TKT-2026-00041", summary: "Printer jam", actionAt: PAST, description: "Replace the fuser.\nSecond line." },
        { actionId: 32, ticketId: 42, ticketNumber: "TKT-2026-00042", summary: "Wi-Fi drops", actionAt: FUTURE, description: "Swap the access point." },
      ] },
      urgentActive: { total: 7, items: [ticketCard(51), ticketCard(52)] },
      recentlyUpdated: { total: 9, items: [ticketCard(61, { owner: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" } })] },
    },
    ...overrides,
  };
}

type Reply = { status: number; body: unknown } | "defer";

/** Answers the dashboard from a script; records every request path. */
function mockApi(user: unknown, replies: Reply[]) {
  const calls: string[] = [];
  const queue = [...replies];
  const held: Array<() => void> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    calls.push(`${url.pathname}${url.search}`);
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (url.pathname === "/api/auth/me") return answer(200, { user });
    if (url.pathname === "/api/dashboard/staff") {
      const next = queue.length > 1 ? queue.shift()! : queue[0];
      if (next === "defer") return new Promise((resolve) => held.push(() => resolve(answer(200, staffData()))));
      return answer(next.status, next.body);
    }
    if (url.pathname === "/api/staff/tickets") return answer(200, { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
    if (url.pathname === "/api/staff/assignees" || url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    if (url.pathname === "/api/tickets") return answer(200, { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 });
    if (url.pathname === "/api/dashboard/requester") return answer(503, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "x" } });
    throw new Error(`Unexpected request: ${url.pathname}`);
  }));
  return { calls, held };
}

const ok = (body: unknown = staffData()): Reply => ({ status: 200, body });

async function renderDashboard() {
  render(<MemoryRouter initialEntries={["/dashboard"]}><App /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Dashboard" });
}

const hrefOf = (name: string | RegExp) => screen.getByRole("link", { name }).getAttribute("href");
const activeParam = encodeURIComponent(ACTIVE);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-05 the four cards", () => {
  it("show each count as a sentence, and link to the list each one counted, built from its query", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    await screen.findByRole("link", { name: "Unassigned: 4 tickets" });
    expect(hrefOf("Unassigned: 4 tickets")).toBe(`/queue?owner=unassigned&currentStatus=${activeParam}`);
    expect(hrefOf("My active tickets: 1 ticket")).toBe(`/queue?owner=me&currentStatus=${activeParam}`);
    expect(hrefOf("My open actions: 2 actions")).toBe("#my-open-actions");
    expect(hrefOf("Requester says resolved: 0 tickets")).toBe(`/queue?requesterIndicated=true&currentStatus=${activeParam}`);
    expect(screen.getByText("Actions assigned to you that are still open")).toBeInTheDocument();
  });

  it("drill down: the Unassigned card opens the queue already asking for unassigned active tickets", async () => {
    const { calls } = mockApi(STAFF, [ok()]);
    await renderDashboard();
    await userEvent.click(await screen.findByRole("link", { name: "Unassigned: 4 tickets" }));
    await screen.findByRole("heading", { name: "Ticket Queue" });
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/staff/tickets?") && c.includes("owner=unassigned") && c.includes(`currentStatus=${activeParam}`))).toBe(true));
    expect(screen.getByLabelText("Status")).toHaveValue("ACTIVE");
    expect(screen.getByLabelText("Owner")).toHaveValue("unassigned");
  });
});

describe("UI-05 the breakdowns", () => {
  it("list all eight statuses, zeros included, each a link to that status", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    const panel = (await screen.findByRole("heading", { name: "Tickets by status" })).closest("section")!;
    const links = within(panel).getAllByRole("link");
    expect(links).toHaveLength(8);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(STATUSES.map((s) => `/queue?currentStatus=${s}`));
    expect(within(panel).getByRole("link", { name: "Closed: 0 tickets" })).toBeInTheDocument();
  });

  it("list all four IT priorities among active tickets, zeros included", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    const panel = (await screen.findByRole("heading", { name: "Active by IT Priority" })).closest("section")!;
    const links = within(panel).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["URGENT", "HIGH", "MEDIUM", "LOW"].map((p) => `/queue?itPriority=${p}&currentStatus=${activeParam}`));
    expect(within(panel).getByRole("link", { name: "Active, IT Priority URGENT: 0 tickets" })).toBeInTheDocument();
  });
});

describe("UI-05 the panels", () => {
  it("My open actions: each row opens its Ticket at that Action, and only a past one is Overdue", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    const panel = await screen.findByRole("region", { name: "My open actions" });
    expect(within(panel).getByText("Showing 2 of 2")).toBeInTheDocument();
    const [late, planned] = within(panel).getAllByRole("listitem");
    expect(within(late).getByRole("link")).toHaveAttribute("href", "/queue/41#action-31");
    expect(within(late).getByText("Overdue")).toBeInTheDocument();
    expect(within(late).getByText("Replace the fuser.")).toBeInTheDocument();
    expect(within(late).queryByText(/Second line/)).not.toBeInTheDocument();
    expect(within(planned).getByRole("link")).toHaveAttribute("href", "/queue/42#action-32");
    expect(within(planned).queryByText("Overdue")).not.toBeInTheDocument();
  });

  it("Urgent active tickets and Recently updated open each Ticket, say how many of how many, and offer View all", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    const urgent = (await screen.findByRole("heading", { name: "Urgent active tickets" })).closest("section")!;
    expect(within(urgent).getByText("Showing 2 of 7")).toBeInTheDocument();
    expect(within(urgent).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/queue/51", "/queue/52", `/queue?itPriority=URGENT&currentStatus=${activeParam}`]);
    const recent = screen.getByRole("heading", { name: "Recently updated" }).closest("section")!;
    expect(within(recent).getByText(/Grace Okafor/)).toBeInTheDocument();
  });
});

describe("UI-05 the Administrator's User accounts panel (BR-28)", () => {
  it("is shown to an Administrator, each role linking to User Management filtered by it", async () => {
    mockApi(ADMIN, [ok(staffData({ users: {
      REQUESTER: { active: 5, inactive: 1, query: { role: "REQUESTER" } },
      IT_STAFF: { active: 3, inactive: 0, query: { role: "IT_STAFF" } },
      ADMINISTRATOR: { active: 1, inactive: 0, query: { role: "ADMINISTRATOR" } },
    } }))]);
    await renderDashboard();
    const panel = (await screen.findByRole("heading", { name: "User accounts" })).closest("section")!;
    const links = within(panel).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(["Requester 5 active · 1 inactive", "IT Staff 3 active · 0 inactive", "Administrator 1 active · 0 inactive"]);
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/users?role=REQUESTER", "/users?role=IT_STAFF", "/users?role=ADMINISTRATOR"]);
  });

  it("is absent for IT Staff", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    await screen.findByRole("link", { name: "Unassigned: 4 tickets" });
    expect(screen.queryByRole("heading", { name: "User accounts" })).not.toBeInTheDocument();
  });
});

describe("UI-05 the states", () => {
  it("loading: says so, with placeholders, before any number", async () => {
    const { held } = mockApi(STAFF, ["defer"]);
    await renderDashboard();
    expect(screen.getByRole("status")).toHaveTextContent("Loading dashboard…");
    expect(screen.queryByRole("link", { name: /Unassigned/ })).not.toBeInTheDocument();
    await waitFor(() => expect(held).toHaveLength(1));
    held[0]();
    expect(await screen.findByRole("link", { name: "Unassigned: 4 tickets" })).toBeInTheDocument();
  });

  it("failure: an alert with Retry and no numbers beside it; Retry loads", async () => {
    mockApi(STAFF, [{ status: 503, body: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "x" } } }, ok()]);
    await renderDashboard();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The dashboard could not be loaded. Please try again.");
    expect(screen.queryByRole("link", { name: /Unassigned/ })).not.toBeInTheDocument();
    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: "Unassigned: 4 tickets" })).toBeInTheDocument();
  });

  it("a failed refresh removes the old numbers rather than leaving them beside the alert", async () => {
    mockApi(STAFF, [ok(), { status: 503, body: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "x" } } }]);
    await renderDashboard();
    await screen.findByRole("link", { name: "Unassigned: 4 tickets" });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: /Unassigned/ })).not.toBeInTheDocument();
    // Nor the old "Updated …" time, which would date the failure to a moment
    // the screen no longer shows.
    expect(screen.queryByText(/^Updated /)).not.toBeInTheDocument();
  });

  it("refreshing: the current numbers stay, and Refresh reads Refreshing… and is disabled", async () => {
    const { held } = mockApi(STAFF, [ok(), "defer"]);
    await renderDashboard();
    await screen.findByRole("link", { name: "Unassigned: 4 tickets" });
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(screen.getByRole("button", { name: "Refreshing…" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Unassigned: 4 tickets" })).toBeInTheDocument();
    await waitFor(() => expect(held).toHaveLength(1));
    held[0]();
    expect(await screen.findByRole("button", { name: "Refresh" })).toBeEnabled();
  });

  it("forbidden: a 403 shows the Forbidden card", async () => {
    mockApi(STAFF, [{ status: 403, body: { error: { code: "FORBIDDEN", message: "No." } } }]);
    render(<MemoryRouter initialEntries={["/dashboard"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "You do not have access to this page" })).toBeInTheDocument();
  });

  it("empty: every count is 0 and every panel says what is empty; zero rows stay links", async () => {
    const zero = (q: Record<string, string> | null) => ({ value: 0, query: q });
    mockApi(STAFF, [ok(staffData({
      cards: { unassignedActive: zero({ owner: "unassigned" }), myActive: zero({ owner: "me" }), myOpenActions: zero(null), requesterIndicated: zero({ requesterIndicated: "true" }) },
      byStatus: Object.fromEntries(STATUSES.map((s) => [s, zero({ currentStatus: s })])),
      activeByItPriority: Object.fromEntries(["URGENT", "HIGH", "MEDIUM", "LOW"].map((p) => [p, zero({ itPriority: p })])),
      lists: { myOpenActions: { total: 0, items: [] }, urgentActive: { total: 0, items: [] }, recentlyUpdated: { total: 0, items: [] } },
    }))]);
    await renderDashboard();
    expect(await screen.findByRole("link", { name: "Unassigned: 0 tickets" })).toBeInTheDocument();
    expect(screen.getByText("You have no open actions.")).toBeInTheDocument();
    expect(screen.getByText("No urgent active tickets.")).toBeInTheDocument();
    expect(screen.getByText("No tickets yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New: 0 tickets" })).toHaveAttribute("href", "/queue?currentStatus=NEW");
    expect(screen.queryByRole("link", { name: "View all" })).not.toBeInTheDocument();
  });
});

describe("UI-05 the role boundary, both directions", () => {
  it("IT Staff never ask the Requester dashboard", async () => {
    const { calls } = mockApi(STAFF, [ok()]);
    await renderDashboard();
    await screen.findByRole("link", { name: "Unassigned: 4 tickets" });
    expect(calls.some((c) => c.startsWith("/api/dashboard/requester"))).toBe(false);
  });

  it("a Requester at /dashboard gets their own dashboard and never asks for the staff one", async () => {
    const { calls } = mockApi(REQUESTER, [ok()]);
    render(<MemoryRouter initialEntries={["/dashboard"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Dashboard" });
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/dashboard/requester"))).toBe(true));
    expect(calls.some((c) => c.startsWith("/api/dashboard/staff"))).toBe(false);
  });
});

describe("UI-05 the navigation marks the Dashboard as the current page", () => {
  it("with aria-current, Dashboard first", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    const nav = screen.getByRole("navigation", { name: "Primary" });
    const items = within(nav).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual(["Dashboard", "Ticket Queue"]);
    expect(items[0]).toHaveAttribute("aria-current", "page");
  });
});

// Earth2509's non-blocking follow-ups on PR #101.
describe("UI-05 follow-ups from the #101 review", () => {
  it("Recently updated's View all opens the queue in the panel's order, last updated first", async () => {
    const { calls } = mockApi(STAFF, [ok()]);
    await renderDashboard();
    const recent = (await screen.findByRole("heading", { name: "Recently updated" })).closest("section")!;
    const viewAll = within(recent).getByRole("link", { name: "View all" });
    expect(viewAll).toHaveAttribute("href", "/queue?sortBy=updatedAt&sortOrder=desc");
    await userEvent.click(viewAll);
    await screen.findByRole("heading", { name: "Ticket Queue" });
    await waitFor(() => expect(calls.some((c) => c.startsWith("/api/staff/tickets?") && c.includes("sortBy=updatedAt") && c.includes("sortOrder=desc"))).toBe(true));
    expect(screen.getByLabelText("Sort")).toHaveValue("updatedAt:desc");
  });

  it("puts the links in the keyboard order of ui-spec §7: cards, then breakdowns, then panels", async () => {
    mockApi(STAFF, [ok()]);
    await renderDashboard();
    const lastCard = await screen.findByRole("link", { name: "Requester says resolved: 0 tickets" });
    const firstBreakdown = screen.getByRole("link", { name: "New: 1 ticket" });
    const lastBreakdown = screen.getByRole("link", { name: "Active, IT Priority LOW: 3 tickets" });
    const firstPanelRow = within(screen.getByRole("region", { name: "My open actions" })).getAllByRole("link")[0];
    const follows = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(lastCard, firstBreakdown)).toBe(true);
    expect(follows(lastBreakdown, firstPanelRow)).toBe(true);
  });
});
