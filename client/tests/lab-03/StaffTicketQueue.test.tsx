import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import App from "../../src/App.js";

// UI-04 — AC-13 (docs/lab-03/tests.md).
//
// The queue is the first screen where the interface can quietly lie: a filter
// that changes the request but not the rows, or a stale reply that overwrites a
// newer one, both look like working software. So each control is asserted
// against the rows on screen as well as against the query that asked for them.

const STAFF = {
  id: 7,
  fullName: "Grace Okafor",
  email: "grace.okafor@toktickit.local",
  role: "IT_STAFF",
  mustChangePassword: false,
};

const CATEGORIES = [
  { id: 2, name: "Network" },
  { id: 3, name: "Hardware" },
];

const ASSIGNEES = [
  { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
  { id: 9, fullName: "Hassan Ali", role: "IT_STAFF" },
];

function row(id: number, summary: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    ticketNumber: `TKT-2026-${String(id).padStart(5, "0")}`,
    ticketDate: "2026-09-10T09:00:00.000Z",
    summary,
    category: CATEGORIES[0],
    requester: { id: 3, fullName: "Nadia Rahman", role: "REQUESTER" },
    requestedPriority: "HIGH",
    itPriority: "URGENT",
    currentStatus: "IN_PROGRESS",
    owner: { id: 7, fullName: "Grace Okafor", role: "IT_STAFF" },
    requesterResolvedAt: null,
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function page(items: unknown[], overrides: Record<string, number> = {}) {
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

function mockApi(queueFor: (url: URL) => unknown = () => page([row(1, "Campus Wi-Fi drops nightly")])) {
  const queueUrls: URL[] = [];
  const fetchMock = vi.fn(async (input: string) => {
    const url = new URL(String(input), "http://localhost");
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, headers: new Headers() });

    if (url.pathname === "/api/auth/me") return json({ user: STAFF });
    if (url.pathname === "/api/staff/tickets") {
      queueUrls.push(url);
      const body = await queueFor(url);
      if (body instanceof Error) throw body;
      return json(body);
    }
    if (url.pathname === "/api/staff/assignees") return json(ASSIGNEES);
    if (url.pathname === "/api/categories") return json(CATEGORIES);
    if (url.pathname === "/api/related-systems") return json([]);
    throw new Error(`Unexpected request: ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, queueUrls };
}

async function renderQueue() {
  render(
    <MemoryRouter initialEntries={["/queue"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "Ticket Queue" });
  // The filter dropdowns arrive in a separate request; waiting here stops every
  // test that touches a filter from racing it.
  await waitFor(() => expect(within(screen.getByLabelText("Category")).getAllByRole("option").length).toBeGreaterThan(1));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Ticket Queue — the table", () => {
  it("shows the seven columns the contract names", async () => {
    mockApi();
    await renderQueue();

    const table = await screen.findByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((cell) => cell.textContent);
    expect(headers).toEqual(["Ticket No.", "Summary", "Requester", "Priority", "Status", "Owner", "Updated"]);
  });

  it("carries the status in words and both priorities under their own labels", async () => {
    mockApi();
    await renderQueue();

    const table = await screen.findByRole("table");
    // ui-spec.md §1: never colour alone, and the two priority scales are
    // indistinguishable unless each badge says which one it is.
    expect(within(table).getByText("In Progress")).toBeInTheDocument();
    expect(within(table).getByText("Requested")).toBeInTheDocument();
    expect(within(table).getByText("IT")).toBeInTheDocument();
    expect(within(table).getByText("HIGH")).toBeInTheDocument();
    expect(within(table).getByText("URGENT")).toBeInTheDocument();
  });

  it("says Unassigned in words when a ticket has no owner", async () => {
    mockApi(() => page([row(1, "Nobody owns this", { owner: null })]));
    await renderQueue();

    // Scoped to the table on purpose: "Unassigned" is also an option in the
    // Owner filter, which is correct and is not what this test is about.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Unassigned")).toBeInTheDocument();
  });

  it("marks a ticket whose Requester says it is resolved", async () => {
    mockApi(() =>
      page([row(1, "Requester thinks this is fixed", { requesterResolvedAt: "2026-09-15T10:00:00.000Z" })]),
    );
    await renderQueue();

    // BR-33: the indication is a marker on the row, and it is a word. Scoped to
    // the table because the toolbar filter carries the same wording — the row
    // marker and the control that filters by it should read alike.
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Requester says resolved")).toBeInTheDocument();
  });

  it("links the Ticket Number to the ticket and offers an Open action", async () => {
    mockApi();
    await renderQueue();

    const table = await screen.findByRole("table");
    expect(within(table).getByRole("link", { name: "TKT-2026-00001" })).toHaveAttribute("href", "/tickets/1");
    expect(within(table).getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
});

describe("Ticket Queue — the toolbar asks the right question", () => {
  it("omits an untouched filter rather than sending it blank", async () => {
    const { queueUrls } = mockApi();
    await renderQueue();
    await screen.findByRole("table");

    const first = queueUrls[0];
    expect(first.searchParams.has("currentStatus")).toBe(false);
    expect(first.searchParams.has("owner")).toBe(false);
    expect(first.searchParams.has("search")).toBe(false);
    expect(first.searchParams.get("sortBy")).toBe("ticketDate");
    expect(first.searchParams.get("page")).toBe("1");
  });

  it.each([
    ["Status", "RESOLVED", "currentStatus", "RESOLVED"],
    ["IT Priority", "LOW", "itPriority", "LOW"],
    ["Category", "3", "categoryId", "3"],
    ["Owner", "unassigned", "owner", "unassigned"],
  ])("sends %s as a query parameter", async (label, choice, parameter, expected) => {
    const { queueUrls } = mockApi();
    await renderQueue();
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText(label as string), choice as string);

    await waitFor(() => expect(queueUrls.at(-1)!.searchParams.get(parameter as string)).toBe(expected));
  });

  it("sends the Requester-says-resolved filter only when it is ticked", async () => {
    const { queueUrls } = mockApi();
    await renderQueue();
    await screen.findByRole("table");

    await userEvent.click(screen.getByLabelText("Requester says resolved"));
    await waitFor(() => expect(queueUrls.at(-1)!.searchParams.get("requesterIndicated")).toBe("true"));

    await userEvent.click(screen.getByLabelText("Requester says resolved"));
    await waitFor(() => expect(queueUrls.at(-1)!.searchParams.has("requesterIndicated")).toBe(false));
  });

  it("debounces typing into one request rather than one per keystroke", async () => {
    const { queueUrls } = mockApi();
    await renderQueue();
    await screen.findByRole("table");
    const before = queueUrls.length;

    await userEvent.type(screen.getByLabelText("Search"), "wifi");
    await waitFor(() => expect(queueUrls.length).toBeGreaterThan(before), { timeout: 2000 });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const searches = queueUrls.slice(before).map((url) => url.searchParams.get("search"));
    expect(searches.length).toBeLessThanOrEqual(2);
    expect(searches.at(-1)).toBe("wifi");
  });

  it("returns to page 1 when a filter changes", async () => {
    // Staying on page 7 of a result set that now has two pages shows an empty
    // table for a query that actually matched.
    function twoPages(url: URL) {
      const requested = Number(url.searchParams.get("page") ?? "1");
      return { items: [row(requested * 10, `Page ${requested}`)], page: requested, pageSize: 10, totalItems: 20, totalPages: 2 };
    }
    const { queueUrls } = mockApi(twoPages);
    await renderQueue();
    await screen.findByRole("table");

    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(queueUrls.at(-1)!.searchParams.get("page")).toBe("2"));

    await userEvent.selectOptions(screen.getByLabelText("Status"), "OPEN");
    await waitFor(() => expect(queueUrls.at(-1)!.searchParams.get("page")).toBe("1"));
  });

  it("clears every control at once, and is disabled until something is set", async () => {
    mockApi();
    await renderQueue();
    await screen.findByRole("table");

    const clear = screen.getByRole("button", { name: "Clear filters" });
    expect(clear).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "OPEN");
    expect(clear).toBeEnabled();

    await userEvent.click(clear);
    expect(screen.getByLabelText("Status")).toHaveValue("");
    expect(clear).toBeDisabled();
  });
});

describe("Ticket Queue — a filter changes the rows, not only the query", () => {
  function fixtures(url: URL) {
    if (url.searchParams.get("currentStatus") === "RESOLVED") return page([row(2, "A resolved ticket", { currentStatus: "RESOLVED" })]);
    if (url.searchParams.get("owner") === "unassigned") return page([row(3, "An unowned ticket", { owner: null })]);
    return page([row(1, "Unfiltered result")]);
  }

  it.each([
    ["Status", "RESOLVED", "A resolved ticket"],
    ["Owner", "unassigned", "An unowned ticket"],
  ])("%s replaces what is on screen", async (label, choice, expected) => {
    mockApi(fixtures);
    await renderQueue();
    expect(await screen.findByText("Unfiltered result")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText(label as string), choice as string);

    expect(await screen.findByText(expected as string)).toBeInTheDocument();
    expect(screen.queryByText("Unfiltered result")).not.toBeInTheDocument();
  });
});

describe("Ticket Queue — the states are distinct", () => {
  it("shows loading, and keeps the toolbar usable while it waits", async () => {
    const gate = deferred<unknown>();
    mockApi(() => gate.promise);
    await renderQueue();

    expect(screen.getByRole("status")).toHaveTextContent("Loading tickets…");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    // ui-spec.md §7: the toolbar stays usable, so a slow query can be narrowed
    // rather than waited out.
    expect(screen.getByLabelText("Search")).toBeEnabled();

    gate.resolve(page([row(1, "It arrived")]));
    expect(await screen.findByText("It arrived")).toBeInTheDocument();
  });

  it("distinguishes an empty queue from a search that matched nothing", async () => {
    mockApi((url) => (url.searchParams.get("currentStatus") ? page([]) : page([row(1, "Something")])));
    await renderQueue();
    await screen.findByRole("table");

    await userEvent.selectOptions(screen.getByLabelText("Status"), "CLOSED");

    // Telling someone to clear filters they never set is the wrong advice, so
    // the two empty states say different things.
    expect(await screen.findByText("No tickets match your search or filters.")).toBeInTheDocument();
    expect(screen.queryByText("There are no tickets yet.")).not.toBeInTheDocument();
  });

  it("says the queue is empty when nothing is filtered", async () => {
    mockApi(() => page([]));
    await renderQueue();

    expect(await screen.findByText("There are no tickets yet.")).toBeInTheDocument();
    expect(screen.queryByText("No tickets match your search or filters.")).not.toBeInTheDocument();
  });

  it("offers a retry on failure, and recovers on it", async () => {
    let attempt = 0;
    mockApi(() => {
      attempt += 1;
      return attempt === 1 ? new Error("network") : page([row(1, "Second time lucky")]);
    });
    await renderQueue();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not be loaded/i);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Second time lucky")).toBeInTheDocument();
  });

  it("discards a stale response that arrives after a newer one", async () => {
    // Deliberate behaviour with no test is behaviour that disappears in the
    // next refactor.
    const gates: Array<{ resolve: (value: unknown) => void }> = [];
    mockApi(() => {
      const gate = deferred<unknown>();
      gates.push(gate);
      return gate.promise;
    });
    await renderQueue();

    await userEvent.selectOptions(screen.getByLabelText("Status"), "OPEN");
    await waitFor(() => expect(gates.length).toBe(2));

    gates[1].resolve(page([row(2, "Newer answer")]));
    expect(await screen.findByText("Newer answer")).toBeInTheDocument();

    gates[0].resolve(page([row(1, "Stale answer")]));
    await new Promise((settle) => setTimeout(settle, 60));

    expect(screen.queryByText("Stale answer")).not.toBeInTheDocument();
    expect(screen.getByText("Newer answer")).toBeInTheDocument();
  });
});

describe("Ticket Queue — paging", () => {
  it("announces the count, not only the page number", async () => {
    mockApi(() => page([row(1, "Only one")], { totalItems: 31, totalPages: 4 }));
    await renderQueue();
    await screen.findByRole("table");

    const nav = screen.getByRole("navigation", { name: "Ticket Queue pages" });
    expect(nav).toHaveTextContent("of 31 tickets");
    expect(nav).toHaveTextContent("Page 1 of 4");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
