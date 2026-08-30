import { describe, it, expect } from "vitest";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  SUMMARY_MAX,
  SUMMARY_MIN,
  isSameTicket,
  validateTicketCreate,
} from "../../src/ticket-create.js";

// UNIT-02 — BR-12, BR-13, BR-14, BR-17. Boundaries belong in unit tests: they
// are the cases most likely to be off by one and the cheapest to check here.

const valid = {
  categoryId: 1,
  relatedSystemId: 2,
  summary: "Cannot connect to Campus Wi-Fi",
  description: "The laptop reports an authentication failure on the campus network every morning.",
  requestedPriority: "HIGH",
};

describe("ticket create validation", () => {
  it("accepts a valid ticket and returns the trimmed values", () => {
    const result = validateTicketCreate({
      ...valid,
      summary: "   Cannot connect to Campus Wi-Fi   ",
      description: `  ${valid.description}  `,
    });

    expect(result.fieldErrors).toBeUndefined();
    expect(result.value?.summary).toBe("Cannot connect to Campus Wi-Fi");
    expect(result.value?.description).toBe(valid.description);
  });

  it("rejects whitespace that would otherwise satisfy the minimum", () => {
    // Trim happens before the length check, so spaces cannot pad a value into
    // validity (BR-12).
    const result = validateTicketCreate({ ...valid, summary: " ".repeat(50) });
    expect(result.value).toBeUndefined();
    expect(result.fieldErrors?.summary).toMatch(/5-120/);
  });

  it.each([
    ["summary", SUMMARY_MIN - 1, false],
    ["summary", SUMMARY_MIN, true],
    ["summary", SUMMARY_MAX, true],
    ["summary", SUMMARY_MAX + 1, false],
    ["description", DESCRIPTION_MIN - 1, false],
    ["description", DESCRIPTION_MIN, true],
    ["description", DESCRIPTION_MAX, true],
    ["description", DESCRIPTION_MAX + 1, false],
  ])("%s of length %i is accepted=%s", (field, length, accepted) => {
    const result = validateTicketCreate({ ...valid, [field]: "x".repeat(length) });
    expect(result.value !== undefined).toBe(accepted);
  });

  it("rejects a priority outside the allowed set", () => {
    const result = validateTicketCreate({ ...valid, requestedPriority: "CRITICAL" });
    expect(result.fieldErrors?.requestedPriority).toMatch(/LOW, MEDIUM, HIGH, URGENT/);
  });

  it("reports every broken field at once rather than the first", () => {
    // BR-17: the user should be able to fix the whole form in one pass.
    const result = validateTicketCreate({
      categoryId: 0,
      relatedSystemId: "two",
      summary: "no",
      description: "short",
      requestedPriority: "SOMEDAY",
    });

    expect(Object.keys(result.fieldErrors ?? {}).sort()).toEqual([
      "categoryId",
      "description",
      "relatedSystemId",
      "requestedPriority",
      "summary",
    ]);
  });

  it.each([null, "a string", 42, ["an", "array"]])("rejects %s as a body", (body) => {
    expect(validateTicketCreate(body).fieldErrors).toBeDefined();
  });

  it("treats two payloads as the same only when every field matches after trimming", () => {
    const a = validateTicketCreate(valid).value!;
    const b = validateTicketCreate({ ...valid, summary: `  ${valid.summary}  ` }).value!;
    const c = validateTicketCreate({ ...valid, requestedPriority: "LOW" }).value!;

    expect(isSameTicket(a, b)).toBe(true);
    expect(isSameTicket(a, c)).toBe(false);
  });
});
