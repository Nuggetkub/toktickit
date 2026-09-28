import { createHash } from "node:crypto";
import type { ActionStatus, TicketStatus } from "@prisma/client";
import { isTerminal } from "./ticket-workflow.js";

// The rules for Actions Taken (docs/lab-04/specification.md BR-03 to BR-15),
// kept apart from the route for the same reason as ticket-workflow.ts and
// discussion.ts: the policy can be decided, and tested, without a database.
//
// Every parser reports EVERY failing field, not only the first. A validator that
// returns at the first error is how a second bad parameter hid behind the first
// in my peer's Lab 3 queue, and it makes a form show one message at a time.

export const DESCRIPTION_MIN = 5;
export const DESCRIPTION_MAX = 2000;
export const RESULT_MIN = 5; // to complete
export const RESULT_MAX = 2000;
export const FOLLOW_UP_NOTE_MIN = 5;
export const FOLLOW_UP_NOTE_MAX = 1000;
export const ATTACHMENT_NOTES_MAX = 500;
export const REASON_MIN = 5;
export const REASON_MAX = 500;
/** BR-07: a completed Action may be dated this far past the server's clock. */
export const CLOCK_SKEW_MS = 5 * 60 * 1000;
/** BR-07: an open Action may be planned this far ahead. */
export const PLANNING_HORIZON_MS = 365 * 24 * 60 * 60 * 1000;

type FieldErrors = Record<string, string>;
export type Parsed<T> = { kind: "ok"; value: T } | { kind: "invalid"; fieldErrors: FieldErrors };

/** The Ticket facts the rules need: when it began, for BR-07. */
export type TicketContext = { createdAt: Date };

export type CreateInput = {
  status: "OPEN" | "COMPLETED";
  actionAt: Date;
  description: string;
  result: string | null;
  followUpRequired: boolean;
  followUpNote: string | null;
  attachmentNotes: string | null;
  assigneeId: number;
};

/** The editable part of an open Action (BR-08); every key optional. */
export type EditInput = Partial<Omit<CreateInput, "status">> & { version: number };

export type CompleteInput = {
  version: number;
  result: string;
  followUpRequired?: boolean;
  followUpNote?: string | null;
  actionAt?: Date;
};

export type CancelInput = { version: number; reason: string };

/** The stored facts an edit or a completion is checked against. */
export type StoredAction = {
  actionAt: Date;
  followUpRequired: boolean;
  followUpNote: string | null;
  assigneeId: number | null;
};

// --- field readers -----------------------------------------------------------

const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(?:Z|([+-])(\d{2}):(\d{2}))$/;

/**
 * An ISO 8601 instant with a time zone, checked component by component.
 *
 * `new Date()` alone is not a validator: it silently normalises impossible
 * values, so `2027-02-31T12:00:00Z` becomes 3 March and `T24:00` becomes the
 * next day. A planned Action would then be saved at a time nobody entered.
 * Earth2509 found this in review of PR #94. Every part is checked against the
 * calendar first, including the day count of the month in that year, so a leap
 * day is accepted only in a leap year.
 */
function readInstant(raw: unknown): Date | undefined {
  if (typeof raw !== "string") return undefined;
  const m = ISO_WITH_OFFSET.exec(raw);
  if (!m) return undefined;
  const [year, month, day, hour, minute] = [m[1], m[2], m[3], m[4], m[5]].map(Number);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  const millis = m[7] === undefined ? 0 : Number(m[7].padEnd(3, "0"));
  const offsetSign = m[8] === "-" ? -1 : 1;
  const offsetHours = m[9] === undefined ? 0 : Number(m[9]);
  const offsetMinutes = m[10] === undefined ? 0 : Number(m[10]);

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return undefined;
  if (hour > 23 || minute > 59 || second > 59) return undefined;
  // Real offsets run from -12:00 to +14:00; anything outside is a typing error.
  if (offsetMinutes > 59 || offsetHours * 60 + offsetMinutes > 14 * 60) return undefined;

  const utc = Date.UTC(year, month - 1, day, hour, minute, second, millis);
  return new Date(utc - offsetSign * (offsetHours * 60 + offsetMinutes) * 60_000);
}

/** Trimmed text within bounds, or undefined when invalid. */
function readText(raw: unknown, min: number, max: number): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed.length >= min && trimmed.length <= max ? trimmed : undefined;
}

/**
 * Optional text: absent, null or blank becomes null; otherwise trimmed and
 * limited. Returns undefined only when the value is present and invalid.
 */
function readOptionalText(raw: unknown, max: number): string | null | undefined {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length <= max ? trimmed : undefined;
}

function readId(raw: unknown): number | undefined {
  return typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
}

function readVersion(raw: unknown, fieldErrors: FieldErrors): number {
  const version = readId(raw);
  if (version === undefined) fieldErrors.version = "Send the version of the Action you last read.";
  return version ?? 0;
}

// --- rules that span fields ----------------------------------------------------

/** BR-07 for the status the Action will have. */
function checkActionAt(actionAt: Date, status: ActionStatus, ticket: TicketContext, now: Date, fieldErrors: FieldErrors): void {
  // The same clock-skew allowance as for the future: the Ticket's createdAt is
  // the database's clock, the Action's date the client's, and they differ. Here
  // the database ran about 144 ms ahead of this machine, which made an Action
  // dated "now" on a new Ticket look older than the Ticket.
  if (actionAt.getTime() < ticket.createdAt.getTime() - CLOCK_SKEW_MS) {
    fieldErrors.actionAt = "The action cannot be dated before the ticket was created.";
  } else if (status === "COMPLETED" && actionAt.getTime() > now.getTime() + CLOCK_SKEW_MS) {
    fieldErrors.actionAt = "Completed work cannot be dated in the future.";
  } else if (status === "OPEN" && actionAt.getTime() > now.getTime() + PLANNING_HORIZON_MS) {
    fieldErrors.actionAt = "Planned work can be dated at most a year ahead.";
  }
}

/**
 * BR-09 on the Action's final state: a follow-up needs a note, and no follow-up
 * means no note. A note sent without the flag is refused rather than silently
 * dropped.
 */
function checkFollowUp(required: boolean, note: string | null, fieldErrors: FieldErrors): void {
  if (required && note === null) {
    fieldErrors.followUpNote = `Say what follow-up is needed, in ${FOLLOW_UP_NOTE_MIN} to ${FOLLOW_UP_NOTE_MAX} characters.`;
  } else if (!required && note !== null) {
    fieldErrors.followUpNote = "Remove the follow-up note, or mark follow-up as required.";
  }
}

function readFollowUpNote(raw: unknown, fieldErrors: FieldErrors): string | null {
  const note = readOptionalText(raw, FOLLOW_UP_NOTE_MAX);
  if (note === undefined || (note !== null && note.length < FOLLOW_UP_NOTE_MIN)) {
    fieldErrors.followUpNote = `Say what follow-up is needed, in ${FOLLOW_UP_NOTE_MIN} to ${FOLLOW_UP_NOTE_MAX} characters.`;
    return null;
  }
  return note;
}

function record(body: unknown): Record<string, unknown> {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

// --- parsers --------------------------------------------------------------------

/** POST /api/tickets/:ticketId/actions (BR-03, BR-04, BR-06 syntax, BR-07, BR-09, BR-10). */
export function parseCreate(body: unknown, ticket: TicketContext, now: Date): Parsed<CreateInput> {
  const raw = record(body);
  const fieldErrors: FieldErrors = {};

  const status = raw.status === "OPEN" || raw.status === "COMPLETED" ? raw.status : undefined;
  if (!status) {
    fieldErrors.status =
      raw.status === "CANCELLED"
        ? "An Action cannot be created cancelled."
        : "Choose OPEN to plan the work or COMPLETED to record work already done.";
  }

  const actionAt = readInstant(raw.actionAt);
  if (!actionAt) fieldErrors.actionAt = "Give the date and time as an ISO 8601 instant with a time zone.";
  else if (status) checkActionAt(actionAt, status, ticket, now, fieldErrors);

  const description = readText(raw.description, DESCRIPTION_MIN, DESCRIPTION_MAX);
  if (!description) fieldErrors.description = `Describe the action in ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters.`;

  let result: string | null = null;
  if (status === "COMPLETED") {
    const read = readText(raw.result, RESULT_MIN, RESULT_MAX);
    if (!read) fieldErrors.result = `Record the result in ${RESULT_MIN} to ${RESULT_MAX} characters.`;
    result = read ?? null;
  } else {
    const read = readOptionalText(raw.result, RESULT_MAX);
    if (read === undefined) fieldErrors.result = `The result can be at most ${RESULT_MAX} characters.`;
    result = read ?? null;
  }

  const followUpRequired = typeof raw.followUpRequired === "boolean" ? raw.followUpRequired : undefined;
  if (followUpRequired === undefined) fieldErrors.followUpRequired = "Say whether follow-up is required.";
  const followUpNote = readFollowUpNote(raw.followUpNote, fieldErrors);
  if (followUpRequired !== undefined && !fieldErrors.followUpNote) checkFollowUp(followUpRequired, followUpNote, fieldErrors);

  const attachmentNotes = readOptionalText(raw.attachmentNotes, ATTACHMENT_NOTES_MAX);
  if (attachmentNotes === undefined) fieldErrors.attachmentNotes = `Attachment notes can be at most ${ATTACHMENT_NOTES_MAX} characters.`;

  const assigneeId = readId(raw.assigneeId);
  if (assigneeId === undefined) fieldErrors.assigneeId = "Choose who is responsible for this action.";

  if (Object.keys(fieldErrors).length > 0) return { kind: "invalid", fieldErrors };
  return {
    kind: "ok",
    value: {
      status: status!,
      actionAt: actionAt!,
      description: description!,
      result,
      followUpRequired: followUpRequired!,
      followUpNote,
      attachmentNotes: attachmentNotes!,
      assigneeId: assigneeId!,
    },
  };
}

const EDITABLE = ["actionAt", "description", "result", "followUpRequired", "followUpNote", "attachmentNotes", "assigneeId"] as const;

/**
 * PATCH on an open Action (BR-08). Each field keeps its create rule, read as
 * for an OPEN Action, and the follow-up pair is checked on the final state, so
 * clearing the flag without clearing the note is refused (BR-09). An Action
 * whose assignee a deactivation cleared must be given one now (BR-17).
 */
export function parseEdit(body: unknown, stored: StoredAction, ticket: TicketContext, now: Date): Parsed<EditInput> {
  const raw = record(body);
  const fieldErrors: FieldErrors = {};
  const version = readVersion(raw.version, fieldErrors);
  const edit: EditInput = { version };

  if (!EDITABLE.some((key) => key in raw)) {
    fieldErrors.body = "Change at least one field of the action.";
  }

  if ("actionAt" in raw) {
    const actionAt = readInstant(raw.actionAt);
    if (!actionAt) fieldErrors.actionAt = "Give the date and time as an ISO 8601 instant with a time zone.";
    else {
      checkActionAt(actionAt, "OPEN", ticket, now, fieldErrors);
      edit.actionAt = actionAt;
    }
  }
  if ("description" in raw) {
    const description = readText(raw.description, DESCRIPTION_MIN, DESCRIPTION_MAX);
    if (!description) fieldErrors.description = `Describe the action in ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters.`;
    else edit.description = description;
  }
  if ("result" in raw) {
    const result = readOptionalText(raw.result, RESULT_MAX);
    if (result === undefined) fieldErrors.result = `The result can be at most ${RESULT_MAX} characters.`;
    else edit.result = result;
  }
  if ("followUpRequired" in raw) {
    if (typeof raw.followUpRequired !== "boolean") fieldErrors.followUpRequired = "Say whether follow-up is required.";
    else edit.followUpRequired = raw.followUpRequired;
  }
  if ("followUpNote" in raw) edit.followUpNote = readFollowUpNote(raw.followUpNote, fieldErrors);
  if ("attachmentNotes" in raw) {
    const notes = readOptionalText(raw.attachmentNotes, ATTACHMENT_NOTES_MAX);
    if (notes === undefined) fieldErrors.attachmentNotes = `Attachment notes can be at most ${ATTACHMENT_NOTES_MAX} characters.`;
    else edit.attachmentNotes = notes;
  }
  if ("assigneeId" in raw) {
    const assigneeId = readId(raw.assigneeId);
    if (assigneeId === undefined) fieldErrors.assigneeId = "Choose who is responsible for this action.";
    else edit.assigneeId = assigneeId;
  } else if (stored.assigneeId === null) {
    fieldErrors.assigneeId = "This action has no assignee. Choose who is responsible for it.";
  }

  if (!fieldErrors.followUpRequired && !fieldErrors.followUpNote) {
    checkFollowUp(edit.followUpRequired ?? stored.followUpRequired, edit.followUpNote !== undefined ? edit.followUpNote : stored.followUpNote, fieldErrors);
  }

  return Object.keys(fieldErrors).length > 0 ? { kind: "invalid", fieldErrors } : { kind: "ok", value: edit };
}

/**
 * POST …/complete (BR-04, BR-05). The result is required. The follow-up fields
 * and the date may be updated with it. A planned Action dated in the future
 * must be given a real date to be completed (BR-07).
 */
export function parseComplete(body: unknown, stored: StoredAction, ticket: TicketContext, now: Date): Parsed<CompleteInput> {
  const raw = record(body);
  const fieldErrors: FieldErrors = {};
  const version = readVersion(raw.version, fieldErrors);

  const result = readText(raw.result, RESULT_MIN, RESULT_MAX);
  if (!result) fieldErrors.result = `Record the result in ${RESULT_MIN} to ${RESULT_MAX} characters.`;

  const input: CompleteInput = { version, result: result ?? "" };
  if ("followUpRequired" in raw) {
    if (typeof raw.followUpRequired !== "boolean") fieldErrors.followUpRequired = "Say whether follow-up is required.";
    else input.followUpRequired = raw.followUpRequired;
  }
  if ("followUpNote" in raw) input.followUpNote = readFollowUpNote(raw.followUpNote, fieldErrors);
  if (!fieldErrors.followUpRequired && !fieldErrors.followUpNote) {
    checkFollowUp(input.followUpRequired ?? stored.followUpRequired, input.followUpNote !== undefined ? input.followUpNote : stored.followUpNote, fieldErrors);
  }

  if ("actionAt" in raw) {
    const actionAt = readInstant(raw.actionAt);
    if (!actionAt) fieldErrors.actionAt = "Give the date and time as an ISO 8601 instant with a time zone.";
    else {
      checkActionAt(actionAt, "COMPLETED", ticket, now, fieldErrors);
      input.actionAt = actionAt;
    }
  } else {
    // The stored date must also be acceptable for a completed Action.
    checkActionAt(stored.actionAt, "COMPLETED", ticket, now, fieldErrors);
    if (fieldErrors.actionAt) fieldErrors.actionAt = "This action is dated in the future. Give the date and time the work was done.";
  }

  return Object.keys(fieldErrors).length > 0 ? { kind: "invalid", fieldErrors } : { kind: "ok", value: input };
}

/** POST …/cancel (BR-04). */
export function parseCancel(body: unknown): Parsed<CancelInput> {
  const raw = record(body);
  const fieldErrors: FieldErrors = {};
  const version = readVersion(raw.version, fieldErrors);
  const reason = readText(raw.reason, REASON_MIN, REASON_MAX);
  if (!reason) fieldErrors.reason = `Give a reason in ${REASON_MIN} to ${REASON_MAX} characters.`;
  return Object.keys(fieldErrors).length > 0 ? { kind: "invalid", fieldErrors } : { kind: "ok", value: { version, reason: reason! } };
}

// --- state --------------------------------------------------------------------

export type ActionWriteRefusal = "TICKET_TERMINAL" | "ACTION_NOT_ALLOWED";

/**
 * BR-12: Actions change only while the Ticket is active. A RESOLVED Ticket is
 * not terminal, and it gets its own code, because the next step differs:
 * reopen it to record more work.
 */
export function actionWriteRefusal(ticketStatus: TicketStatus): ActionWriteRefusal | null {
  if (isTerminal(ticketStatus)) return "TICKET_TERMINAL";
  if (ticketStatus === "RESOLVED") return "ACTION_NOT_ALLOWED";
  return null;
}

/** BR-08: completed and cancelled Actions are final. */
export function isFinal(status: ActionStatus): boolean {
  return status !== "OPEN";
}

// --- replay (BR-15) --------------------------------------------------------------

/**
 * A stable hash of a create request: who sent it, to which Ticket, and the
 * normalised input. A retry is compared with this, not with the row, because an
 * open Action may have been edited since it was created.
 */
export function requestFingerprint(ticketId: number, callerId: number, input: CreateInput): string {
  const canonical = JSON.stringify([
    ticketId,
    callerId,
    input.status,
    input.actionAt.toISOString(),
    input.description,
    input.result,
    input.followUpRequired,
    input.followUpNote,
    input.attachmentNotes,
    input.assigneeId,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}
