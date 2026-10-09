// The `currentStatus` filter on My Tickets and the Ticket Queue (BR-30,
// api-spec.md §5, issue #84 and issue #78).
//
// One status, or a comma-separated list of distinct ones, so that every
// dashboard drill-down, "active" included, is a real query against the list
// endpoint (D-12). Everything else is refused, never read generously: an empty
// value, a trailing comma, a lower-case or unknown member, or a repeat. A filter
// that is quietly dropped or reinterpreted answers a question the caller did not
// ask (Lab 2 BR-27).

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

export type TicketStatusName = (typeof TICKET_STATUSES)[number];

/** BR-25: the statuses in which work is still owed. `RESOLVED` is not one of them. */
export const ACTIVE_STATUSES = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"] as const satisfies readonly TicketStatusName[];

const MESSAGE = `Use one status, or a comma-separated list of different statuses, from: ${TICKET_STATUSES.join(", ")}.`;

/**
 * Reads `currentStatus`. Returns the statuses in the order given, or undefined
 * when the parameter is absent or refused; a refusal is written to fieldErrors.
 */
export function parseStatusList(value: unknown, fieldErrors: Record<string, string>): TicketStatusName[] | undefined {
  if (value === undefined) return undefined;
  // Express turns a repeated parameter into an array. The list form is the
  // comma, so a second `currentStatus=` is a mistake, not a longer list.
  if (typeof value !== "string") {
    fieldErrors.currentStatus = Array.isArray(value) ? "Provide this parameter once; list statuses with commas." : MESSAGE;
    return undefined;
  }

  const members = value.split(",");
  const known = new Set<string>(TICKET_STATUSES);
  const seen = new Set<string>();
  for (const member of members) {
    if (!known.has(member) || seen.has(member)) {
      fieldErrors.currentStatus = MESSAGE;
      return undefined;
    }
    seen.add(member);
  }
  return members as TicketStatusName[];
}
