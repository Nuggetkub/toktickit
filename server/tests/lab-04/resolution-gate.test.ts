import { describe, expect, it } from "vitest";
import { gateSummary, unmetConditions, type GateAction } from "../../src/resolution-gate.js";

// UNIT-02 in docs/lab-04/tests.md (AC-11, AC-12): the gate function against
// hand-built evidence. The expected lists are transcribed from specification
// BR-19, not derived from the module.

const t = (minutes: number) => new Date(Date.UTC(2026, 8, 28, 9, 0) + minutes * 60_000);
let nextId = 1;
const action = (status: GateAction["status"], at: number, extra: Partial<GateAction> = {}): GateAction => ({
  id: nextId++,
  status,
  actionAt: t(at),
  completedAt: status === "COMPLETED" ? t(at) : null,
  // The history order runs with the minutes here unless a test says otherwise.
  completionSeq: status === "COMPLETED" ? BigInt(at) : null,
  followUpRequired: false,
  ...extra,
});
const gate = (actions: GateAction[], latestReopenSeq: bigint | null = null) => unmetConditions({ actions, latestReopenSeq });

describe("the resolution gate (BR-19)", () => {
  it("refuses a Ticket with no Actions, or with only cancelled ones", () => {
    expect(gate([])).toEqual([{ condition: "NO_COMPLETED_ACTION" }]);
    expect(gate([action("CANCELLED", 0), action("CANCELLED", 5)])).toEqual([{ condition: "NO_COMPLETED_ACTION" }]);
  });

  it("counts every open Action, and reports the missing completion alongside it", () => {
    expect(gate([action("OPEN", 0), action("OPEN", 5)])).toEqual([{ condition: "OPEN_ACTIONS", count: 2 }, { condition: "NO_COMPLETED_ACTION" }]);
    expect(gate([action("COMPLETED", 0), action("OPEN", 5)])).toEqual([{ condition: "OPEN_ACTIONS", count: 1 }]);
  });

  it("refuses when the latest completed Action asks for follow-up, naming it", () => {
    const followUp = action("COMPLETED", 10, { followUpRequired: true });
    expect(gate([action("COMPLETED", 0), followUp])).toEqual([{ condition: "FOLLOW_UP_REQUIRED", actionId: followUp.id }]);
  });

  it("accepts a follow-up superseded by a later completed Action", () => {
    expect(gate([action("COMPLETED", 0, { followUpRequired: true }), action("COMPLETED", 10)])).toEqual([]);
  });

  it("decides 'latest' by Action Date/Time, then by id when two share one", () => {
    // Same instant: the higher id is the latest.
    const first = action("COMPLETED", 20);
    const second = action("COMPLETED", 20, { followUpRequired: true });
    expect(gate([second, first])).toEqual([{ condition: "FOLLOW_UP_REQUIRED", actionId: second.id }]);
    // A later Action Date/Time wins over a higher id.
    const early = action("COMPLETED", 30);
    const late = action("COMPLETED", 40, { followUpRequired: true });
    const recordedLater = { ...early, id: 999 };
    expect(gate([recordedLater, late])).toEqual([{ condition: "FOLLOW_UP_REQUIRED", actionId: late.id }]);
  });

  it("after a reopen, requires work completed since the latest reopen, in history order (D-15)", () => {
    const before = action("COMPLETED", 0);
    expect(gate([before], 5n)).toEqual([{ condition: "NO_WORK_SINCE_REOPEN" }]);
    expect(gate([before, action("COMPLETED", 10)], 5n)).toEqual([]);
    // Work since the reopen, but backdated: the completion's place in the order counts, not actionAt.
    expect(gate([before, action("COMPLETED", 1, { completionSeq: 10n })], 5n)).toEqual([]);
    // The order decides, not any clock: completed after the reopen by the order,
    // though its completedAt reads earlier (Earth2509's review of PR #95) ...
    expect(gate([action("COMPLETED", 10, { completedAt: t(0) })], 5n)).toEqual([]);
    // ... and completed before it by the order, though its completedAt reads later.
    expect(gate([action("COMPLETED", 0, { completedAt: t(10) })], 5n)).toEqual([{ condition: "NO_WORK_SINCE_REOPEN" }]);
    // A completion with no place in the order predates the column, so counts as before.
    expect(gate([action("COMPLETED", 10, { completionSeq: null })], 5n)).toEqual([{ condition: "NO_WORK_SINCE_REOPEN" }]);
    // Every failed condition at once, in the documented order.
    expect(gate([action("OPEN", 0), before], 5n)).toEqual([{ condition: "OPEN_ACTIONS", count: 1 }, { condition: "NO_WORK_SINCE_REOPEN" }]);
  });

  it("summarises the gate for Ticket Detail, with ready meaning no unmet condition", () => {
    const followUp = action("COMPLETED", 10, { followUpRequired: true });
    expect(gateSummary({ actions: [action("OPEN", 0), followUp, action("CANCELLED", 3)], latestReopenSeq: null })).toEqual({
      openActions: 1,
      completedActions: 1,
      latestFollowUpRequired: true,
      reopenedSinceWork: false,
      ready: false,
    });
    expect(gateSummary({ actions: [action("COMPLETED", 0)], latestReopenSeq: null })).toMatchObject({ ready: true, reopenedSinceWork: false });
    expect(gateSummary({ actions: [action("COMPLETED", 0)], latestReopenSeq: 5n })).toMatchObject({ ready: false, reopenedSinceWork: true });
  });
});
