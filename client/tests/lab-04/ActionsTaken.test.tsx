import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActionsTaken } from "../../src/actions/ActionsTaken";
import type { ActionTaken } from "../../src/api";

// UI-01 and UI-02 in docs/lab-04/tests.md (AC-01, AC-03, AC-05, AC-06, AC-09,
// AC-26, AC-27): the Actions taken section of Lab 4 ui-spec §4. Expected texts
// and behaviours are transcribed from the ui-spec and api-spec §2.

const ME = { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" as const };
const COLLEAGUE = { id: 9, fullName: "Daniel Reyes", role: "IT_STAFF" as const };
const ASSIGNEES = [ME, COLLEAGUE];

function action(id: number, overrides: Partial<ActionTaken> = {}): ActionTaken {
  return {
    id, ticketId: 42, status: "OPEN", actionAt: "2026-09-20T09:00:00.000Z",
    description: `Work item ${id}`, result: null, followUpRequired: false, followUpNote: null, attachmentNotes: null,
    assignee: ME, performedBy: null, completedAt: null, cancelledBy: null, cancelledAt: null, cancellationReason: null,
    createdBy: COLLEAGUE, createdAt: "2026-09-20T09:05:00.000Z", updatedAt: "2026-09-20T09:05:00.000Z", version: 1,
    ...overrides,
  };
}

type Call = { method: string; path: string; body?: unknown; key?: string | null };
type Reply = { status: number; body: unknown } | Error;

/**
 * Answers the Actions list and the assignees, records every request, and lets
 * a test script the replies to writes, one per call, in order.
 */
function mockApi(list: ActionTaken[], writes: Reply[] = [], assigneeReplies: Reply[] = []) {
  const calls: Call[] = [];
  const queue = [...writes];
  const assigneeQueue = [...assigneeReplies];
  let items = list;
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined, key: headers.get("Idempotency-Key") });
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (method === "GET" && url.pathname === "/api/tickets/42/actions") return answer(200, { items });
    if (method === "GET" && url.pathname === "/api/staff/assignees") {
      // Scripted replies first, if a test gave any; then the eligible staff.
      const scripted = assigneeQueue.shift();
      if (scripted instanceof Error) throw scripted;
      return scripted ? answer(scripted.status, scripted.body) : answer(200, ASSIGNEES);
    }
    const next = queue.shift();
    if (!next) throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    if (next instanceof Error) throw next;
    return answer(next.status, next.body);
  }));
  return { calls, setList: (next: ActionTaken[]) => { items = next; } };
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");
const gets = (calls: Call[], path: string) => calls.filter((c) => c.method === "GET" && c.path === path).length;

function renderSection(props: { canWrite?: boolean; ticketStatus?: string } = {}) {
  render(<ActionsTaken ticketId={42} ticketStatus={props.ticketStatus ?? "IN_PROGRESS"} canWrite={props.canWrite ?? true} currentUserId={ME.id} />);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-01 the list", () => {
  it("renders every field, with Result beneath Description and the details behind a disclosure", async () => {
    mockApi([
      action(1, { status: "COMPLETED", result: "Connected at full signal.", performedBy: COLLEAGUE, followUpRequired: true, followUpNote: "Check again on Monday.", attachmentNotes: "See wifi-0926.png." }),
      action(2, { status: "CANCELLED", cancelledBy: ME, cancellationReason: "Duplicate of action 1." }),
    ]);
    renderSection();

    expect(await screen.findByRole("heading", { name: "Actions taken (2)" })).toBeInTheDocument();
    const rows = within(screen.getByRole("table")).getAllByRole("row");
    const first = rows[1];
    expect(within(first).getByText("Work item 1")).toBeInTheDocument();
    expect(within(first).getByText("Connected at full signal.")).toBeInTheDocument();
    expect(within(first).getByText("Completed")).toBeInTheDocument();
    expect(within(first).getByText("Follow-up required")).toBeInTheDocument();
    expect(within(first).getAllByText(COLLEAGUE.fullName)).toHaveLength(1); // performed by
    expect(within(first).getByText(ME.fullName)).toBeInTheDocument(); // assignee

    const toggle = within(first).getByRole("button", { name: "Details" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Check again on Monday.")).toBeInTheDocument();
    expect(screen.getByText("Attachment notes — refers to files in the Attachments tab")).toBeInTheDocument();
    expect(screen.getByText("See wifi-0926.png.")).toBeInTheDocument();
    expect(screen.getByText("Recorded by")).toBeInTheDocument();

    await userEvent.click(within(rows[2]).getByRole("button", { name: "Details" }));
    expect(screen.getByText("Duplicate of action 1.")).toBeInTheDocument();
    expect(screen.getByText("Cancelled by")).toBeInTheDocument();
  });

  it("offers Edit, Complete and Cancel on open work only; final Actions say how to correct them", async () => {
    mockApi([action(1), action(2, { status: "COMPLETED", result: "Done well.", performedBy: ME }), action(3, { status: "CANCELLED", cancelledBy: ME, cancellationReason: "Not needed." })]);
    renderSection();
    const rows = within(await screen.findByRole("table")).getAllByRole("row");

    for (const name of ["Edit", "Complete", "Cancel action"]) expect(within(rows[1]).getByRole("button", { name })).toBeInTheDocument();
    for (const row of [rows[2], rows[3]]) {
      for (const name of ["Edit", "Complete", "Cancel action"]) expect(within(row).queryByRole("button", { name })).not.toBeInTheDocument();
      expect(within(row).getByText("Final — record a new action to correct it.")).toBeInTheDocument();
    }
  });

  it("shows an empty list in words", async () => {
    mockApi([]);
    renderSection();
    expect(await screen.findByText("No actions have been recorded yet.")).toBeInTheDocument();
  });

  it("shows a cleared assignee as Unassigned, and its Edit starts with the field empty and required", async () => {
    mockApi([action(1, { assignee: null })]);
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    expect(within(row).getByText("Unassigned")).toHaveClass("zen-action__unassigned");

    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const assignee = await screen.findByLabelText(/Assignee/);
    expect(assignee).toHaveValue("");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByText("Choose who the action is assigned to.")).toBeInTheDocument();
  });
});

describe("UI-01 adding an action", () => {
  it("defaults to Record completed work, assigned to the current user, with the requester-visible notice", async () => {
    mockApi([]);
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));

    expect(screen.getByLabelText("Record completed work")).toBeChecked();
    await waitFor(() => expect(screen.getByLabelText(/Assignee/)).toHaveValue(String(ME.id)));
    expect(screen.getByText("Visible to the requester. Use an internal note for anything private.")).toBeInTheDocument();
  });

  it("shows the Follow-up note only while Follow-up required is ticked, and then requires it", async () => {
    const { calls } = mockApi([]);
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    expect(screen.queryByLabelText(/Follow-up note/)).not.toBeInTheDocument();

    const box = screen.getByRole("checkbox", { name: "Follow-up required" });
    await userEvent.click(box);
    const note = screen.getByLabelText(/Follow-up note/);
    expect(box).toHaveAttribute("aria-controls", note.id);

    await userEvent.type(screen.getByLabelText(/Description/), "Replaced the access point.");
    await userEvent.type(screen.getByLabelText(/^Result/), "Signal restored.");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByText("Describe the follow-up that is needed.")).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    await userEvent.click(box);
    expect(screen.queryByLabelText(/Follow-up note/)).not.toBeInTheDocument();
  });

  it("puts each validation message beneath its own field and moves focus to the first invalid one", async () => {
    const { calls } = mockApi([]);
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));

    const description = screen.getByLabelText(/Description/);
    const result = screen.getByLabelText(/^Result/);
    expect(description).toHaveAttribute("aria-invalid", "true");
    expect(description.getAttribute("aria-describedby")).toContain(`${description.id}-error`);
    expect(document.getElementById(`${description.id}-error`)).toHaveTextContent("Enter a description of the work.");
    expect(document.getElementById(`${result.id}-error`)).toHaveTextContent("Enter the result of the work.");
    await waitFor(() => expect(description).toHaveFocus());
    expect(writes(calls)).toHaveLength(0);
  });

  it("makes Result optional under Plan open work, and sends the plan as OPEN", async () => {
    const { calls } = mockApi([], [{ status: 201, body: action(5) }]);
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    await userEvent.click(screen.getByLabelText("Plan open work"));
    expect(screen.getByLabelText(/^Result/)).not.toBeRequired();
    await userEvent.type(screen.getByLabelText(/Description/), "Replace the access point in room 402.");
    await userEvent.selectOptions(screen.getByLabelText(/Assignee/), String(COLLEAGUE.id));
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));

    expect(await screen.findByText("Action recorded")).toBeInTheDocument();
    expect(writes(calls)[0]).toMatchObject({ method: "POST", path: "/api/tickets/42/actions", body: { status: "OPEN", result: null, assigneeId: COLLEAGUE.id } });
  });

  it("shows a server field refusal beneath its field", async () => {
    mockApi([], [{ status: 400, body: { error: { code: "VALIDATION_FAILED", message: "Check the fields.", fieldErrors: { assigneeId: "That person can no longer be assigned work." } } } }]);
    renderSection();
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    await userEvent.type(screen.getByLabelText(/Description/), "Replaced the access point.");
    await userEvent.type(screen.getByLabelText(/^Result/), "Signal restored.");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));

    const assignee = screen.getByLabelText(/Assignee/);
    expect(await screen.findByText("That person can no longer be assigned work.")).toHaveAttribute("id", `${assignee.id}-error`);
  });
});

describe("UI-01 completing and cancelling", () => {
  it("Complete requires a Result before it can be confirmed, then sends the version and result", async () => {
    const { calls } = mockApi([action(1, { version: 3 })], [{ status: 200, body: action(1, { status: "COMPLETED", version: 4 }) }]);
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(row).getByRole("button", { name: "Complete" }));

    const dialog = screen.getByRole("dialog", { name: "Complete action" });
    const confirm = within(dialog).getByRole("button", { name: "Complete action" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Result/), "abc");
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Result/), "de done");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    expect(await screen.findByText("Action completed")).toBeInTheDocument();
    expect(writes(calls)[0]).toMatchObject({ path: "/api/tickets/42/actions/1/complete", body: { version: 3, result: "abcde done", followUpRequired: false } });
  });

  it("Complete asks for when the work was done if the Action was planned for the future", async () => {
    mockApi([action(1, { actionAt: new Date(Date.now() + 3 * 24 * 3_600_000).toISOString() })]);
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(row).getByRole("button", { name: "Complete" }));
    expect(within(screen.getByRole("dialog")).getByLabelText(/Action date\/time/)).toBeInTheDocument();
  });

  it("Cancel requires a reason of at least 5 characters and keeps the Action otherwise", async () => {
    const { calls } = mockApi([action(1, { version: 2 })], [{ status: 200, body: action(1, { status: "CANCELLED" }) }]);
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(row).getByRole("button", { name: "Cancel action" }));

    const dialog = screen.getByRole("dialog", { name: "Cancel action" });
    const confirm = within(dialog).getByRole("button", { name: "Cancel action" });
    expect(confirm).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText(/Reason/), "Duplicate entry.");
    await userEvent.click(confirm);
    expect(await screen.findByText("Action cancelled")).toBeInTheDocument();
    expect(writes(calls)[0]).toMatchObject({ path: "/api/tickets/42/actions/1/cancel", body: { version: 2, reason: "Duplicate entry." } });
  });
});

describe("UI-01 the Requester's view", () => {
  it("shows the same list with no control, and never asks a staff endpoint or writes", async () => {
    const { calls } = mockApi([action(1), action(2, { status: "COMPLETED", result: "Done.", performedBy: ME })]);
    renderSection({ canWrite: false });
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Work item 1")).toBeInTheDocument();
    for (const name of ["Add action", "Edit", "Complete", "Cancel action"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(screen.queryByText(/Final — record a new action/)).not.toBeInTheDocument();
    expect(gets(calls, "/api/staff/assignees")).toBe(0);
    expect(writes(calls)).toHaveLength(0);
  });
});

describe("UI-01 a resolved Ticket", () => {
  it("hides Add action and the row controls, and says how to record more work", async () => {
    mockApi([action(1)]);
    renderSection({ ticketStatus: "RESOLVED" });
    await screen.findByRole("table");
    expect(screen.getByText("Reopen the ticket to record more work.")).toBeInTheDocument();
    for (const name of ["Add action", "Edit", "Complete", "Cancel action"]) expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
  });
});

describe("UI-02 conflicts, failures and duplicate submits", () => {
  async function fillCreate() {
    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    await userEvent.type(screen.getByLabelText(/Description/), "Replaced the access point.");
    await userEvent.type(screen.getByLabelText(/^Result/), "Signal restored.");
    await userEvent.type(screen.getByLabelText(/Attachment notes/), "Photo in Attachments.");
  }

  it("a version conflict shows Reload, keeps the input, and Reload fetches the list again", async () => {
    const { calls } = mockApi([action(1)], [{ status: 409, body: { error: { code: "ACTION_VERSION_CONFLICT", message: "Stale." } } }]);
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const description = screen.getByLabelText(/Description/);
    await userEvent.clear(description);
    await userEvent.type(description, "Replaced the access point twice.");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Someone else changed this action. Reload to see the latest version.");
    expect(screen.getByLabelText(/Description/)).toHaveValue("Replaced the access point twice.");
    const before = gets(calls, "/api/tickets/42/actions");
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(gets(calls, "/api/tickets/42/actions")).toBe(before + 1));
    expect(writes(calls)[0]).toMatchObject({ method: "PATCH", body: { version: 1, description: "Replaced the access point twice." } });
  });

  it("a network failure keeps every field, and Retry re-sends the same Idempotency-Key", async () => {
    const { calls } = mockApi([], [new TypeError("Failed to fetch"), { status: 201, body: action(9) }]);
    renderSection();
    await fillCreate();
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("everything you entered is kept");
    expect(screen.getByLabelText(/Description/)).toHaveValue("Replaced the access point.");
    expect(screen.getByLabelText(/^Result/)).toHaveValue("Signal restored.");
    expect(screen.getByLabelText(/Attachment notes/)).toHaveValue("Photo in Attachments.");

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Action recorded")).toBeInTheDocument();
    const posts = writes(calls);
    expect(posts).toHaveLength(2);
    expect(posts[0].key).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1].key).toBe(posts[0].key);
  });

  it("a server error is treated like a network failure: input kept, Retry offered", async () => {
    mockApi([], [{ status: 503, body: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Unavailable." } } }]);
    renderSection();
    await fillCreate();
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toHaveValue("Replaced the access point.");
  });

  it("a double-click on Save sends one request", async () => {
    let settle!: () => void;
    const held = new Promise<void>((resolve) => (settle = resolve));
    const { calls } = mockApi([]);
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "POST") {
        calls.push({ method: "POST", path: String(input) });
        await held;
        return { ok: true, status: 201, json: async () => action(9), headers: new Headers() };
      }
      return realFetch(input, init);
    }));
    renderSection();
    await fillCreate();
    const save = screen.getByRole("button", { name: "Save action" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Saving action…" })).toBeDisabled();
    settle();
    expect(await screen.findByText("Action recorded")).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(1);
  });

  it("ACTION_FINAL shows the server's message and refreshes the list", async () => {
    const { calls } = mockApi([action(1)], [{ status: 409, body: { error: { code: "ACTION_FINAL", message: "This action is final." } } }]);
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
    await userEvent.type(screen.getByLabelText(/Description/), " more");
    const before = gets(calls, "/api/tickets/42/actions");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This action is final.");
    await waitFor(() => expect(gets(calls, "/api/tickets/42/actions")).toBe(before + 1));
  });
});

// Earth2509's review of PR #99, finding 1: after a conflict and Reload, a field
// the user never touched must not be sent, or it silently reverts the other
// user's change with a valid new version.
describe("UI-02 a reload after a conflict keeps the other user's changes", () => {
  async function editDescription(row: HTMLElement, text: string) {
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const description = screen.getByLabelText(/Description/);
    await userEvent.clear(description);
    await userEvent.type(description, text);
  }

  it("sends only what this user changed, against the new version, so a reassignment made meanwhile survives", async () => {
    const { calls, setList } = mockApi([action(1, { version: 1, assignee: ME })], [
      { status: 409, body: { error: { code: "ACTION_VERSION_CONFLICT", message: "Stale." } } },
      { status: 200, body: action(1, { version: 3, assignee: COLLEAGUE, description: "Replaced the access point, again." }) },
    ]);
    renderSection();
    await editDescription(within(await screen.findByRole("table")).getAllByRole("row")[1], "Replaced the access point, again.");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await screen.findByText("Someone else changed this action. Reload to see the latest version.");

    // Meanwhile the other user reassigned it to a colleague: version 2.
    setList([action(1, { version: 2, assignee: COLLEAGUE })]);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(screen.getByLabelText(/Assignee/)).toHaveValue(String(COLLEAGUE.id)));
    expect(screen.getByLabelText(/Description/)).toHaveValue("Replaced the access point, again.");

    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByText("Action updated")).toBeInTheDocument();
    const patches = writes(calls).filter((c) => c.method === "PATCH");
    expect(patches).toHaveLength(2);
    expect(patches[1].body).toEqual({ version: 2, description: "Replaced the access point, again." });
  });

  it("when the other user changed the same field, keeps this user's value and says what it replaces", async () => {
    const { calls, setList } = mockApi([action(1, { version: 1 })], [
      { status: 409, body: { error: { code: "ACTION_VERSION_CONFLICT", message: "Stale." } } },
      { status: 200, body: action(1, { version: 3 }) },
    ]);
    renderSection();
    await editDescription(within(await screen.findByRole("table")).getAllByRole("row")[1], "Mine: reseated the cable.");
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    await screen.findByText("Someone else changed this action. Reload to see the latest version.");

    setList([action(1, { version: 2, description: "Theirs: rebooted the switch." })]);
    await userEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByText(/Someone else changed this to “Theirs: rebooted the switch\.”/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/)).toHaveValue("Mine: reseated the cable.");

    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByText("Action updated")).toBeInTheDocument();
    expect(writes(calls).filter((c) => c.method === "PATCH")[1].body).toEqual({ version: 2, description: "Mine: reseated the cable." });
  });
});

// Earth2509's review of PR #99, finding 2: a failed assignee lookup needs a
// Retry that keeps the form, or an Unassigned Action cannot be given anyone.
describe("UI-02 the assignee list can be retried without losing the form", () => {
  it("shows the failure beside Assignee, retries on request, and the chosen assignee is saved", async () => {
    const { calls } = mockApi(
      [action(1, { assignee: null, version: 4 })],
      [{ status: 200, body: action(1, { assignee: COLLEAGUE, version: 5 }) }],
      [{ status: 503, body: { error: { code: "DEPENDENCY_UNAVAILABLE", message: "Unavailable." } } }],
    );
    renderSection();
    const row = within(await screen.findByRole("table")).getAllByRole("row")[1];
    await userEvent.click(within(row).getByRole("button", { name: "Edit" }));
    const description = screen.getByLabelText(/Description/);
    await userEvent.type(description, " today");

    expect(await screen.findByText("The list of assignees could not be loaded.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry loading assignees" }));
    await userEvent.selectOptions(await screen.findByLabelText(/Assignee/), String(COLLEAGUE.id));
    expect(screen.getByLabelText(/Description/)).toHaveValue("Work item 1 today");
    expect(gets(calls, "/api/staff/assignees")).toBe(2);

    await userEvent.click(screen.getByRole("button", { name: "Save action" }));
    expect(await screen.findByText("Action updated")).toBeInTheDocument();
    expect(writes(calls)[0].body).toEqual({ version: 4, description: "Work item 1 today", assigneeId: COLLEAGUE.id });
  });
});

// On the real IT Staff Ticket Detail, not the section alone: after an Action
// is saved the screen re-reads the Ticket, and that must not blank the page,
// or the section remounts and the "Action recorded" status is lost unseen.
describe("UI-01 on the IT Staff Ticket Detail screen", () => {
  it("keeps the section, and its success message, through the Ticket re-read after a save", async () => {
    const staffTicket = {
      id: 42, ticketNumber: "TKT-2026-00042", ticketDate: "2026-09-14T09:14:22.518Z",
      requester: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" }, category: { id: 2, name: "Network" },
      relatedSystem: { id: 5, name: "Campus Wi-Fi" }, summary: "Cannot connect", description: "Authentication failure.",
      requestedPriority: "HIGH", itPriority: "URGENT", currentStatus: "IN_PROGRESS", owner: ME,
      resolutionSummary: null, requesterResolvedAt: null, version: 4, attachments: [],
      createdAt: "2026-09-14T09:14:22.518Z", updatedAt: "2026-09-14T10:02:51.004Z",
    };
    let ticketReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      const method = init?.method ?? "GET";
      const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
      if (url.pathname === "/api/auth/me") return answer(200, { user: { ...ME, email: "grace@toktickit.local", mustChangePassword: false } });
      if (url.pathname === "/api/tickets/42") {
        ticketReads += 1;
        // A re-read takes network time, as it does in a browser; an instant
        // answer lets React batch the loading and ready states into one render
        // and hide the blanked page this test exists to catch.
        if (ticketReads > 1) await new Promise((resolve) => setTimeout(resolve, 100));
        return answer(200, staffTicket);
      }
      if (url.pathname === "/api/tickets/42/comments" || url.pathname === "/api/tickets/42/internal-notes") return answer(200, []);
      if (url.pathname === "/api/staff/assignees") return answer(200, ASSIGNEES);
      if (method === "GET" && url.pathname === "/api/tickets/42/actions") return answer(200, { items: [] });
      if (method === "POST" && url.pathname === "/api/tickets/42/actions") return answer(201, action(9));
      if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }));
    const { MemoryRouter } = await import("react-router-dom");
    const { default: App } = await import("../../src/App");
    render(<MemoryRouter initialEntries={["/queue/42"]}><App /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });

    await userEvent.click(await screen.findByRole("button", { name: "Add action" }));
    await userEvent.type(screen.getByLabelText(/Description/), "Replaced the access point.");
    await userEvent.type(screen.getByLabelText(/^Result/), "Signal restored.");
    const reads = ticketReads;
    await userEvent.click(screen.getByRole("button", { name: "Save action" }));

    // The Ticket is re-read (the resolution guidance depends on it)...
    await waitFor(() => expect(ticketReads).toBe(reads + 1));
    // ...without the page going back to "Loading", so the message is still there.
    expect(await screen.findByText("Action recorded")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByText("Action recorded")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ticket TKT-2026-00042" })).toBeInTheDocument();
  });
});
