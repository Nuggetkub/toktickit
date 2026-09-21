import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  REQUESTED_PRIORITIES,
  fetchAssignees,
  fetchCategories,
  fetchStaffQueue,
  type Category,
  type RequestedPriority,
  type StaffQueueResponse,
  type UserSummary,
} from "../api.js";
import {
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  Field,
  PriorityBadge,
  StatusBadge,
  StatusMessage,
  TICKET_STATUSES,
  statusLabel,
  type TicketStatus,
} from "../components/index.js";

// The shared IT Staff queue (ui-spec.md §7).
//
// The toolbar, paging and stale-response handling follow My Tickets deliberately
// rather than being reinvented: the two screens do the same job for different
// scopes, and a reader who has learned one should not have to learn the other.

type SortChoice =
  | "ticketDate:desc"
  | "ticketDate:asc"
  | "updatedAt:desc"
  | "updatedAt:asc"
  | "itPriority:desc"
  | "itPriority:asc"
  | "currentStatus:asc"
  | "ticketNumber:desc";

type Filters = {
  search: string;
  currentStatus: "" | TicketStatus;
  itPriority: "" | RequestedPriority;
  categoryId: string;
  owner: string;
  requesterIndicated: boolean;
  sort: SortChoice;
};

const DEFAULTS: Filters = {
  search: "",
  currentStatus: "",
  itPriority: "",
  categoryId: "",
  owner: "",
  requesterIndicated: false,
  sort: "ticketDate:desc",
};

const PAGE_SIZE = 10;

// Typing is not a request. Without this every keystroke is a round trip and the
// table is rebuilt under the reader's hands.
const SEARCH_DEBOUNCE_MS = 300;

/** Relative for scanning, exact in the tooltip for anyone who needs precision. */
function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function StaffTicketQueue() {
  const navigate = useNavigate();
  const location = useLocation();

  // Ticket Detail hands the filters and page back when the reader returns
  // (ui-spec.md §8). Rebuilding a seven-control query by hand after opening one
  // ticket is the difference between a queue someone works from and one they
  // avoid.
  const restored = (location.state as { queue?: { filters: Filters; page: number } } | null)?.queue ?? null;

  const [filters, setFilters] = useState<Filters>(restored?.filters ?? DEFAULTS);
  const [debouncedSearch, setDebouncedSearch] = useState(restored?.filters.search.trim() ?? "");
  const [page, setPage] = useState(restored?.page ?? 1);

  const [categories, setCategories] = useState<Category[]>([]);
  const [assignees, setAssignees] = useState<UserSummary[]>([]);

  const [results, setResults] = useState<StaffQueueResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([fetchCategories(), fetchAssignees()])
      .then(([loadedCategories, loadedAssignees]) => {
        if (!active) return;
        setCategories(loadedCategories);
        setAssignees(loadedAssignees);
      })
      .catch(() => {
        // The filters degrade to "all" rather than blocking the queue itself.
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
    "ticketDate" | "updatedAt" | "itPriority" | "currentStatus" | "ticketNumber",
    "asc" | "desc",
  ];

  useEffect(() => {
    let active = true;
    setState("loading");

    fetchStaffQueue({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(filters.currentStatus ? { currentStatus: filters.currentStatus } : {}),
      ...(filters.itPriority ? { itPriority: filters.itPriority } : {}),
      ...(filters.categoryId ? { categoryId: Number(filters.categoryId) } : {}),
      ...(filters.owner ? { owner: filters.owner } : {}),
      ...(filters.requesterIndicated ? { requesterIndicated: "true" as const } : {}),
      sortBy,
      sortOrder,
      page,
      pageSize: PAGE_SIZE,
    })
      .then((response) => {
        // A slow reply to an abandoned query must never overwrite a newer one
        // (ui-spec.md §7): the requests are cheap, the ordering is not promised.
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
    debouncedSearch,
    filters.currentStatus,
    filters.itPriority,
    filters.categoryId,
    filters.owner,
    filters.requesterIndicated,
    sortBy,
    sortOrder,
    page,
    reloadToken,
  ]);

  // Every search, filter or sort change returns to page 1 (ui-spec.md §7).
  // Staying on page 7 of a result set that now has two pages shows an empty
  // table for a query that matched.
  function update(patch: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1);
  }

  function clearFilters() {
    setFilters(DEFAULTS);
    setDebouncedSearch("");
    setPage(1);
  }

  const filtersAreDefault =
    filters.search === DEFAULTS.search &&
    filters.currentStatus === DEFAULTS.currentStatus &&
    filters.itPriority === DEFAULTS.itPriority &&
    filters.categoryId === DEFAULTS.categoryId &&
    filters.owner === DEFAULTS.owner &&
    filters.requesterIndicated === DEFAULTS.requesterIndicated &&
    filters.sort === DEFAULTS.sort;

  const hasQuery =
    debouncedSearch !== "" ||
    filters.currentStatus !== "" ||
    filters.itPriority !== "" ||
    filters.categoryId !== "" ||
    filters.owner !== "" ||
    filters.requesterIndicated;

  const first = results && results.totalItems > 0 ? (results.page - 1) * results.pageSize + 1 : 0;
  const last = results ? first + results.items.length - 1 : 0;

  return (
    <Card title="Ticket Queue" as="h1">
      <div className="zen-toolbar" role="search">
        <Field id="queue-search" label="Search">
          {(control) => (
            <input
              {...control}
              type="search"
              placeholder="Search by ticket number, summary or requester"
              value={filters.search}
              onChange={(event) => update({ search: event.target.value })}
            />
          )}
        </Field>

        <Field id="queue-status" label="Status">
          {(control) => (
            <select
              {...control}
              value={filters.currentStatus}
              onChange={(event) => update({ currentStatus: event.target.value as "" | TicketStatus })}
            >
              <option value="">Any status</option>
              {TICKET_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="queue-priority" label="IT Priority">
          {(control) => (
            <select
              {...control}
              value={filters.itPriority}
              onChange={(event) => update({ itPriority: event.target.value as "" | RequestedPriority })}
            >
              <option value="">Any IT Priority</option>
              {REQUESTED_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="queue-category" label="Category">
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

        <Field id="queue-owner" label="Owner">
          {(control) => (
            <select {...control} value={filters.owner} onChange={(event) => update({ owner: event.target.value })}>
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="unassigned">Unassigned</option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.fullName}
                </option>
              ))}
            </select>
          )}
        </Field>

        <div className="zen-checkbox">
          <input
            id="queue-indicated"
            type="checkbox"
            checked={filters.requesterIndicated}
            onChange={(event) => update({ requesterIndicated: event.target.checked })}
          />
          <label htmlFor="queue-indicated">Requester says resolved</label>
        </div>

        <Field id="queue-sort" label="Sort">
          {(control) => (
            <select {...control} value={filters.sort} onChange={(event) => update({ sort: event.target.value as SortChoice })}>
              <option value="ticketDate:desc">Newest first</option>
              <option value="ticketDate:asc">Oldest first</option>
              <option value="updatedAt:desc">Recently updated</option>
              <option value="updatedAt:asc">Least recently updated</option>
              <option value="itPriority:desc">IT Priority, urgent first</option>
              <option value="itPriority:asc">IT Priority, low first</option>
              <option value="currentStatus:asc">Status, lifecycle order</option>
              <option value="ticketNumber:desc">Ticket Number, high to low</option>
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
        </div>
      </div>

      {/* The toolbar stays usable while a query is in flight (ui-spec.md §7). */}
      {state === "loading" && <StatusMessage>Loading tickets…</StatusMessage>}

      {state === "failed" && (
        <ErrorAlert onRetry={() => setReloadToken((token) => token + 1)}>
          The Ticket Queue could not be loaded.
        </ErrorAlert>
      )}

      {state === "ready" && results && results.items.length === 0 && (
        // Empty and no-results are different situations with different fixes.
        hasQuery ? (
          <EmptyState
            title="No tickets match your search or filters."
            description="Try a different term, or clear the filters to see the whole queue."
            action={
              <Button variant="secondary" onClick={clearFilters}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState title="There are no tickets yet." description="New tickets appear here as Requesters raise them." />
        )
      )}

      {state === "ready" && results && results.items.length > 0 && (
        <>
          <div className="zen-table-wrap">
            <table className="zen-table zen-queue">
              <caption className="zen-visually-hidden">The IT Staff Ticket Queue</caption>
              <thead>
                <tr>
                  <th scope="col">Ticket No.</th>
                  <th scope="col">Summary</th>
                  <th scope="col" className="zen-queue__requester">
                    Requester
                  </th>
                  <th scope="col">Priority</th>
                  <th scope="col">Status</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {results.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td data-label="Ticket No.">
                      <Link to={`/queue/${ticket.id}`} state={{ queue: { filters, page } }}>
                        {ticket.ticketNumber}
                      </Link>
                      {/* The Open action belongs to the mobile card only
                          (ui-spec.md §7). It lives inside this cell rather than
                          in a column of its own so the table keeps seven headers
                          and seven cells; CSS hides it above 767px. */}
                      <span className="zen-queue__open">
                        <Button
                          variant="secondary"
                          onClick={() => navigate(`/queue/${ticket.id}`, { state: { queue: { filters, page } } })}
                        >
                          Open
                        </Button>
                      </span>
                    </td>
                    <td data-label="Summary">
                      {/* Category folded in beneath, so seven columns stay
                          readable at 992px rather than becoming a mega-grid. */}
                      <span className="zen-queue__summary" title={ticket.summary}>
                        {ticket.summary}
                      </span>
                      <span className="zen-queue__category">{ticket.category.name}</span>
                    </td>
                    <td data-label="Requester" className="zen-queue__requester">
                      {ticket.requester.fullName}
                    </td>
                    <td data-label="Priority">
                      <PriorityBadge kind="Requested" priority={ticket.requestedPriority} />
                      <PriorityBadge kind="IT" priority={ticket.itPriority} />
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={ticket.currentStatus as TicketStatus} />
                      {ticket.requesterResolvedAt && (
                        // BR-33: the indication is a marker on the row, in words.
                        <span className="zen-queue__indicated">Requester says resolved</span>
                      )}
                    </td>
                    <td data-label="Owner">
                      {ticket.owner ? (
                        ticket.owner.fullName
                      ) : (
                        <span className="zen-queue__unassigned">Unassigned</span>
                      )}
                    </td>
                    <td data-label="Updated">
                      <span title={new Date(ticket.updatedAt).toLocaleString()}>{relativeTime(ticket.updatedAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <nav className="zen-pagination" aria-label="Ticket Queue pages">
            <Button variant="secondary" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={results.page <= 1}>
              Previous
            </Button>

            <p aria-live="polite">
              Showing {first}–{last} of {results.totalItems} {results.totalItems === 1 ? "ticket" : "tickets"} · Page{" "}
              {results.page} of {results.totalPages}
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
