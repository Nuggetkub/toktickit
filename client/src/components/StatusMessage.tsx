import type { ReactNode } from "react";

type StatusMessageProps = { children: ReactNode };

/**
 * Loading, submitting and success. Polite: role="status" announces without
 * interrupting what the user is doing (ui-spec.md §3).
 */
export function StatusMessage({ children }: StatusMessageProps) {
  return (
    <p className="zen-status" role="status">
      {children}
    </p>
  );
}
