import type { ReactNode } from "react";
import { Button } from "./Button.js";

type ErrorAlertProps = {
  children: ReactNode;
  /** Optional retry, so a failed request is recoverable without a reload. */
  onRetry?: () => void;
  retryLabel?: string;
};

/**
 * Failures that need the user to act. Assertive: role="alert" (ui-spec.md §3).
 * Reserved for actionable failure — a quiet empty list is not an alert.
 */
export function ErrorAlert({ children, onRetry, retryLabel = "Try again" }: ErrorAlertProps) {
  return (
    <div className="zen-alert" role="alert">
      <p className="zen-alert__message">{children}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
