import { describe, expect, it } from "vitest";
import {
  actionWriteRefusal,
  isFinal,
  parseCancel,
  parseComplete,
  parseCreate,
  parseEdit,
  requestFingerprint,
  type CreateInput,
  type StoredAction,
} from "../../src/action-rules.js";

// UNIT-01 in docs/lab-04/tests.md (AC-03, AC-05).
//
// The limits below are transcribed by hand from specification.md BR-03 to
// BR-12, not imported from action-rules.ts. A test that reads the same
// constants as the code cannot notice them drifting from the contract.

const NOW = new Date("2026-09-27T10:00:00.000Z");
const TICKET = { createdAt: new Date("2026-09-20T09:00:00.000Z") };
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const iso = (ms: number) => new Date(ms).toISOString();
const text = (n: number) => "x".repeat(n);

function create(overrides: Record<string, unknown> = {}) {
  return parseCreate(
    {
      status: "COMPLETED",
      actionAt: iso(NOW.getTime() - 60 * MINUTE),
      description: "Reset the Wi-Fi profile on the laptop.",
      result: "Connected at full signal.",
      followUpRequired: false,
      followUpNote: null,
      attachmentNotes: null,
      assigneeId: 7,
      ...overrides,
    },
    TICKET,
    NOW,
  );
}

const validOpen = () => ({
  status: "OPEN",
  description: "Replace the access point.",
  followUpRequired: false,
  assigneeId: 7,
});

function errors(parsed: { kind: string; fieldErrors?: Record<string, string> }): string[] {
  return parsed.kind === "invalid" ? Object.keys(parsed.fieldErrors!).sort() : [];
}

describe("creating an Action (BR-03, BR-04, BR-07, BR-09, BR-10)", () => {
  it("accepts a valid completed and a valid open Action, trimming text", () => {
    const done = create({ description: "  Reset the profile.  " });
    expect(done.kind).toBe("ok");
    if (done.kind === "ok") expect(done.value.description).toBe("Reset the profile.");
    expect(create({ status: "OPEN", result: null, actionAt: iso(NOW.getTime() + 2 * DAY) }).kind).toBe("ok");
  });

  it("allows OPEN and COMPLETED only: nothing is created cancelled", () => {
    expect(errors(create({ status: "CANCELLED" }))).toEqual(["status"]);
    expect(errors(create({ status: "DONE" }))).toEqual(["status"]);
    expect(errors(create({ status: undefined }))).toEqual(["status"]);
  });

  it("holds the description to 5–2000 characters after trimming", () => {
    expect(create({ description: text(5) }).kind).toBe("ok");
    expect(create({ description: text(2000) }).kind).toBe("ok");
    expect(errors(create({ description: text(4) }))).toEqual(["description"]);
    expect(errors(create({ description: `  ${text(4)}  ` }))).toEqual(["description"]);
    expect(errors(create({ description: text(2001) }))).toEqual(["description"]);
  });

  it("requires a 5–2000 character result to complete, and allows up to 2000 or none while open", () => {
    expect(errors(create({ result: null }))).toEqual(["result"]);
    expect(errors(create({ result: text(4) }))).toEqual(["result"]);
    expect(create({ result: text(5) }).kind).toBe("ok");
    expect(errors(create({ result: text(2001) }))).toEqual(["result"]);
    expect(create({ status: "OPEN", result: null }).kind).toBe("ok");
    expect(create({ status: "OPEN", result: "Half" }).kind).toBe("ok");
    expect(errors(create({ status: "OPEN", result: text(2001) }))).toEqual(["result"]);
  });

  it("requires a follow-up note of 5–1000 characters when follow-up is required, and refuses one when it is not", () => {
    expect(errors(create({ followUpRequired: true, followUpNote: null }))).toEqual(["followUpNote"]);
    expect(errors(create({ followUpRequired: true, followUpNote: text(4) }))).toEqual(["followUpNote"]);
    expect(create({ followUpRequired: true, followUpNote: text(5) }).kind).toBe("ok");
    expect(create({ followUpRequired: true, followUpNote: text(1000) }).kind).toBe("ok");
    expect(errors(create({ followUpRequired: true, followUpNote: text(1001) }))).toEqual(["followUpNote"]);
    // BR-09: refused, never silently dropped.
    expect(errors(create({ followUpRequired: false, followUpNote: "Check again next week." }))).toEqual(["followUpNote"]);
    expect(create({ followUpRequired: false, followUpNote: "   " }).kind).toBe("ok");
    expect(errors(create({ followUpRequired: "no" }))).toEqual(["followUpRequired"]);
  });

  it("allows attachment notes up to 500 characters", () => {
    expect(create({ attachmentNotes: text(500) }).kind).toBe("ok");
    expect(errors(create({ attachmentNotes: text(501) }))).toEqual(["attachmentNotes"]);
  });

  it("bounds the Action Date/Time by the Ticket's creation, the clock and the planning horizon", () => {
    // Not before the Ticket existed.
    expect(errors(create({ actionAt: iso(TICKET.createdAt.getTime() - 1) }))).toEqual(["actionAt"]);
    expect(create({ actionAt: iso(TICKET.createdAt.getTime()) }).kind).toBe("ok");
    // Completed work: at most five minutes past now.
    expect(create({ actionAt: iso(NOW.getTime() + 5 * MINUTE) }).kind).toBe("ok");
    expect(errors(create({ actionAt: iso(NOW.getTime() + 5 * MINUTE + 1) }))).toEqual(["actionAt"]);
    // Planned work: at most 365 days ahead.
    expect(create({ status: "OPEN", result: null, actionAt: iso(NOW.getTime() + 365 * DAY) }).kind).toBe("ok");
    expect(errors(create({ status: "OPEN", result: null, actionAt: iso(NOW.getTime() + 365 * DAY + 1) }))).toEqual(["actionAt"]);
    // An instant needs a time zone; a bare local time is ambiguous.
    expect(errors(create({ actionAt: "2026-09-27T09:00:00" }))).toEqual(["actionAt"]);
    expect(create({ actionAt: "2026-09-27T16:00:00+07:00" }).kind).toBe("ok");
    expect(errors(create({ actionAt: "yesterday" }))).toEqual(["actionAt"]);
  });

  it("refuses impossible calendar dates instead of normalising them (Earth2509's review of PR #94)", () => {
    // Each of these parses under new Date() as a DIFFERENT, real instant.
    for (const impossible of [
      "2027-02-31T12:00:00Z", // 3 March
      "2027-02-29T12:00:00Z", // 2027 is not a leap year
      "2026-11-31T12:00:00Z", // November has 30 days
      "2026-12-00T12:00:00Z",
      "2026-13-01T12:00:00Z",
      "2026-12-01T24:00:00Z", // the next day
      "2026-12-01T12:60:00Z",
      "2026-12-01T12:00:60Z",
      "2026-12-01T12:00:00+25:00",
      "2026-12-01T12:00:00+14:01",
      "2026-12-01T12:00:00+05:60",
    ]) {
      expect(errors(create({ status: "OPEN", result: null, actionAt: impossible })), impossible).toEqual(["actionAt"]);
    }
    // The real ones on either side of each boundary are accepted, at exactly the instant written.
    const leapNow = new Date("2028-02-20T00:00:00Z");
    const leapTicket = { createdAt: new Date("2028-01-01T00:00:00Z") };
    const leap = parseCreate({ ...validOpen(), actionAt: "2028-02-29T23:59:59.999Z" }, leapTicket, leapNow);
    expect(leap.kind).toBe("ok");
    if (leap.kind === "ok") expect(leap.value.actionAt.toISOString()).toBe("2028-02-29T23:59:59.999Z");
    for (const [written, instant] of [
      ["2026-11-30T12:00:00Z", "2026-11-30T12:00:00.000Z"],
      ["2026-12-31T23:59:59Z", "2026-12-31T23:59:59.000Z"],
      ["2026-12-01T12:00:00+14:00", "2026-11-30T22:00:00.000Z"],
      ["2026-12-01T12:00:00-12:00", "2026-12-02T00:00:00.000Z"],
      ["2026-12-01T12:00:00.5Z", "2026-12-01T12:00:00.500Z"],
    ] as const) {
      const ok = create({ status: "OPEN", result: null, actionAt: written });
      expect(ok.kind, written).toBe("ok");
      if (ok.kind === "ok") expect(ok.value.actionAt.toISOString(), written).toBe(instant);
    }
  });

  it("names every failing field at once, not only the first", () => {
    expect(errors(create({ description: "", result: null, assigneeId: "seven", followUpRequired: true }))).toEqual(
      ["assigneeId", "description", "followUpNote", "result"],
    );
  });
});

describe("editing an open Action (BR-08, BR-09, BR-17)", () => {
  const stored: StoredAction = { actionAt: new Date(NOW.getTime() - DAY), followUpRequired: true, followUpNote: "Check the router.", assigneeId: 7 };
  const edit = (body: Record<string, unknown>, s: StoredAction = stored) => parseEdit({ version: 3, ...body }, s, TICKET, NOW);

  it("needs a version and at least one field", () => {
    expect(errors(parseEdit({ description: "Changed the plan." }, stored, TICKET, NOW))).toEqual(["version"]);
    expect(errors(edit({}))).toEqual(["body"]);
  });

  it("checks the follow-up pair on the final state", () => {
    // Clearing the flag while a note is stored must clear the note too.
    expect(errors(edit({ followUpRequired: false }))).toEqual(["followUpNote"]);
    expect(edit({ followUpRequired: false, followUpNote: null }).kind).toBe("ok");
    // A note alone is fine while the stored flag is on.
    expect(edit({ followUpNote: "Check the switch instead." }).kind).toBe("ok");
  });

  it("requires an assignee in the first edit after a deactivation cleared one, and not otherwise", () => {
    const orphan = { ...stored, assigneeId: null };
    expect(errors(edit({ description: "Still to do." }, orphan))).toEqual(["assigneeId"]);
    expect(edit({ description: "Still to do.", assigneeId: 8 }, orphan).kind).toBe("ok");
    expect(edit({ description: "Still to do." }).kind).toBe("ok");
  });

  it("reads each field with the open-Action rules", () => {
    expect(edit({ result: null }).kind).toBe("ok");
    expect(edit({ actionAt: iso(NOW.getTime() + 30 * DAY) }).kind).toBe("ok");
    expect(errors(edit({ description: "tiny" }))).toEqual(["description"]);
  });
});

describe("completing and cancelling (BR-04, BR-05, BR-07)", () => {
  const stored: StoredAction = { actionAt: new Date(NOW.getTime() - DAY), followUpRequired: false, followUpNote: null, assigneeId: 7 };

  it("requires a result to complete", () => {
    expect(parseComplete({ version: 1, result: "Replaced the access point." }, stored, TICKET, NOW).kind).toBe("ok");
    expect(errors(parseComplete({ version: 1 }, stored, TICKET, NOW))).toEqual(["result"]);
  });

  it("will not complete planned work still dated in the future unless given a real date", () => {
    const planned = { ...stored, actionAt: new Date(NOW.getTime() + 2 * DAY) };
    expect(errors(parseComplete({ version: 1, result: "Done early." }, planned, TICKET, NOW))).toEqual(["actionAt"]);
    expect(parseComplete({ version: 1, result: "Done early.", actionAt: iso(NOW.getTime() - MINUTE) }, planned, TICKET, NOW).kind).toBe("ok");
  });

  it("checks follow-up on the completed state", () => {
    expect(errors(parseComplete({ version: 1, result: "Mostly done.", followUpRequired: true }, stored, TICKET, NOW))).toEqual(["followUpNote"]);
    expect(parseComplete({ version: 1, result: "Mostly done.", followUpRequired: true, followUpNote: "Recheck Friday." }, stored, TICKET, NOW).kind).toBe("ok");
  });

  it("requires a 5–500 character reason to cancel", () => {
    expect(parseCancel({ version: 1, reason: text(5) }).kind).toBe("ok");
    expect(parseCancel({ version: 1, reason: text(500) }).kind).toBe("ok");
    expect(errors(parseCancel({ version: 1, reason: text(4) }))).toEqual(["reason"]);
    expect(errors(parseCancel({ version: 1, reason: text(501) }))).toEqual(["reason"]);
    expect(errors(parseCancel({ reason: "Duplicate of another action." }))).toEqual(["version"]);
  });
});

describe("state (BR-08, BR-12)", () => {
  it("allows Action writes exactly while the Ticket is active", () => {
    // Transcribed from BR-12.
    const expected = {
      NEW: null,
      OPEN: null,
      IN_PROGRESS: null,
      WAITING_FOR_REQUESTER: null,
      REOPENED: null,
      RESOLVED: "ACTION_NOT_ALLOWED",
      CLOSED: "TICKET_TERMINAL",
      CANCELLED: "TICKET_TERMINAL",
    } as const;
    for (const [status, refusal] of Object.entries(expected)) {
      expect(actionWriteRefusal(status as keyof typeof expected), status).toBe(refusal);
    }
  });

  it("treats exactly COMPLETED and CANCELLED as final", () => {
    expect(isFinal("OPEN")).toBe(false);
    expect(isFinal("COMPLETED")).toBe(true);
    expect(isFinal("CANCELLED")).toBe(true);
  });
});

describe("the replay fingerprint (BR-15)", () => {
  const input: CreateInput = {
    status: "OPEN",
    actionAt: new Date("2026-09-27T09:00:00.000Z"),
    description: "Replace the access point.",
    result: null,
    followUpRequired: false,
    followUpNote: null,
    attachmentNotes: null,
    assigneeId: 7,
  };

  it("is identical for an identical request, however the instant was written", () => {
    const again = parseCreate(
      { status: "OPEN", actionAt: "2026-09-27T16:00:00+07:00", description: " Replace the access point. ", followUpRequired: false, assigneeId: 7 },
      TICKET,
      NOW,
    );
    expect(again.kind).toBe("ok");
    if (again.kind === "ok") expect(requestFingerprint(42, 5, again.value)).toBe(requestFingerprint(42, 5, input));
  });

  it("changes with the Ticket, the caller, or any field", () => {
    const base = requestFingerprint(42, 5, input);
    expect(requestFingerprint(43, 5, input)).not.toBe(base);
    expect(requestFingerprint(42, 6, input)).not.toBe(base);
    for (const change of [
      { description: "Replace the access point now." },
      { assigneeId: 8 },
      { actionAt: new Date("2026-09-27T09:00:01.000Z") },
      { attachmentNotes: "photo.png" },
      { result: "Partly done." },
    ]) {
      expect(requestFingerprint(42, 5, { ...input, ...change })).not.toBe(base);
    }
  });
});
