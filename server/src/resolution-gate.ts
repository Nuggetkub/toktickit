import type { ActionStatus } from "@prisma/client";

// The resolution gate (docs/lab-04/specification.md BR-19), as policy with no
// Express and no Prisma, like ticket-workflow.ts. The route loads the evidence
// under the Ticket row lock and asks this module what is missing.

export type GateAction = {
  id: number;
  status: ActionStatus;
  actionAt: Date;
  completedAt: Date | null;
  followUpRequired: boolean;
};

export type GateEvidence = {
  actions: readonly GateAction[];
  /** The time of the Ticket's most recent Status Event into REOPENED, if any. */
  latestReopenAt: Date | null;
};

export type Unmet =
  | { condition: "OPEN_ACTIONS"; count: number }
  | { condition: "NO_COMPLETED_ACTION" }
  | { condition: "FOLLOW_UP_REQUIRED"; actionId: number }
  | { condition: "NO_WORK_SINCE_REOPEN" };

export type GateSummary = {
  openActions: number;
  completedActions: number;
  latestFollowUpRequired: boolean;
  reopenedSinceWork: boolean;
  ready: boolean;
};

/** BR-19 3: the latest completed Action by Action Date/Time, the id breaking a tie. */
function latestCompleted(actions: readonly GateAction[]): GateAction | undefined {
  return actions
    .filter((a) => a.status === "COMPLETED")
    .reduce<GateAction | undefined>((latest, a) => {
      if (!latest) return a;
      const byTime = a.actionAt.getTime() - latest.actionAt.getTime();
      return byTime > 0 || (byTime === 0 && a.id > latest.id) ? a : latest;
    }, undefined);
}

/** BR-19 4: reopened, and nothing completed since the latest reopen. */
function reopenedSinceWork(evidence: GateEvidence): boolean {
  const since = evidence.latestReopenAt;
  if (since === null) return false;
  return !evidence.actions.some((a) => a.status === "COMPLETED" && a.completedAt !== null && a.completedAt.getTime() > since.getTime());
}

/**
 * Every condition of BR-19 that fails, in the order the API reports them. An
 * empty list means the Ticket may be resolved. Cancelled Actions count toward
 * none of them.
 */
export function unmetConditions(evidence: GateEvidence): Unmet[] {
  const unmet: Unmet[] = [];
  const open = evidence.actions.filter((a) => a.status === "OPEN").length;
  if (open > 0) unmet.push({ condition: "OPEN_ACTIONS", count: open });
  const latest = latestCompleted(evidence.actions);
  if (!latest) unmet.push({ condition: "NO_COMPLETED_ACTION" });
  else if (latest.followUpRequired) unmet.push({ condition: "FOLLOW_UP_REQUIRED", actionId: latest.id });
  if (reopenedSinceWork(evidence)) unmet.push({ condition: "NO_WORK_SINCE_REOPEN" });
  return unmet;
}

/** The `resolutionGate` field of Ticket Detail: advice for the screen (api-spec §4). */
export function gateSummary(evidence: GateEvidence): GateSummary {
  const latest = latestCompleted(evidence.actions);
  return {
    openActions: evidence.actions.filter((a) => a.status === "OPEN").length,
    completedActions: evidence.actions.filter((a) => a.status === "COMPLETED").length,
    latestFollowUpRequired: latest?.followUpRequired ?? false,
    reopenedSinceWork: reopenedSinceWork(evidence),
    ready: unmetConditions(evidence).length === 0,
  };
}
