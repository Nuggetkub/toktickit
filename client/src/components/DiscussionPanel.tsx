import { CONTENT_MAX, type DiscussionEntry } from "../api.js";
import { Button } from "./Button.js";
import { Field } from "./Field.js";
import { RoleBadge } from "./RoleBadge.js";
import { statusLabel, type TicketStatus } from "./StatusBadge.js";

/** The composer, owned by the caller so a draft survives a tab change. */
export type ComposerProps = {
  id: string;
  label: string;
  hint?: string;
  submitLabel: string;
  busyLabel: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error?: string;
};

type DiscussionPanelProps = {
  heading: string;
  entries: DiscussionEntry[];
  emptyText: string;
  /** Omitted when nobody may post here — a closed ticket, or a read-only role. */
  composer?: ComposerProps;
  /** The private surface of ui-spec.md §1. Internal Notes, and nothing else. */
  surface?: "public" | "private";
  /** Replaces the composer when posting is impossible but reading is not. */
  closedText?: string;
  notice?: string;
};

function moment(value: string): string {
  return new Date(value).toLocaleString();
}

/**
 * ui-spec.md §1 — a composer above a newest-first list of entries showing
 * author, role badge, time and content.
 *
 * Content is rendered as a text node inside an element that preserves line
 * breaks in CSS. That is the whole of BR-36's "never as HTML": React escapes
 * what it renders, so markup in a comment reaches the next reader as the
 * characters the author typed. Nothing here calls `dangerouslySetInnerHTML`,
 * and nothing should — escaping on the way *in* instead would store `&lt;b&gt;`
 * and show the entities to everyone afterwards.
 *
 * The draft lives with the caller rather than here. The two threads are
 * separate tabs with separate composers, and switching tabs unmounts one panel:
 * a draft held in this component would vanish on the way past, which is exactly
 * the accident ui-spec.md §8 forbids when it says text must never move from one
 * composer to the other.
 */
export function DiscussionPanel({
  heading,
  entries,
  emptyText,
  composer,
  surface = "public",
  closedText,
  notice,
}: DiscussionPanelProps) {
  const isPrivate = surface === "private";
  const trimmed = composer ? composer.value.trim() : "";
  const tooLong = trimmed.length > CONTENT_MAX;

  return (
    <section className={`zen-discussion${isPrivate ? " zen-discussion--private" : ""}`}>
      <h3 className="zen-discussion__heading">
        {isPrivate && (
          <span className="zen-discussion__lock" aria-hidden="true">
            🔒
          </span>
        )}
        {heading}
      </h3>

      {notice && (
        <p className="zen-status" role="status">
          {notice}
        </p>
      )}

      {composer && (
        <div className="zen-discussion__composer">
          <Field
            id={composer.id}
            label={composer.label}
            hint={`${composer.hint ? `${composer.hint} ` : ""}Up to ${CONTENT_MAX} characters. ${trimmed.length} so far.`}
            error={composer.error}
          >
            {(control) => (
              <textarea
                {...control}
                rows={3}
                value={composer.value}
                onChange={(event) => composer.onChange(event.target.value)}
              />
            )}
          </Field>

          <Button
            busy={composer.busy}
            busyLabel={composer.busyLabel}
            disabled={trimmed.length === 0 || tooLong}
            onClick={composer.onSubmit}
          >
            {composer.submitLabel}
          </Button>
        </div>
      )}

      {closedText && <p className="zen-discussion__closed">{closedText}</p>}

      {entries.length === 0 ? (
        <p className="zen-discussion__empty">{emptyText}</p>
      ) : (
        <ol className="zen-discussion__list" aria-label={heading}>
          {entries.map((entry) => (
            <li key={entry.id} className="zen-discussion__entry">
              <div className="zen-discussion__byline">
                <span className="zen-discussion__author">{entry.author.fullName}</span>
                <RoleBadge role={entry.author.role} />
                <span className="zen-discussion__time">{moment(entry.createdAt)}</span>
              </div>

              {/* BR-30: a comment written by a status change says so, otherwise
                  the Requester reads a bare summary with no idea what it
                  accompanied. */}
              {entry.statusChangedTo && (
                <p className="zen-discussion__status-change">
                  Status changed to {statusLabel(entry.statusChangedTo as TicketStatus)}
                </p>
              )}

              <p className="zen-discussion__content">{entry.content}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
