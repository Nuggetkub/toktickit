import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";
import { REQUESTER_STORAGE_KEY } from "../../src/requester/index.js";

// UI-07, UI-08, UI-09 — AC-08, AC-09, AC-11.

const REQUESTERS = [
  { id: 1, fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local" },
  { id: 2, fullName: "Somchai Pattana", email: "somchai.pattana@toktickit.local" },
];
const CATEGORIES = [{ id: 2, name: "Network" }, { id: 3, name: "Hardware" }];
const RELATED_SYSTEMS = [{ id: 5, name: "Campus Wi-Fi" }];

function ticket(id: number, summary: string, priority = "HIGH") {
  return {
    id,
    ticketNumber: `TKT-2026-${String(id).padStart(5, "0")}`,
    ticketDate: "2026-08-30T09:00:00.000Z",
    summary,
    category: CATEGORIES[0],
    relatedSystem: RELATED_SYSTEMS[0],
    requestedPriority: priority,
    currentStatus: "NEW",
    attachmentCount: 0,
  };
}

function page(items: ReturnType<typeof ticket>[], overrides: Record<string, number> = {}) {
  return { items, page: 1, pageSize: 10, totalItems: items.length, totalPages: 1, ...overrides };
}

/** Records every /api/tickets request so query building can be asserted. */
function mockApi(listFor: (url: URL) => unknown = () => page([ticket(1, "Campus Wi-Fi drops nightly")])) {
  const listUrls: URL[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");

    if (url.pathname === "/api/tickets") {
      listUrls.push(url);
      const body = listFor(url);
      if (body instanceof Error) throw body;
      return { ok: true, status: 200, json: async () => body, headers: init?.headers };
    }
    if (url.pathname === "/api/requesters") return { ok: true, status: 200, json: async () => REQUESTERS };
    if (url.pathname === "/api/categories") return { ok: true, status: 200, json: async () => CATEGORIES };
    if (url.pathname === "/api/related-systems") return { ok: true, status: 200, json: async () => RELATED_SYSTEMS };
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, listUrls };
}

async function renderList(requesterId = "1") {
  window.localStorage.setItem(REQUESTER_STORAGE_KEY, requesterId);
  render(
    <MemoryRouter initialEntries={["/tickets"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "My Tickets" });
}

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("My Tickets — the list", () => {
  it("shows the requester's tickets with the columns the spec names", async () => {
    mockApi();
    await renderList();

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Ticket Number",
      "Summary",
      "Category",
      "Related System",
      "Requested Priority",
      "Ticket Date",
    ]);
    expect(within(table).getByText("Campus Wi-Fi drops nightly")).toBeInTheDocument();
  });

  it("sends the requester in the header, never in the query string", async () => {
    const { listUrls } = mockApi();
    await renderList();
    await screen.findByRole("table");

    expect(listUrls[0].searchParams.has("requesterId")).toBe(false);
  });

  it("links Ticket Number and Summary to the ticket", async () => {
    mockApi();
    await renderList();

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "TKT-2026-00001" })).toHaveAttribute("href", "/tickets/1");
    expect(within(table).getByRole("link", { name: "Campus Wi-Fi drops nightly" })).toHaveAttribute("href", "/tickets/1");
  });
});

describe("My Tickets — searching and filtering", () => {
  it("debounces typing into one request rather than one per keystroke", async () => {
    const { listUrls } = mockApi();
    await renderList();
    await screen.findByRole("table");
    const before = listUrls.length;

    await userEvent.type(screen.getByLabelText("Search"), "laptop");
    await waitFor(() => expect(listUrls.length).toBeGreaterThan(before), { timeout: 2000 });
    // Let any further debounced request land before counting.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const searches = listUrls.slice(before).map((url) => url.searchParams.get("search"));
    expect(searches.length).toBeLessThanOrEqual(2);
    expect(searches.at(-1)).toBe("laptop");
  });

  it("omits an empty filter from the query instead of sending a blank value", async () => {
    // The API rejects unknown or malformed parameters rather than ignoring them,
    // so a blank filter must be absent, not present and empty.
    const { listUrls } = mockApi();
    await renderList();
    await screen.findByRole("table");

    const first = listUrls[0];
    expect(first.searchParams.has("categoryId")).toBe(false);
    expect(first.searchParams.has("search")).toBe(false);
    expect(first.searchParams.get("sortBy")).toBe("ticketDate");
  });

  it("sends a chosen filter and resets to the first page", async () => {
    const { listUrls } = mockApi();
    await renderList();
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText("Category"), "3");
    await waitFor(() => expect(listUrls.at(-1)!.searchParams.get("categoryId")).toBe("3"));
    expect(listUrls.at(-1)!.searchParams.get("page")).toBe("1");
  });

  it("offers no Current Status filter, because every Lab 2 Ticket is NEW", async () => {
    mockApi();
    await renderList();
    await screen.findByRole("table");

    expect(screen.queryByLabelText(/Current Status/i)).not.toBeInTheDocument();
  });
});

describe("My Tickets — Clear filters", () => {
  it("is enabled by a sort-only change, because it resets sort too", async () => {
    mockApi();
    await renderList();
    await screen.findByRole("table");

    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Sort"), "ticketNumber:asc");
    expect(clear).toBeEnabled();

    await userEvent.click(clear);
    expect(screen.getByLabelText("Sort")).toHaveValue("ticketDate:desc");
  });
});

describe("My Tickets — empty and no-results are different", () => {
  it("offers Create Ticket when the requester has none at all", async () => {
    mockApi(() => page([]));
    await renderList();

    const message = await screen.findByText("You have not created any Tickets yet.");
    // Create Ticket also sits in the toolbar, so scope to the empty panel.
    const panel = message.closest(".zen-empty") as HTMLElement;
    expect(within(panel).getByRole("button", { name: "Create Ticket" })).toBeInTheDocument();
  });

  it("offers Clear filters when a search matched nothing", async () => {
    mockApi((url) => (url.searchParams.get("search") ? page([]) : page([ticket(1, "Campus Wi-Fi drops nightly")])));
    await renderList();
    await screen.findByRole("table");

    await userEvent.type(screen.getByLabelText("Search"), "zzzz");

    expect(await screen.findByText("No Tickets match your search or filters.", {}, { timeout: 3000 })).toBeInTheDocument();
    // Telling someone to clear filters they never set would be the wrong advice,
    // and offering "Create Ticket" here answers a question they did not ask.
    expect(screen.queryByText("You have not created any Tickets yet.")).not.toBeInTheDocument();
  });
});

describe("My Tickets — pagination", () => {
  it("announces the result count, not only the page number", async () => {
    const rows = Array.from({ length: 10 }, (_, index) => ticket(index + 1, `Ticket ${index + 1}`));
    mockApi(() => page(rows, { totalItems: 24, totalPages: 3 }));
    await renderList();
    await screen.findByRole("table");

    const nav = screen.getByRole("navigation", { name: "Ticket list pages" });
    expect(nav).toHaveTextContent("Showing 1–10 of 24 Tickets");
    expect(nav).toHaveTextContent("Page 1 of 3");
  });

  it("disables Previous on the first page and Next on the last", async () => {
    mockApi(() => page([ticket(1, "Only ticket")]));
    await renderList();
    await screen.findByRole("table");

    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });
});

describe("My Tickets — requester context", () => {
  it("requests the list for whichever requester is selected", async () => {
    const { fetchMock } = mockApi();
    await renderList("2");
    await screen.findByRole("table");

    const listCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/api/tickets"))!;
    const headers = (listCall[1] as RequestInit).headers as Record<string, string>;
    expect(headers["X-Dev-Requester-Id"]).toBe("2");
  });

  it("returns to the selector when the requester is changed", async () => {
    mockApi();
    await renderList();
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Change Requester" }));

    expect(
      await screen.findByRole("heading", { name: "Development Requester Selection" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
