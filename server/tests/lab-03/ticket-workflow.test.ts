import { describe, expect, it } from "vitest";
import type { TicketStatus } from "@prisma/client";
import {
  ALLOWED_TRANSITIONS,
  OWNER_REQUIRED_TO_ENTER,
  REASON_MAX,
  REASON_MIN,
  SUMMARY_MAX,
  SUMMARY_MIN,
  TERMINAL_STATUSES,
  TICKET_STATUSES,
  decideStatusChange,
  evidenceRequiredFor,
} from "../../src/ticket-workflow.js";

// UNIT-03 — AC-16 (docs/lab-03/tests.md).
//
// The expected matrix below is transcribed from specification.md BR-29 by hand
// and deliberately NOT derived from ALLOWED_TRANSITIONS. Looping the
// implementation's own table and asserting it agrees with itself proves only
// that the loop works: it passes unchanged if a row is wrong, because both sides
// read the same source. I raised exactly that on my peer's 8x8 test
// (Earth2509 PR #47), so this file carries the contract independently and the
// first test below is what makes the two disagree out loud.

/** specification.md §BR-29, copied row by row. */
const CONTRACT: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

/** Evidence that satisfies BR-30, so a transition test fails on the transition. */
function evidenceFor(to: TicketStatus) {
  return {
    resolutionSummary: "The access point was replaced and the connection verified.",
    reason: "The Requester confirmed the problem has returned.",
  };
}

describe("the transition matrix agrees with the contract", () => {
  it("has the same rows as BR-29, transcribed independently", () => {
    // If someone edits ALLOWED_TRANSITIONS without changing the contract, this
    // is the test that notices — the one assertion the parameterised sweep
    // below cannot make, because that sweep would move with the edit.
    expect(ALLOWED_TRANSITIONS).toEqual(CONTRACT);
  });

  it("treats exactly CLOSED and CANCELLED as terminal (BR-27)", () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(["CANCELLED", "CLOSED"]);
    for (const status of TERMINAL_STATUSES) expect(CONTRACT[status]).toEqual([]);
  });

  it("requires an owner to enter exactly three statuses (BR-28)", () => {
    expect([...OWNER_REQUIRED_TO_ENTER].sort()).toEqual(["IN_PROGRESS", "RESOLVED", "WAITING_FOR_REQUESTER"]);
  });
});

describe("every one of the 64 pairs is decided", () => {
  const pairs = TICKET_STATUSES.flatMap((from) => TICKET_STATUSES.map((to) => [from, to] as const));

  it.each(pairs)("%s -> %s", (from, to) => {
    const decision = decideStatusChange({ from, to, ownerId: 7, ...evidenceFor(to) });

    if (TERMINAL_STATUSES.includes(from)) {
      // BR-27 outranks the matrix: a finished ticket says so, rather than
      // reporting the pair as unsupported.
      expect(decision).toMatchObject({ kind: "conflict", code: "TICKET_TERMINAL" });
      return;
    }

    if (CONTRACT[from].includes(to)) {
      expect(decision.kind, `${from} -> ${to} should be allowed`).toBe("ok");
    } else {
      expect(decision, `${from} -> ${to} should be refused`).toMatchObject({
        kind: "conflict",
        code: "INVALID_STATUS_TRANSITION",
      });
    }
  });

  it("refuses a status to itself, which is what 'including a status to itself' means", () => {
    for (const status of TICKET_STATUSES) {
      const decision = decideStatusChange({ from: status, to: status, ownerId: 7, ...evidenceFor(status) });
      expect(decision.kind, `${status} -> ${status}`).toBe("conflict");
    }
  });
});

describe("the owner condition is on the transition, not the status (BR-28)", () => {
  it.each(["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED"] as const)(
    "refuses entering %s with no owner",
    (to) => {
      expect(decideStatusChange({ from: "OPEN", to, ownerId: null, ...evidenceFor(to) })).toMatchObject({
        kind: "conflict",
        code: "OWNER_REQUIRED",
      });
    },
  );

  it("allows entering OPEN and CANCELLED with no owner", () => {
    expect(decideStatusChange({ from: "NEW", to: "OPEN", ownerId: null }).kind).toBe("ok");
    expect(decideStatusChange({ from: "NEW", to: "CANCELLED", ownerId: null, ...evidenceFor("CANCELLED") }).kind).toBe("ok");
  });
});

describe("the evidence BR-30 requires", () => {
  it("names which field each status needs", () => {
    expect(evidenceRequiredFor("RESOLVED")).toBe("resolutionSummary");
    expect(evidenceRequiredFor("CANCELLED")).toBe("reason");
    expect(evidenceRequiredFor("REOPENED")).toBe("reason");
    expect(evidenceRequiredFor("OPEN")).toBeNull();
  });

  it.each([
    ["RESOLVED", "resolutionSummary", SUMMARY_MIN, SUMMARY_MAX],
    ["CANCELLED", "reason", REASON_MIN, REASON_MAX],
  ] as const)("holds %s to %s of %i to %i characters", (to, field, min, max) => {
    const at = (length: number) => decideStatusChange({ from: "OPEN", to, ownerId: 7, [field]: "x".repeat(length) });

    expect(at(min - 1), `${min - 1} should be refused`).toMatchObject({ kind: "validation" });
    expect(at(min).kind, `${min} should be accepted`).toBe("ok");
    expect(at(max).kind, `${max} should be accepted`).toBe("ok");
    expect(at(max + 1), `${max + 1} should be refused`).toMatchObject({ kind: "validation" });
  });

  it("trims before measuring, and refuses whitespace dressed up as a reason", () => {
    const padded = decideStatusChange({ from: "OPEN", to: "CANCELLED", ownerId: 7, reason: `   ${"x".repeat(REASON_MIN)}   ` });
    expect(padded).toMatchObject({ kind: "ok", evidence: "x".repeat(REASON_MIN) });

    expect(decideStatusChange({ from: "OPEN", to: "CANCELLED", ownerId: 7, reason: " ".repeat(50) })).toMatchObject({
      kind: "validation",
    });
  });

  it("names the field it is missing, so the message can land on the control", () => {
    const decision = decideStatusChange({ from: "OPEN", to: "RESOLVED", ownerId: 7 });
    expect(decision).toMatchObject({ kind: "validation" });
    expect((decision as { fieldErrors: Record<string, string> }).fieldErrors).toHaveProperty("resolutionSummary");
  });
});

describe("input validity is decided before state (api-spec.md §1)", () => {
  it("reports an unknown target status as a field error, not as a transition conflict", () => {
    const decision = decideStatusChange({ from: "OPEN", to: "FINISHED", ownerId: 7 });

    expect(decision).toMatchObject({ kind: "validation" });
    expect((decision as { fieldErrors: Record<string, string> }).fieldErrors).toHaveProperty("toStatus");
  });

  it("answers a missing summary before a terminal refusal, because step 6 precedes step 7", () => {
    // Worth pinning: it reads oddly, it is what the contracted order says, and
    // deciding it per-endpoint instead would be worse.
    expect(decideStatusChange({ from: "CLOSED", to: "RESOLVED", ownerId: 7 })).toMatchObject({ kind: "validation" });
    expect(
      decideStatusChange({ from: "CLOSED", to: "RESOLVED", ownerId: 7, ...evidenceFor("RESOLVED") }),
    ).toMatchObject({ kind: "conflict", code: "TICKET_TERMINAL" });
  });
});
