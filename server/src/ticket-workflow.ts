import type { TicketStatus } from "@prisma/client";

// The rules that decide whether a ticket may move (BR-26 to BR-30).
//
// Kept apart from the route so the whole matrix can be unit-tested without a
// database, and so the route reads as "ask, then write" rather than burying the
// policy inside a transaction.

export const TICKET_STATUSES = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
] as const satisfies readonly TicketStatus[];

/** BR-27. A terminal ticket is frozen: nothing about it changes again. */
export const TERMINAL_STATUSES: readonly TicketStatus[] = ["CLOSED", "CANCELLED"];

/**
 * BR-28. "Owner required to enter" is a condition on the *transition*, not an
 * invariant of the status: a ticket already in one of these may later be
 * unassigned and simply shows as Unassigned until someone takes it.
 */
export const OWNER_REQUIRED_TO_ENTER: readonly TicketStatus[] = [
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
];

/** BR-29, transcribed from specification.md. A status to itself is not in it. */
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

// BR-30, after trimming.
export const SUMMARY_MIN = 10;
export const SUMMARY_MAX = 2000;
export const REASON_MIN = 5;
export const REASON_MAX = 500;

/** Entering RESOLVED needs a summary; CANCELLED and REOPENED need a reason. */
export function evidenceRequiredFor(to: TicketStatus): "resolutionSummary" | "reason" | null {
  if (to === "RESOLVED") return "resolutionSummary";
  if (to === "CANCELLED" || to === "REOPENED") return "reason";
  return null;
}

export type WorkflowConflictCode = "INVALID_STATUS_TRANSITION" | "OWNER_REQUIRED" | "TICKET_TERMINAL";

export type StatusChangeDecision =
  | { kind: "ok"; evidence: string | null }
  | { kind: "validation"; fieldErrors: Record<string, string> }
  | { kind: "conflict"; code: WorkflowConflictCode; message: string };

/**
 * Decides one status change.
 *
 * The result is discriminated rather than a bare message, so the route maps each
 * refusal to the code api-spec.md §6 names. Returning one string for every
 * failure is how "fix this field" reaches a user as "reload the page" — a defect
 * I found reviewing my peer's workflow (Earth2509 PR #47), and the reason this
 * type exists.
 *
 * **Input validity is decided before state**, which is the order api-spec.md §1
 * fixes: step 6 is `400 VALIDATION_FAILED`, step 7 is the `409` family. So a
 * request to resolve a ticket with no summary is a `400` even when that ticket
 * is closed. It reads oddly in that one case and it is what the contract says;
 * the alternative is deciding the order per-endpoint, which is worse.
 */
export function decideStatusChange(input: {
  from: TicketStatus;
  to: unknown;
  ownerId: number | null;
  resolutionSummary?: unknown;
  reason?: unknown;
}): StatusChangeDecision {
  const fieldErrors: Record<string, string> = {};

  const to = (TICKET_STATUSES as readonly string[]).includes(String(input.to))
    ? (input.to as TicketStatus)
    : undefined;
  if (!to) fieldErrors.toStatus = `Choose one of: ${TICKET_STATUSES.join(", ")}.`;

  // The evidence rule depends on the requested target, so it can only be checked
  // once the target is known to be a real status.
  const field = to ? evidenceRequiredFor(to) : null;
  let evidence: string | null = null;

  if (field) {
    const raw = field === "resolutionSummary" ? input.resolutionSummary : input.reason;
    const [min, max] = field === "resolutionSummary" ? [SUMMARY_MIN, SUMMARY_MAX] : [REASON_MIN, REASON_MAX];
    const trimmed = typeof raw === "string" ? raw.trim() : "";

    if (trimmed.length < min || trimmed.length > max) {
      fieldErrors[field] =
        field === "resolutionSummary"
          ? `Give a resolution summary of ${min} to ${max} characters.`
          : `Give a reason of ${min} to ${max} characters.`;
    } else {
      evidence = trimmed;
    }
  }

  if (Object.keys(fieldErrors).length > 0) return { kind: "validation", fieldErrors };

  const target = to as TicketStatus;

  // BR-27 before the matrix: a closed or cancelled ticket has no allowed
  // transitions, so both rules would fire, and "this ticket is finished" is the
  // truer answer than "that pair is not permitted".
  if (TERMINAL_STATUSES.includes(input.from)) {
    return { kind: "conflict", code: "TICKET_TERMINAL", message: "This Ticket is closed and can no longer change." };
  }

  if (!ALLOWED_TRANSITIONS[input.from].includes(target)) {
    return {
      kind: "conflict",
      code: "INVALID_STATUS_TRANSITION",
      message: `A Ticket cannot move from ${input.from} to ${target}.`,
    };
  }

  if (OWNER_REQUIRED_TO_ENTER.includes(target) && input.ownerId === null) {
    return {
      kind: "conflict",
      code: "OWNER_REQUIRED",
      message: "Assign an owner before moving this Ticket to that status.",
    };
  }

  return { kind: "ok", evidence };
}

/** BR-27, for the owner and IT Priority routes, which have no target status. */
export function isTerminal(status: TicketStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}
