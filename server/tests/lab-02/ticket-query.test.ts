import { describe, it, expect } from "vitest";
import { DEFAULT_PAGE_SIZE, validateTicketListQuery } from "../../src/ticket-query.js";

// UNIT-06 — AC-09. The parser decides what a query means; these are the cases
// where "reject" and "ignore" look identical from the outside and are not.

describe("ticket list query", () => {
  it("applies the documented defaults when nothing is supplied", () => {
    const { value } = validateTicketListQuery({});
    expect(value).toMatchObject({ sortBy: "ticketDate", sortOrder: "desc", page: 1, pageSize: DEFAULT_PAGE_SIZE });
  });

  it("trims a search term and treats an empty one as absent", () => {
    expect(validateTicketListQuery({ search: "  laptop  " }).value?.search).toBe("laptop");
    expect(validateTicketListQuery({ search: "   " }).value?.search).toBeUndefined();
  });

  it.each([
    ["sortBy", "summary"],
    ["sortOrder", "sideways"],
    ["pageSize", "11"],
    ["page", "0"],
    ["requestedPriority", "SOMEDAY"],
    ["categoryId", "-1"],
  ])("rejects an invalid %s rather than falling back to a default", (field, value) => {
    const result = validateTicketListQuery({ [field]: value });
    expect(result.value).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty(field);
  });

  it("rejects a repeated parameter instead of picking one", () => {
    const result = validateTicketListQuery({ page: ["1", "99"] });
    expect(result.fieldErrors).toHaveProperty("page");
  });

  // Lab 2 refused Current Status here, because every Lab 2 Ticket was NEW. Lab 4
  // BR-30 (issue #78) adds the filter, so the refusal became an acceptance; the
  // full list rules are UNIT-03 in server/tests/lab-04/status-filter.test.ts.
  it("accepts a Current Status filter since Lab 4, and still refuses an unknown one", () => {
    expect(validateTicketListQuery({ currentStatus: "NEW" }).value?.currentStatus).toEqual(["NEW"]);
    expect(validateTicketListQuery({ currentStatus: "new" }).fieldErrors).toHaveProperty("currentStatus");
  });

  it("reports every invalid parameter at once", () => {
    const result = validateTicketListQuery({ sortBy: "nope", pageSize: "7", page: "0" });
    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual(["page", "pageSize", "sortBy"]);
  });
});
