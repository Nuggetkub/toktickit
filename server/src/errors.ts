import type { Response } from "express";

// Every error response in Lab 2 uses one shape (api-spec.md §1):
//   { "error": { "code": string, "message": string, "fieldErrors"?: {...} } }
// `code` is the stable identifier tests assert on; `message` is safe to display.
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "REQUESTER_CONTEXT_REQUIRED"
  | "IDEMPOTENCY_KEY_REQUIRED"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "TICKET_NOT_FOUND"
  | "ATTACHMENT_NOT_FOUND"
  | "ATTACHMENT_ALREADY_REMOVED"
  | "ATTACHMENT_LIMIT_REACHED"
  | "ATTACHMENT_TOO_LARGE"
  | "ATTACHMENT_TYPE_NOT_ALLOWED"
  | "REFERENCE_NOT_FOUND"
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
