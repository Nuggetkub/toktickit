const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface SystemStatus {
  online: boolean;
  categories: Category[];
}

export type Role = "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";

/** The signed-in user, exactly as `/api/auth/me` returns them (api-spec.md §2). */
export interface AuthUser {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
}

// Shown to the user whenever the API cannot be reached at all. A rejected fetch
// gives a raw browser error such as "TypeError: Failed to fetch", which is
// jargon; the acceptance criterion asks for a useful message instead.
export const UNREACHABLE_MESSAGE = "Unable to connect to TokTickIT API";

/**
 * Called whenever any request answers `401` — issue #48.
 *
 * It lives here rather than in each screen because ui-spec.md §2 requires *every*
 * `401` outside sign-in to end the session and clear what is on screen. A screen
 * added later cannot forget a rule it never has to remember, whereas a `catch`
 * copied into each component is one omission away from showing a signed-out user
 * the previous user's data.
 */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

/** Sign-in answers 401 for bad credentials; that is not a lost session. */
let suppressUnauthorized = false;

function noteUnauthorized(response: Response): void {
  if (response.status === 401 && !suppressUnauthorized) unauthorizedHandler?.();
}

// Every request carries the session cookie. The API is a different origin, so
// without `credentials` the browser sends nothing and every call is a 401
// (decision D-02).
const CREDENTIALS: RequestCredentials = "include";

// Wraps fetch so a network-level failure becomes a readable message rather than
// the browser's raw TypeError. HTTP responses pass straight through — those are
// handled by the status checks below.
async function request(url: string): Promise<Response> {
  try {
    const response = await fetch(url, { credentials: CREDENTIALS });
    noteUnauthorized(response);
    return response;
  } catch {
    throw new Error(UNREACHABLE_MESSAGE);
  }
}

// Issue 2 + Issue 4 — call the backend.
// Throwing on failure lets the UI show a single Offline/error state.
export async function checkSystem(): Promise<SystemStatus> {
  const health = await request(`${API_URL}/api/health`);
  if (!health.ok) {
    throw new Error(`${UNREACHABLE_MESSAGE} (health check returned ${health.status}).`);
  }

  const response = await request(`${API_URL}/api/categories`);
  if (!response.ok) {
    throw new Error(`Could not load categories (HTTP ${response.status}).`);
  }

  const categories = (await response.json()) as Category[];
  return { online: true, categories };
}

// ---------------------------------------------------------------------------
// Issue 22 — Create Ticket
// ---------------------------------------------------------------------------

export const REQUESTED_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type RequestedPriority = (typeof REQUESTED_PRIORITIES)[number];

export interface RelatedSystem {
  id: number;
  name: string;
}

export interface CreatedTicket {
  id: number;
  ticketNumber: string;
  ticketDate: string;
  requester: { id: number; fullName: string };
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
  currentStatus: string;
}

export interface NewTicket {
  categoryId: number;
  relatedSystemId: number;
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
}

/**
 * Carries the server's error envelope through to the form. `fieldErrors` is
 * what lets a server-side rule land on the field it concerns rather than as one
 * anonymous banner — the client re-checks the same rules, but the server is the
 * authority (BR-16) and its answer has to be displayable.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    readonly fieldErrors?: Record<string, string>,
    readonly status?: number,
    /** Seconds from `Retry-After`, so a throttled sign-in can say how long. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ErrorEnvelope = {
  error?: { code?: string; message?: string; fieldErrors?: Record<string, string> };
};

/**
 * Turns a failed response into the error envelope the UI can display. Shared by
 * the JSON calls and the attachment download, which fails with the same envelope
 * even though it succeeds with bytes.
 */
async function toApiError(response: Response): Promise<ApiError> {
  // Named rather than inferred: `typeof envelope` narrows to `null` after the
  // initialiser, so casting to it would collapse the parsed body to `never`.
  let envelope: ErrorEnvelope | null = null;
  try {
    envelope = (await response.json()) as ErrorEnvelope;
  } catch {
    // A non-JSON error body is itself a failure worth reporting safely.
  }

  const retryAfter = Number(response.headers?.get?.("Retry-After") ?? "");
  return new ApiError(
    envelope?.error?.message ?? "The request could not be completed.",
    envelope?.error?.code,
    envelope?.error?.fieldErrors,
    response.status,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    const response = await fetch(`${API_URL}${path}`, { credentials: CREDENTIALS, ...init });
    noteUnauthorized(response);
    return response;
  } catch {
    // The browser's raw TypeError never reaches a component (BR-43).
    throw new ApiError(UNREACHABLE_MESSAGE);
  }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  if (!response.ok) throw await toApiError(response);
  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Issue 48 — authentication (api-spec.md §2)
//
// The session lives in an HttpOnly cookie, so there is deliberately no token
// here to store, read or accidentally log. "Who am I" is a question for the
// server on every start-up, never a value cached in the client.
// ---------------------------------------------------------------------------

/** `POST /api/auth/login`. A `401` here is a wrong password, not a lost session. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  suppressUnauthorized = true;
  try {
    const body = await requestJson<{ user: AuthUser }>("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return body.user;
  } finally {
    suppressUnauthorized = false;
  }
}

/**
 * `GET /api/auth/me`. Answers `null` rather than throwing when nobody is signed
 * in: at start-up that is an ordinary answer, not a failure.
 */
export async function fetchCurrentUser(): Promise<AuthUser | null> {
  suppressUnauthorized = true;
  try {
    const response = await send("/api/auth/me");
    if (response.status === 401) return null;
    if (!response.ok) throw await toApiError(response);
    return ((await response.json()) as { user: AuthUser }).user;
  } finally {
    suppressUnauthorized = false;
  }
}

export interface PasswordChange {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** `POST /api/auth/change-password` — returns the user with the gate cleared. */
export async function changePassword(input: PasswordChange): Promise<AuthUser> {
  const body = await requestJson<{ user: AuthUser }>("/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return body.user;
}

/** `POST /api/auth/logout` — always succeeds, so signing out is safe to retry. */
export async function signOut(): Promise<void> {
  suppressUnauthorized = true;
  try {
    await send("/api/auth/logout", { method: "POST" });
  } finally {
    suppressUnauthorized = false;
  }
}

export async function fetchCategories(): Promise<Category[]> {
  return requestJson<Category[]>("/api/categories");
}

export async function fetchRelatedSystems(): Promise<RelatedSystem[]> {
  return requestJson<RelatedSystem[]>("/api/related-systems");
}

/**
 * The idempotency key travels in a header because it is transport metadata
 * rather than part of the ticket being described (decision D-01). The requester
 * is no longer sent at all: issue #47 made ownership the session's business, so
 * there is nothing here a client could forge.
 */
export async function createTicket(ticket: NewTicket, idempotencyKey: string): Promise<CreatedTicket> {
  return requestJson<CreatedTicket>("/api/tickets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(ticket),
  });
}

// ---------------------------------------------------------------------------
// Issue 24 — My Tickets
// ---------------------------------------------------------------------------

export interface TicketListItem {
  id: number;
  ticketNumber: string;
  ticketDate: string;
  summary: string;
  category: { id: number; name: string };
  relatedSystem: { id: number; name: string };
  requestedPriority: RequestedPriority;
  currentStatus: string;
  attachmentCount: number;
}

export interface TicketListResponse {
  items: TicketListItem[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface TicketListParams {
  search?: string;
  categoryId?: number;
  relatedSystemId?: number;
  requestedPriority?: RequestedPriority;
  sortBy?: "ticketDate" | "ticketNumber" | "requestedPriority";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/**
 * Only parameters with a value are sent. The API rejects unknown or empty ones
 * rather than ignoring them (BR-27), so an empty filter must be absent from the
 * query string rather than present and blank.
 */
export async function fetchTickets(params: TicketListParams): Promise<TicketListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === null) continue;
    query.set(key, String(value));
  }

  const suffix = query.toString();
  return requestJson<TicketListResponse>(`/api/tickets${suffix ? `?${suffix}` : ""}`);
}

// ---------------------------------------------------------------------------
// Issue 50 — the IT Staff Ticket Queue (api-spec.md §5)
// ---------------------------------------------------------------------------

export interface UserSummary {
  id: number;
  fullName: string;
  role: Role;
}

export interface StaffQueueRow {
  id: number;
  ticketNumber: string;
  ticketDate: string;
  summary: string;
  category: { id: number; name: string };
  requester: UserSummary;
  requestedPriority: RequestedPriority;
  itPriority: RequestedPriority;
  currentStatus: string;
  /** Null is the answer, not an omission: the queue shows "Unassigned". */
  owner: UserSummary | null;
  requesterResolvedAt: string | null;
  updatedAt: string;
}

export interface StaffQueueResponse {
  items: StaffQueueRow[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface StaffQueueParams {
  search?: string;
  currentStatus?: string;
  itPriority?: RequestedPriority;
  categoryId?: number;
  /** `me`, `unassigned`, or a user id. */
  owner?: string;
  requesterIndicated?: "true";
  sortBy?: "ticketDate" | "updatedAt" | "ticketNumber" | "itPriority" | "requestedPriority" | "currentStatus";
  sortOrder?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/**
 * Only parameters with a value are sent. The queue rejects unknown or empty ones
 * rather than ignoring them, so an empty filter must be absent from the query
 * string rather than present and blank.
 */
export async function fetchStaffQueue(params: StaffQueueParams): Promise<StaffQueueResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === null) continue;
    query.set(key, String(value));
  }

  const suffix = query.toString();
  return requestJson<StaffQueueResponse>(`/api/staff/tickets${suffix ? `?${suffix}` : ""}`);
}

/** Active IT Staff and Administrators — the Owner filter and, later, assignment. */
export async function fetchAssignees(): Promise<UserSummary[]> {
  return requestJson<UserSummary[]>("/api/staff/assignees");
}

// ---------------------------------------------------------------------------
// Issue 26 — Ticket Detail and attachments
// ---------------------------------------------------------------------------

/**
 * Attachment metadata as the API returns it (api-spec.md §4). A removed
 * attachment keeps every field it had and gains the three removal ones, because
 * BR-37 makes removal a record rather than a deletion.
 */
export interface Attachment {
  id: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: string;
  removedAt: string | null;
  removedByRequesterId: number | null;
  removalReason: string | null;
}

/**
 * The detail response: the create shape, the attachments, and the workflow
 * fields issue #51 added (api-spec.md §4).
 *
 * One interface rather than a staff-only variant, because the API returns the
 * *same* shape to every permitted role — "nothing in it is private". A second
 * type would invite the belief that a Requester receives less than they do, and
 * the real privacy boundary is Internal Notes, which are not in this shape at
 * all and are fetched from their own endpoint (BR-34).
 */
export interface TicketDetail extends CreatedTicket {
  attachments: Attachment[];
  itPriority: RequestedPriority;
  /** Null is the answer, not an omission: the screen shows "Not yet assigned". */
  owner: UserSummary | null;
  resolutionSummary: string | null;
  requesterResolvedAt: string | null;
  /** Carried back on every workflow write, which is how BR-24 detects a stale edit. */
  version: number;
}

export async function fetchTicket(ticketId: number): Promise<TicketDetail> {
  return requestJson<TicketDetail>(`/api/tickets/${ticketId}`);
}

export async function fetchAttachments(ticketId: number): Promise<Attachment[]> {
  return requestJson<Attachment[]>(`/api/tickets/${ticketId}/attachments`);
}

/**
 * One file per request, under the field name the API expects.
 *
 * `Content-Type` is deliberately not set: the browser has to write it itself so
 * that it carries the multipart boundary. Setting it by hand produces a body the
 * server cannot parse, which then looks like a validation bug rather than a
 * transport one.
 */
export async function uploadAttachment(ticketId: number, file: File): Promise<Attachment> {
  const body = new FormData();
  body.append("file", file);

  return requestJson<Attachment>(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    body,
  });
}

export async function removeAttachment(
  ticketId: number,
  attachmentId: number,
  removalReason: string,
): Promise<Attachment> {
  return requestJson<Attachment>(`/api/tickets/${ticketId}/attachments/${attachmentId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ removalReason }),
  });
}

/**
 * Downloads through fetch rather than a plain link.
 *
 * The bytes are fetched and handed to the caller to save. A plain `<a href>`
 * would work now that identity travels in a cookie, but fetching keeps the
 * failure path in one place: a refusal arrives as the documented error envelope
 * and can be shown beside the attachment, rather than as a browser error page.
 */
export async function downloadAttachment(ticketId: number, attachmentId: number): Promise<Blob> {
  const response = await send(`/api/tickets/${ticketId}/attachments/${attachmentId}/download`);
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}

// ---------------------------------------------------------------------------
// Issue 51 — the ticket workflow (api-spec.md §6)
//
// Every call carries the `version` last read and answers with the updated
// detail, so the screen always redraws from the server's answer rather than
// from what it hoped it wrote. A stale `version` comes back as
// `409 TICKET_VERSION_CONFLICT`; the body also carries the current ticket, but
// the screen deliberately refetches on Reload instead of reading it, so there
// is one path to "what does this ticket look like now" rather than two.
// ---------------------------------------------------------------------------

async function writeTicket(path: string, method: "POST" | "PATCH", body: unknown): Promise<TicketDetail> {
  return requestJson<TicketDetail>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function claimTicket(ticketId: number, version: number): Promise<TicketDetail> {
  return writeTicket(`/api/tickets/${ticketId}/claim`, "POST", { version });
}

/** `ownerId: null` unassigns. Null is sent, not omitted: it is the instruction. */
export async function setTicketOwner(ticketId: number, ownerId: number | null, version: number): Promise<TicketDetail> {
  return writeTicket(`/api/tickets/${ticketId}/owner`, "PATCH", { ownerId, version });
}

export async function setItPriority(
  ticketId: number,
  itPriority: RequestedPriority,
  version: number,
): Promise<TicketDetail> {
  return writeTicket(`/api/tickets/${ticketId}/it-priority`, "PATCH", { itPriority, version });
}

export interface StatusChange {
  toStatus: string;
  version: number;
  /** Required entering RESOLVED (BR-30). */
  resolutionSummary?: string;
  /** Required entering CANCELLED or REOPENED (BR-30). */
  reason?: string;
}

export async function changeTicketStatus(ticketId: number, input: StatusChange): Promise<TicketDetail> {
  return writeTicket(`/api/tickets/${ticketId}/status`, "POST", input);
}

// ---------------------------------------------------------------------------
// Issue 52 — comments, internal notes and the resolution indication (§7)
// ---------------------------------------------------------------------------

/**
 * One shape for both threads: the server returns the same fields, and Internal
 * Notes differ only in lacking `statusChangedTo`. Separating them into two
 * types would suggest the screens may treat them alike in some other respect —
 * the difference that matters is which endpoint answers, and who may call it.
 */
export interface DiscussionEntry {
  id: number;
  ticketId: number;
  author: UserSummary;
  content: string;
  /** Set on the comment a status change writes (BR-30). Absent on notes. */
  statusChangedTo?: string | null;
  createdAt: string;
}

/** BR-36, mirrored so the composer can refuse before a round trip. */
export const CONTENT_MIN = 1;
export const CONTENT_MAX = 2000;

export async function fetchComments(ticketId: number): Promise<DiscussionEntry[]> {
  return requestJson<DiscussionEntry[]>(`/api/tickets/${ticketId}/comments`);
}

export async function postComment(ticketId: number, content: string): Promise<DiscussionEntry> {
  return requestJson<DiscussionEntry>(`/api/tickets/${ticketId}/comments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

/**
 * IT Staff and Administrators only. A Requester is refused `403` before the
 * ticket is looked up (BR-35) — which is why no Requester screen calls this,
 * and why the Requester test asserts the request is never made at all rather
 * than that its answer was handled politely.
 */
export async function fetchInternalNotes(ticketId: number): Promise<DiscussionEntry[]> {
  return requestJson<DiscussionEntry[]>(`/api/tickets/${ticketId}/internal-notes`);
}

export async function postInternalNote(ticketId: number, content: string): Promise<DiscussionEntry> {
  return requestJson<DiscussionEntry>(`/api/tickets/${ticketId}/internal-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
}

/** The owning Requester's "Problem Appears Resolved" (BR-32). No body. */
export async function indicateResolved(ticketId: number): Promise<TicketDetail> {
  return requestJson<TicketDetail>(`/api/tickets/${ticketId}/resolution-indication`, { method: "POST" });
}
