import { Link } from "react-router-dom";

// MetricCard (Lab 4 ui-spec §1): one link holding a label, a large value and a
// muted line saying what is counted. Its accessible name reads as a sentence,
// "Unassigned: 4 tickets", so a screen reader hears the count with its meaning.
// A card whose count has no list page links to its panel on the same page,
// never to nowhere.

type MetricCardProps = {
  label: string;
  value: number;
  /** The noun counted, singular; "ticket" becomes "tickets" when value ≠ 1. */
  noun: string;
  explanation: string;
  to: string;
};

export function MetricCard({ label, value, noun, explanation, to }: MetricCardProps) {
  const counted = `${value} ${noun}${value === 1 ? "" : "s"}`;
  const body = (
    <>
      <span className="zen-metric__label">{label}</span>
      <span className="zen-metric__value">{value}</span>
      <span className="zen-metric__explanation">{explanation}</span>
    </>
  );
  // A same-page panel is an anchor; a list is a route.
  return to.startsWith("#") ? (
    <a className="zen-metric" href={to} aria-label={`${label}: ${counted}`}>
      {body}
    </a>
  ) : (
    <Link className="zen-metric" to={to} aria-label={`${label}: ${counted}`}>
      {body}
    </Link>
  );
}
