import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  REQUESTED_PRIORITIES,
  createTicket,
  fetchCategories,
  fetchRelatedSystems,
  type Category,
  type CreatedTicket,
  type RelatedSystem,
  type RequestedPriority,
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

// Client-side bounds mirror BR-12 to BR-15. The server re-checks every one of
// them and is the authority (BR-16); these exist so the user is told before a
// round trip, and so a server rule that does fire lands on its own field.
const SUMMARY_MIN = 5;
const SUMMARY_MAX = 120;
const DESCRIPTION_MIN = 20;
const DESCRIPTION_MAX = 4000;

type FormValues = {
  categoryId: string;
  relatedSystemId: string;
  summary: string;
  description: string;
  requestedPriority: "" | RequestedPriority;
};

const EMPTY: FormValues = {
  categoryId: "",
  relatedSystemId: "",
  summary: "",
  description: "",
  requestedPriority: "",
};

function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

export default function CreateTicket() {
  const { requester } = useRequester();
  const [values, setValues] = useState<FormValues>(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<CreatedTicket | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [relatedSystems, setRelatedSystems] = useState<RelatedSystem[]>([]);
  const [referenceState, setReferenceState] = useState<"loading" | "ready" | "failed">("loading");

  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState("");

  // One key per submission attempt. It is regenerated whenever a field changes,
  // because the server treats a reused key with a different payload as a
  // conflict (BR-19): retrying the *same* ticket after a failure must replay,
  // but retrying an *edited* ticket is a new ticket and needs a new key.
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);

  async function loadReferenceData() {
    setReferenceState("loading");
    try {
      const [loadedCategories, loadedSystems] = await Promise.all([
        fetchCategories(),
        fetchRelatedSystems(),
      ]);
      setCategories(loadedCategories);
      setRelatedSystems(loadedSystems);
      setReferenceState("ready");
    } catch {
      setReferenceState("failed");
    }
  }

  useEffect(() => {
    void loadReferenceData();
  }, []);

  function update(field: keyof FormValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setFieldErrors((current) => {
      const { [field]: _cleared, ...rest } = current;
      return rest;
    });
    setSubmitError("");
    setIdempotencyKey(newIdempotencyKey());
  }

  function validate(): Record<string, string> {
    const errors: Record<string, string> = {};
    const summary = values.summary.trim();
    const description = values.description.trim();

    if (!values.categoryId) errors.categoryId = "Select a Category.";
    if (!values.relatedSystemId) errors.relatedSystemId = "Select a Related System.";
    if (summary.length < SUMMARY_MIN || summary.length > SUMMARY_MAX) {
      errors.summary = `Summary must be ${SUMMARY_MIN}-${SUMMARY_MAX} characters.`;
    }
    if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
      errors.description = `Description must be ${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters.`;
    }
    if (!values.requestedPriority) errors.requestedPriority = "Select a Requested Priority.";

    return errors;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0 || !requester) return;

    setSubmitting(true);
    setSubmitError("");
    try {
      const ticket = await createTicket(
        {
          categoryId: Number(values.categoryId),
          relatedSystemId: Number(values.relatedSystemId),
          summary: values.summary.trim(),
          description: values.description.trim(),
          requestedPriority: values.requestedPriority as RequestedPriority,
        },
        requester.id,
        idempotencyKey,
      );
      setCreated(ticket);
    } catch (error) {
      // BR-42: nothing the user typed is cleared here. A field error from the
      // server lands on its field; anything else becomes one safe message.
      if (error instanceof ApiError) {
        setFieldErrors(error.fieldErrors ?? {});
        setSubmitError(error.fieldErrors ? "Some details need correcting." : error.message);
      } else {
        setSubmitError("The Ticket could not be created. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  function createAnother() {
    setCreated(null);
    setValues(EMPTY);
    setFieldErrors({});
    setSubmitError("");
    setFiles([]);
    setFileError("");
    setIdempotencyKey(newIdempotencyKey());
  }

  function chooseFiles(chosen: FileList | null) {
    const { accepted, rejected } = selectAttachments(Array.from(chosen ?? []), files);
    setFiles(accepted);
    setFileError(rejected.length > 0 ? describeRejections(rejected) : "");
  }

  const ticketDate = useMemo(
    () => (created ? new Date(created.ticketDate).toLocaleString() : "Assigned after saving"),
    [created],
  );

  if (created) {
    return (
      <Card title="Ticket created" as="h1">
        <div className="zen-status" role="status">
          <p>
            Your Ticket has been saved as <strong>{created.ticketNumber}</strong>, raised on{" "}
            {ticketDate}.
          </p>
        </div>

        <ReadOnlyField label="Ticket Number" value={created.ticketNumber} />
        <ReadOnlyField label="Ticket Date" value={ticketDate} />
        <ReadOnlyField label="Current Status" value={<Badge tone="success">{created.currentStatus}</Badge>} />

        {files.length > 0 && (
          <p>
            {files.length} selected {files.length === 1 ? "file was" : "files were"} checked but{" "}
            <strong>not uploaded</strong> — attachments are added from the Ticket Detail screen,
            which arrives with Issue #26. Nothing has been stored, so they will need choosing again.
          </p>
        )}

        <div className="zen-shell__nav">
          <Link className="zen-button zen-button--primary" to="/tickets">
            View My Tickets
          </Link>
          <Button variant="secondary" onClick={createAnother}>
            Create another Ticket
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Create Ticket" as="h1">
      <p>
        Describe the problem. TokTickIT assigns the official Ticket Number once the Ticket is
        saved.
      </p>

      {referenceState === "loading" && <StatusMessage>Loading Categories and Related Systems…</StatusMessage>}

      {referenceState === "failed" && (
        <ErrorAlert onRetry={() => void loadReferenceData()}>
          Categories and Related Systems could not be loaded, so a Ticket cannot be raised yet.
        </ErrorAlert>
      )}

      {submitError && <ErrorAlert>{submitError}</ErrorAlert>}

      <form onSubmit={submit} noValidate>
        {/* System-assigned values, shown from the start so their place on the
            screen is not a surprise once they are filled in (ui-spec.md §6). */}
        <ReadOnlyField label="Ticket Number" value="Assigned after saving" />
        <ReadOnlyField label="Ticket Date" value="Assigned after saving" />
        <ReadOnlyField label="Requester" value={requester?.fullName ?? "No Requester selected"} />

        <Field id="categoryId" label="Category" required error={fieldErrors.categoryId}>
          {(control) => (
            <select
              {...control}
              value={values.categoryId}
              disabled={referenceState !== "ready"}
              onChange={(event) => update("categoryId", event.target.value)}
            >
              <option value="">Select a Category</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field id="relatedSystemId" label="Related System" required error={fieldErrors.relatedSystemId}>
          {(control) => (
            <select
              {...control}
              value={values.relatedSystemId}
              disabled={referenceState !== "ready"}
              onChange={(event) => update("relatedSystemId", event.target.value)}
            >
              <option value="">Select a Related System</option>
              {relatedSystems.map((system) => (
                <option key={system.id} value={system.id}>
                  {system.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id="summary"
          label="Ticket Summary"
          required
          error={fieldErrors.summary}
          hint={`${SUMMARY_MIN}-${SUMMARY_MAX} characters. ${values.summary.trim().length} so far.`}
        >
          {(control) => (
            <input
              {...control}
              type="text"
              value={values.summary}
              onChange={(event) => update("summary", event.target.value)}
            />
          )}
        </Field>

        <Field id="requestedPriority" label="Requested Priority" required error={fieldErrors.requestedPriority}>
          {(control) => (
            <select
              {...control}
              value={values.requestedPriority}
              onChange={(event) => update("requestedPriority", event.target.value)}
            >
              <option value="">Select a Requested Priority</option>
              {REQUESTED_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          id="description"
          label="Description"
          required
          error={fieldErrors.description}
          hint={`${DESCRIPTION_MIN}-${DESCRIPTION_MAX} characters. ${values.description.trim().length} so far.`}
        >
          {(control) => (
            <textarea
              {...control}
              value={values.description}
              onChange={(event) => update("description", event.target.value)}
            />
          )}
        </Field>

        <Field
          id="attachments"
          label="Attachments"
          error={fileError}
          hint={`${PERMITTED_TYPE_LABEL}, up to 5 MB each, ${MAX_FILES} files maximum. Files are checked now and uploaded from the Ticket Detail screen.`}
        >
          {(control) => (
            <input
              {...control}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(event) => chooseFiles(event.target.files)}
            />
          )}
        </Field>

        {files.length > 0 && (
          <ul aria-label="Selected attachments">
            {files.map((file) => (
              <li key={`${file.name}-${file.size}`}>
                {file.name} ({(file.size / 1024 / 1024).toFixed(1)} MB)
              </li>
            ))}
          </ul>
        )}

        <Button type="submit" busy={submitting} busyLabel="Creating ticket…" disabled={referenceState !== "ready"}>
          Submit Ticket
        </Button>
      </form>
    </Card>
  );
}
