import { useEffect, useId, useRef, useState } from "react";
import { ApiError, type ActionTaken, type UserSummary } from "../api.js";
import { Button, Field } from "../components/index.js";
import {
  FIELD_ORDER,
  fromLocalInput,
  serverErrors,
  toLocalInput,
  validateDraft,
  type ActionDraft,
  type DraftErrors,
} from "./action-rules.js";

// ActionForm (Lab 4 ui-spec §1, §4): create and edit one Action.
//
// What the reader typed is never thrown away by a failure (BR-32). A refusal
// shows beside the field it concerns, a conflict offers Reload and keeps the
// input, and a network or server failure turns Save into Retry, which re-sends
// the same request with the same Idempotency-Key (BR-15), so a create that did
// reach the server is answered with the original Action, not a second one.

export type FormOutcome =
  | { kind: "saved"; action: ActionTaken }
  /** The Action changed or became final elsewhere: the list should reload. */
  | { kind: "stale" };

export type AssigneeList = { people: UserSummary[]; state: "loading" | "ready" | "failed"; retry: () => void };

type ActionFormProps = {
  mode: "create" | "edit";
  /** The Action being edited, in edit mode; a newer version arriving here is rebased onto. */
  action?: ActionTaken;
  assignees: AssigneeList;
  currentUserId: number;
  /** Sends the draft. In create mode `idempotencyKey` is the one key this form opening uses. */
  submit: (draft: ActionDraft, idempotencyKey: string) => Promise<ActionTaken>;
  onSaved: (action: ActionTaken) => void;
  /** Reloads the list behind the form without closing it. */
  onReload: () => void;
  onClose: () => void;
};

function initialDraft(mode: "create" | "edit", action: ActionTaken | undefined, currentUserId: number): ActionDraft {
  if (mode === "edit" && action) {
    return {
      status: "OPEN",
      actionAt: toLocalInput(new Date(action.actionAt)),
      description: action.description,
      result: action.result ?? "",
      followUpRequired: action.followUpRequired,
      followUpNote: action.followUpNote ?? "",
      attachmentNotes: action.attachmentNotes ?? "",
      // An assignee cleared by BR-17 starts empty, and the field is required.
      assigneeId: action.assignee ? String(action.assignee.id) : "",
    };
  }
  return {
    // "Record completed work" is the default (ui-spec §4), and the assignee is
    // the person recording it, not the Ticket Owner (BR-02).
    status: "COMPLETED",
    actionAt: toLocalInput(new Date()),
    description: "",
    result: "",
    followUpRequired: false,
    followUpNote: "",
    attachmentNotes: "",
    assigneeId: String(currentUserId),
  };
}

/** How a stored value reads in a "changed to" note. */
function shown(field: keyof ActionDraft, draft: ActionDraft, people: UserSummary[]): string {
  if (field === "assigneeId") return people.find((p) => String(p.id) === draft.assigneeId)?.fullName ?? "nobody";
  if (field === "followUpRequired") return draft.followUpRequired ? "Follow-up required" : "No follow-up";
  if (field === "actionAt") return draft.actionAt ? new Date(draft.actionAt).toLocaleString() : "no time";
  const value = draft[field];
  return typeof value === "string" && value.trim() ? value.trim() : "empty";
}

const NETWORK_MESSAGE = "The action could not be saved. Check your connection, then retry; everything you entered is kept.";

export function ActionForm({ mode, action, assignees, currentUserId, submit, onSaved, onReload, onClose }: ActionFormProps) {
  const id = useId();
  const [draft, setDraft] = useState<ActionDraft>(() => initialDraft(mode, action, currentUserId));
  // What the draft was opened against (edit mode). Earth2509's review of PR #99:
  // after a conflict and Reload, comparing the old draft with the new record
  // would send fields this user never touched and revert another user's change
  // under a valid version. The baseline tells edited fields from untouched ones.
  const [baseline, setBaseline] = useState<{ version: number; draft: ActionDraft } | null>(() =>
    mode === "edit" && action ? { version: action.version, draft: initialDraft(mode, action, currentUserId) } : null,
  );
  const [changedElsewhere, setChangedElsewhere] = useState<DraftErrors>({});
  const [rebased, setRebased] = useState(false);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ message: string; kind: "conflict" | "refused" | "network" } | null>(null);
  // One key per opening of the form: a retry is the same request again (BR-15).
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const form = useRef<HTMLFormElement>(null);
  const focusFirstError = useRef(false);

  useEffect(() => {
    if (!focusFirstError.current) return;
    focusFirstError.current = false;
    const first = FIELD_ORDER.find((field) => errors[field]);
    if (first) form.current?.querySelector<HTMLElement>(`[data-field="${first}"]`)?.focus();
  }, [errors]);

  // A newer version of the Action arrived (Reload, or any refresh of the list):
  // untouched fields take its values, edited fields keep this user's, and where
  // both changed the same field the note beneath it says what will be replaced.
  useEffect(() => {
    if (mode !== "edit" || !action || !baseline || action.version === baseline.version) return;
    const latest = initialDraft("edit", action, currentUserId);
    const notes: DraftErrors = {};
    const next = { ...draft };
    for (const field of FIELD_ORDER) {
      const edited = draft[field] !== baseline.draft[field];
      if (!edited) (next as Record<string, unknown>)[field] = latest[field];
      else if (latest[field] !== baseline.draft[field]) {
        notes[field] = `Someone else changed this to “${shown(field, latest, assignees.people)}”. Saving keeps your value.`;
      }
    }
    setDraft(next);
    setChangedElsewhere(notes);
    setBaseline({ version: action.version, draft: latest });
    setFailure(null);
    setRebased(true);
    // Only a new version of the Action triggers this; the draft is read as it
    // stands at that moment, not followed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action?.version]);

  const fieldId = (name: keyof ActionDraft) => `${id}-${name}`;
  const update = (patch: Partial<ActionDraft>) => setDraft((current) => ({ ...current, ...patch }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    const found = validateDraft(draft);
    if (Object.keys(found).length > 0) {
      focusFirstError.current = true;
      setErrors(found);
      return;
    }
    setErrors({});
    setFailure(null);
    setBusy(true);
    try {
      onSaved(await submit(draft, idempotencyKey));
    } catch (error) {
      if (!(error instanceof ApiError) || error.status === undefined || error.status >= 500) {
        setFailure({ kind: "network", message: NETWORK_MESSAGE });
      } else if (error.code === "VALIDATION_FAILED") {
        focusFirstError.current = true;
        const mapped = serverErrors(error.fieldErrors);
        setErrors(mapped);
        if (Object.keys(mapped).length === 0) setFailure({ kind: "refused", message: error.message });
      } else if (error.code === "ACTION_VERSION_CONFLICT") {
        setFailure({ kind: "conflict", message: "Someone else changed this action. Reload to see the latest version." });
      } else {
        // ACTION_FINAL, ACTION_NOT_ALLOWED, TICKET_TERMINAL and the like: the
        // server's own words, and the list behind refreshes so the controls
        // match the true state.
        setFailure({ kind: "refused", message: error.message });
        onReload();
      }
    } finally {
      setBusy(false);
    }
  }

  const completed = draft.status === "COMPLETED";
  const title = mode === "create" ? "Add action" : "Edit action";

  return (
    <form ref={form} className="zen-action-form" aria-label={title} noValidate onSubmit={(event) => void save(event)}>
      <h3 className="zen-card__title">{title}</h3>

      {mode === "create" && (
        <fieldset className="zen-field" data-field="status" tabIndex={-1}>
          <legend className="zen-field__label">Status</legend>
          <label>
            <input type="radio" name={`${id}-status`} checked={completed} onChange={() => update({ status: "COMPLETED" })} /> Record completed work
          </label>
          <label>
            <input type="radio" name={`${id}-status`} checked={!completed} onChange={() => update({ status: "OPEN" })} /> Plan open work
          </label>
        </fieldset>
      )}

      {rebased && (
        <p className="zen-status" role="status">
          This action was reloaded at its latest version. Fields you had not changed now show the latest values; your changes are kept.
        </p>
      )}

      <Field id={fieldId("actionAt")} label="Action date/time" required error={errors.actionAt} hint={changedElsewhere.actionAt}>
        {(control) => (
          <input {...control} data-field="actionAt" type="datetime-local" value={draft.actionAt} onChange={(event) => update({ actionAt: event.target.value })} />
        )}
      </Field>

      <Field id={fieldId("description")} label="Description" required error={errors.description} hint={changedElsewhere.description} wide>
        {(control) => (
          <textarea {...control} data-field="description" rows={3} value={draft.description} onChange={(event) => update({ description: event.target.value })} />
        )}
      </Field>

      <Field id={fieldId("result")} label="Result" required={completed} error={errors.result} hint={changedElsewhere.result ?? (completed ? undefined : "Optional for planned work.")} wide>
        {(control) => (
          <textarea {...control} data-field="result" rows={2} value={draft.result} onChange={(event) => update({ result: event.target.value })} />
        )}
      </Field>

      <Field
        id={fieldId("assigneeId")}
        label="Assignee"
        required
        error={errors.assigneeId}
        hint={changedElsewhere.assigneeId ?? (assignees.state === "loading" ? "Loading the people who can be assigned…" : undefined)}
      >
        {(control) => (
          <select {...control} data-field="assigneeId" value={draft.assigneeId} onChange={(event) => update({ assigneeId: event.target.value })}>
            <option value="">Choose an assignee</option>
            {assignees.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </select>
        )}
      </Field>
      {/* Earth2509's review of PR #99: a failed lookup must be retryable without
          losing the form, or an Unassigned Action can never be given anyone. */}
      {assignees.state === "failed" && (
        <div className="zen-alert" role="alert">
          <p>The list of assignees could not be loaded.</p>
          <Button variant="secondary" onClick={assignees.retry}>
            Retry loading assignees
          </Button>
        </div>
      )}

      <div className="zen-field">
        <label className="zen-checkbox">
          <input
            type="checkbox"
            data-field="followUpRequired"
            checked={draft.followUpRequired}
            aria-controls={fieldId("followUpNote")}
            aria-expanded={draft.followUpRequired}
            onChange={(event) => update({ followUpRequired: event.target.checked })}
          />{" "}
          Follow-up required
        </label>
        {changedElsewhere.followUpRequired && <p className="zen-field__hint">{changedElsewhere.followUpRequired}</p>}
      </div>

      {draft.followUpRequired && (
        <Field id={fieldId("followUpNote")} label="Follow-up note" required error={errors.followUpNote} hint={changedElsewhere.followUpNote} wide>
          {(control) => (
            <textarea {...control} data-field="followUpNote" rows={2} value={draft.followUpNote} onChange={(event) => update({ followUpNote: event.target.value })} />
          )}
        </Field>
      )}

      <Field id={fieldId("attachmentNotes")} label="Attachment notes — refers to files in the Attachments tab" error={errors.attachmentNotes} hint={changedElsewhere.attachmentNotes} wide>
        {(control) => (
          <textarea {...control} data-field="attachmentNotes" rows={2} value={draft.attachmentNotes} onChange={(event) => update({ attachmentNotes: event.target.value })} />
        )}
      </Field>

      {failure && (
        <div className="zen-alert" role="alert">
          <p>{failure.message}</p>
          {failure.kind === "conflict" && (
            <Button variant="secondary" onClick={onReload}>
              Reload
            </Button>
          )}
        </div>
      )}

      <p className="zen-field__hint">Visible to the requester. Use an internal note for anything private.</p>
      <div className="zen-form-actions">
        <Button type="submit" busy={busy} busyLabel="Saving action…">
          {failure?.kind === "network" ? "Retry" : "Save action"}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/** The request a draft becomes, for create; `fromLocalInput` already passed validation. */
export function draftToNewAction(draft: ActionDraft) {
  const note = draft.followUpNote.trim();
  return {
    status: draft.status,
    actionAt: fromLocalInput(draft.actionAt)!,
    description: draft.description.trim(),
    result: draft.result.trim() || null,
    followUpRequired: draft.followUpRequired,
    followUpNote: draft.followUpRequired ? note : null,
    attachmentNotes: draft.attachmentNotes.trim() || null,
    assigneeId: Number(draft.assigneeId),
  };
}
