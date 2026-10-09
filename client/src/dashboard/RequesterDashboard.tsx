import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, fetchRequesterDashboard, type RequesterDashboardData, type RequesterTicketCard } from "../api.js";
import { Forbidden } from "../auth/index.js";
import { Button, Card, ErrorAlert, StatusBadge, StatusMessage, type TicketStatus } from "../components/index.js";
import { MetricCard } from "../components/MetricCard.js";
import { moment } from "../tickets/attachment-format.js";
import { linkFor } from "./dashboard-links.js";

// The Requester Dashboard (Lab 4 ui-spec §3, BR-26): the signed-in Requester's
// own Tickets only, summarised. It does not repeat My Tickets' table, search or
// paging (labsheet §8.2); every card links into My Tickets already filtered, and
// no list here is longer than five.

type State = "loading" | "ready" | "failed" | "forbidden";

export default function RequesterDashboard() {
  const [data, setData] = useState<RequesterDashboardData | null>(null);
  const [state, setState] = useState<State>("loading");
  const [refreshing, setRefreshing] = useState(false);
  const [loadToken, setLoadToken] = useState(0);

  useEffect(() => {
    let active = true;
    fetchRequesterDashboard()
      .then((loaded) => {
        if (!active) return;
        setData(loaded);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        // No stale numbers, or stale "Updated" time, beside a failure (ui-spec §3).
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
    setRefreshing(true);
    setLoadToken((token) => token + 1);
  }

  function retry() {
    setState("loading");
    setLoadToken((token) => token + 1);
  }

  if (state === "forbidden") return <Forbidden />;

  // A Requester with no Tickets at all sees one clear next step (ui-spec §3).
  const noTicketsAtAll = state === "ready" && data !== null && data.lists.recentlyUpdated.total === 0;

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
            <div className="zen-metrics" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="zen-metric zen-metric--placeholder" />
              ))}
            </div>
          </>
        )}

        {state === "failed" && <ErrorAlert onRetry={retry} retryLabel="Retry">The dashboard could not be loaded. Please try again.</ErrorAlert>}

        {state === "ready" && data && (
          <>
            <div className="zen-metrics">
              <MetricCard label="My active tickets" value={data.cards.activeTickets.value} noun="ticket"
                explanation="Submitted and still being worked on" to={linkFor("/tickets", data.cards.activeTickets.query)} />
              <MetricCard label="Waiting for me" value={data.cards.waitingForMe.value} noun="ticket"
                explanation="IT Staff need information from you" to={linkFor("/tickets", data.cards.waitingForMe.query)} />
              <MetricCard label="Resolved — please check" value={data.cards.resolvedAwaitingClosure.value} noun="ticket"
                explanation="Fixed by IT Staff, awaiting closure" to={linkFor("/tickets", data.cards.resolvedAwaitingClosure.query)} />
              <MetricCard label="Resolved in the last 7 days" value={data.cards.resolvedLast7Days.value} noun="ticket"
                explanation="Including tickets now closed" to="#recently-resolved" />
            </div>
            {noTicketsAtAll && (
              <div className="zen-empty">
                <p className="zen-empty__title">You have not submitted any tickets yet.</p>
                <Link className="zen-button zen-button--primary" to="/create">
                  Create Ticket
                </Link>
              </div>
            )}
          </>
        )}
      </Card>

      {/* The panels stay for a Requester with no tickets too: the Resolved in the
          last 7 days card links to #recently-resolved, which must exist (ui-spec §6). */}
      {state === "ready" && data && (
        <div className="zen-dashboard__lists">
          <TicketPanel id="needs-attention" title="Needs your attention" empty="Nothing needs your attention." list={data.lists.needsAttention} when="updated" />
          <TicketPanel id="recently-updated" title="Recently updated" empty="None of your tickets has been updated yet." list={data.lists.recentlyUpdated} when="updated" viewAll={linkFor("/tickets", { sortBy: "updatedAt", sortOrder: "desc" })} />
          <TicketPanel id="recently-resolved" title="Recently resolved" empty="No ticket was resolved in the last 7 days." list={data.lists.recentlyResolved} when="resolved" />
        </div>
      )}
    </div>
  );
}

function TicketPanel({
  id,
  title,
  empty,
  list,
  when,
  viewAll,
}: {
  id: string;
  title: string;
  empty: string;
  list: { total: number; items: RequesterTicketCard[] };
  when: "updated" | "resolved";
  viewAll?: string;
}) {
  return (
    <Card title={title}>
      <section id={id} aria-label={title}>
        {list.total > 0 && <p className="zen-field__hint">Showing {list.items.length} of {list.total}</p>}
        {list.items.length === 0 ? (
          <p className="zen-field__hint">{empty}</p>
        ) : (
          <ul className="zen-dashboard__rows">
            {list.items.map((ticket) => (
              <li key={ticket.id} className="zen-dashboard__row">
                <Link to={`/tickets/${ticket.id}`}>
                  <strong>{ticket.ticketNumber}</strong> {ticket.summary} <StatusBadge status={ticket.currentStatus as TicketStatus} />{" "}
                  <span className="zen-field__hint">
                    {when === "resolved" && ticket.resolvedAt ? `Resolved ${moment(ticket.resolvedAt)}` : `Updated ${moment(ticket.updatedAt)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {viewAll && list.total > 0 && (
          <Link className="zen-button zen-button--tertiary" to={viewAll}>
            View all
          </Link>
        )}
      </section>
    </Card>
  );
}
