import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "destructive";

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type"> & {
  variant?: ButtonVariant;
  /** While busy the button is disabled and announces itself as busy. */
  busy?: boolean;
  /** Present-participle label shown while busy, e.g. "Creating ticket…". */
  busyLabel?: string;
  type?: "button" | "submit" | "reset";
  children: ReactNode;
};

/**
 * The only button in the application. Every variant and state named in
 * ui-spec.md §3 lives here so that no screen re-invents a button.
 *
 * A busy button is disabled by construction rather than by the caller
 * remembering to pass both props — that pairing is what stops a double submit.
 */
export function Button({
  variant = "primary",
  busy = false,
  busyLabel,
  disabled = false,
  type = "button",
  className,
  children,
  ...rest
}: ButtonProps) {
  const classes = ["zen-button", `zen-button--${variant}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type={type}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}
