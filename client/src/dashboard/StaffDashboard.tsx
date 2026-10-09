import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, fetchStaffDashboard, type RequestedPriority, type StaffDashboardData, type StaffTicketCard } from "../api.js";
import { Forbidden } from "../auth/index.js";
import {
  Button,
  Card,
  ErrorAlert,
  PriorityBadge,
  StatusBadge,
  StatusMessage,
  TICKET_STATUSES,
  statusLabel,
  type TicketStatus,
} from "../components/index.js";
import { MetricCard } from "../components/MetricCard.js";
import { moment } from "../tickets/attachment-format.js";
import { ACTIVE_STATUS_LIST, linkFor } from "./dashboard-links.js";

// The IT Staff and Administrator Dashboard (Lab 4 ui-spec §3, BR-27, BR-28).
//
// Every number is the server's, read in one snapshot (BR-25), and every card
// links to the list it counted, built from the card's own `query`. "My open
// actions" is the signed-in user's Actions Taken that are still open, which
// the labsheet's Part 5 asks this dashboard to show.

const PRIORITIES: RequestedPriority[] = ["URGENT", "HIGH", "MEDIUM", "LOW"];
const ROLE_ROWS = [
  ["REQUESTER", "Requester"],
  ["IT_STAFF", "IT Staff"],
  ["ADMINISTRATOR", "Administrator"],
] as const;

type State = "loading" | "ready" | "failed" | "forbidden";

export default function StaffDashboard() {
  const [data, setData] = useState<StaffDashboardData | null>(null);
  const [state, setState] = useState<State>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadToken, setLoadToken] = useState(0);

  useEffect(() => {
    let active = true;
    fetchStaffDashboard()
      .then((loaded) => {
        if (!active) return;
        setData(loaded);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        // No stale or partial numbers beside a failure (ui-spec §3).
        setData(null);
        setState(error instanceof ApiError && error.status === 403 ? "forbidden" : "failed");
      })
      .finally(() => {
        if (active) setRefreshing(false);
      });
    return () => {
      active = false;
    };
  }, [loadToken]);

  function refresh() {
    // The current numbers stay while the new ones load.
    setRefreshing(true);
    setLoadToken((token) => token + 1);
  }

  function retry() {
    setState("loading");
    setLoadToken((token) => token + 1);
  }

  if (state === "forbidden") return <Forbidden />;

  return (
    <div className="zen-dashboard">
      <Card title="Dashboard" as="h1">
        {data && (
          <p className="zen-dashboard__updated">
            Updated {moment(data.generatedAt)} ·{" "}
            <Button variant="tertiary" busy={refreshing} busyLabel="Refreshing…" onClick={refresh}>
              Refresh
            </Button>
          </p>
        )}

        {state === "loading" && (
          <>
            <StatusMessage>Loading dashboard…</StatusMessage>
            {/* Placeholders the size of the cards, so nothing shifts when they arrive. */}
            <div className="zen-metrics" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="zen-metric zen-metric--placeholder" />
              ))}
            </div>
          </>
        )}

        {state === "failed" && <ErrorAlert onRetry={retry} retryLabel="Retry">The dashboard could not be loaded. Please try again.</ErrorAlert>}

        {state === "ready" && data && (
          <div className="zen-metrics">
            <MetricCard label="Unassigned" value={data.cards.unassignedActive.value} noun="ticket"
              explanation="Active tickets that nobody owns yet" to={linkFor("/queue", data.cards.unassignedActive.query)} />
            <MetricCard label="My active tickets" value={data.cards.myActive.value} noun="ticket"
              explanation="Active tickets you own" to={linkFor("/queue", data.cards.myActive.query)} />
            <MetricCard label="My open actions" value={data.cards.myOpenActions.value} noun="action"
              explanation="Actions assigned to you that are still open" to="#my-open-actions" />
            <MetricCard label="Requester says resolved" value={data.cards.requesterIndicated.value} noun="ticket"
              explanation="The requester thinks the problem is fixed" to={linkFor("/queue", data.cards.requesterIndicated.query)} />
          </div>
        )}
      </Card>

      {state === "ready" && data && (
        <div className="zen-dashboard__panels">
          {/* DOM order is the keyboard order of ui-spec §7: cards, then breakdowns,
              then panels. The grid still places the lists in the wider left column. */}
          <div className="zen-dashboard__breakdowns">
            <Card title="Tickets by status">
              <ul className="zen-dashboard__rows">
                {TICKET_STATUSES.map((status) => {
                  const row = data.byStatus[status];
                  return (
                    <li key={status}>
                      <Link to={linkFor("/queue", row.query)} aria-label={`${statusLabel(status as TicketStatus)}: ${row.value} ticket${row.value === 1 ? "" : "s"}`}>
                        <StatusBadge status={status as TicketStatus} /> <span className="zen-dashboard__count">{row.value}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>

            <Card title="Active by IT Priority">
              <ul className="zen-dashboard__rows">
                {PRIORITIES.map((priority) => {
                  const row = data.activeByItPriority[priority];
                  return (
                    <li key={priority}>
                      <Link to={linkFor("/queue", row.query)} aria-label={`Active, IT Priority ${priority}: ${row.value} ticket${row.value === 1 ? "" : "s"}`}>
                        <PriorityBadge kind="IT" priority={priority} /> <span className="zen-dashboard__count">{row.value}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>

            {data.users && (
              <Card title="User accounts">
                <ul className="zen-dashboard__rows">
                  {ROLE_ROWS.map(([role, label]) => {
                    const row = data.users![role];
                    return (
                      <li key={role}>
                        <Link to={linkFor("/users", row.query)}>
                          <strong>{label}</strong> {row.active} active · {row.inactive} inactive
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            )}
          </div>

          <div className="zen-dashboard__lists">
            <Card title="My open actions">
              <section id="my-open-actions" aria-label="My open actions">
                <ListTotal shown={data.lists.myOpenActions.items.length} total={data.lists.myOpenActions.total} />
                {data.lists.myOpenActions.items.length === 0 ? (
                  <p className="zen-field__hint">You have no open actions.</p>
                ) : (
                  <ul className="zen-dashboard__rows">
                    {data.lists.myOpenActions.items.map((item) => {
                      const overdue = new Date(item.actionAt).getTime() < Date.now();
                      return (
                        <li key={item.actionId} className={overdue ? "zen-dashboard__row zen-dashboard__row--overdue" : "zen-dashboard__row"}>
                          <Link to={`/queue/${item.ticketId}#action-${item.actionId}`}>
                            <span>{moment(item.actionAt)}</span>
                            {overdue && <span className="zen-badge zen-badge--status-waiting">Overdue</span>}
                            <strong>{item.ticketNumber}</strong> {item.summary}
                            <span className="zen-field__hint">{item.description.split("\n")[0]}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            </Card>

            <TicketPanel title="Urgent active tickets" empty="No urgent active tickets."
              list={data.lists.urgentActive} viewAll={linkFor("/queue", { itPriority: "URGENT", currentStatus: ACTIVE_STATUS_LIST })} />
            <TicketPanel title="Recently updated" empty="No tickets yet." list={data.lists.recentlyUpdated} viewAll={linkFor("/queue", { sortBy: "updatedAt", sortOrder: "desc" })} />
          </div>
        </div>
      )}
    </div>
  );
}

function ListTotal({ shown, total }: { shown: number; total: number }) {
  return total > 0 ? <p className="zen-field__hint">Showing {shown} of {total}</p> : null;
}

function TicketPanel({ title, empty, list, viewAll }: { title: string; empty: string; list: { total: number; items: StaffTicketCard[] }; viewAll: string }) {
  return (
    <Card title={title}>
      <ListTotal shown={list.items.length} total={list.total} />
      {list.items.length === 0 ? (
        <p className="zen-field__hint">{empty}</p>
      ) : (
        <ul className="zen-dashboard__rows">
          {list.items.map((ticket) => (
            <li key={ticket.id} className="zen-dashboard__row">
              <Link to={`/queue/${ticket.id}`}>
                <strong>{ticket.ticketNumber}</strong> {ticket.summary}{" "}
                <StatusBadge status={ticket.currentStatus as TicketStatus} />{" "}
                <span className="zen-field__hint">
                  {ticket.owner ? ticket.owner.fullName : "Unassigned"} · {moment(ticket.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {list.total > 0 && (
        <Link className="zen-button zen-button--tertiary" to={viewAll}>
          View all
        </Link>
      )}
    </Card>
  );
}
