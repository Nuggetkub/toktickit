import type { TicketStatus } from "./components/index.js";

/**
 * The ticket lifecycle rules the interface has to know, transcribed by hand from
 * docs/lab-03/specification.md.
 *
 * The server owns these rules and re-checks every one of them; this copy exists
 * because ui-spec.md §8 requires the Change status control to offer *only* the
 * statuses BR-29 allows from here, and a control cannot filter itself against a
 * table it does not have. Offering all eight and letting the server refuse six
 * would be a slower, ruder way of showing an error.
 *
 * A second copy of a rule is a liability — the one in `server/src/ticket-workflow.ts`
 * is the authority — so the unit test transcribes BR-29 a *third* time, by hand
 * from the specification, and asserts this table equals it. If the two ever
 * disagree, the test says so rather than the user discovering it.
 */
export const ALLOWED_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

/** BR-27. A terminal ticket is frozen: the Work panel is disabled, not hidden. */
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["CLOSED", "CANCELLED"];

/** BR-28 — a condition on the transition, not an invariant of the status. */
export const OWNER_REQUIRED_TO_ENTER: readonly TicketStatus[] = [
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
];

/** BR-32. The Requester may say "appears resolved" only from these. */
export const INDICATION_ALLOWED_FROM: readonly TicketStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "REOPENED",
];

// BR-30, after trimming. These are the ticket's evidence limits and have nothing
// to do with the attachment removal reason in TicketDetail, which is BR-38's
// 5-250 — two different rules that would quietly merge if they shared a name.
export const SUMMARY_MIN = 10;
export const SUMMARY_MAX = 2000;
export const REASON_MIN = 5;
export const REASON_MAX = 500;

/** BR-31: these four are the transitions the interface confirms before sending. */
export const CONFIRMED_TRANSITIONS: readonly TicketStatus[] = ["RESOLVED", "CLOSED", "CANCELLED", "REOPENED"];

export function isTerminal(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function nextStatuses(from: TicketStatus): readonly TicketStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

/** Entering RESOLVED needs a summary; CANCELLED and REOPENED need a reason. */
export function evidenceRequiredFor(to: TicketStatus): "resolutionSummary" | "reason" | null {
  if (to === "RESOLVED") return "resolutionSummary";
  if (to === "CANCELLED" || to === "REOPENED") return "reason";
  return null;
}

export function evidenceLimits(field: "resolutionSummary" | "reason"): { min: number; max: number } {
  return field === "resolutionSummary"
    ? { min: SUMMARY_MIN, max: SUMMARY_MAX }
    : { min: REASON_MIN, max: REASON_MAX };
}

export function indicationAllowedFrom(status: TicketStatus): boolean {
  return INDICATION_ALLOWED_FROM.includes(status);
}

/**
 * BR-28, for the Status control: moving an unassigned ticket into one of these
 * answers `409 OWNER_REQUIRED`, so the screen says why beneath the control
 * instead of offering the choice and reporting a conflict afterwards.
 */
export function ownerRequiredToEnter(status: TicketStatus): boolean {
  return OWNER_REQUIRED_TO_ENTER.includes(status);
}
