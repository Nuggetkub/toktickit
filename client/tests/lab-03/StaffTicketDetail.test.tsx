import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-05 — AC-14, AC-15, AC-16; UI-06 — AC-17, AC-18, AC-19 (docs/lab-03/tests.md).
//
// The screen's whole claim is that Ticket information is a record and the Work
// panel is the only place anything changes. So the tests assert what was *sent*
// as well as what is on screen: an owner control that changes a dropdown and
// nothing else, or a status list offering a transition the server will refuse,
// both look like working software until someone uses them.
//
// Composer labels are anchored (`/^Public comment$/`) rather than loose. The
// panel heading, the list's accessible name and the tab all contain the same
// words, so an unanchored query matches three elements and the test fails for a
// reason that has nothing to do with the behaviour it is about.

const STAFF = {
  id: 7,
  fullName: "Grace Okafor",
  email: "grace.okafor@toktickit.local",
  role: "IT_STAFF",
  mustChangePassword: false,
};

const ASSIGNEES = [
  { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
  { id: 9, fullName: "Hassan Ali", role: "IT_STAFF" },
];

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    ticketNumber: "TKT-2026-00042",
    ticketDate: "2026-09-14T09:14:22.518Z",
    requester: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" },
    category: { id: 2, name: "Network" },
    relatedSystem: { id: 5, name: "Campus Wi-Fi" },
    summary: "Cannot connect to Campus Wi-Fi in Building 4",
    description: "My laptop reports an authentication failure on the campus network.",
    requestedPriority: "HIGH",
    itPriority: "URGENT",
    currentStatus: "IN_PROGRESS",
    owner: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
    resolutionSummary: null,
    requesterResolvedAt: null,
    version: 4,
    attachments: [],
    createdAt: "2026-09-14T09:14:22.518Z",
    updatedAt: "2026-09-14T10:02:51.004Z",
    ...overrides,
  };
}

function entry(id: number, content: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketId: 42,
    author: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
    content,
    createdAt: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

type Answer = { status: number; body: unknown };
type Handler = (init: RequestInit | undefined) => Answer | Promise<Answer>;

function envelope(status: number, code: string, message: string, fieldErrors?: Record<string, string>): Answer {
  return { status, body: { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } } };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Routed by method and path so one test can answer a single call differently
 * without restating the rest, and every request is recorded — which is what
 * lets a test assert that nothing was re-sent after a conflict.
 */
function mockApi(
  handlers: Record<string, Handler> = {},
  seed: { detail?: Record<string, unknown>; comments?: unknown[]; notes?: unknown[] } = {},
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const current = seed.detail ?? ticket();

  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });

    const answer = (status: number, body: unknown) => ({
      ok: status < 400,
      status,
      json: async () => body,
      headers: new Headers(),
    });

    const handler = handlers[`${method} ${url.pathname}`];
    if (handler) {
      const result = await handler(init);
      return answer(result.status, result.body);
    }

    if (url.pathname === "/api/auth/me") return answer(200, { user: STAFF });
    if (url.pathname === "/api/tickets/42") return answer(200, current);
    if (url.pathname === "/api/tickets/42/comments") return answer(200, seed.comments ?? []);
    if (url.pathname === "/api/tickets/42/internal-notes") return answer(200, seed.notes ?? []);
    if (url.pathname === "/api/staff/assignees") return answer(200, ASSIGNEES);
    if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function renderDetail() {
  render(
    <MemoryRouter initialEntries={["/queue/42"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IT Staff Ticket Detail — information is a record, the Work panel is not", () => {
  it("shows the ticket facts read-only, with no control that would edit them", async () => {
    mockApi();
    await renderDetail();

    expect(screen.getByText("Cannot connect to Campus Wi-Fi in Building 4")).toBeInTheDocument();
    expect(screen.getByText("Nadia Rahman")).toBeInTheDocument();
    expect(screen.getByText("Campus Wi-Fi")).toBeInTheDocument();

    // The editable region is exactly three controls. A textbox anywhere in the
    // information column would mean a Requester's record had become editable.
    expect(screen.getByLabelText(/^Owner/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^IT Priority/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Status/)).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Cannot connect to Campus Wi-Fi in Building 4")).not.toBeInTheDocument();
  });

  it("carries both priorities under their own labels and the status in words", async () => {
    mockApi();
    await renderDetail();

    const header = screen.getByText("In Progress");
    expect(header).toBeInTheDocument();
    expect(screen.getAllByText("Requested").length).toBeGreaterThan(0);
    expect(screen.getAllByText("IT").length).toBeGreaterThan(0);
  });

  it("offers only the statuses BR-29 allows from here", async () => {
    mockApi();
    await renderDetail();

    // IN_PROGRESS -> WAITING_FOR_REQUESTER, RESOLVED, CANCELLED. Anything else
    // would be refused by the server, and a choice that cannot succeed is not
    // a choice.
    const options = within(screen.getByLabelText(/^Status/))
      .getAllByRole("option")
      .map((option) => option.textContent);
    expect(options).toEqual(["Choose a new status", "Waiting for Requester", "Resolved", "Cancelled"]);
    expect(options).not.toContain("In Progress");
    expect(options).not.toContain("Closed");
  });
});

describe("IT Staff Ticket Detail — each save is its own", () => {
  it("claims an unassigned ticket, sending the version it last read", async () => {
    const { calls } = mockApi(
      { "POST /api/tickets/42/claim": () => ({ status: 200, body: ticket({ version: 5 }) }) },
      { detail: ticket({ owner: null, version: 4 }) },
    );
    await renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "Claim" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You now own this ticket."));
    expect(calls.find((call) => call.path === "/api/tickets/42/claim")?.body).toEqual({ version: 4 });
  });

  it("saves the owner without disabling the priority control", async () => {
    // ui-spec.md §8: each save has its own busy state. One shared flag would
    // mean saving a priority locks the owner control, and the reader cannot
    // tell which of three edits is in flight.
    const gate = deferred<Answer>();
    mockApi({ "PATCH /api/tickets/42/owner": () => gate.promise });
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Owner/), "9");
    await userEvent.click(screen.getByRole("button", { name: "Save owner" }));

    expect(await screen.findByRole("button", { name: "Saving owner…" })).toBeDisabled();
    expect(screen.getByLabelText(/^IT Priority/)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save priority" })).toBeEnabled();

    gate.resolve({ status: 200, body: ticket({ owner: ASSIGNEES[1], version: 5 }) });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Owner updated"));
  });

  it("sends Unassigned as null rather than omitting it", async () => {
    const { calls } = mockApi({
      "PATCH /api/tickets/42/owner": () => ({ status: 200, body: ticket({ owner: null, version: 5 }) }),
    });
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Owner/), "");
    await userEvent.click(screen.getByRole("button", { name: "Save owner" }));

    await waitFor(() => expect(calls.some((call) => call.path === "/api/tickets/42/owner")).toBe(true));
    expect(calls.find((call) => call.path === "/api/tickets/42/owner")?.body).toEqual({ ownerId: null, version: 4 });
  });

  it("saves the IT Priority on its own, leaving Requested Priority alone", async () => {
    const { calls } = mockApi({
      "PATCH /api/tickets/42/it-priority": () => ({ status: 200, body: ticket({ itPriority: "LOW", version: 5 }) }),
    });
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^IT Priority/), "LOW");
    await userEvent.click(screen.getByRole("button", { name: "Save priority" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("IT Priority updated"));
    expect(calls.find((call) => call.path === "/api/tickets/42/it-priority")?.body).toEqual({
      itPriority: "LOW",
      version: 4,
    });
  });
});

describe("IT Staff Ticket Detail — confirmation, validation and conflict", () => {
  it("will not confirm Resolved until the summary meets BR-30", async () => {
    const { calls } = mockApi({
      "POST /api/tickets/42/status": () => ({ status: 200, body: ticket({ currentStatus: "RESOLVED", version: 5 }) }),
    });
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Status/), "RESOLVED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Change status to Resolved" });
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/Resolution summary/), "Replaced the access point");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Status changed to Resolved"));
    expect(calls.find((call) => call.path === "/api/tickets/42/status")?.body).toEqual({
      toStatus: "RESOLVED",
      version: 4,
      resolutionSummary: "Replaced the access point",
    });
  });

  it("refreshes the thread after a status change, because the server posts the summary as a comment", async () => {
    // BR-30: the summary is written as a Public Comment in the same
    // transaction, so the thread on screen is stale the instant the change
    // succeeds. Nothing asserted this until I checked the rule against the
    // code rather than against what the screen appeared to do.
    let reads = 0;
    mockApi({
      "GET /api/tickets/42/comments": () => {
        reads += 1;
        return {
          status: 200,
          body:
            reads === 1
              ? []
              : [entry(3, "Replaced the access point", { statusChangedTo: "RESOLVED" })],
        };
      },
      "POST /api/tickets/42/status": () => ({ status: 200, body: ticket({ currentStatus: "RESOLVED", version: 5 }) }),
    });
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Status/), "RESOLVED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/Resolution summary/), "Replaced the access point");
    await userEvent.click(within(dialog).getByRole("button", { name: "Change status to Resolved" }));

    expect(await screen.findByText("Replaced the access point")).toBeInTheDocument();
    // Scoped to the thread: the success notice says the same words, and an
    // unscoped query cannot tell "the save worked" from "the thread now records
    // why" — which is the half this test is actually about.
    const thread = within(screen.getByRole("list", { name: "Public comments" }));
    expect(thread.getByText("Status changed to Resolved")).toBeInTheDocument();
  });

  it("asks for a reason rather than a summary when cancelling", async () => {
    mockApi();
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Status/), "CANCELLED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText(/Reason/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Resolution summary/)).not.toBeInTheDocument();
  });

  it("closes the dialog on Escape without sending anything", async () => {
    const { calls } = mockApi();
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Status/), "CANCELLED");
    await userEvent.click(screen.getByRole("button", { name: "Change status" }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.some((call) => call.path === "/api/tickets/42/status")).toBe(false);
  });

  it("reports a stale version as a conflict, keeps the typed comment, and re-sends nothing", async () => {
    const { calls } = mockApi({
      "PATCH /api/tickets/42/it-priority": () =>
        envelope(409, "TICKET_VERSION_CONFLICT", "This Ticket changed while you were working on it."),
    });
    await renderDetail();

    await userEvent.type(screen.getByLabelText(/^Public comment$/), "Half-written note to the requester");
    await userEvent.selectOptions(screen.getByLabelText(/^IT Priority/), "LOW");
    await userEvent.click(screen.getByRole("button", { name: "Save priority" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Someone else changed this ticket. Reload to see the latest version.");
    expect(within(alert).getByRole("button", { name: "Reload" })).toBeInTheDocument();

    // Unsent input survives, and nothing is retried behind the reader's back.
    expect(screen.getByLabelText(/^Public comment$/)).toHaveValue("Half-written note to the requester");
    expect(calls.filter((call) => call.path === "/api/tickets/42/it-priority")).toHaveLength(1);
  });

  it("names the missing owner instead of letting the server refuse the transition", async () => {
    mockApi({}, { detail: ticket({ owner: null, currentStatus: "OPEN" }) });
    await renderDetail();

    await userEvent.selectOptions(screen.getByLabelText(/^Status/), "IN_PROGRESS");

    // BR-28 stated before the attempt: a 409 afterwards is a worse way to learn.
    expect(
      await screen.findByText("Assign an owner before moving this ticket to In Progress."),
    ).toBeInTheDocument();
  });

  it("freezes the Work panel on a closed ticket but keeps everything readable", async () => {
    mockApi({}, { detail: ticket({ currentStatus: "CLOSED" }), comments: [entry(1, "Closing note")] });
    await renderDetail();

    expect(screen.getByText("This ticket is closed and can no longer be changed.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Owner/)).toBeDisabled();
    expect(screen.getByLabelText(/^IT Priority/)).toBeDisabled();
    expect(screen.getByLabelText(/^Status/)).toBeDisabled();

    // Tabs stay readable; only the composers go (ui-spec.md §8).
    expect(screen.queryByLabelText(/^Public comment$/)).not.toBeInTheDocument();
    expect(screen.getByText("Closing note")).toBeInTheDocument();
  });
});

describe("Internal notes are kept apart from public comments", () => {
  it("uses the private surface and its heading, and its own submit wording", async () => {
    mockApi({}, { notes: [entry(5, "Router firmware is out of date")] });
    await renderDetail();

    await userEvent.click(screen.getByRole("tab", { name: /Internal notes/ }));

    expect(
      screen.getByRole("heading", { name: /Internal notes — visible only to IT Staff and Administrators/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add internal note" })).toBeInTheDocument();
    expect(screen.getByText("Router firmware is out of date")).toBeInTheDocument();
  });

  it("keeps a separate draft per composer, so switching tabs never moves text", async () => {
    // The accident this prevents is the one that matters most on this screen:
    // a private note posted publicly because the composer carried the draft.
    mockApi();
    await renderDetail();

    await userEvent.type(screen.getByLabelText(/^Public comment$/), "Visible to the requester");
    await userEvent.click(screen.getByRole("tab", { name: /Internal notes/ }));

    expect(screen.getByLabelText(/^Internal note$/)).toHaveValue("");
    await userEvent.type(screen.getByLabelText(/^Internal note$/), "Private working note");

    await userEvent.click(screen.getByRole("tab", { name: /Public comments/ }));
    expect(screen.getByLabelText(/^Public comment$/)).toHaveValue("Visible to the requester");

    await userEvent.click(screen.getByRole("tab", { name: /Internal notes/ }));
    expect(screen.getByLabelText(/^Internal note$/)).toHaveValue("Private working note");
  });

  it("posts each composer to its own endpoint", async () => {
    const { calls } = mockApi({
      "POST /api/tickets/42/internal-notes": () => ({ status: 201, body: entry(9, "Private working note") }),
    });
    await renderDetail();

    await userEvent.click(screen.getByRole("tab", { name: /Internal notes/ }));
    await userEvent.type(screen.getByLabelText(/^Internal note$/), "Private working note");
    await userEvent.click(screen.getByRole("button", { name: "Add internal note" }));

    await waitFor(() => expect(screen.getByText("Private working note")).toBeInTheDocument());
    const posted = calls.find((call) => call.method === "POST" && call.path === "/api/tickets/42/internal-notes");
    expect(posted?.body).toEqual({ content: "Private working note" });
    expect(calls.some((call) => call.method === "POST" && call.path === "/api/tickets/42/comments")).toBe(false);
  });

  it("shows the Requester's indication with their name and its time", async () => {
    mockApi({}, { detail: ticket({ requesterResolvedAt: "2026-09-15T10:41:00.000Z" }) });
    await renderDetail();

    // BR-33: this banner is how IT Staff learn of it at all.
    expect(screen.getByRole("note")).toHaveTextContent(/Nadia Rahman says the problem appears resolved/);
    // And it is not a status change: the badge is untouched.
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });

  it("offers no upload or removal control on the attachments tab", async () => {
    mockApi(
      {},
      {
        detail: ticket({
          attachments: [
            {
              id: 7,
              originalFilename: "wifi-error.png",
              mimeType: "image/png",
              sizeBytes: 184203,
              uploadedAt: "2026-09-14T09:20:41.004Z",
              removedAt: null,
              removedByRequesterId: null,
              removalReason: null,
            },
          ],
        }),
      },
    );
    await renderDetail();

    await userEvent.click(screen.getByRole("tab", { name: /Attachments/ }));

    expect(screen.getByRole("button", { name: "Download wifi-error.png" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Add an attachment/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remove / })).not.toBeInTheDocument();
  });
});
