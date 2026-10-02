import { useEffect, useId, useState } from "react";
import { fetchHistory, type StatusHistory as History } from "../api.js";
import { Button, Card, ErrorAlert, StatusBadge, StatusMessage, type TicketStatus } from "../components/index.js";
import { moment } from "../tickets/attachment-format.js";

// The History disclosure (Lab 4 ui-spec §5), below the Actions section on both
// Ticket Detail screens: collapsed by default, with its event count, holding the
// StatusTimeline oldest first (BR-23). Each entry names both statuses as badges,
// so no change is told by colour alone.

type StatusHistoryProps = {
  ticketId: number;
  /** Changes when the Ticket's status changes, so the history re-reads. */
  refreshToken?: number;
};

export function StatusHistory({ ticketId, refreshToken = 0 }: StatusHistoryProps) {
  const [history, setHistory] = useState<History | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [open, setOpen] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const listId = useId();

  useEffect(() => {
    let active = true;
    // Read straight away, not on opening, because the button shows the count.
    fetchHistory(ticketId)
      .then((loaded) => {
        if (!active) return;
        setHistory(loaded);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, [ticketId, refreshToken, retryToken]);

  const count = history ? ` (${history.items.length})` : "";

  return (
    <Card>
      <Button variant="tertiary" aria-expanded={open} aria-controls={listId} onClick={() => setOpen((current) => !current)}>
        {`History${count}`}
      </Button>
      {open && (
        <div id={listId}>
          {state === "loading" && <StatusMessage>Loading the history…</StatusMessage>}
          {state === "failed" && <ErrorAlert onRetry={() => setRetryToken((token) => token + 1)}>The history could not be loaded.</ErrorAlert>}
          {state === "ready" && history && (
            <>
              {/* BR-24: a Ticket from before the history began says so first. */}
              {!history.recordedFromCreation && <p className="zen-field__hint">Earlier changes were made before history was recorded.</p>}
              {history.items.length === 0 ? (
                <p className="zen-field__hint">No status changes have been recorded.</p>
              ) : (
                <ol className="zen-timeline" aria-label="Status history, oldest first">
                  {history.items.map((event) => (
                    <li key={event.id}>
                      {event.fromStatus === null ? (
                        <>
                          {event.actor.fullName} created this ticket as <StatusBadge status={event.toStatus as TicketStatus} />
                        </>
                      ) : (
                        <>
                          {event.actor.fullName} moved this from <StatusBadge status={event.fromStatus as TicketStatus} /> to{" "}
                          <StatusBadge status={event.toStatus as TicketStatus} />
                        </>
                      )}
                      {" · "}
                      <time dateTime={event.createdAt}>{moment(event.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  );
}
