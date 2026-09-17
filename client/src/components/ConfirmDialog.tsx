import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "./Button.js";
import { Field } from "./Field.js";

/** An optional required answer — the resolution summary, or a reason (BR-30). */
export type ConfirmField = {
  label: string;
  hint?: string;
  min: number;
  max: number;
  /** Reasons are a line; resolution summaries are a paragraph. */
  multiline?: boolean;
};

type ConfirmDialogProps = {
  title: string;
  /** The consequence, in one sentence (ui-spec.md §1). */
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  field?: ConfirmField;
  busy?: boolean;
  busyLabel?: string;
  /** A refusal from the server, shown inside the dialog rather than behind it. */
  error?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * ui-spec.md §1 — title, the consequence in one sentence, an optional required
 * field, Confirm and Cancel. Focus moves in, is trapped while open, and returns
 * to the control that opened it. Escape cancels.
 *
 * The focus rules are the reason this is a component rather than a block of JSX
 * in the one screen that needs it today: a dialog that leaves focus behind it is
 * unusable by keyboard and invisible to a screen reader, and that is exactly the
 * detail a second, hand-rolled dialog would omit. BR-31 puts a confirmation in
 * front of four status changes, so there will be more than one caller.
 */
export function ConfirmDialog({
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  field,
  busy = false,
  busyLabel,
  error,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const fieldId = useId();
  const [value, setValue] = useState("");

  useEffect(() => {
    // Remembered before focus moves, and restored on close: the trigger is the
    // place the reader was, and returning them anywhere else loses their place.
    const opener = document.activeElement as HTMLElement | null;
    const first = dialog.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    return () => opener?.focus();
  }, []);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onCancel();
      return;
    }

    if (event.key !== "Tab" || !dialog.current) return;

    // The trap: Tab past the last control returns to the first, and Shift+Tab
    // before the first goes to the last, so focus cannot wander behind the
    // modal to controls the reader cannot see.
    const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    }
  }

  const trimmed = value.trim();
  const lengthIsWrong = field ? trimmed.length < field.min || trimmed.length > field.max : false;

  return (
    <div className="zen-modal" role="presentation">
      <div
        className="zen-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialog}
        onKeyDown={onKeyDown}
      >
        <h2 className="zen-modal__title" id={titleId}>
          {title}
        </h2>
        <p className="zen-modal__consequence">{consequence}</p>

        {field && (
          <Field
            id={fieldId}
            label={field.label}
            required
            error={error}
            hint={`${field.hint ? `${field.hint} ` : ""}${field.min}-${field.max} characters. ${trimmed.length} so far.`}
          >
            {(control) =>
              field.multiline ? (
                <textarea {...control} rows={4} value={value} onChange={(event) => setValue(event.target.value)} />
              ) : (
                <input {...control} type="text" value={value} onChange={(event) => setValue(event.target.value)} />
              )
            }
          </Field>
        )}

        {/* A refusal with no field to hang on still belongs inside the dialog:
            behind it, the reader would have to close the dialog to find out
            why closing it was necessary. */}
        {error && !field && <p className="zen-field__error" role="alert">{error}</p>}

        <div className="zen-modal__actions">
          <Button
            busy={busy}
            busyLabel={busyLabel}
            // Disabled until the answer is one the server would accept, on the
            // same reasoning as the attachment removal dialog: a button certain
            // to fail is a slower way of showing an error.
            disabled={lengthIsWrong}
            onClick={() => onConfirm(trimmed)}
          >
            {confirmLabel}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
