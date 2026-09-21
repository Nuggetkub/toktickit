import { describe, expect, it } from "vitest";
import {
  STAFF_PAGE_SIZES,
  STAFF_PRIORITIES,
  STAFF_SEARCH_MAX,
  STAFF_SORT_FIELDS,
  STAFF_STATUSES,
  staffTotalPages,
  validateStaffQueueQuery,
} from "../../src/staff-queue-query.js";

// UNIT-04 — AC-13 (docs/lab-03/tests.md).
//
// Each parameter is tested **on its own**, not only in a combined query. That is
// deliberate and comes from a real defect: reviewing my peer's queue
// (Earth2509 PR #46) I found four of five filters were never validated, because
// they were evaluated inside the returned object literal below an early
// `if (errors.length) return`. A combined query hid it — the first bad parameter
// short-circuited the rest — and only one-bad-parameter-at-a-time exposed it.
// These tests are shaped so the same mistake here could not survive.

describe("staff queue query — each filter is validated on its own", () => {
  it.each([
    ["currentStatus", "unknown"],
    ["itPriority", "NOW"],
    ["categoryId", "abc"],
    ["owner", "nobody"],
    ["requesterIndicated", "false"],
    ["sortBy", "summary"],
    ["sortOrder", "sideways"],
    ["page", "0"],
    ["pageSize", "11"],
  ])("rejects an invalid %s when it is the only bad parameter", (field, value) => {
    const result = validateStaffQueueQuery({ [field]: value });

    // The distinction that matters: rejected, not accepted-and-dropped.
    expect(result.value, `${field}=${value} was accepted`).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty(field);
  });

  it("reports every bad parameter at once rather than stopping at the first", () => {
    // The combined case that hid the peer's defect. All three must be named, so
    // a caller fixing one is not sent round again for the next.
    const result = validateStaffQueueQuery({ page: "0", currentStatus: "unknown", itPriority: "NOW" });

    expect(result.value).toBeUndefined();
    expect(Object.keys(result.fieldErrors!).sort()).toEqual(["currentStatus", "itPriority", "page"]);
  });

  it("refuses a parameter it does not recognise", () => {
    // A misspelling must not read as an unfiltered queue.
    const result = validateStaffQueueQuery({ itPriorty: "HIGH" });

    expect(result.value).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty("itPriorty");
  });

  it("refuses a repeated parameter instead of quietly choosing one", () => {
    const result = validateStaffQueueQuery({ page: ["1", "99"] });

    expect(result.value).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty("page");
  });
});

describe("staff queue query — every whitelisted value is accepted", () => {
  it.each(STAFF_STATUSES)("accepts currentStatus=%s", (status) => {
    expect(validateStaffQueueQuery({ currentStatus: status }).value?.currentStatus).toBe(status);
  });

  it.each(STAFF_PRIORITIES)("accepts itPriority=%s", (priority) => {
    expect(validateStaffQueueQuery({ itPriority: priority }).value?.itPriority).toBe(priority);
  });

  it.each(STAFF_SORT_FIELDS)("accepts sortBy=%s", (field) => {
    expect(validateStaffQueueQuery({ sortBy: field }).value?.sortBy).toBe(field);
  });

  it.each(STAFF_PAGE_SIZES)("accepts pageSize=%s", (size) => {
    expect(validateStaffQueueQuery({ pageSize: String(size) }).value?.pageSize).toBe(size);
  });
});

describe("staff queue query — the owner filter", () => {
  it("accepts me, unassigned and a numeric id, and keeps them distinct", () => {
    // `me` stays a token here on purpose: this module has no caller, which is
    // what lets the whole parameter set be unit-tested without a session.
    expect(validateStaffQueueQuery({ owner: "me" }).value?.owner).toBe("me");
    expect(validateStaffQueueQuery({ owner: "unassigned" }).value?.owner).toBe("unassigned");
    expect(validateStaffQueueQuery({ owner: "7" }).value?.owner).toBe(7);
  });

  it.each([["0"], ["-1"], ["mine"], ["null"]])("rejects owner=%s", (value) => {
    const result = validateStaffQueueQuery({ owner: value });
    expect(result.value).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty("owner");
  });
});

describe("staff queue query — defaults and shape", () => {
  it("defaults to newest first, page 1, ten per page", () => {
    const result = validateStaffQueueQuery({});

    expect(result.value).toEqual({ sortBy: "ticketDate", sortOrder: "desc", page: 1, pageSize: 10 });
  });

  it("omits an absent filter rather than carrying an undefined key", () => {
    // The route spreads these into a Prisma `where`; an explicit undefined would
    // read as a filter that exists.
    const result = validateStaffQueueQuery({ currentStatus: "OPEN" });

    expect(Object.keys(result.value!).sort()).toEqual([
      "currentStatus",
      "page",
      "pageSize",
      "sortBy",
      "sortOrder",
    ]);
  });

  it("trims a search term and treats an all-whitespace one as absent", () => {
    expect(validateStaffQueueQuery({ search: "  wifi  " }).value?.search).toBe("wifi");
    expect(validateStaffQueueQuery({ search: "   " }).value?.search).toBeUndefined();
  });

  it(`rejects a search term longer than ${STAFF_SEARCH_MAX} characters`, () => {
    const result = validateStaffQueueQuery({ search: "x".repeat(STAFF_SEARCH_MAX + 1) });

    expect(result.value).toBeUndefined();
    expect(result.fieldErrors).toHaveProperty("search");
  });

  it("accepts requesterIndicated=true only", () => {
    expect(validateStaffQueueQuery({ requesterIndicated: "true" }).value?.requesterIndicated).toBe(true);
    expect(validateStaffQueueQuery({ requesterIndicated: "false" }).fieldErrors).toHaveProperty(
      "requesterIndicated",
    );
  });
});

describe("staffTotalPages", () => {
  it("never reports page 1 of 0", () => {
    // A reader is always on page 1 of at least 1; "Page 1 of 0" is nonsense on
    // an empty queue, and it was a defect found on the peer's Lab 2 list.
    expect(staffTotalPages(0, 10)).toBe(1);
    expect(staffTotalPages(1, 10)).toBe(1);
    expect(staffTotalPages(10, 10)).toBe(1);
    expect(staffTotalPages(11, 10)).toBe(2);
    expect(staffTotalPages(31, 10)).toBe(4);
  });
});
