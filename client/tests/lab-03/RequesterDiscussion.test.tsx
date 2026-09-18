import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-07 — AC-04, AC-17, AC-19 (docs/lab-03/tests.md).
//
// The Requester's half of the discussion. Two of these assertions are negative
// claims — no Internal Notes control, and no request for one — so they are
// written as sweeps rather than as a single missing button: a screen that asked
// for notes and quietly discarded the 403 would satisfy "no panel is rendered"
// while still telling the server a Requester wants them.

const REQUESTER = {
  id: 3,
  fullName: "Nadia Rahman",
  email: "nadia.rahman@toktickit.local",
  role: "REQUESTER",
  mustChangePassword: false,
};

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
    itPriority: "HIGH",
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

function comment(id: number, content: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketId: 42,
    author: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
    content,
    statusChangedTo: null,
    createdAt: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

type Answer = { status: number; body: unknown };
type Handler = (init: RequestInit | undefined) => Answer | Promise<Answer>;

function mockApi(
  handlers: Record<string, Handler> = {},
  seed: { detail?: Record<string, unknown>; comments?: unknown[] } = {},
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

    if (url.pathname === "/api/auth/me") return answer(200, { user: REQUESTER });
    if (url.pathname === "/api/tickets/42") return answer(200, current);
    if (url.pathname === "/api/tickets/42/comments") return answer(200, seed.comments ?? []);
    if (url.pathname === "/api/categories" || url.pathname === "/api/related-systems") return answer(200, []);
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function renderDetail() {
  render(
    <MemoryRouter initialEntries={["/tickets/42"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Requester Ticket Detail — the discussion", () => {
  it("shows the comment thread and a composer", async () => {
    mockApi({}, { comments: [comment(1, "We have replaced the access point.")] });
    await renderDetail();

    const thread = within(screen.getByRole("list", { name: "Comments" }));
    expect(thread.getByText("We have replaced the access point.")).toBeInTheDocument();
    // Scoped to the thread deliberately: the same name is on the ticket as
    // "Assigned to", and an assertion that cannot tell the owner from the
    // author of a comment proves nothing about the byline.
    expect(thread.getByText("Grace Okafor")).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a comment/)).toBeInTheDocument();
  });

  it("posts a comment and shows it at the top of the thread", async () => {
    const { calls } = mockApi(
      {
        "POST /api/tickets/42/comments": () => ({
          status: 201,
          body: comment(2, "Thank you — it works now.", {
            author: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" },
            createdAt: "2026-09-16T09:00:00.000Z",
          }),
        }),
      },
      { comments: [comment(1, "We have replaced the access point.")] },
    );
    await renderDetail();

    await userEvent.type(screen.getByLabelText(/Add a comment/), "Thank you — it works now.");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    await waitFor(() => expect(screen.getByText("Thank you — it works now.")).toBeInTheDocument());
    expect(calls.find((call) => call.method === "POST" && call.path === "/api/tickets/42/comments")?.body).toEqual({
      content: "Thank you — it works now.",
    });

    // Newest first (BR-37): the reply the Requester just wrote is above the one
    // it answers, which is the order the server returns them in.
    const entries = within(screen.getByRole("list", { name: "Comments" })).getAllByRole("listitem");
    expect(entries[0]).toHaveTextContent("Thank you — it works now.");
  });

  it("renders content as text, with line breaks kept and markup shown literally", async () => {
    // BR-36. React escapes what it renders and the panel preserves newlines in
    // CSS, so a comment containing tags reaches the next reader as characters.
    mockApi({}, { comments: [comment(1, "Line one\nLine two <b>not bold</b>")] });
    await renderDetail();

    const content = screen.getByText(/Line one/);
    expect(content).toHaveTextContent("<b>not bold</b>");
    expect(content.querySelector("b")).toBeNull();
  });

  it("renders no Internal Notes control and never asks for internal notes", async () => {
    const { calls } = mockApi({}, { comments: [comment(1, "A public reply")] });
    await renderDetail();

    // AC-04 is a negative claim, so it is swept rather than spot-checked.
    expect(screen.queryByText(/Internal note/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /internal/i })).not.toBeInTheDocument();
    expect(calls.some((call) => call.path.includes("internal-notes"))).toBe(false);
  });
});

describe("Requester Ticket Detail — Problem Appears Resolved", () => {
  it("confirms first, then records what the Requester did without moving the status", async () => {
    const { calls } = mockApi({
      "POST /api/tickets/42/resolution-indication": () => ({
        status: 200,
        body: ticket({ requesterResolvedAt: "2026-09-16T10:41:00.000Z" }),
      }),
    });
    await renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "Problem Appears Resolved" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("They will review and close the ticket.");
    await userEvent.click(within(dialog).getByRole("button", { name: "Tell IT Staff" }));

    // The button is replaced by the record of what was done...
    expect(await screen.findByText(/You told IT Staff the problem appears resolved on/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();

    // ...and the status badge does not move, so the screen never suggests IT
    // has formally resolved it (ui-spec.md §6).
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(calls.some((call) => call.path === "/api/tickets/42/resolution-indication")).toBe(true);
  });

  it("sends nothing if the confirmation is cancelled", async () => {
    const { calls } = mockApi();
    await renderDetail();

    await userEvent.click(screen.getByRole("button", { name: "Problem Appears Resolved" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls.some((call) => call.path === "/api/tickets/42/resolution-indication")).toBe(false);
    expect(screen.getByRole("button", { name: "Problem Appears Resolved" })).toBeInTheDocument();
  });

  it("does not offer the indication on a Resolved ticket", async () => {
    // BR-32 refuses it from RESOLVED even though that status is not terminal —
    // the case a rule written as "anything but closed" would get wrong.
    mockApi({}, { detail: ticket({ currentStatus: "RESOLVED" }) });
    await renderDetail();

    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();
  });

  it("replaces the composer with the closed message on a cancelled ticket", async () => {
    mockApi({}, { detail: ticket({ currentStatus: "CANCELLED" }), comments: [comment(1, "Withdrawn as duplicate")] });
    await renderDetail();

    expect(screen.getByText("This ticket is closed. Create a new ticket if you need more help.")).toBeInTheDocument();
    expect(screen.queryByLabelText(/Add a comment/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();
    // Everything on it stays readable (BR-27).
    expect(screen.getByText("Withdrawn as duplicate")).toBeInTheDocument();
  });
});
