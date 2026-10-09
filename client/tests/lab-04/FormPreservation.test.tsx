import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";
import { ActionsTaken } from "../../src/actions/ActionsTaken";

// UI-08 in docs/lab-04/tests.md (AC-27, BR-32): Create Ticket, the comment and
// note composers, the Action form and the user panel each keep every entered
// value after a 500 and after a network failure, show the error, clear their
// busy state so the user can retry, and clear only on success or an explicit
// Cancel. This file was named by tests.md and missing from the release
// candidate; Earth2509's review of #108 found it.

type Reply = { status: number; body: unknown } | "network";
const SERVER_DOWN: Reply = { status: 500, body: { error: { code: "INTERNAL", message: "Something went wrong on our side. Please try again." } } };
const FAILURES: Array<[string, Reply]> = [["a 500", SERVER_DOWN], ["a network failure", "network"]];

/**
 * Answers `reads` by path, and the write named `write` from `replies` in order.
 * A "network" reply rejects the way a dropped connection does.
 */
function mockApi(user: unknown, reads: Record<string, unknown>, write: string, replies: Reply[]) {
  const writes: unknown[] = [];
  const queue = [...replies];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (url.pathname === "/api/auth/me") return answer(200, { user });
    if (`${method} ${url.pathname}` === write) {
      writes.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      const reply = queue.shift();
      if (!reply) throw new Error(`No scripted reply for ${write}`);
      if (reply === "network") throw new TypeError("Failed to fetch");
      return answer(reply.status, reply.body);
    }
    if (method === "GET" && url.pathname in reads) {
      const value = reads[url.pathname];
      return answer(200, typeof value === "function" ? (value as () => unknown)() : value);
    }
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }));
  return { writes };
}

/** The visible error, and that no raw browser text leaked into it. */
async function expectErrorShown() {
  const alerts = await screen.findAllByRole("alert");
  expect(alerts.length).toBeGreaterThan(0);
  for (const alert of alerts) expect(alert).not.toHaveTextContent(/Failed to fetch/);
}

beforeEach(() => {
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-2222-4333-8444-555555555555" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const REQUESTER = { id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", mustChangePassword: false };
const STAFF = { id: 7, fullName: "Grace Okafor", email: "grace.okafor@toktickit.local", role: "IT_STAFF", mustChangePassword: false };
const ADMIN = { id: 9, fullName: "Aurelia Admin", email: "aurelia.admin@toktickit.local", role: "ADMINISTRATOR", mustChangePassword: false };

const TICKET = {
  id: 42, ticketNumber: "TKT-2026-00042", ticketDate: "2026-10-01T09:00:00.000Z",
  requester: { id: 1, fullName: "Nadia Rahman", role: "REQUESTER" }, category: { id: 2, name: "Network" },
  relatedSystem: { id: 5, name: "Campus Wi-Fi" }, summary: "Cannot connect to Campus Wi-Fi", description: "Authentication fails in Building 4.",
  requestedPriority: "HIGH", itPriority: "HIGH", currentStatus: "IN_PROGRESS", owner: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
  resolutionSummary: null, requesterResolvedAt: null, version: 4, attachments: [],
  createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-02T09:00:00.000Z",
};
const entry = (id: number, content: string, author: { id: number; fullName: string; role: string }) => ({ id, ticketId: 42, author, content, createdAt: "2026-10-03T09:00:00.000Z" });

describe.each(FAILURES)("UI-08 Create Ticket keeps everything after %s", (_name, failure) => {
  it("keeps every value, shows the error, can retry, and only success moves on", async () => {
    const { writes } = mockApi(REQUESTER, {
      "/api/categories": [{ id: 2, name: "Network" }],
      "/api/related-systems": [{ id: 5, name: "Campus Wi-Fi" }],
    }, "POST /api/tickets", [failure, { status: 201, body: { ...TICKET, currentStatus: "NEW" } }]);
    render(<MemoryRouter initialEntries={["/create"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Create Ticket" });
    await waitFor(() => expect(screen.getByLabelText(/Category/)).toBeEnabled());
    await userEvent.selectOptions(screen.getByLabelText(/Category/), "2");
    await userEvent.selectOptions(screen.getByLabelText(/Related System/), "5");
    await userEvent.type(screen.getByLabelText(/Ticket Summary/), "Cannot connect to Campus Wi-Fi");
    await userEvent.selectOptions(screen.getByLabelText(/Requested Priority/), "HIGH");
    await userEvent.type(screen.getByLabelText(/Description/), "Authentication fails in Building 4.");
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    await expectErrorShown();
    expect(screen.getByLabelText(/Category/)).toHaveValue("2");
    expect(screen.getByLabelText(/Related System/)).toHaveValue("5");
    expect(screen.getByLabelText(/Ticket Summary/)).toHaveValue("Cannot connect to Campus Wi-Fi");
    expect(screen.getByLabelText(/Requested Priority/)).toHaveValue("HIGH");
    expect(screen.getByLabelText(/Description/)).toHaveValue("Authentication fails in Building 4.");
    const submit = screen.getByRole("button", { name: "Submit Ticket" });
    expect(submit).toBeEnabled();

    await userEvent.click(submit);
    expect(await screen.findByRole("heading", { name: "Ticket created" })).toBeInTheDocument();
    expect(writes).toHaveLength(2);
  });
});

describe.each(FAILURES)("UI-08 the Requester's comment composer keeps the comment after %s", (_name, failure) => {
  it("keeps the draft, shows the error, can retry, and clears only on success", async () => {
    let comments: unknown[] = [];
    mockApi(REQUESTER, {
      "/api/tickets/42": TICKET,
      "/api/tickets/42/comments": () => comments,
      "/api/tickets/42/actions": { items: [] },
      "/api/tickets/42/history": { items: [], recordedFromCreation: true },
    }, "POST /api/tickets/42/comments", [failure, { status: 201, body: entry(5, "Still failing this morning.", REQUESTER) }]);
    render(<MemoryRouter initialEntries={["/tickets/42"]}><App /></MemoryRouter>);
    const box = await screen.findByLabelText(/Add a comment/);
    await userEvent.type(box, "Still failing this morning.");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await expectErrorShown();
    expect(screen.getByLabelText(/Add a comment/)).toHaveValue("Still failing this morning.");
    expect(screen.getByRole("button", { name: "Post comment" })).toBeEnabled();

    comments = [entry(5, "Still failing this morning.", REQUESTER)];
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));
    await waitFor(() => expect(screen.getByLabelText(/Add a comment/)).toHaveValue(""));
    expect(screen.getByText("Still failing this morning.")).toBeInTheDocument();
  });
});

describe.each(FAILURES)("UI-08 the internal note composer keeps the note after %s", (_name, failure) => {
  it("keeps the draft, shows the error, can retry, and clears only on success", async () => {
    mockApi(STAFF, {
      "/api/tickets/42": TICKET,
      "/api/tickets/42/comments": [],
      "/api/tickets/42/internal-notes": [],
      "/api/staff/assignees": [{ id: 7, fullName: "Grace Okafor", role: "IT_STAFF" }],
      "/api/tickets/42/actions": { items: [] },
      "/api/tickets/42/history": { items: [], recordedFromCreation: true },
    }, "POST /api/tickets/42/internal-notes", [failure, { status: 201, body: entry(6, "Check the RADIUS logs first.", STAFF) }]);
    render(<MemoryRouter initialEntries={["/queue/42"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
    await userEvent.click(screen.getByRole("tab", { name: /Internal notes/ }));
    await userEvent.type(screen.getByRole("textbox", { name: /^Internal note/ }), "Check the RADIUS logs first.");
    await userEvent.click(screen.getByRole("button", { name: "Add internal note" }));

    await expectErrorShown();
    expect(screen.getByRole("textbox", { name: /^Internal note/ })).toHaveValue("Check the RADIUS logs first.");
    expect(screen.getByRole("button", { name: "Add internal note" })).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Add internal note" }));
    await waitFor(() => expect(screen.getByRole("textbox", { name: /^Internal note/ })).toHaveValue(""));
    expect(screen.getByText("Check the RADIUS logs first.")).toBeInTheDocument();
  });
});

const ME = { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" as const };
const saved = {
  id: 1, ticketId: 42, status: "COMPLETED", actionAt: "2026-10-03T09:00:00.000Z", description: "Replaced the access point.",
  result: "Signal restored.", followUpRequired: true, followUpNote: "Check again on Monday.", attachmentNotes: "Photo in Attachments.",
  assignee: ME, performedBy: ME, completedAt: "2026-10-03T09:00:00.000Z", cancelledBy: null, cancelledAt: null, cancellationReason: null,
  createdBy: ME, createdAt: "2026-10-03T09:00:00.000Z", updatedAt: "2026-10-03T09:00:00.000Z", version: 1,
};

describe.each(FAILURES)("UI-08 the Action form keeps every field after %s", (_name, failure) => {
  it("keeps every field, offers Retry, and only success closes it", async () => {
    let items: unknown[] = [];
    mockApi(STAFF, { "/api/tickets/42/actions": () => ({ items }), "/api/staff/assignees": [ME] },
      "POST /api/tickets/42/actions", [failure, { status: 201, body: saved }]);
    render(<ActionsTaken ticketId={42} ticketStatus="IN_PROGRESS" canWrite currentUserId={ME.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    const form = screen.getByRole("form");
    await userEvent.type(within(form).getByLabelText(/^Description/), "Replaced the access point.");
    await userEvent.type(within(form).getByLabelText(/^Result/), "Signal restored.");
    await userEvent.click(within(form).getByRole("checkbox", { name: "Follow-up required" }));
    await userEvent.type(within(form).getByLabelText(/^Follow-up note/), "Check again on Monday.");
    await userEvent.type(within(form).getByLabelText(/^Attachment notes/), "Photo in Attachments.");
    const actionAt = (within(form).getByLabelText(/^Action date\/time/) as HTMLInputElement).value;
    await userEvent.click(within(form).getByRole("button", { name: "Save action" }));

    await expectErrorShown();
    expect(within(form).getByLabelText(/^Description/)).toHaveValue("Replaced the access point.");
    expect(within(form).getByLabelText(/^Result/)).toHaveValue("Signal restored.");
    expect(within(form).getByRole("checkbox", { name: "Follow-up required" })).toBeChecked();
    expect(within(form).getByLabelText(/^Follow-up note/)).toHaveValue("Check again on Monday.");
    expect(within(form).getByLabelText(/^Attachment notes/)).toHaveValue("Photo in Attachments.");
    expect(within(form).getByLabelText(/^Action date\/time/)).toHaveValue(actionAt);
    expect(within(form).getByLabelText(/^Assignee/)).toHaveValue(String(ME.id));
    const retry = within(form).getByRole("button", { name: "Retry" });
    expect(retry).toBeEnabled();

    items = [saved];
    await userEvent.click(retry);
    await waitFor(() => expect(screen.queryByRole("form")).not.toBeInTheDocument());
    expect(screen.getByText("Replaced the access point.")).toBeInTheDocument();
  });
});

describe("UI-08 the Action form clears on an explicit Cancel", () => {
  it("Cancel closes it, and the next Add action starts empty", async () => {
    mockApi(STAFF, { "/api/tickets/42/actions": { items: [] }, "/api/staff/assignees": [ME] }, "POST /api/tickets/42/actions", []);
    render(<ActionsTaken ticketId={42} ticketStatus="IN_PROGRESS" canWrite currentUserId={ME.id} />);
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    await userEvent.type(within(screen.getByRole("form")).getByLabelText(/^Description/), "Typed, then abandoned.");
    await userEvent.click(within(screen.getByRole("form")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add action" }));
    expect(within(screen.getByRole("form")).getByLabelText(/^Description/)).toHaveValue("");
  });
});

const person = (id: number, overrides: Record<string, unknown> = {}) => ({
  id, fullName: `Person ${id}`, email: `person${id}@toktickit.local`, role: "REQUESTER", isActive: true, mustChangePassword: false,
  createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", ...overrides,
});

describe.each(FAILURES)("UI-08 the user panel keeps every field after %s", (_name, failure) => {
  it("keeps every field, shows the error, can retry, and only success closes it", async () => {
    let users = [person(1)];
    mockApi(ADMIN, { "/api/admin/users": () => ({ items: users }) },
      "POST /api/admin/users", [failure, { status: 201, body: person(2, { fullName: "New Hire", email: "new.hire@toktickit.local", role: "IT_STAFF", mustChangePassword: true }) }]);
    render(<MemoryRouter initialEntries={["/users"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "User Management" });
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));
    const panel = within(screen.getByRole("region", { name: "Create user" }));
    await userEvent.type(panel.getByLabelText(/Full name/), "New Hire");
    await userEvent.type(panel.getByLabelText(/Email address/), "new.hire@toktickit.local");
    await userEvent.selectOptions(panel.getByLabelText(/^Role/), "IT_STAFF");
    await userEvent.type(panel.getByLabelText(/Initial password/), "correct-horse-battery-staple");
    await userEvent.click(panel.getByRole("button", { name: "Create user" }));

    await expectErrorShown();
    expect(panel.getByLabelText(/Full name/)).toHaveValue("New Hire");
    expect(panel.getByLabelText(/Email address/)).toHaveValue("new.hire@toktickit.local");
    expect(panel.getByLabelText(/^Role/)).toHaveValue("IT_STAFF");
    expect(panel.getByLabelText(/Initial password/)).toHaveValue("correct-horse-battery-staple");
    const submit = panel.getByRole("button", { name: "Create user" });
    expect(submit).toBeEnabled();

    users = [person(1), person(2, { fullName: "New Hire", email: "new.hire@toktickit.local", role: "IT_STAFF" })];
    await userEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Create user" })).not.toBeInTheDocument());
    expect(await screen.findByText("New Hire")).toBeInTheDocument();
  });
});

describe("UI-08 the user panel clears on an explicit Cancel", () => {
  it("Cancel closes it, and the next Create user starts empty", async () => {
    mockApi(ADMIN, { "/api/admin/users": { items: [person(1)] } }, "POST /api/admin/users", []);
    render(<MemoryRouter initialEntries={["/users"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "User Management" });
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));
    let panel = within(screen.getByRole("region", { name: "Create user" }));
    await userEvent.type(panel.getByLabelText(/Full name/), "Typed, then abandoned");
    await userEvent.click(panel.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: "Create user" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Create user" }));
    panel = within(screen.getByRole("region", { name: "Create user" }));
    expect(panel.getByLabelText(/Full name/)).toHaveValue("");
  });
});
