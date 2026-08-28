import type { ReactNode } from "react";

/** Props a Field hands to its control so the wiring cannot be forgotten. */
export type FieldControlProps = {
  id: string;
  required?: boolean;
  "aria-required"?: boolean;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

type FieldProps = {
  id: string;
  label: string;
  required?: boolean;
  /** Validation message. Its presence is what marks the field invalid. */
  error?: string;
  hint?: string;
  children: (control: FieldControlProps) => ReactNode;
};

/**
 * Label above the control, a red asterisk when required, and the validation
 * message directly beneath the field it concerns — never one lumped error at
 * the top of a form (ui-spec.md §3).
 *
 * The control is supplied through a render prop rather than as plain children
 * so that `id`, `aria-invalid` and `aria-describedby` are always connected. A
 * caller cannot accidentally ship an unlabelled or undescribed input.
 */
export function Field({ id, label, required = false, error, hint, children }: FieldProps) {
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  const classes = ["zen-field", error ? "zen-field--invalid" : null].filter(Boolean).join(" ");

  return (
    <div className={classes}>
      <label className="zen-field__label" htmlFor={id}>
        {label}
        {required && (
          <span className="zen-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>

      {hint && (
        <p className="zen-field__hint" id={hintId}>
          {hint}
        </p>
      )}

      {children({
        id,
        required: required || undefined,
        "aria-required": required || undefined,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy || undefined,
      })}

      {error && (
        <p className="zen-field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

type ReadOnlyFieldProps = {
  label: string;
  /** Placeholder wording used before the backend has assigned the value. */
  value: ReactNode;
};

/**
 * A system-assigned value such as Ticket Number or Ticket Date. Rendered with
 * the read-only surface so it is visibly distinct from an editable field, and
 * not focusable as an input, because Lab 2 never lets a requester edit these.
 */
export function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return (
    <div className="zen-field zen-field--readonly">
      <span className="zen-field__label">{label}</span>
      <p className="zen-field__value">{value}</p>
    </div>
  );
}
