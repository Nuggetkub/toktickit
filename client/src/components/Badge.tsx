import type { ReactNode } from "react";

export type BadgeTone = "neutral" | "success" | "warning" | "danger";

type BadgeProps = {
  tone?: BadgeTone;
  children: ReactNode;
};

/**
 * Priority, status and removed markers. The label is always rendered as text:
 * ui-spec.md §1 forbids communicating state by colour alone, so tone only ever
 * reinforces a word that is already on screen.
 */
export function Badge({ tone = "neutral", children }: BadgeProps) {
  return <span className={`zen-badge zen-badge--${tone}`}>{children}</span>;
}
