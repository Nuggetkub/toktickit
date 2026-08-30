// Validation and numbering for POST /api/tickets. Kept out of app.ts so the
// rules can be unit-tested without a database or an HTTP server — the bounds in
// BR-12 and BR-13 are exactly the sort of thing that deserves cheap, fast tests
// at the boundaries rather than a round trip each.

export const REQUESTED_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type RequestedPriorityValue = (typeof REQUESTED_PRIORITIES)[number];

// BR-12 and BR-13. Enforced after trimming, so whitespace cannot satisfy them.
export const SUMMARY_MIN = 5;
export const SUMMARY_MAX = 120;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 4000;

export type NormalizedTicket = {
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: RequestedPriorityValue;
};

export type TicketValidation =
  | { value: NormalizedTicket; fieldErrors?: never }
  | { value?: never; fieldErrors: Record<string, string> };

export function validateTicketCreate(body: unknown): TicketValidation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { fieldErrors: { body: "A JSON object is required." } };
  }

  const input = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};

  const categoryId = reference(input.categoryId, "categoryId", "Category", fieldErrors);
  const relatedSystemId = reference(input.relatedSystemId, "relatedSystemId", "Related System", fieldErrors);
  const summary = bounded(input.summary, "summary", "Summary", SUMMARY_MIN, SUMMARY_MAX, fieldErrors);
  const description = bounded(input.description, "description", "Description", DESCRIPTION_MIN, DESCRIPTION_MAX, fieldErrors);
  const requestedPriority = priority(input.requestedPriority, fieldErrors);

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };

  return {
    value: {
      categoryId: categoryId!,
      relatedSystemId: relatedSystemId!,
      summary: summary!,
      description: description!,
      requestedPriority: requestedPriority!,
    },
  };
}

/**
 * BR-02: `TKT-<YYYY>-<NNNNN>`, where the sequence restarts each calendar year.
 * The caller supplies the value taken from the per-year counter.
 */
export function formatTicketNumber(year: number, sequence: number): string {
  return `TKT-${year}-${String(sequence).padStart(5, "0")}`;
}

/**
 * Two create requests are "the same" when the five body fields match after the
 * same trimming validation applies (BR-19). The Requester is not compared here
 * because it comes from the header and is checked separately — a key reused by
 * a different Requester is still a conflict.
 */
export function isSameTicket(a: NormalizedTicket, b: NormalizedTicket): boolean {
  return (
    a.categoryId === b.categoryId &&
    a.relatedSystemId === b.relatedSystemId &&
    a.summary === b.summary &&
    a.description === b.description &&
    a.requestedPriority === b.requestedPriority
  );
}

function reference(
  value: unknown,
  field: string,
  label: string,
  fieldErrors: Record<string, string>,
): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    fieldErrors[field] = `Select a ${label}.`;
    return undefined;
  }
  return value;
}

function bounded(
  value: unknown,
  field: string,
  label: string,
  min: number,
  max: number,
  fieldErrors: Record<string, string>,
): string | undefined {
  if (typeof value !== "string") {
    fieldErrors[field] = `${label} is required.`;
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    fieldErrors[field] = `${label} must be ${min}-${max} characters.`;
    return undefined;
  }

  return trimmed;
}

function priority(value: unknown, fieldErrors: Record<string, string>): RequestedPriorityValue | undefined {
  if (typeof value !== "string" || !REQUESTED_PRIORITIES.includes(value as RequestedPriorityValue)) {
    fieldErrors.requestedPriority = `Requested Priority must be one of ${REQUESTED_PRIORITIES.join(", ")}.`;
    return undefined;
  }
  return value as RequestedPriorityValue;
}
