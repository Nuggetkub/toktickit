import type { Response } from "express";

// Every error response in Lab 2 uses one shape (api-spec.md §1):
//   { "error": { "code": string, "message": string, "fieldErrors"?: {...} } }
// `code` is the stable identifier tests assert on; `message` is safe to display.
export type ErrorCode =
  | "VALIDATION_FAILED"
  // Lab 3 authentication and authorization (api-spec.md §9). `403` enters the
  // API here for the first time, for refusals that do not depend on a resource
  // existing — so none of them discloses one (decision D-07).
  | "UNAUTHENTICATED"
  | "INVALID_CREDENTIALS"
  | "ACCOUNT_INACTIVE"
  | "LOGIN_THROTTLED"
  | "PASSWORD_CHANGE_REQUIRED"
  | "ORIGIN_REJECTED"
  | "FORBIDDEN"
  // REQUESTER_CONTEXT_REQUIRED (Lab 2) is gone, not merely unused: issue #47
  // retired the X-Dev-Requester-Id header it described, and `401 UNAUTHENTICATED`
  // took its place (api-spec.md §9). Leaving the variant in the union would let a
  // later route emit a code the contract no longer documents.
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "TICKET_NOT_FOUND"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_ALREADY_REMOVED"
  | "ATTACHMENT_LIMIT_REACHED"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_TYPE_NOT_ALLOWED"
  | "REFERENCE_NOT_FOUND"
  // Lab 3 ticket workflow (api-spec.md §6). Each names one refusal precisely,
  // because the client acts differently on each: a stale version means reload
  // and reapply, an already-assigned ticket means someone else took it first, a
  // terminal ticket means nothing more can change at all. One shared code would
  // leave the interface guessing which of those happened.
  | "TICKET_VERSION_CONFLICT"
  | "TICKET_ALREADY_ASSIGNED"
  | "INVALID_STATUS_TRANSITION"
  | "OWNER_REQUIRED"
  | "TICKET_TERMINAL"
  // Lab 3 discussion (api-spec.md §7). The indication is refused on a RESOLVED
  // or terminal ticket (BR-32). It is not TICKET_TERMINAL: a RESOLVED ticket is
  // not terminal and can still be reopened, so the two refusals mean different
  // things to the screen even though both answer 409.
  | "INDICATION_NOT_ALLOWED"
  // Lab 3 Administrator user management (api-spec.md §8). Each refusal is named
  // separately because the Administrator's next move differs for each: a
  // duplicate email means pick another address, self-deactivation means ask
  // someone else to do it, and the last-Administrator refusal means promote
  // somebody before demoting yourself. A shared CONFLICT would make the screen
  // guess which of the three happened.
  | "USER_NOT_FOUND"
  | "EMAIL_ALREADY_EXISTS"
  | "CANNOT_DEACTIVATE_SELF"
  | "CANNOT_CHANGE_OWN_ROLE"
  | "LAST_ACTIVE_ADMINISTRATOR"
  | "INTERNAL_ERROR"
  | "DEPENDENCY_UNAVAILABLE";

export function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  fieldErrors?: Record<string, string>,
): void {
  res.status(status).json({ error: { code, message, ...(fieldErrors ? { fieldErrors } : {}) } });
}

/**
 * The database or another dependency is unreachable. The real cause is logged
 * for us and never sent to the client: a stack trace or a connection string in
 * a response is exactly what BR-41 forbids.
 */
export function sendDependencyUnavailable(res: Response, context: string, cause: unknown): void {
  console.error(`${context} failed:`, cause);
  sendError(res, 503, "DEPENDENCY_UNAVAILABLE", "The service is temporarily unavailable. Please try again.");
}
