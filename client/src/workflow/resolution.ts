import type { ResolutionGate, UnmetCondition } from "../api.js";

// The "Resolution needs:" lines of Lab 4 ui-spec §5, in BR-19's order.
//
// Two sources, one wording. Before the attempt they come from the Ticket's
// `resolutionGate`, which is advice; after a refusal they come from the
// server's `unmet` list, which is the rule. The reader sees the same sentence
// either way, so a stale screen that the server overrules does not suddenly
// speak a different language.

const openLine = (count: number) => `Complete or cancel ${count} open action${count === 1 ? "" : "s"}`;
const NO_COMPLETED = "Record at least one completed action";
const FOLLOW_UP = "The latest completed action asks for follow-up — record the follow-up work";
const REOPENED = "The ticket was reopened — record the work done since";

/** What still stands between this Ticket and Resolved, from its gate. Empty when ready. */
export function resolutionNeeds(gate: ResolutionGate): string[] {
  if (gate.ready) return [];
  const lines: string[] = [];
  if (gate.openActions > 0) lines.push(openLine(gate.openActions));
  if (gate.completedActions === 0) lines.push(NO_COMPLETED);
  else if (gate.latestFollowUpRequired) lines.push(FOLLOW_UP);
  if (gate.reopenedSinceWork) lines.push(REOPENED);
  return lines;
}

/** The server's refusal, in the same words (api-spec §4, RESOLUTION_BLOCKED). */
export function unmetLines(unmet: UnmetCondition[]): string[] {
  return unmet.map((item) => {
    switch (item.condition) {
      case "OPEN_ACTIONS":
        return openLine(item.count);
      case "NO_COMPLETED_ACTION":
        return NO_COMPLETED;
      case "FOLLOW_UP_REQUIRED":
        return FOLLOW_UP;
      case "NO_WORK_SINCE_REOPEN":
        return REOPENED;
    }
  });
}

/** BR-20: cancelling a Ticket cancels its open Actions, so the confirmation says how many. */
export function cancellationWarning(gate: ResolutionGate | undefined): string | null {
  const count = gate?.openActions ?? 0;
  if (count === 0) return null;
  return count === 1 ? "1 open action will also be cancelled." : `${count} open actions will also be cancelled.`;
}
