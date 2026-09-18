import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  CONFIRMED_TRANSITIONS,
  INDICATION_ALLOWED_FROM,
  OWNER_REQUIRED_TO_ENTER,
  REASON_MAX,
  REASON_MIN,
  SUMMARY_MAX,
  SUMMARY_MIN,
  TERMINAL_STATUSES,
  evidenceLimits,
  evidenceRequiredFor,
  indicationAllowedFrom,
  isTerminal,
  nextStatuses,
  ownerRequiredToEnter,
} from "../../src/ticket-rules.js";
import { TICKET_STATUSES, type TicketStatus } from "../../src/components/index.js";

// UNIT — the client's copy of the lifecycle rules (docs/lab-03/tests.md UI-05).
//
// The client needs BR-29 because the Change status control must offer only the
// statuses the rule allows. That makes it the *second* copy of a rule whose
// authority is the server, and a second copy is only safe if something fails
// when the two disagree.
//
// So this file transcribes BR-29 a third time, by hand, from
// docs/lab-03/specification.md — not derived from the table under test, because
// a table that checks itself proves only that it equals itself. It is the same
// standard demanded of Earth2509's 8x8 matrix test on his PR #47, turned inward.

const BR_29: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["OPEN", "IN_PROGRESS", "CANCELLED"],
  OPEN: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  IN_PROGRESS: ["WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  WAITING_FOR_REQUESTER: ["IN_PROGRESS", "RESOLVED", "CANCELLED"],
  RESOLVED: ["CLOSED", "REOPENED"],
  REOPENED: ["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CANCELLED"],
  CLOSED: [],
  CANCELLED: [],
};

describe("BR-29 — the status transition matrix the interface offers", () => {
  it("matches the specification, transition for transition", () => {
    expect(ALLOWED_TRANSITIONS).toEqual(BR_29);
  });

  it("covers all eight statuses and no invented ones", () => {
    expect(Object.keys(ALLOWED_TRANSITIONS).sort()).toEqual([...TICKET_STATUSES].sort());
  });

  it("never offers a status to itself", () => {
    // Called out in BR-29 because it is the one pair a reader assumes is free.
    for (const status of TICKET_STATUSES) {
      expect(nextStatuses(status)).not.toContain(status);
    }
  });

  it("offers nothing at all from a terminal status", () => {
    expect(nextStatuses("CLOSED")).toEqual([]);
    expect(nextStatuses("CANCELLED")).toEqual([]);
  });

  it("sweeps all 64 pairs, so a wrongly added transition fails here too", () => {
    const allowed = new Set<string>();
    for (const from of TICKET_STATUSES) {
      for (const to of BR_29[from]) allowed.add(`${from}->${to}`);
    }

    for (const from of TICKET_STATUSES) {
      for (const to of TICKET_STATUSES) {
        expect(nextStatuses(from).includes(to)).toBe(allowed.has(`${from}->${to}`));
      }
    }
  });
});

describe("BR-27, BR-28, BR-31 and BR-32 — the rules the panel reads", () => {
  it("freezes exactly the two terminal statuses (BR-27)", () => {
    expect(TERMINAL_STATUSES).toEqual(["CLOSED", "CANCELLED"]);
    expect(isTerminal("CLOSED")).toBe(true);
    expect(isTerminal("CANCELLED")).toBe(true);
    expect(isTerminal("RESOLVED")).toBe(false);
    // Resolved is not terminal, and treating it as one would quietly remove
    // Reopen and Close — the two things left to do with a resolved ticket.
    expect(nextStatuses("RESOLVED")).toEqual(["CLOSED", "REOPENED"]);
  });

  it("requires an owner to enter exactly three statuses (BR-28)", () => {
    expect(OWNER_REQUIRED_TO_ENTER).toEqual(["IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED"]);
    expect(ownerRequiredToEnter("IN_PROGRESS")).toBe(true);
    expect(ownerRequiredToEnter("CANCELLED")).toBe(false);
  });

  it("confirms exactly the four transitions BR-31 names", () => {
    expect(CONFIRMED_TRANSITIONS).toEqual(["RESOLVED", "CLOSED", "CANCELLED", "REOPENED"]);
  });

  it("asks for a summary entering Resolved and a reason entering Cancelled or Reopened (BR-30)", () => {
    expect(evidenceRequiredFor("RESOLVED")).toBe("resolutionSummary");
    expect(evidenceRequiredFor("CANCELLED")).toBe("reason");
    expect(evidenceRequiredFor("REOPENED")).toBe("reason");
    expect(evidenceRequiredFor("IN_PROGRESS")).toBeNull();
    expect(evidenceRequiredFor("CLOSED")).toBeNull();
  });

  it("carries BR-30's limits, which are not the attachment reason's", () => {
    // 10-2000 and 5-500 here; the removal reason on Ticket Detail is BR-38's
    // 5-250. Two rules that would merge silently if they shared a constant.
    expect(evidenceLimits("resolutionSummary")).toEqual({ min: SUMMARY_MIN, max: SUMMARY_MAX });
    expect(evidenceLimits("reason")).toEqual({ min: REASON_MIN, max: REASON_MAX });
    expect([SUMMARY_MIN, SUMMARY_MAX, REASON_MIN, REASON_MAX]).toEqual([10, 2000, 5, 500]);
  });

  it("allows the Requester's indication from five statuses, and not from Resolved (BR-32)", () => {
    expect(INDICATION_ALLOWED_FROM).toEqual([
      "NEW",
      "OPEN",
      "IN_PROGRESS",
      "WAITING_FOR_REQUESTER",
      "REOPENED",
    ]);
    // Resolved is the interesting refusal: it is not terminal, so a rule written
    // as "anything but closed" would wrongly allow it.
    expect(indicationAllowedFrom("RESOLVED")).toBe(false);
    expect(indicationAllowedFrom("CLOSED")).toBe(false);
    expect(indicationAllowedFrom("CANCELLED")).toBe(false);
    expect(indicationAllowedFrom("WAITING_FOR_REQUESTER")).toBe(true);
  });
});
