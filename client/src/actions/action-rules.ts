// The Action form's own checks (Lab 4 BR-03, BR-07, BR-09, api-spec §2).
//
// They repeat the server's limits so a reader learns of a problem beside the
// field before anything is sent. The server stays the authority: its
// fieldErrors are shown the same way, beneath the same fields, and a rule only
// it can judge, such as an assignee deactivated a moment ago, still reaches
// the reader that way.

export type ActionDraft = {
  status: "OPEN" | "COMPLETED";
  /** The `datetime-local` value, in the reader's own time zone. */
  actionAt: string;
  description: string;
  result: string;
  followUpRequired: boolean;
  followUpNote: string;
  attachmentNotes: string;
  /** The assignee's id as the select holds it; "" when none is chosen. */
  assigneeId: string;
};

export type DraftErrors = Partial<Record<keyof ActionDraft, string>>;

/** The order fields appear in, so focus goes to the first invalid one. */
export const FIELD_ORDER: Array<keyof ActionDraft> = [
  "status", "actionAt", "description", "result", "assigneeId", "followUpRequired", "followUpNote", "attachmentNotes",
];

const FIVE_MINUTES = 5 * 60 * 1000;
const A_YEAR = 365 * 24 * 60 * 60 * 1000;

/** A Date as the `datetime-local` control shows it, in local time to the minute. */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/**
 * A `datetime-local` value, read in local time, as the ISO instant the API
 * requires. Null when it is not a complete, real date and time.
 */
export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function length(value: string, min: number, max: number, label: string): string | undefined {
  const n = value.trim().length;
  if (n < min) return min === 1 ? `Enter ${label}.` : `${capital(label)} must be at least ${min} characters.`;
  if (n > max) return `${capital(label)} must be ${max} characters or fewer.`;
  return undefined;
}

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Every failing field at once, in the form's order (BR-03, BR-07, BR-09). */
export function validateDraft(draft: ActionDraft, now: Date = new Date()): DraftErrors {
  const errors: DraftErrors = {};
  const at = fromLocalInput(draft.actionAt);
  if (!at) {
    errors.actionAt = "Enter the date and time of the work.";
  } else {
    const when = new Date(at).getTime();
    if (draft.status === "COMPLETED" && when > now.getTime() + FIVE_MINUTES) {
      errors.actionAt = "Completed work cannot be dated in the future.";
    } else if (draft.status === "OPEN" && when > now.getTime() + A_YEAR) {
      errors.actionAt = "Planned work can be dated at most a year ahead.";
    }
  }

  const description = length(draft.description, 5, 2000, "the description");
  if (description) errors.description = draft.description.trim().length === 0 ? "Enter a description of the work." : description;

  if (draft.status === "COMPLETED") {
    const result = length(draft.result, 5, 2000, "the result");
    if (result) errors.result = draft.result.trim().length === 0 ? "Enter the result of the work." : result;
  } else if (draft.result.trim().length > 2000) {
    errors.result = "The result must be 2000 characters or fewer.";
  }

  if (!draft.assigneeId) errors.assigneeId = "Choose who the action is assigned to.";

  if (draft.followUpRequired) {
    const note = length(draft.followUpNote, 5, 1000, "the follow-up note");
    if (note) errors.followUpNote = draft.followUpNote.trim().length === 0 ? "Describe the follow-up that is needed." : note;
  }

  if (draft.attachmentNotes.trim().length > 500) errors.attachmentNotes = "Attachment notes must be 500 characters or fewer.";
  return errors;
}

/** The server's fieldErrors, keyed by the same names as the draft; any other name is dropped. */
export function serverErrors(fieldErrors: Record<string, string> | undefined): DraftErrors {
  const errors: DraftErrors = {};
  for (const [field, message] of Object.entries(fieldErrors ?? {})) {
    if ((FIELD_ORDER as string[]).includes(field)) errors[field as keyof ActionDraft] = message;
  }
  return errors;
}
