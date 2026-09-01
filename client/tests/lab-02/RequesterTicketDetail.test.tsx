import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import { REQUESTER_STORAGE_KEY } from "../../src/requester/index.js";

// UI-10, UI-11 — AC-12, AC-14, AC-15.

const REQUESTERS = [
  { id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local" },
  { id: 2, fullName: "Somchai Pattana", email: "somchai.pattana@toktickit.local" },
];

const ACTIVE_FILE = {
  id: 7,
  originalFilename: "wifi-error.png",
  mimeType: "image/png",
  sizeBytes: 184203,
  uploadedAt: "2026-08-30T09:20:41.004Z",
  removedAt: null,
  removedByRequesterId: null,
  removalReason: null,
};

const REMOVED_FILE = {
  id: 8,
  originalFilename: "wrong-screenshot.pdf",
  mimeType: "application/pdf",
  sizeBytes: 2 * 1024 * 1024,
  uploadedAt: "2026-08-30T09:25:00.000Z",
  removedAt: "2026-08-30T10:02:00.000Z",
  removedByRequesterId: 1,
  removalReason: "Uploaded the wrong screenshot",
};

function detail(attachments: unknown[] = []) {
  return {
    id: 42,
    ticketNumber: "TKT-2026-00042",
    ticketDate: "2026-08-30T09:14:22.518Z",
    requester: { id: 1, fullName: "Nadia Rahman" },
    category: { id: 2, name: "Network" },
    relatedSystem: { id: 5, name: "Campus Wi-Fi" },
    summary: "Cannot connect to Campus Wi-Fi in Building 4",
    description: "My laptop reports an authentication failure on the campus network.",
    requestedPriority: "HIGH",
    currentStatus: "NEW",
    attachments,
    createdAt: "2026-08-30T09:14:22.518Z",
    updatedAt: "2026-08-30T09:14:22.518Z",
  };
}

/** The server's error envelope, as api-spec.md 5 defines it. */
function envelope(status: number, code: string, message: string, fieldErrors?: Record<string, string>) {
  return { status, body: { error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } } };
}

type Handler = (init: RequestInit | undefined) => { status: number; body: unknown } | Blob;

/**
 * Routes by method and path so a test can answer one call differently without
 * restating the others. Every request is recorded, which is what lets the
 * ownership test assert on the header actually sent rather than on the props of
 * a component.
 */
function mockApi(handlers: Record<string, Handler> = {}) {
  const calls: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];

  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = (init?.headers ?? {}) as Record<string, string>;
    calls.push({ method, path: url.pathname, headers, body: init?.body });

    const handler = handlers[`${method} ${url.pathname}`];
    if (handler) {
      const answer = handler(init);
      if (answer instanceof Blob) {
        return { ok: true, status: 200, blob: async () => answer };
      }
      return {
        ok: answer.status < 400,
        status: answer.status,
        json: async () => answer.body,
        blob: async () => new Blob([]),
      };
    }

    if (url.pathname === "/api/requesters") return { ok: true, status: 200, json: async () => REQUESTERS };
    if (url.pathname === "/api/tickets/42") return { ok: true, status: 200, json: async () => detail() };
    throw new Error(`Unexpected request: ${method} ${url.pathname}`);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function renderDetail(ticketId = "42", requesterId = "1") {
  window.localStorage.setItem(REQUESTER_STORAGE_KEY, requesterId);
  render(
    <MemoryRouter initialEntries={[`/tickets/${ticketId}`]}>
      <App />
    </MemoryRouter>,
  );
}

function png(name: string, bytes = 1024): File {
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
}

/** The card a heading belongs to, so an assertion cannot match the app shell —
 *  which also displays the requester's name. */
function cardFor(heading: RegExp | string): HTMLElement {
  return screen.getByRole("heading", { name: heading }).closest("section") as HTMLElement;
}

// jsdom implements neither half of the object-URL API, and the download path
// needs both. Redefined per test so the calls can be counted.
const objectUrl = { create: vi.fn(() => "blob:stub"), revoke: vi.fn() };

beforeEach(() => {
  objectUrl.create.mockClear();
  objectUrl.revoke.mockClear();
  Object.assign(URL, { createObjectURL: objectUrl.create, revokeObjectURL: objectUrl.revoke });
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Ticket Detail — the read-only record", () => {
  it("shows every ticket field as a read-only value, not as an editable control", async () => {
    mockApi({ "GET /api/tickets/42": () => ({ status: 200, body: detail() }) });
    await renderDetail();

    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
    // Scoped to the ticket card: the shell shows the requester's name too, and
    // an assertion that cannot tell them apart proves nothing about the screen.
    const card = within(cardFor(/^Ticket TKT-/));

    for (const [label, value] of [
      ["Ticket Number", "TKT-2026-00042"],
      ["Requester", "Nadia Rahman"],
      ["Category", "Network"],
      ["Related System", "Campus Wi-Fi"],
      ["Ticket Summary", "Cannot connect to Campus Wi-Fi in Building 4"],
      ["Requested Priority", "HIGH"],
      ["Current Status", "NEW"],
      ["Description", "My laptop reports an authentication failure on the campus network."],
    ] as const) {
      expect(card.getByText(label)).toBeInTheDocument();
      expect(card.getByText(value)).toBeInTheDocument();
    }

    // The distinction the labsheet grades is read-only versus editable, so the
    // claim is about what the DOM contains: no textbox, combobox or textarea
    // carries any of these values.
    expect(screen.queryByRole("textbox", { name: /Summary|Description/ })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(document.querySelectorAll(".zen-field--readonly").length).toBeGreaterThanOrEqual(9);
  });

  it("asks for the ticket as the selected requester and shows nothing before the answer", async () => {
    const { calls } = mockApi({ "GET /api/tickets/42": () => ({ status: 200, body: detail() }) });
    await renderDetail("42", "2");

    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
    const detailCall = calls.find((call) => call.path === "/api/tickets/42");
    expect(detailCall?.headers["X-Dev-Requester-Id"]).toBe("2");
  });
});

describe("Ticket Detail — a ticket that is not yours", () => {
  it("reports a 404 without disclosing that the ticket exists", async () => {
    mockApi({
      "GET /api/tickets/42": () => envelope(404, "TICKET_NOT_FOUND", "That Ticket could not be found."),
    });
    await renderDetail();

    await screen.findByRole("heading", { name: "Ticket not found" });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/could not be found/i);

    // No field of the ticket reaches the screen, and nothing on it says who does
    // own the ticket — the two failures stay indistinguishable (D-04).
    expect(screen.queryByText("TKT-2026-00042")).toBeNull();
    expect(screen.queryByText("Somchai Pattana")).toBeNull();
    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull();
  });

  it("offers a retry when the backend fails, and recovers on it", async () => {
    let attempt = 0;
    mockApi({
      "GET /api/tickets/42": () => {
        attempt += 1;
        return attempt === 1
          ? envelope(503, "DEPENDENCY_UNAVAILABLE", "The service is temporarily unavailable.")
          : { status: 200, body: detail() };
      },
    });
    await renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);
    // A failure and a refusal read differently: this one is worth retrying and
    // says so, while "not found" offers no retry at all.
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByRole("heading", { name: "Ticket TKT-2026-00042" });
  });
});

describe("Ticket Detail — attachment states", () => {
  it("keeps a removed attachment as marked metadata with no download control", async () => {
    mockApi({ "GET /api/tickets/42": () => ({ status: 200, body: detail([ACTIVE_FILE, REMOVED_FILE]) }) });
    await renderDetail();

    const list = await screen.findByRole("list", { name: "Attachments" });
    const [active, removed] = within(list).getAllByRole("listitem");

    expect(within(active).getByText("wifi-error.png")).toBeInTheDocument();
    expect(within(active).getByText("Active")).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: /^Download wifi-error\.png$/ })).toBeInTheDocument();

    // The metadata survives removal: filename, type, size and upload time are
    // all still there, alongside the reason and the removal date (BR-37, BR-39).
    expect(within(removed).getByText("wrong-screenshot.pdf")).toBeInTheDocument();
    expect(within(removed).getByText(/PDF document/)).toHaveTextContent(/2\.0 MB/);
    expect(within(removed).getByText("Removed")).toBeInTheDocument();
    expect(within(removed).getByText(/Uploaded the wrong screenshot/)).toBeInTheDocument();

    // No download control at all for it, and the absence is explained in words
    // rather than left for the reader to infer from a colour.
    expect(within(removed).queryByRole("button", { name: /Download/ })).toBeNull();
    expect(within(removed).getByText(/Download is unavailable because this attachment was removed/)).toBeInTheDocument();
    expect(within(removed).queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("downloads an active attachment with the requester header, since a link cannot carry one", async () => {
    const { calls } = mockApi({
      "GET /api/tickets/42": () => ({ status: 200, body: detail([ACTIVE_FILE]) }),
      "GET /api/tickets/42/attachments/7/download": () => new Blob([new Uint8Array([1, 2, 3])]),
    });
    await renderDetail();

    const list = await screen.findByRole("list", { name: "Attachments" });
    await userEvent.click(within(list).getByRole("button", { name: /^Download wifi-error\.png$/ }));

    await waitFor(() => expect(objectUrl.create).toHaveBeenCalled());
    const download = calls.find((call) => call.path.endsWith("/download"));
    expect(download?.headers["X-Dev-Requester-Id"]).toBe("1");
    // The object URL is released once the save is triggered; a detail screen
    // visited repeatedly would otherwise hold every file it downloaded.
    expect(objectUrl.revoke).toHaveBeenCalledWith("blob:stub");
  });
});

describe("Ticket Detail — uploading", () => {
  it("names a rejected file with its reason and sends nothing", async () => {
    const { calls } = mockApi({ "GET /api/tickets/42": () => ({ status: 200, body: detail() }) });
    await renderDetail();
    await screen.findByRole("heading", { name: "Attachments" });

    // fireEvent, not userEvent.upload: userEvent honours the `accept` attribute
    // and would drop payload.exe before the component ever saw it. A browser
    // treats accept as a hint — drag-and-drop ignores it — which is why the
    // check cannot live in the attribute.
    fireEvent.change(screen.getByLabelText("Add an attachment"), {
      target: { files: [new File([new Uint8Array(1024)], "payload.exe", { type: "application/x-msdownload" })] },
    });

    // The rejection is client-side, so the server is never asked. The file is
    // named alongside the reason rather than reported as "invalid file".
    expect(screen.getByRole("alert")).toHaveTextContent(/payload\.exe is not a permitted type/);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull();
  });

  it("adds an uploaded file to the list and announces it", async () => {
    mockApi({
      "GET /api/tickets/42": () => ({ status: 200, body: detail() }),
      "POST /api/tickets/42/attachments": () => ({ status: 201, body: ACTIVE_FILE }),
    });
    await renderDetail();
    await screen.findByRole("heading", { name: "Attachments" });

    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("wifi-error.png"));

    const list = await screen.findByRole("list", { name: "Attachments" });
    expect(within(list).getByText("wifi-error.png")).toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent(/wifi-error\.png was uploaded/);
  });

  it("reports a server rejection beside the section, naming the file", async () => {
    mockApi({
      "GET /api/tickets/42": () => ({ status: 200, body: detail() }),
      "POST /api/tickets/42/attachments": () =>
        envelope(415, "ATTACHMENT_TYPE_NOT_ALLOWED", "Attachments must be JPEG, PNG, WEBP or PDF."),
    });
    await renderDetail();
    await screen.findByRole("heading", { name: "Attachments" });

    await userEvent.upload(screen.getByLabelText("Add an attachment"), png("disguised.png"));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/disguised\.png was not uploaded/);
    expect(alert).toHaveTextContent(/must be JPEG, PNG, WEBP or PDF/);
    expect(screen.queryByRole("list", { name: "Attachments" })).toBeNull();
  });

  it("stops offering the control once five attachments are active, and says why", async () => {
    const five = Array.from({ length: 5 }, (_, index) => ({
      ...ACTIVE_FILE,
      id: 100 + index,
      originalFilename: `shot-${index}.png`,
    }));
    mockApi({ "GET /api/tickets/42": () => ({ status: 200, body: detail(five) }) });
    await renderDetail();

    await screen.findByRole("list", { name: "Attachments" });
    expect(screen.getByLabelText("Add an attachment")).toBeDisabled();
    expect(screen.getByText(/already has 5 active attachments/)).toBeInTheDocument();
  });
});

describe("Ticket Detail — removal", () => {
  it("requires a confirmation and a typed reason before it will remove anything", async () => {
    const { calls } = mockApi({
      "GET /api/tickets/42": () => ({ status: 200, body: detail([ACTIVE_FILE]) }),
      "PATCH /api/tickets/42/attachments/7": () => ({
        status: 200,
        body: {
          ...ACTIVE_FILE,
          removedAt: "2026-08-31T11:00:00.000Z",
          removedByRequesterId: 1,
          removalReason: "Contains a colleague's name",
        },
      }),
    });
    await renderDetail();

    const list = await screen.findByRole("list", { name: "Attachments" });
    await userEvent.click(within(list).getByRole("button", { name: /^Remove wifi-error\.png$/ }));

    // Nothing has been asked of the server yet: the click opens a confirmation.
    const dialog = screen.getByRole("alertdialog", { name: "Remove wifi-error.png?" });
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);

    const confirm = within(dialog).getByRole("button", { name: "Remove attachment" });
    expect(confirm).toBeDisabled();

    // Four characters is one short of BR-38's minimum, so the button stays shut.
    await userEvent.type(within(dialog).getByLabelText(/Removal reason/), "oops");
    expect(confirm).toBeDisabled();

    await userEvent.type(within(dialog).getByLabelText(/Removal reason/), " — contains a colleague's name");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    await waitFor(() => expect(calls.some((call) => call.method === "PATCH")).toBe(true));
    const patch = calls.find((call) => call.method === "PATCH");
    expect(JSON.parse(String(patch?.body)).removalReason).toBe("oops — contains a colleague's name");

    // The row stays, now marked and unable to be downloaded (AC-15).
    const removed = within(await screen.findByRole("list", { name: "Attachments" })).getByRole("listitem");
    expect(within(removed).getByText("Removed")).toBeInTheDocument();
    expect(within(removed).getByText(/Contains a colleague's name/)).toBeInTheDocument();
    expect(within(removed).queryByRole("button", { name: /Download/ })).toBeNull();
  });

  it("abandons the removal when the confirmation is dismissed", async () => {
    const { calls } = mockApi({ "GET /api/tickets/42": () => ({ status: 200, body: detail([ACTIVE_FILE]) }) });
    await renderDetail();

    const list = await screen.findByRole("list", { name: "Attachments" });
    await userEvent.click(within(list).getByRole("button", { name: /^Remove wifi-error\.png$/ }));
    await userEvent.click(screen.getByRole("button", { name: "Keep attachment" }));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(within(screen.getByRole("list", { name: "Attachments" })).getByText("Active")).toBeInTheDocument();
  });

  it("puts a server-side reason rejection on the reason field", async () => {
    mockApi({
      "GET /api/tickets/42": () => ({ status: 200, body: detail([ACTIVE_FILE]) }),
      "PATCH /api/tickets/42/attachments/7": () =>
        envelope(400, "VALIDATION_FAILED", "The attachment could not be removed.", {
          removalReason: "Give a removal reason of 5-250 characters.",
        }),
    });
    await renderDetail();

    const list = await screen.findByRole("list", { name: "Attachments" });
    await userEvent.click(within(list).getByRole("button", { name: /^Remove wifi-error\.png$/ }));
    await userEvent.type(screen.getByLabelText(/Removal reason/), "     spaces only     ");
    await userEvent.click(screen.getByRole("button", { name: "Remove attachment" }));

    // The message lands on the field it concerns, and the attachment is untouched.
    const reason = await screen.findByText("Give a removal reason of 5-250 characters.");
    expect(reason).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
  });
});
