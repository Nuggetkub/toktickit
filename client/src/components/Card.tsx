import type { ReactNode } from "react";

type CardProps = {
  title?: ReactNode;
  /** Heading level, so a card nested under a page heading stays in order. */
  as?: "h1" | "h2" | "h3";
  children: ReactNode;
};

/** The one surface every screen builds on: white, bordered, restrained shadow. */
export function Card({ title, as: Heading = "h2", children }: CardProps) {
  return (
    <section className="zen-card">
      {title && <Heading className="zen-card__title">{title}</Heading>}
      {children}
    </section>
  );
}
