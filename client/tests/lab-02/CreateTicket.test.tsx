import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import { REQUESTER_STORAGE_KEY } from "../../src/requester/index.js";

// UI-03, UI-04, UI-05, UI-06 — AC-03, AC-04, AC-05, AC-07.

const REQUESTERS = [{ id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local" }];
const CATEGORIES = [{ id: 2, name: "Network" }];
const RELATED_SYSTEMS = [{ id: 5, name: "Campus Wi-Fi" }];

const CREATED = {
  id: 42,
  ticketNumber: "TKT-2026-00042",
  ticketDate: "2026-08-30T09:14:22.518Z",
  requester: { id: 1, fullName: "Nadia Rahman" },
  category: { id: 2, name: "Network" },
  relatedSystem: { id: 5, name: "Campus Wi-Fi" },
  summary: "Cannot connect to Campus Wi-Fi in Building 4",
  description: "The laptop reports an authentication failure on the campus network every morning.",
  requestedPriority: "HIGH",
  currentStatus: "NEW",
};

type Handler = (url: string, init?: RequestInit) => unknown;

/** Routed per endpoint — never a blanket stub that answers every URL alike. */
function mockApi(overrides: { create?: Handler; reference?: Handler } = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const target = String(url);
    calls.push({ url: target, init });

    if (target.endsWith("/api/tickets") && init?.method === "POST") {
      const result = overrides.create ? overrides.create(target, init) : CREATED;
      if (result instanceof Error) throw result;
      if (result && typeof result === "object" && "status" in (result as object)) {
        const failure = result as { status: number; body: unknown };
        return { ok: false, status: failure.status, json: async () => failure.body };
      }
      return { ok: true, status: 201, json: async () => result };
    }

    if (target.endsWith("/api/requesters")) return { ok: true, status: 200, json: async () => REQUESTERS };
    if (target.endsWith("/api/categories")) return { ok: true, status: 200, json: async () => CATEGORIES };
    if (target.endsWith("/api/related-systems")) return { ok: true, status: 200, json: async () => RELATED_SYSTEMS };
    throw new Error(`Unexpected request: ${target}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

async function renderCreateTicket() {
  window.localStorage.setItem(REQUESTER_STORAGE_KEY, "1");
  render(
    <MemoryRouter initialEntries={["/create"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Create Ticket" });
  await waitFor(() => expect(screen.getByLabelText(/Category/)).toBeEnabled());
}

async function fillValidForm() {
  await userEvent.selectOptions(screen.getByLabelText(/Category/), "2");
  await userEvent.selectOptions(screen.getByLabelText(/Related System/), "5");
  await userEvent.type(screen.getByLabelText(/Ticket Summary/), CREATED.summary);
  await userEvent.selectOptions(screen.getByLabelText(/Requested Priority/), "HIGH");
  await userEvent.type(screen.getByLabelText(/Description/), CREATED.description);
}

beforeEach(() => {
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => "11111111-2222-4333-8444-555555555555" });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("Create Ticket — reference data and read-only values", () => {
  it("loads Categories and Related Systems from the API", async () => {
    mockApi();
    await renderCreateTicket();

    expect(within(screen.getByLabelText(/Category/)).getByRole("option", { name: "Network" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText(/Related System/)).getByRole("option", { name: "Campus Wi-Fi" }),
    ).toBeInTheDocument();
  });

  it("shows the Requester from context, and the system-assigned fields as pending", async () => {
    mockApi();
    await renderCreateTicket();

    // Every field §4.4 names is present, including Ticket Date.
    expect(screen.getAllByText("Nadia Rahman").length).toBeGreaterThan(0);
    expect(screen.getByText("Ticket Number")).toBeInTheDocument();
    expect(screen.getByText("Ticket Date")).toBeInTheDocument();
    expect(screen.getAllByText("Assigned after saving")).toHaveLength(2);
  });
});

describe("Create Ticket — validation", () => {
  it("reports every broken field beneath its own control and sends no request", async () => {
    const { calls } = mockApi();
    await renderCreateTicket();

    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    expect(await screen.findByText("Select a Category.")).toBeInTheDocument();
    expect(screen.getByText("Select a Related System.")).toBeInTheDocument();
    expect(screen.getByText(/Summary must be 5-120 characters\./)).toBeInTheDocument();
    expect(screen.getByText(/Description must be 20-4000 characters\./)).toBeInTheDocument();
    expect(screen.getByText("Select a Requested Priority.")).toBeInTheDocument();

    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  });

  it("clears a field's error as soon as that field is corrected", async () => {
    mockApi();
    await renderCreateTicket();

    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));
    expect(await screen.findByText("Select a Category.")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(/Category/), "2");
    expect(screen.queryByText("Select a Category.")).not.toBeInTheDocument();
  });
});

describe("Create Ticket — submission", () => {
  it("sends the requester and idempotency key as headers, not in the body", async () => {
    const { calls } = mockApi();
    await renderCreateTicket();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    await screen.findByRole("heading", { name: "Ticket created" });

    const post = calls.find((call) => call.init?.method === "POST")!;
    const headers = post.init!.headers as Record<string, string>;
    expect(headers["X-Dev-Requester-Id"]).toBe("1");
    expect(headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);

    // D-01: the body describes a Ticket and nothing else.
    const body = JSON.parse(post.init!.body as string);
    expect(body).not.toHaveProperty("requesterId");
    expect(body).not.toHaveProperty("idempotencyKey");
    expect(body.summary).toBe(CREATED.summary);
  });

  it("shows the backend Ticket Number and Ticket Date after a successful save", async () => {
    mockApi();
    await renderCreateTicket();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    expect(await screen.findByRole("status")).toHaveTextContent("TKT-2026-00042");
    expect(screen.queryByText("Assigned after saving")).not.toBeInTheDocument();
  });

  it("keeps every entered value when the API fails, and shows no raw network text", async () => {
    mockApi({ create: () => new TypeError("Failed to fetch") });
    await renderCreateTicket();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Unable to connect to TokTickIT API/i);
    expect(alert).not.toHaveTextContent(/Failed to fetch/);

    // BR-42: nothing the user typed is lost.
    expect(screen.getByLabelText(/Ticket Summary/)).toHaveValue(CREATED.summary);
    expect(screen.getByLabelText(/Description/)).toHaveValue(CREATED.description);
    expect(screen.getByLabelText(/Category/)).toHaveValue("2");
  });

  it("lands a server-side field error on the field it concerns", async () => {
    mockApi({
      create: () => ({
        status: 400,
        body: {
          error: {
            code: "VALIDATION_FAILED",
            message: "The Ticket could not be created.",
            fieldErrors: { summary: "Summary must be 5-120 characters." },
          },
        },
      }),
    });
    await renderCreateTicket();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    const message = await screen.findByText("Summary must be 5-120 characters.");
    expect(message).toHaveAttribute("id", "summary-error");
    // The field also has a character-count hint, so the description lists both ids.
    expect(screen.getByLabelText(/Ticket Summary/).getAttribute("aria-describedby")).toContain("summary-error");
  });
});

describe("Create Ticket — focus and cancel", () => {
  it("moves focus to the first invalid field in reading order", async () => {
    mockApi();
    await renderCreateTicket();

    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    // Category is first on the screen, so that is where focus belongs — not
    // wherever the user happened to be, and not whichever key an object
    // enumerated first.
    expect(screen.getByLabelText(/Category/)).toHaveFocus();
  });

  it("focuses the first field that is still invalid, not simply the first field", async () => {
    mockApi();
    await renderCreateTicket();

    // Fix the two selects; Summary becomes the first offender.
    await userEvent.selectOptions(screen.getByLabelText(/Category/), "2");
    await userEvent.selectOptions(screen.getByLabelText(/Related System/), "5");
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    expect(screen.getByLabelText(/Ticket Summary/)).toHaveFocus();
  });

  it("focuses the field a server-side error names", async () => {
    mockApi({
      create: () => ({
        status: 400,
        body: {
          error: {
            code: "VALIDATION_FAILED",
            message: "The Ticket could not be created.",
            fieldErrors: { description: "Description must be 20-4000 characters." },
          },
        },
      }),
    });
    await renderCreateTicket();
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    await screen.findByText("Description must be 20-4000 characters.");
    expect(screen.getByLabelText(/Description/)).toHaveFocus();
  });

  it("leaves immediately when Cancel is pressed on an untouched form", async () => {
    mockApi();
    await renderCreateTicket();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
  });

  it("asks before discarding a part-written ticket, and can be waved off", async () => {
    mockApi();
    await renderCreateTicket();
    await userEvent.type(screen.getByLabelText(/Ticket Summary/), "Half a thought");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("alertdialog", { name: /Discard this Ticket/i })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "My Tickets" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Nothing typed is lost by asking.
    expect(screen.getByLabelText(/Ticket Summary/)).toHaveValue("Half a thought");
  });

  it("discards and leaves once the discard is confirmed", async () => {
    mockApi();
    await renderCreateTicket();
    await userEvent.type(screen.getByLabelText(/Ticket Summary/), "Half a thought");

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await userEvent.click(screen.getByRole("button", { name: "Discard Ticket" }));

    expect(await screen.findByRole("heading", { name: "My Tickets" })).toBeInTheDocument();
  });
});

describe("Create Ticket — attachments", () => {
  function file(name: string, type: string, size: number) {
    const created = new File(["x"], name, { type });
    Object.defineProperty(created, "size", { value: size });
    return created;
  }

  it("keeps the valid file and names each rejected one with its reason", async () => {
    mockApi();
    await renderCreateTicket();

    // fireEvent rather than userEvent.upload: upload() honours the input's
    // `accept` filter and would drop payload.exe before the component ever saw
    // it. A browser treats accept as a hint — drag-and-drop ignores it — which
    // is exactly why this validation cannot live in the attribute.
    fireEvent.change(screen.getByLabelText(/Attachments/), {
      target: {
        files: [
          file("evidence.png", "image/png", 1024),
          file("payload.exe", "application/x-msdownload", 2048),
          file("huge.pdf", "application/pdf", 9 * 1024 * 1024),
        ],
      },
    });

    // The good one survives — losing it alongside the bad ones is the failure
    // mode Part 6 asks us to demonstrate the absence of.
    expect(within(screen.getByRole("list", { name: "Selected attachments" })).getByText(/evidence\.png/)).toBeInTheDocument();

    const error = screen.getByText(/payload\.exe/);
    expect(error).toHaveTextContent(/payload\.exe is not a permitted type/);
    expect(error).toHaveTextContent(/huge\.pdf is 9\.0 MB — the limit is 5 MB/);
  });

  it("refuses a sixth file while keeping the first five", async () => {
    mockApi();
    await renderCreateTicket();

    const six = Array.from({ length: 6 }, (_, index) => file(`shot-${index}.png`, "image/png", 1024));
    await userEvent.upload(screen.getByLabelText(/Attachments/), six);

    const list = screen.getByRole("list", { name: "Selected attachments" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText(/shot-5\.png exceeds the limit of 5 attachments/)).toBeInTheDocument();
  });

  it("is honest that selected files are not uploaded yet", async () => {
    mockApi();
    await renderCreateTicket();
    await userEvent.upload(screen.getByLabelText(/Attachments/), [file("evidence.png", "image/png", 1024)]);
    await fillValidForm();
    await userEvent.click(screen.getByRole("button", { name: "Submit Ticket" }));

    await screen.findByRole("heading", { name: "Ticket created" });
    expect(screen.getByText(/not uploaded/i)).toBeInTheDocument();
  });
});
