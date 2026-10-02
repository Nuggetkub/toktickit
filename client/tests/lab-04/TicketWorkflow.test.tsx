import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

// UI-03 and UI-04 in docs/lab-04/tests.md (AC-11, AC-14 to AC-16): workflow
// and resolution feedback, and the status history (Lab 4 ui-spec §5), on the
// real Ticket Detail screens. The transition matrix and every sentence are
// transcribed by hand from the specification and ui-spec, not imported.

const STAFF = { id: 7, fullName: "Grace Okafor", email: "grace.okafor@toktickit.local", role: "IT_STAFF", mustChangePassword: false };
const REQUESTER = { id: 3, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", mustChangePassword: false };
const READY = { openActions: 0, completedActions: 1, latestFollowUpRequired: false, reopenedSinceWork: false, ready: true };

// BR-18, by hand from docs/lab-04/specification.md.
const NEXT: Record<string, string[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 42, ticketNumber: "TKT-2026-00042", ticketDate: "2026-09-14T09:14:22.518Z",
    requester: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" }, category: { id: 2, name: "Network" },
    relatedSystem: { id: 5, name: "Campus Wi-Fi" }, summary: "Cannot connect to Campus Wi-Fi", description: "Authentication failure.",
    requestedPriority: "HIGH", itPriority: "URGENT", currentStatus: "IN_PROGRESS",
    owner: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }, resolutionSummary: null, requesterResolvedAt: null,
    version: 4, attachments: [], attachmentCount: 0, createdAt: "2026-09-14T09:14:22.518Z", updatedAt: "2026-09-14T10:02:51.004Z",
    resolutionGate: READY,
    ...overrides,
  };
}

const HISTORY = {
  items: [
    { id: 1, fromStatus: null, toStatus: "NEW", actor: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" }, createdAt: "2026-09-14T09:14:22.518Z" },
    { id: 2, fromStatus: "NEW", toStatus: "OPEN", actor: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }, createdAt: "2026-09-14T09:20:00.000Z" },
    { id: 3, fromStatus: "OPEN", toStatus: "IN_PROGRESS", actor: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }, createdAt: "2026-09-14T09:30:00.000Z" },
  ],
  recordedFromCreation: true,
};

type Reply = { status: number; body: unknown };

/** Routes by path, counts every GET, and answers status changes from a script. */
function mockApi(opts: { user?: unknown; detail?: Record<string, unknown>; history?: unknown; statusReplies?: Reply[] } = {}) {
  const gets: Record<string, number> = {};
  const posts: Array<{ path: string; body: unknown }> = [];
  let current = opts.detail ?? ticket();
  const replies = [...(opts.statusReplies ?? [])];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (method === "GET") gets[url.pathname] = (gets[url.pathname] ?? 0) + 1;
    if (url.pathname === "/api/auth/me") return answer(200, { user: opts.user ?? STAFF });
    if (method === "POST" && url.pathname === "/api/tickets/42/status") {
      posts.push({ path: url.pathname, body: JSON.parse(String(init?.body)) });
      const next = replies.shift();
      if (!next) throw new Error("Unexpected status change");
      if (next.status < 400) current = next.body as Record<string, unknown>;
      return answer(next.status, next.body);
    }
    if (url.pathname === "/api/tickets/42") return answer(200, current);
    if (url.pathname === "/api/tickets/42/history") return answer(200, opts.history ?? HISTORY);
    if (url.pathname === "/api/tickets/42/actions") return answer(200, { items: [] });
    if (["/api/tickets/42/comments", "/api/tickets/42/internal-notes", "/api/tickets/42/attachments"].includes(url.pathname)) return answer(200, []);
    if (url.pathname === "/api/staff/assignees") return answer(200, [{ id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }]);
    if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }));
  return { gets, posts, setDetail: (next: Record<string, unknown>) => { current = next; } };
}

async function renderStaff() {
  render(<MemoryRouter initialEntries={["/queue/42"]}><App /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
}

const statusSelect = () => screen.getByLabelText("Status") as HTMLSelectElement;
const offered = () => Array.from(statusSelect().options).map((o) => o.value).filter(Boolean);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-03 the status control offers exactly BR-18's next statuses", () => {
  it.each(Object.keys(NEXT))("from %s", async (status) => {
    mockApi({ detail: ticket({ currentStatus: status }) });
    await renderStaff();
    expect(offered()).toEqual(NEXT[status]);
    if (NEXT[status].length === 0) expect(statusSelect()).toBeDisabled();
  });
});

describe("UI-03 Resolved is disabled while the gate is closed, with the reason before the attempt", () => {
  it.each([
    [{ openActions: 1, completedActions: 0 }, ["Complete or cancel 1 open action", "Record at least one completed action"]],
    [{ openActions: 2, completedActions: 1 }, ["Complete or cancel 2 open actions"]],
    [{ openActions: 0, completedActions: 2, latestFollowUpRequired: true }, ["The latest completed action asks for follow-up — record the follow-up work"]],
    [{ openActions: 0, completedActions: 1, reopenedSinceWork: true }, ["The ticket was reopened — record the work done since"]],
    [{ openActions: 1, completedActions: 1, latestFollowUpRequired: true, reopenedSinceWork: true }, [
      "Complete or cancel 1 open action",
      "The latest completed action asks for follow-up — record the follow-up work",
      "The ticket was reopened — record the work done since",
    ]],
  ])("gate %j", async (gate, lines) => {
    mockApi({ detail: ticket({ resolutionGate: { ...READY, latestFollowUpRequired: false, reopenedSinceWork: false, ...gate, ready: false } }) });
    await renderStaff();
    const resolved = within(statusSelect()).getByRole("option", { name: "Resolved" }) as HTMLOptionElement;
    expect(resolved.disabled).toBe(true);
    const needs = document.getElementById("work-status-needs")!;
    expect(needs).toHaveTextContent("Resolution needs:");
    expect(within(needs).getAllByRole("listitem").map((li) => li.textContent)).toEqual(lines);
    expect(statusSelect().getAttribute("aria-describedby")).toContain("work-status-needs");
  });

  it("offers Resolved, with no list, when the gate is open", async () => {
    mockApi();
    await renderStaff();
    expect((within(statusSelect()).getByRole("option", { name: "Resolved" }) as HTMLOptionElement).disabled).toBe(false);
    expect(document.getElementById("work-status-needs")).toBeNull();
  });
});

describe("UI-03 a stale screen meets the server's refusal", () => {
  it("shows RESOLUTION_BLOCKED's unmet list in the dialog, keeps the summary, and re-reads the gate and Actions", async () => {
    const { gets, posts } = mockApi({
      statusReplies: [{ status: 409, body: { error: { code: "RESOLUTION_BLOCKED", message: "Blocked.", unmet: [{ condition: "OPEN_ACTIONS", count: 1 }, { condition: "NO_WORK_SINCE_REOPEN" }] } } }],
    });
    await renderStaff();
    await userEvent.selectOptions(statusSelect(), "RESOLVED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    const dialog = screen.getByRole("dialog");
    const summary = within(dialog).getByLabelText(/Resolution summary/);
    await userEvent.type(summary, "Replaced the access point and confirmed the connection.");
    const before = { actions: gets["/api/tickets/42/actions"], ticket: gets["/api/tickets/42"] };
    await userEvent.click(within(dialog).getByRole("button", { name: "Change status to Resolved" }));

    const alert = await within(dialog).findByRole("alert");
    expect(within(alert).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Complete or cancel 1 open action",
      "The ticket was reopened — record the work done since",
    ]);
    expect(within(screen.getByRole("dialog")).getByLabelText(/Resolution summary/)).toHaveValue("Replaced the access point and confirmed the connection.");
    await waitFor(() => expect(gets["/api/tickets/42/actions"]).toBeGreaterThan(before.actions));
    await waitFor(() => expect(gets["/api/tickets/42"]).toBeGreaterThan(before.ticket));
    expect(posts[0].body).toMatchObject({ toStatus: "RESOLVED", resolutionSummary: "Replaced the access point and confirmed the connection." });
  });
});

describe("UI-03 a successful change refreshes the screen without a reload", () => {
  it("updates the status, and re-reads the Actions and the history", async () => {
    const { gets } = mockApi({ statusReplies: [{ status: 200, body: ticket({ currentStatus: "WAITING_FOR_REQUESTER", version: 5 }) }] });
    await renderStaff();
    const before = { actions: gets["/api/tickets/42/actions"], history: gets["/api/tickets/42/history"] };
    let sawLoading = false;
    const watcher = new MutationObserver(() => { if (document.body.textContent?.includes("Loading this Ticket")) sawLoading = true; });
    watcher.observe(document.body, { childList: true, subtree: true, characterData: true });

    await userEvent.selectOptions(statusSelect(), "WAITING_FOR_REQUESTER");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(await screen.findByText("Status changed to Waiting for Requester")).toBeInTheDocument();
    await waitFor(() => expect(gets["/api/tickets/42/actions"]).toBe(before.actions + 1));
    await waitFor(() => expect(gets["/api/tickets/42/history"]).toBe(before.history + 1));
    watcher.disconnect();
    expect(sawLoading).toBe(false);
    expect(offered()).toEqual(NEXT.WAITING_FOR_REQUESTER);
  });
});

describe("UI-03 cancelling a Ticket says how many open Actions go with it", () => {
  it.each([
    [2, "2 open actions will also be cancelled."],
    [1, "1 open action will also be cancelled."],
  ])("%i open", async (openActions, sentence) => {
    mockApi({ detail: ticket({ resolutionGate: { ...READY, openActions, ready: false } }) });
    await renderStaff();
    await userEvent.selectOptions(statusSelect(), "CANCELLED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(within(screen.getByRole("dialog")).getByText(new RegExp(sentence.replace(".", "\\.")))).toBeInTheDocument();
  });

  it("adds nothing when no Action is open", async () => {
    mockApi();
    await renderStaff();
    await userEvent.selectOptions(statusSelect(), "CANCELLED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(within(screen.getByRole("dialog")).queryByText(/will also be cancelled/)).not.toBeInTheDocument();
  });
});

describe("UI-04 the History disclosure", () => {
  it("is collapsed with its count, and lists events oldest first with both statuses in words", async () => {
    mockApi();
    await renderStaff();
    const toggle = await screen.findByRole("button", { name: "History (3)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Status history, oldest first" })).not.toBeInTheDocument();

    await userEvent.click(toggle);
    const items = within(screen.getByRole("list", { name: "Status history, oldest first" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.split(" · ")[0])).toEqual([
      "Nadia Rahman created this ticket as New",
      "Grace Okafor moved this from New to Open",
      "Grace Okafor moved this from Open to In Progress",
    ]);
    expect(screen.queryByText("Earlier changes were made before history was recorded.")).not.toBeInTheDocument();
  });

  it("says earlier changes were not recorded only when the history does not start at creation", async () => {
    mockApi({ history: { items: [HISTORY.items[2]], recordedFromCreation: false } });
    await renderStaff();
    await userEvent.click(await screen.findByRole("button", { name: "History (1)" }));
    expect(screen.getByText("Earlier changes were made before history was recorded.")).toBeInTheDocument();
  });

  it("is on the Requester's Ticket Detail too", async () => {
    mockApi({ user: REQUESTER });
    render(<MemoryRouter initialEntries={["/tickets/42"]}><App /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "History (3)" }));
    expect(screen.getByText(/Nadia Rahman created this ticket as/)).toBeInTheDocument();
  });
});

// Earth2509's review of PR #100: the in-place Ticket re-read after an Action
// write must say when it failed, offer Retry, and never let an older or
// another Ticket's response replace what the screen already shows.
describe("UI-03 the in-place Ticket re-read after an Action write", () => {
  type Pending = { resolve: (body: unknown) => void; reject: (status: number) => void };

  const openAction = {
    id: 1, ticketId: 42, status: "OPEN", actionAt: "2026-09-20T09:00:00.000Z", description: "Replace the access point.",
    result: null, followUpRequired: false, followUpNote: null, attachmentNotes: null,
    assignee: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }, performedBy: null, completedAt: null,
    cancelledBy: null, cancelledAt: null, cancellationReason: null, createdBy: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
    createdAt: "2026-09-20T09:05:00.000Z", updatedAt: "2026-09-20T09:05:00.000Z", version: 1,
  };
  const CLOSED_GATE = { openActions: 1, completedActions: 0, latestFollowUpRequired: false, reopenedSinceWork: false, ready: false };

  /**
   * Ticket reads are answered from a script, one entry per read: a body, a
   * failing status, or "defer" to hold the answer until the test releases it.
   */
  function screenApi(script: Record<number, Array<unknown | "defer" | { fail: number }>>, statusReply?: unknown, actions: unknown[] = [openAction]) {
    const reads: Record<number, number> = {};
    const held: Pending[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
      const ticketMatch = url.pathname.match(/^\/api\/tickets\/(\d+)$/);
      if (url.pathname === "/api/auth/me") return answer(200, { user: STAFF });
      if (ticketMatch && method === "GET") {
        const id = Number(ticketMatch[1]);
        reads[id] = (reads[id] ?? 0) + 1;
        const steps = script[id];
        const step = steps[Math.min(reads[id], steps.length) - 1];
        if (step === "defer") {
          return new Promise((resolve) => {
            held.push({ resolve: (body) => resolve(answer(200, body)), reject: (status) => resolve(answer(status, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Unavailable." } })) });
          });
        }
        if (step && typeof step === "object" && "fail" in (step as object)) {
          return answer((step as { fail: number }).fail, { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Unavailable." } });
        }
        return answer(200, step);
      }
      if (method === "POST" && /\/actions\/\d+\/complete$/.test(url.pathname)) return answer(200, { ...openAction, status: "COMPLETED", result: "Replaced it.", version: 2 });
      if (method === "POST" && url.pathname === "/api/tickets/42/status") return answer(200, statusReply);
      if (/\/api\/tickets\/\d+\/history$/.test(url.pathname)) return answer(200, HISTORY);
      if (/\/api\/tickets\/\d+\/actions$/.test(url.pathname)) return answer(200, { items: url.pathname.includes("/42/") ? actions : [] });
      if (/\/api\/tickets\/\d+\/(comments|internal-notes|attachments)$/.test(url.pathname)) return answer(200, []);
      if (url.pathname === "/api/staff/assignees") return answer(200, [{ id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }]);
      if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }));
    return { reads, held };
  }

  async function completeTheOpenAction(rowIndex = 1) {
    const row = within(await screen.findByRole("table")).getAllByRole("row")[rowIndex];
    await userEvent.click(within(row).getByRole("button", { name: "Complete" }));
    const dialog = screen.getByRole("dialog", { name: "Complete action" });
    await userEvent.type(within(dialog).getByLabelText(/Result/), "Replaced it, signal strong.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Complete action" }));
    expect(await screen.findByText("Action completed")).toBeInTheDocument();
  }

  const resolvedOption = () => within(statusSelect()).getByRole("option", { name: "Resolved" }) as HTMLOptionElement;

  it("says when the re-read failed, offers Retry in place, and keeps the success message", async () => {
    screenApi({ 42: [ticket({ resolutionGate: CLOSED_GATE }), { fail: 503 }, ticket({ resolutionGate: READY })] });
    await renderStaff();
    expect(resolvedOption().disabled).toBe(true);
    await completeTheOpenAction();

    const alert = await screen.findByText("This ticket could not be refreshed, so what it shows may be out of date.");
    expect(resolvedOption().disabled).toBe(true);
    await userEvent.click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(resolvedOption().disabled).toBe(false));
    expect(screen.queryByText("This ticket could not be refreshed, so what it shows may be out of date.")).not.toBeInTheDocument();
    expect(screen.getByText("Action completed")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ticket TKT-2026-00042" })).toBeInTheDocument();
  });

  it("ignores an older re-read that answers after a status change has landed", async () => {
    const { held } = screenApi(
      { 42: [ticket({ resolutionGate: READY }), "defer"] },
      ticket({ currentStatus: "WAITING_FOR_REQUESTER", version: 5 }),
    );
    await renderStaff();
    await completeTheOpenAction();
    await waitFor(() => expect(held).toHaveLength(1));

    await userEvent.selectOptions(statusSelect(), "WAITING_FOR_REQUESTER");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    expect(await screen.findByText("Status changed to Waiting for Requester")).toBeInTheDocument();

    // The re-read started before the change answers now, with version 4.
    held[0].resolve(ticket({ currentStatus: "IN_PROGRESS", version: 4, resolutionGate: READY }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(offered()).toEqual(NEXT.WAITING_FOR_REQUESTER);
  });

  it("ignores an earlier re-read that answers after a later one, though the version is the same", async () => {
    // Two Actions completed in turn: each write re-reads the Ticket, and an
    // Action write changes the gate without changing the Ticket's version.
    const second = { ...openAction, id: 2, description: "Check the switch." };
    const { held } = screenApi(
      { 42: [ticket({ resolutionGate: { ...CLOSED_GATE, openActions: 2 } }), "defer", ticket({ resolutionGate: READY })] },
      undefined,
      [openAction, second],
    );
    await renderStaff();
    await completeTheOpenAction(1);
    await waitFor(() => expect(held).toHaveLength(1));
    await completeTheOpenAction(2);
    await waitFor(() => expect(resolvedOption().disabled).toBe(false));

    // The first re-read, from before the second write, answers last.
    held[0].resolve(ticket({ resolutionGate: { ...CLOSED_GATE, openActions: 1, completedActions: 1 } }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(resolvedOption().disabled).toBe(false);
    expect(document.getElementById("work-status-needs")).toBeNull();
  });

  it("ignores a re-read that answers after the screen has moved to another Ticket", async () => {
    const { held } = screenApi({
      42: [ticket({ resolutionGate: READY }), "defer"],
      43: [ticket({ id: 43, ticketNumber: "TKT-2026-00043", currentStatus: "OPEN", resolutionGate: READY })],
    });
    let go!: (to: string) => void;
    const { useNavigate } = await import("react-router-dom");
    function Driver() {
      go = useNavigate();
      return null;
    }
    render(<MemoryRouter initialEntries={["/queue/42"]}><Driver /><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
    await completeTheOpenAction();
    await waitFor(() => expect(held).toHaveLength(1));

    await act(async () => go("/queue/43"));
    await screen.findByRole("heading", { name: "Ticket TKT-2026-00043" });

    held[0].resolve(ticket({ resolutionGate: READY }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("heading", { name: "Ticket TKT-2026-00043" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Ticket TKT-2026-00042" })).not.toBeInTheDocument();
  });
});
