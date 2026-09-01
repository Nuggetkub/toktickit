import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  downloadAttachment,
  fetchTicket,
  removeAttachment,
  uploadAttachment,
  type Attachment,
  type RequestedPriority,
  type TicketDetail as TicketDetailResponse,
} from "../api.js";
import {
  Badge,
  Button,
  Card,
  ErrorAlert,
  Field,
  ReadOnlyField,
  StatusMessage,
} from "../components/index.js";
import { useRequester } from "../requester/index.js";
import {
  MAX_FILES,
  PERMITTED_TYPE_LABEL,
  describeRejections,
  selectAttachments,
} from "./attachment-selection.js";
import { saveBlob } from "./save-file.js";

// BR-38, mirrored from the server so the confirm button can say no before a
// round trip. The server re-checks and remains the authority.
const REASON_MIN = 5;
const REASON_MAX = 250;

const PRIORITY_TONE: Record<RequestedPriority, "neutral" | "warning" | "danger"> = {
  LOW: "neutral",
  MEDIUM: "neutral",
  HIGH: "warning",
  URGENT: "danger",
};

const TYPE_LABELS: Record<string, string> = {
  "image/jpeg": "JPEG image",
  "image/png": "PNG image",
  "image/webp": "WEBP image",
  "application/pdf": "PDF document",
};

function describeType(mimeType: string): string {
  return TYPE_LABELS[mimeType] ?? mimeType;
}

function describeSize(bytes: number): string {
  // Kilobytes below a megabyte: "0.2 MB" for a screenshot tells the reader less
  // than "184 KB" does, and the column exists to be read rather than to be neat.
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function moment(value: string): string {
  return new Date(value).toLocaleString();
}

export default function TicketDetail() {
  const { ticketId = "" } = useParams();
  const { requester } = useRequester();

  const [ticket, setTicket] = useState<TicketDetailResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "notFound" | "failed">("loading");
  const [reloadToken, setReloadToken] = useState(0);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploadingName, setUploadingName] = useState("");

  const [removingId, setRemovingId] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState("");
  const [removalBusy, setRemovalBusy] = useState(false);

  useEffect(() => {
    if (!requester) return;
    let active = true;
    setState("loading");

    fetchTicket(Number(ticketId), requester.id)
      .then((loaded) => {
        if (!active) return;
        setTicket(loaded);
        setAttachments(loaded.attachments);
        setState("ready");
      })
      .catch((error: unknown) => {
        if (!active) return;
        // A Ticket that is not yours and a Ticket that does not exist are the
        // same answer by design (BR-10, D-04), and the screen must not undo that
        // by wording them differently.
        setState(error instanceof ApiError && error.status === 404 ? "notFound" : "failed");
      });

    return () => {
      active = false;
    };
  }, [requester, ticketId, reloadToken]);

  const activeCount = attachments.filter((file) => file.removedAt === null).length;
  const atLimit = activeCount >= MAX_FILES;

  async function upload(chosen: File | undefined, input: HTMLInputElement) {
    // The picker keeps its value, so choosing the same file twice after a failure
    // would otherwise be silent. Clearing it makes every choice a fresh event.
    input.value = "";
    if (!chosen || !requester || !ticket) return;

    setNotice("");

    const { rejected } = selectAttachments([chosen]);
    if (rejected.length > 0) {
      // Named with its reason, and never added to the list (ui-spec.md §8).
      setAttachmentError(describeRejections(rejected));
      return;
    }

    setAttachmentError("");
    setUploadingName(chosen.name);
    try {
      const stored = await uploadAttachment(ticket.id, chosen, requester.id);
      setAttachments((current) => [...current, stored]);
      setNotice(`${stored.originalFilename} was uploaded.`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "The attachment could not be uploaded.";
      setAttachmentError(`${chosen.name} was not uploaded — ${message}`);
    } finally {
      setUploadingName("");
    }
  }

  async function download(attachment: Attachment) {
    if (!requester || !ticket) return;
    setAttachmentError("");
    setNotice("");
    try {
      const blob = await downloadAttachment(ticket.id, attachment.id, requester.id);
      saveBlob(blob, attachment.originalFilename);
      setNotice(`${attachment.originalFilename} was downloaded.`);
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "The attachment could not be downloaded.";
      setAttachmentError(`${attachment.originalFilename} could not be downloaded — ${message}`);
    }
  }

  function startRemoval(attachment: Attachment) {
    setRemovingId(attachment.id);
    setReason("");
    setReasonError("");
    setAttachmentError("");
    setNotice("");
  }

  async function confirmRemoval(attachment: Attachment) {
    if (!requester || !ticket) return;

    const trimmed = reason.trim();
    if (trimmed.length < REASON_MIN || trimmed.length > REASON_MAX) {
      setReasonError(`Give a removal reason of ${REASON_MIN}-${REASON_MAX} characters.`);
      return;
    }

    setRemovalBusy(true);
    try {
      const removed = await removeAttachment(ticket.id, attachment.id, trimmed, requester.id);
      // Replaced rather than dropped: the row stays on screen carrying its
      // removal reason and date, which is the whole point of a soft removal.
      setAttachments((current) => current.map((file) => (file.id === removed.id ? removed : file)));
      setRemovingId(null);
      setReason("");
      setNotice(`${removed.originalFilename} was removed and can no longer be downloaded.`);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      if (apiError?.fieldErrors?.removalReason) {
        setReasonError(apiError.fieldErrors.removalReason);
      } else {
        setAttachmentError(
          `${attachment.originalFilename} could not be removed — ${apiError?.message ?? "please try again."}`,
        );
      }
    } finally {
      setRemovalBusy(false);
    }
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
        <ErrorAlert>
          That Ticket could not be found. It may not exist, or it may belong to a different
          Development Requester.
        </ErrorAlert>
        <Link className="zen-button zen-button--secondary" to="/tickets">
          Back to My Tickets
        </Link>
      </Card>
    );
  }

  if (state === "failed" || !ticket) {
    return (
      <Card title="Ticket" as="h1">
        <ErrorAlert onRetry={() => setReloadToken((token) => token + 1)}>
          This Ticket could not be loaded.
        </ErrorAlert>
        <Link className="zen-button zen-button--secondary" to="/tickets">
          Back to My Tickets
        </Link>
      </Card>
    );
  }

  return (
    <>
      <Card title={`Ticket ${ticket.ticketNumber}`} as="h1">
        {/* Every field is read-only. Lab 2 has no edit, so nothing here should
            look like it invites one (ui-spec.md §8). */}
        <ReadOnlyField label="Ticket Number" value={ticket.ticketNumber} />
        <ReadOnlyField label="Ticket Date" value={moment(ticket.ticketDate)} />
        <ReadOnlyField label="Requester" value={ticket.requester.fullName} />
        <ReadOnlyField label="Category" value={ticket.category.name} />
        <ReadOnlyField label="Related System" value={ticket.relatedSystem.name} />
        <ReadOnlyField label="Ticket Summary" value={ticket.summary} />
        <ReadOnlyField
          label="Requested Priority"
          value={<Badge tone={PRIORITY_TONE[ticket.requestedPriority]}>{ticket.requestedPriority}</Badge>}
        />
        <ReadOnlyField label="Current Status" value={<Badge tone="success">{ticket.currentStatus}</Badge>} />
        <ReadOnlyField label="Description" value={ticket.description} />

        <Link className="zen-button zen-button--secondary" to="/tickets">
          Back to My Tickets
        </Link>
      </Card>

      <Card title="Attachments">
        <p className="zen-field__hint">
          {PERMITTED_TYPE_LABEL}, up to 5 MB each, {MAX_FILES} active attachments maximum.{" "}
          {activeCount} of {MAX_FILES} in use.
        </p>

        {/* Upload errors sit beside the attachment section and name the file
            they concern, rather than as a banner at the top of the page. */}
        {attachmentError && <ErrorAlert>{attachmentError}</ErrorAlert>}
        {uploadingName && <StatusMessage>Uploading {uploadingName}…</StatusMessage>}
        {notice && <StatusMessage>{notice}</StatusMessage>}

        <Field
          id="attachment"
          label="Add an attachment"
          hint={
            atLimit
              ? `This Ticket already has ${MAX_FILES} active attachments. Remove one before adding another.`
              : undefined
          }
        >
          {(control) => (
            <input
              {...control}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={atLimit || uploadingName !== ""}
              onChange={(event) => void upload(event.target.files?.[0], event.target)}
            />
          )}
        </Field>

        {attachments.length === 0 ? (
          <p>No files have been attached to this Ticket.</p>
        ) : (
          <ul className="zen-attachments" aria-label="Attachments">
            {attachments.map((attachment) => {
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
                    // The metadata is retained and the reason is spelled out in
                    // words, so the state is never carried by the badge colour
                    // alone (BR-39, ui-spec.md §10).
                    <p className="zen-attachment__removal">
                      Removed on {moment(attachment.removedAt)} — reason: {attachment.removalReason}. Download is
                      unavailable because this attachment was removed.
                    </p>
                  )}

                  {!removed && (
                    <div className="zen-attachment__actions">
                      <Button variant="secondary" onClick={() => void download(attachment)}>
                        Download {attachment.originalFilename}
                      </Button>
                      <Button variant="destructive" onClick={() => startRemoval(attachment)}>
                        Remove {attachment.originalFilename}
                      </Button>
                    </div>
                  )}

                  {removingId === attachment.id && (
                    <div className="zen-alert" role="alertdialog" aria-label={`Remove ${attachment.originalFilename}?`}>
                      <p>
                        Remove <strong>{attachment.originalFilename}</strong>? The file stops being
                        downloadable, and this record of why it went keeps its place on the Ticket.
                      </p>

                      <Field
                        id={`removal-reason-${attachment.id}`}
                        label="Removal reason"
                        required
                        error={reasonError}
                        hint={`${REASON_MIN}-${REASON_MAX} characters. ${reason.trim().length} so far.`}
                      >
                        {(control) => (
                          <input
                            {...control}
                            type="text"
                            value={reason}
                            onChange={(event) => {
                              setReason(event.target.value);
                              setReasonError("");
                            }}
                          />
                        )}
                      </Field>

                      <div className="zen-attachment__actions">
                        <Button
                          variant="destructive"
                          busy={removalBusy}
                          busyLabel="Removing…"
                          // Disabled until the reason is one the server would
                          // accept: offering a button that is certain to fail is
                          // just a slower way of showing an error.
                          disabled={reason.trim().length < REASON_MIN || reason.trim().length > REASON_MAX}
                          onClick={() => void confirmRemoval(attachment)}
                        >
                          Remove attachment
                        </Button>
                        <Button variant="secondary" disabled={removalBusy} onClick={() => setRemovingId(null)}>
                          Keep attachment
                        </Button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
