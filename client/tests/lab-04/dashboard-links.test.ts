import { describe, expect, it } from "vitest";
import { ACTIVE_STATUS_LIST, linkFor } from "../../src/dashboard/dashboard-links";
import { filtersFromUrl } from "../../src/staff/StaffTicketQueue";
import { resolutionNeeds, unmetLines } from "../../src/workflow/resolution";

// UNIT-04 in docs/lab-04/tests.md (AC-11, AC-20): the client helpers. A card's
// `query` becomes a list URL, and the list screen reads it back into the same
// filters; and the "Resolution needs" lines for each gate combination. The
// expected sentences are transcribed from Lab 4 ui-spec §5.

describe("a card's query becomes a link the queue reads back into the same filters", () => {
  it.each([
    [{ owner: "unassigned", currentStatus: ACTIVE_STATUS_LIST }, { owner: "unassigned", currentStatus: "ACTIVE" }],
    [{ owner: "me", currentStatus: ACTIVE_STATUS_LIST }, { owner: "me", currentStatus: "ACTIVE" }],
    [{ requesterIndicated: "true", currentStatus: ACTIVE_STATUS_LIST }, { requesterIndicated: true, currentStatus: "ACTIVE" }],
    [{ currentStatus: "WAITING_FOR_REQUESTER" }, { currentStatus: "WAITING_FOR_REQUESTER" }],
    [{ itPriority: "URGENT", currentStatus: ACTIVE_STATUS_LIST }, { itPriority: "URGENT", currentStatus: "ACTIVE" }],
  ])("%j", (query, expected) => {
    const url = linkFor("/queue", query);
    expect(url.startsWith("/queue?")).toBe(true);
    const { filters, asWritten } = filtersFromUrl(url.slice("/queue".length));
    expect(filters).toMatchObject(expected);
    expect(asWritten).toEqual({});
  });

  it("a card with no query links to its panel's bare path", () => {
    expect(linkFor("/queue", null)).toBe("/queue");
  });

  it("keeps aside, as written, what the controls cannot show", () => {
    expect(filtersFromUrl("?currentStatus=OPEN,RESOLVED&owner=everyone&requesterIndicated=false").asWritten).toEqual({
      currentStatus: "OPEN,RESOLVED",
      owner: "everyone",
      requesterIndicated: "false",
    });
  });
});

describe("the Resolution needs lines (ui-spec §5)", () => {
  const gate = (over: object) => ({ openActions: 0, completedActions: 1, latestFollowUpRequired: false, reopenedSinceWork: false, ready: false, ...over });

  it("is empty when the gate is open", () => {
    expect(resolutionNeeds(gate({ ready: true }))).toEqual([]);
  });

  it.each([
    [{ openActions: 1, completedActions: 0 }, ["Complete or cancel 1 open action", "Record at least one completed action"]],
    [{ openActions: 3 }, ["Complete or cancel 3 open actions"]],
    [{ latestFollowUpRequired: true }, ["The latest completed action asks for follow-up — record the follow-up work"]],
    [{ reopenedSinceWork: true }, ["The ticket was reopened — record the work done since"]],
  ])("%j", (over, lines) => {
    expect(resolutionNeeds(gate(over))).toEqual(lines);
  });

  it("speaks the server's unmet list in the same words", () => {
    expect(unmetLines([{ condition: "OPEN_ACTIONS", count: 2 }, { condition: "NO_COMPLETED_ACTION" }, { condition: "FOLLOW_UP_REQUIRED", actionId: 9 }, { condition: "NO_WORK_SINCE_REOPEN" }])).toEqual([
      "Complete or cancel 2 open actions",
      "Record at least one completed action",
      "The latest completed action asks for follow-up — record the follow-up work",
      "The ticket was reopened — record the work done since",
    ]);
  });
});
