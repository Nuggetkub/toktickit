export const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const;

export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** The words a reader sees. The enum value is never shown raw. */
const LABELS: Record<TicketStatus, string> = {
  NEW: "New",
  OPEN: "Open",
  IN_PROGRESS: "In Progress",
  WAITING_FOR_REQUESTER: "Waiting for Requester",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  REOPENED: "Reopened",
  CANCELLED: "Cancelled",
};

const TONES: Record<TicketStatus, string> = {
  NEW: "zen-badge--status-new",
  OPEN: "zen-badge--status-open",
  IN_PROGRESS: "zen-badge--status-progress",
  WAITING_FOR_REQUESTER: "zen-badge--status-waiting",
  RESOLVED: "zen-badge--status-resolved",
  CLOSED: "zen-badge--status-closed",
  REOPENED: "zen-badge--status-reopened",
  CANCELLED: "zen-badge--status-cancelled",
};

/**
 * ui-spec.md §1: one badge per status, **always carrying the status in words**.
 *
 * Tone reinforces the word and never replaces it — Closed and Cancelled share a
 * muted fill, so colour alone could not tell them apart even for a reader who
 * sees it perfectly.
 */
export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`zen-badge ${TONES[status]}`}>{LABELS[status]}</span>;
}

export function statusLabel(status: TicketStatus): string {
  return LABELS[status];
}
