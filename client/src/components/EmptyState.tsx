import type { ReactNode } from "react";

type EmptyStateProps = {
  title: string;
  description?: ReactNode;
  /** The recovery action — "Create Ticket" when empty, "Clear filters" when
   *  a search matched nothing. The two cases are deliberately different. */
  action?: ReactNode;
};

/** Used for both the empty list and the no-results list, with different words. */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="zen-empty">
      <p className="zen-empty__title">{title}</p>
      {description && <p className="zen-empty__description">{description}</p>}
      {action}
    </div>
  );
}
