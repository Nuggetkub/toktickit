import { describe, expect, it } from "vitest";
import { ACTIVE_STATUSES, TICKET_STATUSES, parseStatusList } from "../../src/status-filter.js";
import { validateTicketListQuery } from "../../src/ticket-query.js";
import { STAFF_STATUSES, validateStaffQueueQuery } from "../../src/staff-queue-query.js";

// UNIT-03 in docs/lab-04/tests.md (AC-22): the `currentStatus` list rules of
// BR-30. The accepted and refused inputs are transcribed from BR-30 and
// api-spec.md §5, not derived from the module.

const parse = (value: unknown) => {
  const fieldErrors: Record<string, string> = {};
  return { value: parseStatusList(value, fieldErrors), fieldErrors };
};

describe("currentStatus lists (BR-30)", () => {
  it.each(TICKET_STATUSES)("accepts the single status %s", (status) => {
    expect(parse(status)).toEqual({ value: [status], fieldErrors: {} });
  });

  it("accepts all eight at once, and the five active statuses, in the order given", () => {
    const all = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,RESOLVED,CLOSED,REOPENED,CANCELLED";
    expect(parse(all).value).toEqual(all.split(","));
    expect(parse("NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED").value).toEqual([...ACTIVE_STATUSES]);
    expect(parse("REOPENED,NEW").value).toEqual(["REOPENED", "NEW"]);
  });

  it("treats an absent parameter as no filter", () => {
    expect(parse(undefined)).toEqual({ value: undefined, fieldErrors: {} });
  });

  it.each([
    ["an empty value", ""],
    ["an unknown member", "NEW,DONE"],
    ["a repeated member", "NEW,OPEN,NEW"],
    ["a trailing comma", "NEW,"],
    ["a leading comma", ",NEW"],
    ["an empty member", "NEW,,OPEN"],
    ["a lower-case member", "new"],
    ["a space after the comma", "NEW, OPEN"],
  ])("refuses %s, naming currentStatus", (_label, value) => {
    const result = parse(value);
    expect(result.value).toBeUndefined();
    expect(Object.keys(result.fieldErrors)).toEqual(["currentStatus"]);
  });

  it("refuses the parameter given twice, rather than choosing one or merging them", () => {
    const result = parse(["NEW", "OPEN"]);
    expect(result.value).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty("currentStatus");
  });

  it("names exactly the five active statuses of BR-25, RESOLVED not among them", () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual(["IN_PROGRESS", "NEW", "OPEN", "REOPENED", "WAITING_FOR_REQUESTER"]);
  });
});

describe("My Tickets reads the list (issue #78)", () => {
  it("carries the parsed list into the query, and reports a bad one with the other errors", () => {
    expect(validateTicketListQuery({ currentStatus: "RESOLVED,CLOSED" }).value?.currentStatus).toEqual(["RESOLVED", "CLOSED"]);
    const bad = validateTicketListQuery({ currentStatus: "NEW,NEW", page: "0" });
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual(["currentStatus", "page"]);
  });

  it("omits the key entirely when no status filter is sent", () => {
    expect(validateTicketListQuery({}).value).not.toHaveProperty("currentStatus");
  });
});

describe("the Ticket Queue reads the list (issue #84)", () => {
  it.each(STAFF_STATUSES)("keeps accepting the Lab 3 single value %s, as a list of one", (status) => {
    expect(validateStaffQueueQuery({ currentStatus: status }).value?.currentStatus).toEqual([status]);
  });

  it("accepts the five active statuses with the other drill-down filters", () => {
    const value = validateStaffQueueQuery({ currentStatus: ACTIVE_STATUSES.join(","), owner: "unassigned", requesterIndicated: "true" }).value;
    expect(value).toMatchObject({ currentStatus: [...ACTIVE_STATUSES], owner: "unassigned", requesterIndicated: true });
  });

  it("refuses a bad list alongside the other errors, every parameter still checked", () => {
    const result = validateStaffQueueQuery({ currentStatus: "OPEN,OPEN", itPriority: "NOW" });
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["currentStatus", "itPriority"]);
  });
});
