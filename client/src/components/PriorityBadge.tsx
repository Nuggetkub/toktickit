import type { RequestedPriority } from "../api.js";

const TONES: Record<RequestedPriority, string> = {
  LOW: "zen-badge--neutral",
  MEDIUM: "zen-badge--neutral",
  HIGH: "zen-badge--warning",
  URGENT: "zen-badge--danger",
};

/**
 * ui-spec.md §1 — used for **both** Requested Priority and IT Priority, and
 * always preceded by its label.
 *
 * The label is not decoration: the two share one scale and one set of tones, so
 * an unlabelled badge reading "HIGH" beside another reading "URGENT" tells the
 * reader nothing about which is which. The `kind` prop makes the label
 * impossible to omit.
 */
export function PriorityBadge({ kind, priority }: { kind: "Requested" | "IT"; priority: RequestedPriority }) {
  return (
    <span className="zen-priority">
      <span className="zen-priority__label">{kind}</span>
      <span className={`zen-badge ${TONES[priority]}`}>{priority}</span>
    </span>
  );
}
