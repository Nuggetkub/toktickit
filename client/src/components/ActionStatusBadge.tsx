import type { ActionStatus } from "../api.js";

const LABELS: Record<ActionStatus, string> = { OPEN: "Open", COMPLETED: "Completed", CANCELLED: "Cancelled" };

// Lab 4 ui-spec.md §1: Open borrows the amber outline of "Waiting for
// Requester", Completed the primary fill, Cancelled the read-only fill. The
// tone reinforces the word and never replaces it, as with every Lab 3 badge.
const TONES: Record<ActionStatus, string> = {
  OPEN: "zen-badge--status-waiting",
  COMPLETED: "zen-badge--status-resolved",
  CANCELLED: "zen-badge--status-cancelled",
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  return <span className={`zen-badge ${TONES[status]}`}>{LABELS[status]}</span>;
}
