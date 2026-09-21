import { useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ApiError,
  REQUESTED_PRIORITIES,
  changeTicketStatus,
  claimTicket,
  downloadAttachment,
  fetchAssignees,
  fetchComments,
  fetchInternalNotes,
  fetchTicket,
  postComment,
  postInternalNote,
  setItPriority,
  setTicketOwner,
  type Attachment,
  type DiscussionEntry,
  type RequestedPriority,
  type TicketDetail,
  type UserSummary,
} from "../api.js";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DiscussionPanel,
  ErrorAlert,
  Field,
  PriorityBadge,
  ReadOnlyField,
  StatusBadge,
  StatusMessage,
  statusLabel,
  type TicketStatus,
} from "../components/index.js";
import {
  CONFIRMED_TRANSITIONS,
  evidenceLimits,
  evidenceRequiredFor,
  isTerminal,
  nextStatuses,
  ownerRequiredToEnter,
} from "../ticket-rules.js";
import { describeSize, describeType, moment } from "../tickets/attachment-format.js";
import { saveBlob } from "../tickets/save-file.js";

// The IT Staff Ticket Detail (ui-spec.md §8).
//
// Ticket information is read-only and the Work panel is the only editable
// region, which is the screen's whole shape: everything a Requester wrote stays
// a record, and everything IT owns — owner, IT Priority, status — is edited
// separately, each with its own save and its own busy state. One shared "Save"
// would make changing a priority disable the owner control, and a reader who
// cannot tell which of three edits is in flight will make the fourth by mistake.

type Tab = "comments" | "notes" | "attachments";

/** The queue's filters and page, handed over so Back can restore them. */
type QueueReturn = { filters: unknown; page: number };

export default function StaffTicketDetail() {
  const { ticketId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queueReturn = (location.state as { queue?: QueueReturn } | null)?.queue ?? null;

  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notFound" | "failed">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  const [assignees, setAssignees] = useState<UserSummary[]>([]);
  const [comments, setComments] = useState<DiscussionEntry[]>([]);
  const [notes, setNotes] = useState<DiscussionEntry[]>([]);
  const [tab, setTab] = useState<Tab>("comments");

  // Two drafts, held here rather than inside the panels. Switching tabs unmounts
  // one panel, and a draft that lived in the panel would be gone when the reader
  // came back — or, worse, be handed to the other composer (ui-spec.md §8).
  const [commentDraft, setCommentDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [noteBusy, setNoteBusy] = useState(false);
  const [commentError, setCommentError] = useState("");
  const [noteError, setNoteError] = useState("");

  const [ownerChoice, setOwnerChoice] = useState("");
  const [priorityChoice, setPriorityChoice] = useState<RequestedPriority>("MEDIUM");
  const [statusChoice, setStatusChoice] = useState<"" | TicketStatus>("");
  const [pending, setPending] = useState<TicketStatus | null>(null);

  const [claimBusy, setClaimBusy] = useState(false);
  const [ownerBusy, setOwnerBusy] = useState(false);
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);

  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);
  const [ownerError, setOwnerError] = useState("");
  const [priorityError, setPriorityError] = useState("");
  const [statusError, setStatusError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [attachmentError, setAttachmentError] = useState("");

  useEffect(() => {
    let active = true;
    setState("loading");

    fetchTicket(Number(ticketId))
      .then((loaded) => {
        if (!active) return;
        adopt(loaded);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        setState(error instanceof ApiError && error.status === 404 ? "notFound" : "failed");
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, reloadToken]);

  useEffect(() => {
    let active = true;
    // The two threads and the assignee list are independent of each other: one
    // failing must not blank the ticket, which is the thing the reader came for.
    Promise.all([fetchComments(Number(ticketId)), fetchInternalNotes(Number(ticketId)), fetchAssignees()])
      .then(([loadedComments, loadedNotes, loadedAssignees]) => {
        if (!active) return;
        setComments(loadedComments);
        setNotes(loadedNotes);
        setAssignees(loadedAssignees);
      })
      .catch(() => {
        // Left as they are; the ticket itself reports its own failure.
      });
    return () => {
      active = false;
    };
  }, [ticketId, reloadToken]);

  /** Every write answers with the ticket, so the screen redraws from the server. */
  function adopt(updated: TicketDetail) {
    setTicket(updated);
    setOwnerChoice(updated.owner ? String(updated.owner.id) : "");
    setPriorityChoice(updated.itPriority);
    setStatusChoice("");
    setConflict(false);
  }

  function clearMessages() {
    setNotice("");
    setOwnerError("");
    setPriorityError("");
    setStatusError("");
    setDialogError("");
  }

  /**
   * One place that reads a refusal, so no control invents its own wording.
   *
   * A stale version is not a validation failure and must not be reported as one:
   * the reader has to know that someone else moved the ticket, and that nothing
   * they typed has been sent anywhere.
   */
  function refuse(error: unknown, place: (message: string) => void, fallback: string): void {
    const apiError = error instanceof ApiError ? error : null;
    if (apiError?.code === "TICKET_VERSION_CONFLICT") {
      setConflict(true);
      return;
    }
    if (apiError?.code === "OWNER_REQUIRED") {
      setStatusError("Assign an owner before moving this ticket to In Progress.");
      return;
    }
    const fieldError = apiError?.fieldErrors ? Object.values(apiError.fieldErrors)[0] : undefined;
    place(fieldError ?? apiError?.message ?? fallback);
  }

  async function runClaim() {
    if (!ticket) return;
    clearMessages();
    setClaimBusy(true);
    try {
      adopt(await claimTicket(ticket.id, ticket.version));
      setNotice("You now own this ticket.");
    } catch (error) {
      refuse(error, setOwnerError, "The ticket could not be claimed.");
    } finally {
      setClaimBusy(false);
    }
  }

  async function saveOwner() {
    if (!ticket) return;
    clearMessages();
    setOwnerBusy(true);
    try {
      // "" is Unassigned, and it is an instruction rather than an omission.
      adopt(await setTicketOwner(ticket.id, ownerChoice === "" ? null : Number(ownerChoice), ticket.version));
      setNotice("Owner updated");
    } catch (error) {
      refuse(error, setOwnerError, "The owner could not be saved.");
    } finally {
      setOwnerBusy(false);
    }
  }

  async function savePriority() {
    if (!ticket) return;
    clearMessages();
    setPriorityBusy(true);
    try {
      adopt(await setItPriority(ticket.id, priorityChoice, ticket.version));
      setNotice("IT Priority updated");
    } catch (error) {
      refuse(error, setPriorityError, "The IT Priority could not be saved.");
    } finally {
      setPriorityBusy(false);
    }
  }

  /** BR-31: four of the transitions are confirmed; the rest apply directly. */
  function beginStatusChange() {
    if (!statusChoice) return;
    clearMessages();
    if (CONFIRMED_TRANSITIONS.includes(statusChoice)) {
      setPending(statusChoice);
      return;
    }
    void applyStatus(statusChoice, "");
  }

  async function applyStatus(to: TicketStatus, evidence: string) {
    if (!ticket) return;
    const field = evidenceRequiredFor(to);
    setStatusBusy(true);
    try {
      const updated = await changeTicketStatus(ticket.id, {
        toStatus: to,
        version: ticket.version,
        ...(field === "resolutionSummary" ? { resolutionSummary: evidence } : {}),
        ...(field === "reason" ? { reason: evidence } : {}),
      });
      adopt(updated);
      setPending(null);
      setNotice(`Status changed to ${statusLabel(to)}`);
      // The summary or reason is posted as a Public Comment in the same
      // transaction (BR-30), so the thread is stale the moment this succeeds.
      setComments(await fetchComments(ticket.id));
    } catch (error) {
      // Inside the dialog while it is open, beneath the control once it is not.
      refuse(error, pending ? setDialogError : setStatusError, "The status could not be changed.");
    } finally {
      setStatusBusy(false);
    }
  }

  async function addComment() {
    if (!ticket) return;
    setCommentError("");
    setCommentBusy(true);
    try {
      const posted = await postComment(ticket.id, commentDraft.trim());
      setComments((current) => [posted, ...current]);
      setCommentDraft("");
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setCommentError(apiError?.fieldErrors?.content ?? apiError?.message ?? "The comment could not be posted.");
    } finally {
      setCommentBusy(false);
    }
  }

  async function addNote() {
    if (!ticket) return;
    setNoteError("");
    setNoteBusy(true);
    try {
      const posted = await postInternalNote(ticket.id, noteDraft.trim());
      setNotes((current) => [posted, ...current]);
      setNoteDraft("");
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      setNoteError(apiError?.fieldErrors?.content ?? apiError?.message ?? "The note could not be added.");
    } finally {
      setNoteBusy(false);
    }
  }

  async function download(attachment: Attachment) {
    if (!ticket) return;
    setAttachmentError("");
    try {
      saveBlob(await downloadAttachment(ticket.id, attachment.id), attachment.originalFilename);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "The attachment could not be downloaded.";
      setAttachmentError(`${attachment.originalFilename} could not be downloaded — ${message}`);
    }
  }

  function backToQueue() {
    // The queue's filters and page travel with the link, so Back restores the
    // list the reader left rather than a default one they must rebuild.
    navigate("/queue", queueReturn ? { state: { queue: queueReturn } } : undefined);
  }

  if (state === "loading") {
    return (
      <Card title="Ticket" as="h1">
        <StatusMessage>Loading this Ticket…</StatusMessage>
      </Card>
    );
  }

  if (state === "notFound") {
    return (
      <Card title="Ticket not found" as="h1">
        <ErrorAlert>That Ticket could not be found.</ErrorAlert>
        <Button variant="secondary" onClick={backToQueue}>
          Back to queue
        </Button>
      </Card>
    );
  }

  if (state === "failed" || !ticket) {
    return (
      <Card title="Ticket" as="h1">
        <ErrorAlert onRetry={() => setReloadToken((token) => token + 1)}>This Ticket could not be loaded.</ErrorAlert>
        <Button variant="secondary" onClick={backToQueue}>
          Back to queue
        </Button>
      </Card>
    );
  }

  const status = ticket.currentStatus as TicketStatus;
  const frozen = isTerminal(status);
  const available = nextStatuses(status);
  const activeAttachments = ticket.attachments.filter((file) => file.removedAt === null);
  const pendingField = pending ? evidenceRequiredFor(pending) : null;

  return (
    <>
      <Card title={`Ticket ${ticket.ticketNumber}`} as="h1">
        <nav className="zen-breadcrumb" aria-label="Breadcrumb">
          <Button variant="tertiary" onClick={backToQueue}>
            Ticket Queue
          </Button>
          <span aria-hidden="true">›</span>
          <span>{ticket.ticketNumber}</span>
        </nav>

        <div className="zen-detail-header">
          <StatusBadge status={status} />
          <PriorityBadge kind="Requested" priority={ticket.requestedPriority} />
          <PriorityBadge kind="IT" priority={ticket.itPriority} />
          <span className="zen-detail-header__owner">
            {ticket.owner ? `Owner: ${ticket.owner.fullName}` : "Unassigned"}
          </span>
        </div>

        {/* BR-33: this banner is how IT Staff learn the Requester believes it is
            fixed. The status is deliberately untouched — the indication is a
            message, not a transition. */}
        {ticket.requesterResolvedAt && (
          <p className="zen-indication" role="note">
            {ticket.requester.fullName} says the problem appears resolved ({moment(ticket.requesterResolvedAt)}).
          </p>
        )}

        {notice && <StatusMessage>{notice}</StatusMessage>}

        {conflict && (
          <ErrorAlert onRetry={() => setReloadToken((token) => token + 1)} retryLabel="Reload">
            Someone else changed this ticket. Reload to see the latest version.
          </ErrorAlert>
        )}

        {frozen && <p className="zen-frozen">This ticket is closed and can no longer be changed.</p>}

        <div className="zen-detail-columns">
          <section className="zen-detail-information">
            <h2 className="zen-card__title">Ticket information</h2>
            <div className="zen-form-grid">
              <ReadOnlyField label="Requester" value={ticket.requester.fullName} />
              <ReadOnlyField label="Ticket Date" value={moment(ticket.ticketDate)} />
              <ReadOnlyField label="Category" value={ticket.category.name} />
              <ReadOnlyField label="Related System" value={ticket.relatedSystem.name} />
              <ReadOnlyField label="Ticket Summary" value={ticket.summary} wide />
              <ReadOnlyField
                label="Requested Priority"
                value={<PriorityBadge kind="Requested" priority={ticket.requestedPriority} />}
              />
              <ReadOnlyField label="Description" value={ticket.description} wide />
              {ticket.resolutionSummary && (
                <ReadOnlyField label="Resolution Summary" value={ticket.resolutionSummary} wide />
              )}
            </div>
          </section>

          <section className="zen-work-panel">
            <h2 className="zen-card__title">Work</h2>

            {!ticket.owner && (
              <Button busy={claimBusy} busyLabel="Claiming…" disabled={frozen} onClick={() => void runClaim()}>
                Claim
              </Button>
            )}

            <Field id="work-owner" label="Owner" error={ownerError}>
              {(control) => (
                <select
                  {...control}
                  value={ownerChoice}
                  disabled={frozen}
                  onChange={(event) => setOwnerChoice(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {assignees.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              variant="secondary"
              busy={ownerBusy}
              busyLabel="Saving owner…"
              disabled={frozen}
              onClick={() => void saveOwner()}
            >
              Save owner
            </Button>

            <Field id="work-priority" label="IT Priority" error={priorityError}>
              {(control) => (
                <select
                  {...control}
                  value={priorityChoice}
                  disabled={frozen}
                  onChange={(event) => setPriorityChoice(event.target.value as RequestedPriority)}
                >
                  {REQUESTED_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Button
              variant="secondary"
              busy={priorityBusy}
              busyLabel="Saving priority…"
              disabled={frozen}
              onClick={() => void savePriority()}
            >
              Save priority
            </Button>

            <Field
              id="work-status"
              label="Status"
              error={statusError}
              hint={`Current status: ${statusLabel(status)}.`}
            >
              {(control) => (
                <select
                  {...control}
                  value={statusChoice}
                  disabled={frozen || available.length === 0}
                  onChange={(event) => setStatusChoice(event.target.value as "" | TicketStatus)}
                >
                  <option value="">Choose a new status</option>
                  {/* Only BR-29's next statuses: the rest would be refused, and
                      a choice that cannot succeed is not a choice. */}
                  {available.map((next) => (
                    <option key={next} value={next}>
                      {statusLabel(next)}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            {/* BR-28 named before it is broken, rather than as a 409 afterwards. */}
            {!ticket.owner && statusChoice && ownerRequiredToEnter(statusChoice) && (
              <p className="zen-field__hint">Assign an owner before moving this ticket to {statusLabel(statusChoice)}.</p>
            )}
            <Button
              variant="secondary"
              busy={statusBusy && !pending}
              busyLabel="Changing status…"
              disabled={frozen || !statusChoice}
              onClick={beginStatusChange}
            >
              Change status
            </Button>
          </section>
        </div>
      </Card>

      <Card>
        <div className="zen-tabs" role="tablist" aria-label="Ticket discussion">
          {(
            [
              ["comments", `Public comments (${comments.length})`],
              ["notes", `Internal notes (${notes.length})`],
              ["attachments", `Attachments (${ticket.attachments.length})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`tab-${key}`}
              aria-selected={tab === key}
              aria-controls={`panel-${key}`}
              className={`zen-tab${tab === key ? " zen-tab--active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "comments" && (
          <div role="tabpanel" id="panel-comments" aria-labelledby="tab-comments">
            <DiscussionPanel
              heading="Public comments"
              entries={comments}
              emptyText="No public comments yet."
              closedText={frozen ? "This ticket is closed, so no new comment can be posted." : undefined}
              composer={
                frozen
                  ? undefined
                  : {
                      id: "public-comment",
                      label: "Public comment",
                      hint: "Visible to the requester.",
                      submitLabel: "Post public comment",
                      busyLabel: "Posting…",
                      value: commentDraft,
                      onChange: setCommentDraft,
                      onSubmit: () => void addComment(),
                      busy: commentBusy,
                      error: commentError,
                    }
              }
            />
          </div>
        )}

        {tab === "notes" && (
          <div role="tabpanel" id="panel-notes" aria-labelledby="tab-notes">
            <DiscussionPanel
              surface="private"
              heading="Internal notes — visible only to IT Staff and Administrators"
              entries={notes}
              emptyText="No internal notes yet."
              closedText={frozen ? "This ticket is closed, so no new note can be added." : undefined}
              composer={
                frozen
                  ? undefined
                  : {
                      id: "internal-note",
                      label: "Internal note",
                      hint: "Never shown to the requester.",
                      submitLabel: "Add internal note",
                      busyLabel: "Adding…",
                      value: noteDraft,
                      onChange: setNoteDraft,
                      onSubmit: () => void addNote(),
                      busy: noteBusy,
                      error: noteError,
                    }
              }
            />
          </div>
        )}

        {tab === "attachments" && (
          <div role="tabpanel" id="panel-attachments" aria-labelledby="tab-attachments">
            {/* Read-only for IT Staff (ui-spec.md §8): the server permits upload
                and removal to the owning Requester alone, so offering either
                here would be a button that is certain to be refused. */}
            <p className="zen-field__hint">
              {activeAttachments.length} active of {ticket.attachments.length} attached.
            </p>
            {attachmentError && <ErrorAlert>{attachmentError}</ErrorAlert>}

            {ticket.attachments.length === 0 ? (
              <p>No files have been attached to this Ticket.</p>
            ) : (
              <ul className="zen-attachments" aria-label="Attachments">
                {ticket.attachments.map((attachment) => {
                  const removed = attachment.removedAt !== null;
                  return (
                    <li key={attachment.id} className={`zen-attachment${removed ? " zen-attachment--removed" : ""}`}>
                      <div className="zen-attachment__head">
                        <span className="zen-attachment__name">{attachment.originalFilename}</span>
                        {removed ? <Badge tone="danger">Removed</Badge> : <Badge tone="success">Active</Badge>}
                      </div>
                      <p className="zen-attachment__meta">
                        {describeType(attachment.mimeType)} · {describeSize(attachment.sizeBytes)} · uploaded{" "}
                        {moment(attachment.uploadedAt)}
                      </p>
                      {removed && attachment.removedAt && (
                        <p className="zen-attachment__removal">
                          Removed on {moment(attachment.removedAt)} — reason: {attachment.removalReason}.
                        </p>
                      )}
                      {!removed && (
                        <Button variant="secondary" onClick={() => void download(attachment)}>
                          Download {attachment.originalFilename}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </Card>

      {pending && (
        <ConfirmDialog
          title={`Change status to ${statusLabel(pending)}?`}
          consequence={
            pendingField === "resolutionSummary"
              ? "The requester is told the problem is resolved, and your summary is posted to them as a public comment."
              : pendingField === "reason"
                ? "Your reason is posted to the requester as a public comment."
                : "The requester sees the new status on their ticket."
          }
          confirmLabel={`Change status to ${statusLabel(pending)}`}
          busy={statusBusy}
          busyLabel="Changing status…"
          error={dialogError}
          field={
            pendingField
              ? {
                  label: pendingField === "resolutionSummary" ? "Resolution summary" : "Reason",
                  multiline: pendingField === "resolutionSummary",
                  ...evidenceLimits(pendingField),
                }
              : undefined
          }
          onConfirm={(value) => void applyStatus(pending, value)}
          onCancel={() => {
            setPending(null);
            setDialogError("");
          }}
        />
      )}
    </>
  );
}
