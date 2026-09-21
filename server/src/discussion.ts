import type { TicketStatus } from "@prisma/client";

// The rules for Public Comments, Internal Notes and the resolution indication
// (BR-32, BR-36, BR-37), kept apart from the route for the same reason as
// ticket-workflow.ts: the policy can be decided without a database.

/** BR-36, measured after trimming. */
export const CONTENT_MIN = 1;
export const CONTENT_MAX = 2000;

export type ContentResult =
  | { kind: "ok"; content: string }
  | { kind: "invalid"; fieldErrors: Record<string, string> };

/**
 * Trims, then measures. Whitespace alone is rejected rather than stored as an
 * empty entry in the thread (BR-36).
 *
 * Markup is deliberately **not** stripped or escaped. BR-36 says content is
 * rendered as plain text with line breaks preserved, which is the renderer's job
 * — React escapes by default. Escaping here would store `&lt;b&gt;` in the
 * database and show the entities to the next reader, corrupting the content to
 * solve a problem at the wrong layer.
 */
export function validateContent(raw: unknown): ContentResult {
  const trimmed = typeof raw === "string" ? raw.trim() : "";

  if (trimmed.length < CONTENT_MIN || trimmed.length > CONTENT_MAX) {
    return {
      kind: "invalid",
      fieldErrors: { content: `Write between ${CONTENT_MIN} and ${CONTENT_MAX} characters.` },
    };
  }

  return { kind: "ok", content: trimmed };
}

/**
 * BR-32. The Requester may say "this looks fixed to me" while the ticket is
 * still being worked on.
 *
 * RESOLVED is excluded even though it is not terminal: IT Staff have already
 * said it is fixed, so the Requester's next move is to accept it or ask for it
 * to be reopened, not to indicate.
 */
export const INDICATION_ALLOWED_FROM: readonly TicketStatus[] = [
  "NEW",
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_REQUESTER",
  "REOPENED",
];

export function indicationAllowedFrom(status: TicketStatus): boolean {
  return INDICATION_ALLOWED_FROM.includes(status);
}
