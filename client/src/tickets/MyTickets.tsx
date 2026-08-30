import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  REQUESTED_PRIORITIES,
  fetchCategories,
  fetchRelatedSystems,
  fetchTickets,
  type Category,
  type RelatedSystem,
  type RequestedPriority,
  type TicketListResponse,
} from "../api.js";
import { Badge, Button, Card, EmptyState, ErrorAlert, Field, StatusMessage } from "../components/index.js";
import { useRequester } from "../requester/index.js";

type SortChoice =
  | "ticketDate:desc"
  | "ticketDate:asc"
  | "ticketNumber:desc"
  | "ticketNumber:asc"
  | "requestedPriority:desc"
  | "requestedPriority:asc";

type Filters = {
  search: string;
  categoryId: string;
  relatedSystemId: string;
  requestedPriority: "" | RequestedPriority;
  sort: SortChoice;
};

const DEFAULTS: Filters = {
  search: "",
  categoryId: "",
  relatedSystemId: "",
  requestedPriority: "",
  sort: "ticketDate:desc",
};

const PAGE_SIZE = 10;

// Typing is not a request. Without this every keystroke is a round trip and the
// table is torn down and rebuilt under the user's hands — the behaviour found on
// the peer's My Tickets screen, where "laptop" cost six requests.
const SEARCH_DEBOUNCE_MS = 300;

const PRIORITY_TONE: Record<RequestedPriority, "neutral" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warning",
  URGENT: "danger",
};

export default function MyTickets() {
  const { requester } = useRequester();
  const navigate = useNavigate();

  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [relatedSystems, setRelatedSystems] = useState<RelatedSystem[]>([]);

  const [results, setResults] = useState<TicketListResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetchCategories(), fetchRelatedSystems()])
      .then(([loadedCategories, loadedSystems]) => {
        if (!active) return;
        setCategories(loadedCategories);
        setRelatedSystems(loadedSystems);
      })
      .catch(() => {
        // The filters degrade to "all" rather than blocking the list.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(filters.search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [filters.search]);

  const [sortBy, sortOrder] = filters.sort.split(":") as [
    "ticketDate" | "ticketNumber" | "requestedPriority",
    "asc" | "desc",
  ];

  useEffect(() => {
    if (!requester) return;
    let active = true;
    setState("loading");

    fetchTickets(
      {
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(filters.categoryId ? { categoryId: Number(filters.categoryId) } : {}),
        ...(filters.relatedSystemId ? { relatedSystemId: Number(filters.relatedSystemId) } : {}),
        ...(filters.requestedPriority ? { requestedPriority: filters.requestedPriority } : {}),
        sortBy,
        sortOrder,
        page,
        pageSize: PAGE_SIZE,
      },
      requester.id,
    )
      .then((response) => {
        // Guards against a slow response from an abandoned query overwriting a
        // newer one — the requests are cheap, the ordering is not guaranteed.
        if (!active) return;
        setResults(response);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });

    return () => {
      active = false;
    };
  }, [
    requester,
    debouncedSearch,
    filters.categoryId,
    filters.relatedSystemId,
    filters.requestedPriority,
    sortBy,
    sortOrder,
    page,
    reloadToken,
  ]);

  function update(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  // Every control the button resets counts towards whether it is enabled. If
  // `sort` is cleared by it, changing only `sort` has to enable it — otherwise
  // the button silently refuses to do something it claims to do.
  const filtersAreDefault =
    filters.search === DEFAULTS.search &&
    filters.categoryId === DEFAULTS.categoryId &&
    filters.relatedSystemId === DEFAULTS.relatedSystemId &&
    filters.requestedPriority === DEFAULTS.requestedPriority &&
    filters.sort === DEFAULTS.sort;

  const hasQuery =
    debouncedSearch !== "" ||
    filters.categoryId !== "" ||
    filters.relatedSystemId !== "" ||
    filters.requestedPriority !== "";

  function clearFilters() {
    setFilters(DEFAULTS);
    setDebouncedSearch("");
    setPage(1);
  }

  const first = results && results.totalItems > 0 ? (results.page - 1) * results.pageSize + 1 : 0;
  // Derived from the rows actually returned, not from page x pageSize, so the
  // label stays true if the server ever returns a short page.
  const last = results ? first + results.items.length - 1 : 0;

  return (
    <Card title="My Tickets" as="h1">
      <div className="zen-toolbar" role="search">
        <Field id="search" label="Search">
          {(control) => (
            <input
              {...control}
              type="search"
              placeholder="Ticket Number or Summary"
              value={filters.search}
              onChange={(event) => update({ search: event.target.value })}
            />
          )}
        </Field>

        <Field id="categoryId" label="Category">
          {(control) => (
            <select {...control} value={filters.categoryId} onChange={(event) => update({ categoryId: event.target.value })}>
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="relatedSystemId" label="Related System">
          {(control) => (
            <select
              {...control}
              value={filters.relatedSystemId}
              onChange={(event) => update({ relatedSystemId: event.target.value })}
            >
              <option value="">All Related Systems</option>
              {relatedSystems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="requestedPriority" label="Requested Priority">
          {(control) => (
            <select
              {...control}
              value={filters.requestedPriority}
              onChange={(event) => update({ requestedPriority: event.target.value as "" | RequestedPriority })}
            >
              <option value="">All Priorities</option>
              {REQUESTED_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          )}
        </Field>

        {/* No Current Status filter: every Lab 2 Ticket is NEW, so the control
            could never change a result set (BR-30). The API rejects it too. */}
        <Field id="sort" label="Sort">
          {(control) => (
            <select {...control} value={filters.sort} onChange={(event) => update({ sort: event.target.value as SortChoice })}>
              <option value="ticketDate:desc">Newest first</option>
              <option value="ticketDate:asc">Oldest first</option>
              <option value="ticketNumber:desc">Ticket Number, high to low</option>
              <option value="ticketNumber:asc">Ticket Number, low to high</option>
              <option value="requestedPriority:desc">Priority, urgent first</option>
              <option value="requestedPriority:asc">Priority, low first</option>
            </select>
          )}
        </Field>

        <div className="zen-toolbar__actions">
          <Button variant="tertiary" onClick={clearFilters} disabled={filtersAreDefault}>
            Clear filters
          </Button>
          <Button variant="secondary" onClick={() => setReloadToken((token) => token + 1)} disabled={state === "loading"}>
            Refresh
          </Button>
          <Button onClick={() => navigate("/create")}>Create Ticket</Button>
        </div>
      </div>

      {state === "loading" && <StatusMessage>Loading your Tickets…</StatusMessage>}

      {state === "failed" && (
        <ErrorAlert onRetry={() => setReloadToken((token) => token + 1)}>
          Your Tickets could not be loaded.
        </ErrorAlert>
      )}

      {state === "ready" && results && results.items.length === 0 && (
        // Empty and no-results are different situations with different fixes.
        // Telling someone to clear filters they never set is unhelpful (BR-29).
        hasQuery ? (
          <EmptyState
            title="No Tickets match your search or filters."
            description="Try a different term, or clear the filters to see everything."
            action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            title="You have not created any Tickets yet."
            description="When you raise a Ticket it will appear here."
            action={<Button onClick={() => navigate("/create")}>Create Ticket</Button>}
          />
        )
      )}

      {state === "ready" && results && results.items.length > 0 && (
        <>
          <div className="zen-table-wrap">
            <table className="zen-table">
              <caption className="zen-visually-hidden">Your Tickets</caption>
              <thead>
                <tr>
                  <th scope="col">Ticket Number</th>
                  <th scope="col">Summary</th>
                  <th scope="col">Category</th>
                  <th scope="col">Related System</th>
                  <th scope="col">Requested Priority</th>
                  <th scope="col">Ticket Date</th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td data-label="Ticket Number">
                      <Link to={`/tickets/${ticket.id}`}>{ticket.ticketNumber}</Link>
                    </td>
                    <td data-label="Summary">
                      <Link to={`/tickets/${ticket.id}`}>{ticket.summary}</Link>
                    </td>
                    <td data-label="Category">{ticket.category.name}</td>
                    <td data-label="Related System">{ticket.relatedSystem.name}</td>
                    <td data-label="Requested Priority">
                      <Badge tone={PRIORITY_TONE[ticket.requestedPriority]}>{ticket.requestedPriority}</Badge>
                    </td>
                    <td data-label="Ticket Date">{new Date(ticket.ticketDate).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="zen-pagination" aria-label="Ticket list pages">
            <Button
              variant="secondary"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={results.page <= 1}
            >
              Previous
            </Button>

            {/* The count, not just the page. "Page 1 of 3" alone never tells the
                reader how many Tickets matched. */}
            <p aria-live="polite">
              Showing {first}–{last} of {results.totalItems}{" "}
              {results.totalItems === 1 ? "Ticket" : "Tickets"} · Page {results.page} of {results.totalPages}
            </p>

            <Button
              variant="secondary"
              onClick={() => setPage((current) => Math.min(results.totalPages, current + 1))}
              disabled={results.page >= results.totalPages}
            >
              Next
            </Button>
          </nav>
        </>
      )}
    </Card>
  );
}
