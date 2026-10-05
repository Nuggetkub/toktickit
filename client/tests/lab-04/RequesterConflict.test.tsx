import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "../../src/App";

// UI-09 in docs/lab-04/tests.md (AC-27), issue #89: after a 409 the Requester's
// Ticket Detail re-reads the Ticket in place, as the IT Staff screen does on a
// conflict. The refusal stays where it happened, the badge and the controls
// stop offering what the server just refused, and "Loading" never replaces the
// screen. Anything other than a 409 leaves the Ticket alone.

const USER = { id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", mustChangePassword: false };

const FILE = (id: number, name: string) => ({
  id, originalFilename: name, mimeType: "image/png", sizeBytes: 2048, uploadedAt: "2026-10-01T09:00:00.000Z",
  removedAt: null, removedByRequesterId: null, removalReason: null,
});

function ticket(currentStatus: string, attachments: unknown[] = []) {
  return {
    id: 42, ticketNumber: "TKT-2026-00042", ticketDate: "2026-10-01T09:00:00.000Z",
    requester: { id: 1, fullName: "Nadia Rahman" }, category: { id: 2, name: "Network" },
    relatedSystem: { id: 5, name: "Campus Wi-Fi" }, summary: "Cannot connect to Campus Wi-Fi",
    description: "Authentication fails in Building 4.", requestedPriority: "HIGH", itPriority: "HIGH",
    currentStatus, owner: { id: 9, fullName: "Grace Okafor" }, resolutionSummary: null, requesterResolvedAt: null,
    version: currentStatus === "CLOSED" ? 6 : 4, attachments,
    createdAt: "2026-10-01T09:00:00.000Z", updatedAt: "2026-10-02T09:00:00.000Z",
  };
}

const refusal = (status: number, code: string, message: string) => ({ status, body: { error: { code, message } } });

type Read = { body?: unknown; hold?: boolean; status?: number };
type Reply = { status: number; body: unknown };

/**
 * The first read answers `first`. Later reads take `later` in turn, repeating
 * the last: the Ticket as another tab or IT Staff left it. A read marked `hold`
 * waits until its release function in `held` is called, so a test can look at
 * the screen while the re-read is still on its way (an instant answer would
 * hide a screen that blanks and comes back). `write` answers the write under test.
 */
function mockApi(first: unknown, later: unknown | Read[], write: { key: string; reply: Reply | Reply[] }) {
  // A list of replies answers successive writes in turn, repeating the last.
  const replies = Array.isArray(write.reply) ? write.reply : [write.reply];
  let writes = 0;
  const reads: string[] = [];
  const held: Array<() => void> = [];
  const script: Read[] = Array.isArray(later) ? later : [{ body: later }];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const answer = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body, headers: new Headers() });
    if (url.pathname === "/api/auth/me") return answer(200, { user: USER });
    if (`${method} ${url.pathname}` === write.key) {
      const reply = replies[Math.min(writes++, replies.length - 1)];
      return answer(reply.status, reply.body);
    }
    if (method === "GET" && url.pathname === "/api/tickets/42") {
      reads.push(url.pathname);
      if (reads.length === 1) return answer(200, first);
      const next = script[Math.min(reads.length - 2, script.length - 1)];
      const status = next.status ?? 200;
      const body = status < 400 ? next.body : { error: { code: "DEPENDENCY_UNAVAILABLE", message: "The service is unavailable. Please try again." } };
      if (next.hold) return new Promise((resolve) => held.push(() => resolve(answer(status, body))));
      return answer(status, body);
    }
    if (url.pathname === "/api/tickets/42/comments") return answer(200, []);
    if (url.pathname === "/api/tickets/42/actions") return answer(200, { items: [] });
    if (url.pathname === "/api/tickets/42/history") return answer(200, { items: [], recordedFromCreation: true });
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  }));
  return { reads, held };
}

async function renderDetail() {
  render(<MemoryRouter initialEntries={["/tickets/42"]}><App /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Attachments" });
}

const png = (name: string) => new File([new Uint8Array(1024)], name, { type: "image/png" });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("UI-09 the Requester's Ticket Detail catches up after a 409 (issue #89)", () => {
  it("a comment refused because the Ticket was closed: the screen shows it Closed and stops offering the composer", async () => {
    const { reads, held } = mockApi(ticket("IN_PROGRESS"), [{ body: ticket("CLOSED"), hold: true }], {
      key: "POST /api/tickets/42/comments", reply: refusal(409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change."),
    });
    await renderDetail();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/Add a comment/), "Still failing this morning.");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    // While the re-read is on its way, the screen stays as it was: the refusal
    // beside the composer, the old status, and no "Loading" in its place.
    await waitFor(() => expect(held).toHaveLength(1));
    expect(screen.getByText("This Ticket is closed and can no longer change.")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.queryByText("Loading this Ticket…")).not.toBeInTheDocument();
    held[0]();
    expect(await screen.findByText("Closed")).toBeInTheDocument();
    expect(reads).toHaveLength(2);
    expect(screen.getByText("This ticket is closed. Create a new ticket if you need more help.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Post comment" })).not.toBeInTheDocument();
    expect(screen.queryByText("Loading this Ticket…")).not.toBeInTheDocument();
  });

  it("an upload refused at the limit: the refusal names the file, and the list shows what another tab added", async () => {
    const four = [1, 2, 3, 4].map((n) => FILE(n, `photo-${n}.png`));
    const { reads } = mockApi(ticket("OPEN", four), ticket("OPEN", [...four, FILE(5, "added-elsewhere.png")]), {
      key: "POST /api/tickets/42/attachments", reply: refusal(409, "ATTACHMENT_LIMIT_REACHED", "A Ticket may have at most 5 active attachments."),
    });
    await renderDetail();
    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("one-more.png"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/one-more\.png was not uploaded/);
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(within(await screen.findByRole("list", { name: "Attachments" })).getByText("added-elsewhere.png")).toBeInTheDocument();
    // Five are active now, so the control says why it is off rather than inviting another refusal.
    expect(screen.getByText(/already has 5 active attachments/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/one-more\.png was not uploaded/);
  });

  it("an indication refused: the dialog keeps the refusal, and the button behind it is gone", async () => {
    const { reads } = mockApi(ticket("IN_PROGRESS"), ticket("CLOSED"), {
      key: "POST /api/tickets/42/resolution-indication", reply: refusal(409, "INDICATION_NOT_ALLOWED", "This ticket can no longer be marked as resolved by you."),
    });
    await renderDetail();
    await userEvent.click(screen.getByRole("button", { name: "Problem Appears Resolved" }));
    await userEvent.click(screen.getByRole("button", { name: "Tell IT Staff" }));

    expect(await screen.findByText("This ticket can no longer be marked as resolved by you.")).toBeInTheDocument();
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(await screen.findByText("Closed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Problem Appears Resolved" })).not.toBeInTheDocument();
  });

  it("only the latest re-read lands: an older one answering late does not undo it", async () => {
    const four = [1, 2, 3, 4].map((n) => FILE(n, `photo-${n}.png`));
    const { reads, held } = mockApi(ticket("OPEN", four), [
      { body: ticket("OPEN", [...four, FILE(5, "older-read.png")]), hold: true },
      { body: ticket("OPEN", [...four, FILE(6, "latest-read.png")]) },
    ], { key: "POST /api/tickets/42/attachments", reply: refusal(409, "ATTACHMENT_LIMIT_REACHED", "A Ticket may have at most 5 active attachments.") });
    await renderDetail();
    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("first-try.png"));
    await waitFor(() => expect(held).toHaveLength(1));
    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("second-try.png"));
    expect(await screen.findByText("latest-read.png")).toBeInTheDocument();
    held[0]();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toHaveLength(3);
    expect(screen.getByText("latest-read.png")).toBeInTheDocument();
    expect(screen.queryByText("older-read.png")).not.toBeInTheDocument();
  });

  it("a write that succeeds after a re-read started supersedes it (Earth2509, PR #105)", async () => {
    const four = [1, 2, 3, 4].map((n) => FILE(n, `photo-${n}.png`));
    // The re-read was taken before the retry succeeded, so it does not have the retried file.
    const { reads, held } = mockApi(ticket("OPEN", four), [{ body: ticket("OPEN", four), hold: true }], {
      key: "POST /api/tickets/42/attachments",
      reply: [refusal(409, "ATTACHMENT_ALREADY_REMOVED", "That attachment has already been removed."), { status: 201, body: FILE(7, "retried.png") }],
    });
    await renderDetail();
    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("first-try.png"));
    await waitFor(() => expect(held).toHaveLength(1));
    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("retried.png"));
    expect(await screen.findByText(/retried\.png was uploaded/)).toBeInTheDocument();
    held[0]();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toHaveLength(2);
    expect(within(screen.getByRole("list", { name: "Attachments" })).getByText("retried.png")).toBeInTheDocument();
  });

  it("a re-read that fails says so with Retry, keeping the refusal and the draft; Retry catches up (Earth2509, PR #105)", async () => {
    const { reads } = mockApi(ticket("IN_PROGRESS"), [{ status: 503 }, { body: ticket("CLOSED") }], {
      key: "POST /api/tickets/42/comments", reply: refusal(409, "TICKET_TERMINAL", "This Ticket is closed and can no longer change."),
    });
    await renderDetail();
    await userEvent.type(screen.getByLabelText(/Add a comment/), "Still failing this morning.");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    const failed = await screen.findByText("This ticket could not be refreshed, so what it shows may be out of date.");
    expect(screen.getByText("This Ticket is closed and can no longer change.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a comment/)).toHaveValue("Still failing this morning.");
    expect(screen.getByText("In Progress")).toBeInTheDocument();

    await userEvent.click(within(failed.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Closed")).toBeInTheDocument();
    expect(reads).toHaveLength(3);
    expect(screen.queryByText("This ticket could not be refreshed, so what it shows may be out of date.")).not.toBeInTheDocument();
    expect(screen.getByText("This ticket is closed. Create a new ticket if you need more help.")).toBeInTheDocument();
  });

  it("anything but a 409 leaves the Ticket alone: a failed comment is reported and nothing is re-read", async () => {
    const { reads } = mockApi(ticket("IN_PROGRESS"), ticket("CLOSED"), {
      key: "POST /api/tickets/42/comments", reply: refusal(503, "DEPENDENCY_UNAVAILABLE", "The service is unavailable. Please try again."),
    });
    await renderDetail();
    await userEvent.type(screen.getByLabelText(/Add a comment/), "Still failing this morning.");
    await userEvent.click(screen.getByRole("button", { name: "Post comment" }));

    expect(await screen.findByText("The service is unavailable. Please try again.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Add a comment/)).toHaveValue("Still failing this morning.");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(reads).toHaveLength(1);
    expect(screen.getByText("In Progress")).toBeInTheDocument();
  });
});
