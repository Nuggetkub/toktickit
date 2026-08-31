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

/** A promise the test resolves when it chooses, for loading and ordering tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Records every /api/tickets request so query building can be asserted, and lets
 * a test return a pending promise so the states between request and response are
 * reachable rather than only their endpoints.
 */
function mockApi(
  listFor: (url: URL, headers: Record<string, string>) => unknown = () => page([ticket(1, "Campus Wi-Fi drops nightly")]),
) {
  const listUrls: URL[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");

    if (url.pathname === "/api/tickets") {
      listUrls.push(url);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const body = await listFor(url, headers);
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
  // The filter dropdowns are populated by a separate request. Waiting for it here
  // stops every test that touches a filter from racing it — which showed up as a
  // pass in the full suite and a failure when run alone.
  await waitFor(() =>
    expect(within(screen.getByLabelText("Category")).getAllByRole("option").length).toBeGreaterThan(1),
  );
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

describe("My Tickets — behaviour between request and response", () => {
  it("shows the loading state, then the list it resolves to", async () => {
    // Asked for in review: the previous tests only saw the endpoints of the
    // request, never the state in between.
    const gate = deferred<unknown>();
    mockApi(() => gate.promise);
    await renderList();

    expect(screen.getByRole("status")).toHaveTextContent("Loading your Tickets");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    gate.resolve(page([ticket(1, "Resolved at last")]));

    expect(await screen.findByRole("table")).toBeInTheDocument();
    expect(screen.getByText("Resolved at last")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("ignores a stale response that arrives after a newer one", async () => {
    // The `active` flag exists for exactly this. Deliberate behaviour with no
    // test is behaviour that disappears in the next refactor.
    const gates: Array<{ resolve: (value: unknown) => void }> = [];
    mockApi(() => {
      const gate = deferred<unknown>();
      gates.push(gate);
      return gate.promise;
    });
    await renderList();

    await userEvent.selectOptions(screen.getByLabelText("Category"), "3");
    await waitFor(() => expect(gates.length).toBe(2));

    // The newer request answers first, then the abandoned one arrives late.
    gates[1].resolve(page([ticket(2, "Newer answer")]));
    expect(await screen.findByText("Newer answer")).toBeInTheDocument();

    gates[0].resolve(page([ticket(1, "Stale answer")]));
    await new Promise((settle) => setTimeout(settle, 60));

    expect(screen.queryByText("Stale answer")).not.toBeInTheDocument();
    expect(screen.getByText("Newer answer")).toBeInTheDocument();
  });
});

describe("My Tickets — each control changes what is displayed", () => {
  // Distinct fixtures per query, so an assertion can be about the rows on screen
  // rather than only about the URL that asked for them.
  function fixtures(url: URL) {
    if (url.searchParams.get("categoryId") === "3") return page([ticket(2, "Hardware fault")]);
    if (url.searchParams.get("relatedSystemId") === "5") return page([ticket(3, "Wi-Fi fault")]);
    if (url.searchParams.get("requestedPriority") === "URGENT") return page([ticket(4, "Urgent fault")]);
    if (url.searchParams.get("sortBy") === "ticketNumber") return page([ticket(5, "Sorted by number")]);
    return page([ticket(1, "Unfiltered result")]);
  }

  it.each([
    ["Category", "3", "Hardware fault", "categoryId", "3"],
    ["Related System", "5", "Wi-Fi fault", "relatedSystemId", "5"],
    ["Requested Priority", "URGENT", "Urgent fault", "requestedPriority", "URGENT"],
    ["Sort", "ticketNumber:asc", "Sorted by number", "sortBy", "ticketNumber"],
  ])("%s replaces the rows on screen, not just the query", async (label, choice, expected, param, value) => {
    const { listUrls } = mockApi(fixtures);
    await renderList();
    expect(await screen.findByText("Unfiltered result")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(label as string), choice as string);

    expect(await screen.findByText(expected as string)).toBeInTheDocument();
    expect(screen.queryByText("Unfiltered result")).not.toBeInTheDocument();
    expect(listUrls.at(-1)!.searchParams.get(param as string)).toBe(value);
  });
});

describe("My Tickets — paging moves through the list", () => {
  function twoPages(url: URL) {
    const requested = Number(url.searchParams.get("page") ?? "1");
    const rows = Array.from({ length: 10 }, (_, index) =>
      ticket(requested * 100 + index, `Page ${requested} ticket ${index + 1}`),
    );
    return { items: rows, page: requested, pageSize: 10, totalItems: 20, totalPages: 2 };
  }

  it("requests and renders the next page, then comes back", async () => {
    const { listUrls } = mockApi(twoPages);
    await renderList();
    await screen.findByRole("table");

    expect(screen.getByText("Page 1 ticket 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeEnabled();

    await userEvent.click(next);

    expect(await screen.findByText("Page 2 ticket 1")).toBeInTheDocument();
    expect(screen.queryByText("Page 1 ticket 1")).not.toBeInTheDocument();
    expect(listUrls.at(-1)!.searchParams.get("page")).toBe("2");

    const nav = screen.getByRole("navigation", { name: "Ticket list pages" });
    expect(nav).toHaveTextContent("Showing 11–20 of 20 Tickets");
    expect(nav).toHaveTextContent("Page 2 of 2");
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("Page 1 ticket 1")).toBeInTheDocument();
    expect(listUrls.at(-1)!.searchParams.get("page")).toBe("1");
  });
});

describe("My Tickets — changing requester reloads under the new identity", () => {
  // The fixture depends on the requester header, so "A's tickets disappear and
  // B's appear" is actually observable. A shared fixture would prove only that
  // the header changed, which is not what AC-08 claims.
  function perRequester(url: URL, headers: Record<string, string>) {
    const who = headers["X-Dev-Requester-Id"];
    if (who === "2") return page([ticket(20, "Somchai's own ticket")]);
    const requested = Number(url.searchParams.get("page") ?? "1");
    return {
      items: [ticket(requested * 10, `Nadia page ${requested} ticket`)],
      page: requested,
      pageSize: 10,
      totalItems: 20,
      totalPages: 2,
    };
  }

  it("replaces the first requester's tickets with the second requester's", async () => {
    const { fetchMock } = mockApi(perRequester);
    await renderList("1");

    expect(await screen.findByText("Nadia page 1 ticket")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Change Requester" }));
    await screen.findByRole("heading", { name: "Development Requester Selection" });
    await userEvent.selectOptions(await screen.findByLabelText(/Development Requester/), "2");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Somchai's own ticket")).toBeInTheDocument();
    // AC-08: the previous requester's ticket must be gone, not merely re-fetched.
    expect(screen.queryByText("Nadia page 1 ticket")).not.toBeInTheDocument();

    const listCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/tickets"));
    const lastHeaders = (listCalls.at(-1)![1] as RequestInit).headers as Record<string, string>;
    expect(lastHeaders["X-Dev-Requester-Id"]).toBe("2");
  });

  it("starts the new requester on page 1 with the filters cleared", async () => {
    // BR-11: changing Requester clears requester-scoped state. Carrying a filter
    // or a page number across would show the new requester a view shaped by
    // somebody else's session.
    const { listUrls } = mockApi(perRequester);
    await renderList("1");
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText("Category"), "3");
    await waitFor(() => expect(listUrls.at(-1)!.searchParams.get("categoryId")).toBe("3"));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(listUrls.at(-1)!.searchParams.get("page")).toBe("2"));

    await userEvent.click(screen.getByRole("button", { name: "Change Requester" }));
    await screen.findByRole("heading", { name: "Development Requester Selection" });
    await userEvent.selectOptions(await screen.findByLabelText(/Development Requester/), "2");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByText("Somchai's own ticket")).toBeInTheDocument();

    const afterSwitch = listUrls.at(-1)!;
    expect(afterSwitch.searchParams.get("page")).toBe("1");
    expect(afterSwitch.searchParams.has("categoryId")).toBe(false);

    // And the controls agree with the request that was sent.
    expect(screen.getByLabelText("Category")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeDisabled();
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
