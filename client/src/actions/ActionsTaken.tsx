import { Fragment, useEffect, useState } from "react";
import {
  ApiError,
  cancelAction,
  completeAction,
  createAction,
  editAction,
  fetchActions,
  fetchAssignees,
  type ActionEdit,
  type ActionTaken,
  type UserSummary,
} from "../api.js";
import { ActionStatusBadge, Button, Card, ConfirmDialog, EmptyState, ErrorAlert, Field, StatusMessage } from "../components/index.js";
import { moment } from "../tickets/attachment-format.js";
import { ActionForm, draftToNewAction } from "./ActionForm.js";
import { fromLocalInput, toLocalInput, type ActionDraft } from "./action-rules.js";

// Actions taken (Lab 4 ui-spec §4), on both Ticket Detail screens.
//
// IT Staff and Administrators list, add, edit, complete and cancel. A
// Requester sees the same list and every field (BR-16), with no control
// rendered and no write ever requested. The section sits outside the
// discussion tabs, so the work log the resolution gate depends on is always
// in view.

type ActionsTakenProps = {
  ticketId: number;
  ticketStatus: string;
  /** IT Staff and Administrators; false for the owning Requester. */
  canWrite: boolean;
  currentUserId: number;
  /** After any successful write, so the Ticket and its resolution guidance refresh. */
  onChanged?: () => void;
};

type Dialog =
  | { kind: "complete"; action: ActionTaken }
  | { kind: "cancel"; action: ActionTaken };

const TERMINAL = new Set(["CLOSED", "CANCELLED"]);
const FIVE_MINUTES = 5 * 60 * 1000;

export function ActionsTaken({ ticketId, ticketStatus, canWrite, currentUserId, onChanged }: ActionsTakenProps) {
  const [actions, setActions] = useState<ActionTaken[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [assignees, setAssignees] = useState<UserSummary[]>([]);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [notice, setNotice] = useState("");

  const terminal = TERMINAL.has(ticketStatus);
  const resolved = ticketStatus === "RESOLVED";
  // A resolved or terminal Ticket refuses every Action write (BR-12), so no
  // control is offered that could only be refused.
  const writable = canWrite && !terminal && !resolved;

  useEffect(() => {
    let active = true;
    fetchActions(ticketId)
      .then((items) => {
        if (!active) return;
        setActions(items);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("failed");
      });
    return () => {
      active = false;
    };
  }, [ticketId, reloadToken]);

  useEffect(() => {
    // The assignee list is a staff endpoint; a Requester never requests it.
    if (!canWrite) return;
    let active = true;
    fetchAssignees()
      .then((people) => {
        if (active) setAssignees(people);
      })
      .catch(() => {
        // The form still opens; its Assignee field then says what to choose.
      });
    return () => {
      active = false;
    };
  }, [canWrite]);

  const reload = () => setReloadToken((token) => token + 1);

  function saved(message: string) {
    setNotice(message);
    setAdding(false);
    setEditingId(null);
    setDialog(null);
    reload();
    onChanged?.();
  }

  function toggle(id: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function submitEdit(action: ActionTaken, draft: ActionDraft) {
    // Only what changed is sent, with the version last seen (BR-13).
    const wanted = draftToNewAction(draft);
    const edit: ActionEdit = { version: action.version };
    // The control works to the minute: unchanged means it still shows the stored time.
    if (draft.actionAt !== toLocalInput(new Date(action.actionAt))) edit.actionAt = wanted.actionAt;
    if (wanted.description !== action.description) edit.description = wanted.description;
    if (wanted.result !== action.result) edit.result = wanted.result;
    if (wanted.followUpRequired !== action.followUpRequired) edit.followUpRequired = wanted.followUpRequired;
    if (wanted.followUpNote !== action.followUpNote) edit.followUpNote = wanted.followUpNote;
    if (wanted.attachmentNotes !== action.attachmentNotes) edit.attachmentNotes = wanted.attachmentNotes;
    if (wanted.assigneeId !== action.assignee?.id) edit.assigneeId = wanted.assigneeId;
    return editAction(ticketId, action.id, edit);
  }

  const count = state === "ready" ? ` (${actions.length})` : "";

  return (
    <Card title={`Actions taken${count}`}>
      {notice && <StatusMessage>{notice}</StatusMessage>}

      {canWrite && resolved && <p className="zen-frozen">Reopen the ticket to record more work.</p>}
      {/* A closed or cancelled Ticket already says so at the top of the screen
          (the Lab 3 terminal message); repeating it here would say it twice. */}

      {writable && !adding && (
        <Button onClick={() => { setNotice(""); setAdding(true); }}>Add action</Button>
      )}

      {writable && adding && (
        <ActionForm
          mode="create"
          assignees={assignees}
          currentUserId={currentUserId}
          submit={(draft, key) => createAction(ticketId, draftToNewAction(draft), key)}
          onSaved={() => saved("Action recorded")}
          onReload={reload}
          onClose={() => setAdding(false)}
        />
      )}

      {state === "loading" && <StatusMessage>Loading actions…</StatusMessage>}
      {state === "failed" && <ErrorAlert onRetry={reload}>The actions could not be loaded.</ErrorAlert>}
      {state === "ready" && actions.length === 0 && <EmptyState title="No actions have been recorded yet." />}

      {state === "ready" && actions.length > 0 && (
        <div className="zen-table-wrap">
          <table className="zen-table zen-actions-table">
            <caption className="zen-visually-hidden">Actions taken on this ticket, newest first</caption>
            <thead>
              <tr>
                <th scope="col">Action date/time</th>
                <th scope="col">Description</th>
                <th scope="col">Assignee</th>
                <th scope="col">Performed by</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((action) => {
                const open = action.status === "OPEN";
                const isExpanded = expanded.has(action.id);
                const detailsId = `action-${action.id}-details`;
                return (
                  <Fragment key={action.id}>
                    <tr>
                      <td data-label="Action date/time">{moment(action.actionAt)}</td>
                      <td data-label="Description">
                        {action.description}
                        {action.result && <p className="zen-action__result">{action.result}</p>}
                      </td>
                      <td data-label="Assignee">
                        {action.assignee ? action.assignee.fullName : <span className="zen-action__unassigned">Unassigned</span>}
                      </td>
                      <td data-label="Performed by">{action.performedBy?.fullName ?? "—"}</td>
                      <td data-label="Status">
                        <ActionStatusBadge status={action.status} />
                        {action.followUpRequired && <p className="zen-action__result">Follow-up required</p>}
                      </td>
                      <td data-label="Actions">
                        <div className="zen-form-actions">
                          <Button variant="tertiary" aria-expanded={isExpanded} aria-controls={detailsId} onClick={() => toggle(action.id)}>
                            {isExpanded ? "Hide details" : "Details"}
                          </Button>
                          {writable && open && (
                            <>
                              <Button variant="secondary" onClick={() => { setNotice(""); setEditingId(action.id); }}>Edit</Button>
                              <Button variant="secondary" onClick={() => setDialog({ kind: "complete", action })}>Complete</Button>
                              <Button variant="destructive" onClick={() => setDialog({ kind: "cancel", action })}>Cancel action</Button>
                            </>
                          )}
                          {canWrite && !open && <span className="zen-field__hint">Final — record a new action to correct it.</span>}
                        </div>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr id={detailsId}>
                        <td colSpan={6}>
                          <ActionDetails action={action} />
                        </td>
                      </tr>
                    )}
                    {writable && editingId === action.id && (
                      <tr>
                        <td colSpan={6}>
                          <ActionForm
                            mode="edit"
                            action={action}
                            assignees={assignees}
                            currentUserId={currentUserId}
                            submit={(draft) => submitEdit(action, draft)}
                            onSaved={() => saved("Action updated")}
                            onReload={reload}
                            onClose={() => setEditingId(null)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {dialog?.kind === "complete" && (
        <CompleteDialog
          action={dialog.action}
          onDone={() => saved("Action completed")}
          onStale={reload}
          onClose={() => setDialog(null)}
          complete={(completion) => completeAction(ticketId, dialog.action.id, completion)}
        />
      )}
      {dialog?.kind === "cancel" && (
        <CancelDialog
          onDone={() => saved("Action cancelled")}
          onStale={reload}
          onClose={() => setDialog(null)}
          cancel={(reason) => cancelAction(ticketId, dialog.action.id, dialog.action.version, reason)}
        />
      )}
    </Card>
  );
}

function ActionDetails({ action }: { action: ActionTaken }) {
  return (
    <dl className="zen-action__details">
      <dt>Description</dt>
      <dd>{action.description}</dd>
      <dt>Result</dt>
      <dd>{action.result ?? "—"}</dd>
      {action.followUpRequired && (
        <>
          <dt>Follow-up note</dt>
          <dd>{action.followUpNote}</dd>
        </>
      )}
      <dt>Attachment notes — refers to files in the Attachments tab</dt>
      <dd>{action.attachmentNotes ?? "—"}</dd>
      <dt>Recorded by</dt>
      <dd>{action.createdBy.fullName}</dd>
      <dt>Recorded at</dt>
      <dd>{moment(action.createdAt)}</dd>
      {action.status === "CANCELLED" && (
        <>
          <dt>Cancelled by</dt>
          <dd>{action.cancelledBy?.fullName ?? "—"}</dd>
          <dt>Cancellation reason</dt>
          <dd>{action.cancellationReason}</dd>
        </>
      )}
    </dl>
  );
}

/** What a refused write means for a dialog: a message, and whether the list is stale. */
function refusal(error: unknown): { message: string; stale: boolean } {
  if (!(error instanceof ApiError) || error.status === undefined || error.status >= 500) {
    return { message: "The change could not be saved. Check your connection and try again; what you entered is kept.", stale: false };
  }
  if (error.code === "ACTION_VERSION_CONFLICT") return { message: "Someone else changed this action. Close this and reload to see the latest version.", stale: true };
  if (error.code === "VALIDATION_FAILED") {
    return { message: Object.values(error.fieldErrors ?? {}).join(" ") || error.message, stale: false };
  }
  return { message: error.message, stale: true };
}

function CompleteDialog({
  action,
  complete,
  onDone,
  onStale,
  onClose,
}: {
  action: ActionTaken;
  complete: (completion: Parameters<typeof completeAction>[2]) => Promise<ActionTaken>;
  onDone: () => void;
  onStale: () => void;
  onClose: () => void;
}) {
  // A planned Action dated in the future must be completed at a real time
  // (BR-07), so the dialog asks for one, pre-filled with now.
  const futureDated = new Date(action.actionAt).getTime() > Date.now() + FIVE_MINUTES;
  const [followUpRequired, setFollowUpRequired] = useState(action.followUpRequired);
  const [followUpNote, setFollowUpNote] = useState(action.followUpNote ?? "");
  const [actionAt, setActionAt] = useState(() => toLocalInput(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const noteLength = followUpNote.trim().length;
  const noteInvalid = followUpRequired && (noteLength < 5 || noteLength > 1000);
  const atInvalid = futureDated && !fromLocalInput(actionAt);

  async function confirm(result: string) {
    setBusy(true);
    setError(undefined);
    try {
      await complete({
        version: action.version,
        result,
        followUpRequired,
        followUpNote: followUpRequired ? followUpNote.trim() : null,
        ...(futureDated ? { actionAt: fromLocalInput(actionAt)! } : {}),
      });
      onDone();
    } catch (caught) {
      const { message, stale } = refusal(caught);
      setError(message);
      if (stale) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Complete action"
      consequence="Completing records you as the person who performed it. A completed action is final."
      confirmLabel="Complete action"
      busy={busy}
      busyLabel="Completing…"
      field={{ label: "Result", min: 5, max: 2000, multiline: true }}
      error={error}
      confirmDisabled={noteInvalid || atInvalid}
      onConfirm={(result) => void confirm(result)}
      onCancel={onClose}
    >
      {futureDated && (
        <Field id={`complete-${action.id}-at`} label="Action date/time" required hint="This action was planned for later. Enter when the work was actually done.">
          {(control) => <input {...control} type="datetime-local" value={actionAt} onChange={(event) => setActionAt(event.target.value)} />}
        </Field>
      )}
      <div className="zen-field">
        <label className="zen-checkbox">
          <input
            type="checkbox"
            checked={followUpRequired}
            aria-controls={`complete-${action.id}-note`}
            aria-expanded={followUpRequired}
            onChange={(event) => setFollowUpRequired(event.target.checked)}
          />{" "}
          Follow-up required
        </label>
      </div>
      {followUpRequired && (
        <Field id={`complete-${action.id}-note`} label="Follow-up note" required hint={`5-1000 characters. ${noteLength} so far.`}>
          {(control) => <textarea {...control} rows={2} value={followUpNote} onChange={(event) => setFollowUpNote(event.target.value)} />}
        </Field>
      )}
    </ConfirmDialog>
  );
}

function CancelDialog({
  cancel,
  onDone,
  onStale,
  onClose,
}: {
  cancel: (reason: string) => Promise<ActionTaken>;
  onDone: () => void;
  onStale: () => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function confirm(reason: string) {
    setBusy(true);
    setError(undefined);
    try {
      await cancel(reason);
      onDone();
    } catch (caught) {
      const { message, stale } = refusal(caught);
      setError(message);
      if (stale) onStale();
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmDialog
      title="Cancel action"
      consequence="The action stays on the ticket as cancelled, with your reason. A cancelled action is final."
      confirmLabel="Cancel action"
      cancelLabel="Keep action"
      busy={busy}
      busyLabel="Cancelling…"
      field={{ label: "Reason", min: 5, max: 500 }}
      error={error}
      onConfirm={(reason) => void confirm(reason)}
      onCancel={onClose}
    />
  );
}
