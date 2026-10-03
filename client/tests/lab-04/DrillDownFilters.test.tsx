import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

// UI-07 in docs/lab-04/tests.md (AC-20, AC-22), the staff screens' half
// (issue #87): the Ticket Queue and User Management read a dashboard link's
// filters from the URL and request exactly those (Lab 4 ui-spec §2). My
// Tickets' half arrives with the Requester dashboard (issue #88).

const STAFF = { id: 7, fullName: "Grace Okafor", email: "grace.okafor@toktickit.local", role: "IT_STAFF", mustChangePassword: false };
const ADMIN = { id: 1, fullName: "Pim Srisawat", email: "pim.srisawat@toktickit.local", role: "ADMINISTRATOR", mustChangePassword: false };
const ACTIVE = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED";
const EMPTY_PAGE = { items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1 };

/** Records each list request's parameters; a refused value answers 400, as the server does. */
function mockApi(user: unknown, refuse: (params: URLSearchParams) => boolean = () => false) {
  const queueCalls: URLSearchParams[] = [];
  const userCalls: URLSearchParams[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (url.pathname === "/api/auth/me") return answer(200, { user });
    if (url.pathname === "/api/staff/tickets") {
      queueCalls.push(url.searchParams);
      return refuse(url.searchParams)
        ? answer(400, { error: { code: "VALIDATION_FAILED", message: "The Ticket Queue query is not valid.", fieldErrors: { currentStatus: "No." } } })
        : answer(200, EMPTY_PAGE);
    }
    if (url.pathname === "/api/admin/users") {
      userCalls.push(url.searchParams);
      return refuse(url.searchParams)
        ? answer(400, { error: { code: "VALIDATION_FAILED", message: "Not valid.", fieldErrors: { role: "No." } } })
        : answer(200, { items: [] });
    }
    if (url.pathname === "/api/staff/assignees" || url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    throw new Error(`Unexpected request: ${url.pathname}`);
  }));
  return { queueCalls, userCalls };
}

let location = { pathname: "", search: "" };
let go: (delta: number) => void = () => undefined;
function Probe() {
  const current = useLocation();
  const navigate = useNavigate();
  location = current;
  go = (delta) => navigate(delta);
  return null;
}

function renderAt(entries: Array<string | { pathname: string; search?: string; state?: unknown }>) {
  render(<MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}><Probe /><App /></MemoryRouter>);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-07 the Ticket Queue reads a link's filters from the URL", () => {
  it("requests exactly the four drill-down filters, and the controls show them", async () => {
    const { queueCalls } = mockApi(STAFF);
    renderAt([`/queue?currentStatus=${encodeURIComponent(ACTIVE)}&itPriority=HIGH&owner=me&requesterIndicated=true`]);
    await screen.findByRole("heading", { name: "Ticket Queue" });
    await waitFor(() => expect(queueCalls.length).toBeGreaterThan(0));
    const sent = queueCalls[0];
    expect([sent.get("currentStatus"), sent.get("itPriority"), sent.get("owner"), sent.get("requesterIndicated")]).toEqual([ACTIVE, "HIGH", "me", "true"]);
    expect(screen.getByLabelText("Status")).toHaveValue("ACTIVE");
    expect(screen.getByLabelText("IT Priority")).toHaveValue("HIGH");
    expect(screen.getByLabelText("Owner")).toHaveValue("me");
    expect(screen.getByLabelText("Requester says resolved")).toBeChecked();
  });

  it("offers Active tickets in Status, which sends the five active statuses", async () => {
    const { queueCalls } = mockApi(STAFF);
    renderAt(["/queue"]);
    await screen.findByRole("heading", { name: "Ticket Queue" });
    await userEvent.selectOptions(screen.getByLabelText("Status"), "Active tickets");
    await waitFor(() => expect(queueCalls.at(-1)!.get("currentStatus")).toBe(ACTIVE));
  });

  it("sends a value it cannot show as written, and shows the server's refusal with Clear filters", async () => {
    const { queueCalls } = mockApi(STAFF, (p) => p.get("currentStatus") === "DONE");
    renderAt(["/queue?currentStatus=DONE"]);
    const message = await screen.findByText("This link's filter is not valid.");
    expect(queueCalls[0].get("currentStatus")).toBe("DONE");

    // The alert's own Clear filters (the toolbar has one too).
    await userEvent.click(within(message.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(queueCalls.at(-1)!.has("currentStatus")).toBe(false));
    expect(screen.queryByText("This link's filter is not valid.")).not.toBeInTheDocument();
    expect(location.search).toBe("");
  });

  it("refuses an empty value from a link instead of quietly listing everything", async () => {
    const { queueCalls } = mockApi(STAFF);
    renderAt(["/queue?currentStatus="]);
    expect(await screen.findByText("This link's filter is not valid.")).toBeInTheDocument();
    expect(queueCalls).toHaveLength(0);
  });

  it("a later filter change replaces the URL, so Back returns to the dashboard", async () => {
    const { queueCalls } = mockApi(STAFF);
    renderAt(["/dashboard", "/queue?owner=me"]);
    await screen.findByRole("heading", { name: "Ticket Queue" });
    await userEvent.selectOptions(screen.getByLabelText("IT Priority"), "URGENT");
    await waitFor(() => expect(location.search).toBe("?itPriority=URGENT&owner=me"));
    await waitFor(() => expect(queueCalls.at(-1)!.get("itPriority")).toBe("URGENT"));
    go(-1);
    await waitFor(() => expect(location.pathname).toBe("/dashboard"));
  });

  it("lets the Lab 3 Back-to-queue restore win over the URL", async () => {
    const { queueCalls } = mockApi(STAFF);
    const restored = { queue: { filters: { search: "", currentStatus: "CLOSED", itPriority: "", categoryId: "", owner: "", requesterIndicated: false, sort: "ticketDate:desc" }, page: 1 } };
    renderAt([{ pathname: "/queue", search: "?currentStatus=OPEN", state: restored }]);
    await screen.findByRole("heading", { name: "Ticket Queue" });
    await waitFor(() => expect(queueCalls.length).toBeGreaterThan(0));
    expect(queueCalls[0].get("currentStatus")).toBe("CLOSED");
  });
});

describe("UI-07 User Management reads the role from the URL", () => {
  it("requests the role a dashboard row links to, and shows it", async () => {
    const { userCalls } = mockApi(ADMIN);
    renderAt(["/users?role=IT_STAFF"]);
    await screen.findByRole("heading", { name: "User Management" });
    await waitFor(() => expect(userCalls.length).toBeGreaterThan(0));
    expect(userCalls[0].get("role")).toBe("IT_STAFF");
    expect(screen.getByLabelText("Role")).toHaveValue("IT_STAFF");
  });

  it("sends an unknown role as written, shows the refusal, and Clear filters lists every role", async () => {
    const { userCalls } = mockApi(ADMIN, (p) => p.get("role") === "BOSS");
    renderAt(["/users?role=BOSS"]);
    expect(await screen.findByText("This link's filter is not valid.")).toBeInTheDocument();
    expect(userCalls[0].get("role")).toBe("BOSS");
    await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(userCalls.at(-1)!.has("role")).toBe(false));
    expect(location.search).toBe("");
  });
});
