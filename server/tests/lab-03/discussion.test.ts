import { describe, expect, it } from "vitest";
import type { TicketStatus } from "@prisma/client";
import {
  CONTENT_MAX,
  CONTENT_MIN,
  INDICATION_ALLOWED_FROM,
  indicationAllowedFrom,
  validateContent,
} from "../../src/discussion.js";

// UNIT-06 — AC-17, AC-19 (docs/lab-03/tests.md).
//
// As in ticket-workflow.test.ts, the expected status list is transcribed from
// specification.md BR-32 by hand and deliberately NOT imported as the source of
// truth for the assertion below: a test that reads the same array the
// implementation reads cannot fail when that array is wrong.

/** specification.md BR-32, copied by hand. */
const CONTRACT_STATUSES: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "REOPENED"];

const ALL_STATUSES: TicketStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "RESOLVED",
  "CLOSED",
  "REOPENED",
  "CANCELLED",
];

describe("content rules (BR-36)", () => {
  it("trims before storing, so the thread keeps what was written and not the padding", () => {
    expect(validateContent("   The projector works now.   ")).toEqual({
      kind: "ok",
      content: "The projector works now.",
    });
  });

  it.each([
    ["one character", "x", true],
    ["exactly the maximum", "x".repeat(CONTENT_MAX), true],
    ["empty", "", false],
    ["one over the maximum", "x".repeat(CONTENT_MAX + 1), false],
    ["whitespace alone", "      ", false],
    ["a newline alone", "\n\n", false],
  ])("%s -> %s", (_label, raw, accepted) => {
    expect(validateContent(raw).kind).toBe(accepted ? "ok" : "invalid");
  });

  it("measures after trimming, not before", () => {
    // 2000 characters of content with padding around it is 2000 characters of
    // content. Measuring first would refuse a comment that is exactly at the
    // limit purely because the user pressed space.
    const padded = `  ${"x".repeat(CONTENT_MAX)}  `;
    expect(padded.length).toBeGreaterThan(CONTENT_MAX);
    expect(validateContent(padded).kind).toBe("ok");
  });

  it.each([[null], [undefined], [42], [{ content: "hello" }], [["hello"]]])(
    "refuses %s, which is not a string at all",
    (raw) => {
      expect(validateContent(raw).kind).toBe("invalid");
    },
  );

  it("names the field, so the message can land on the composer", () => {
    const result = validateContent("");
    expect(result).toMatchObject({ kind: "invalid" });
    expect((result as { fieldErrors: Record<string, string> }).fieldErrors).toHaveProperty("content");
  });

  it("keeps markup as literal text rather than escaping or stripping it", () => {
    // BR-36 renders as plain text; escaping here would store the entities and
    // show them to the next reader. The renderer escapes, not the store.
    const raw = '<b>urgent</b> & <script>alert("x")</script>';
    expect(validateContent(raw)).toEqual({ kind: "ok", content: raw });
  });

  it("preserves line breaks inside the content", () => {
    const raw = "Tried this:\n  - restart\n  - reseat the cable";
    expect(validateContent(raw)).toEqual({ kind: "ok", content: raw });
  });

  it("holds CONTENT_MIN and CONTENT_MAX at the contracted numbers", () => {
    expect([CONTENT_MIN, CONTENT_MAX]).toEqual([1, 2000]);
  });
});

describe("resolution indication eligibility (BR-32)", () => {
  it("allows exactly the statuses BR-32 lists, transcribed independently", () => {
    expect([...INDICATION_ALLOWED_FROM].sort()).toEqual([...CONTRACT_STATUSES].sort());
  });

  it.each(ALL_STATUSES)("%s", (status) => {
    expect(indicationAllowedFrom(status)).toBe(CONTRACT_STATUSES.includes(status));
  });

  it("excludes RESOLVED even though it is not terminal", () => {
    // Worth its own test: RESOLVED can still be reopened, so it is easy to
    // assume it behaves like an open status. BR-32 says otherwise — IT Staff
    // have already said it is fixed, so there is nothing left to indicate.
    expect(indicationAllowedFrom("RESOLVED")).toBe(false);
    expect(indicationAllowedFrom("REOPENED")).toBe(true);
  });
});
