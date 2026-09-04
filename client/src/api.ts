const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface SystemStatus {
  online: boolean;
  categories: Category[];
}

// A Development Requester as the selector sees one. The API deliberately
// exposes no more than this: no isActive, no timestamps (api-spec.md §2).
export interface Requester {
  id: number;
  fullName: string;
  email: string;
}

// Shown to the user whenever the API cannot be reached at all. A rejected fetch
// gives a raw browser error such as "TypeError: Failed to fetch", which is
// jargon; the acceptance criterion asks for a useful message instead.
export const UNREACHABLE_MESSAGE = "Unable to connect to TokTickIT API";

// Wraps fetch so a network-level failure becomes a readable message rather than
// the browser's raw TypeError. HTTP responses pass straight through — those are
// handled by the status checks below.
async function request(url: string): Promise<Response> {
  try {
    return await fetch(url);
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

// Issue 20 — the active Development Requesters offered by the selector.
// Inactive requesters are excluded by the API, not filtered here (BR-06): the
// client is not the thing that decides who may be selected.
export async function fetchRequesters(): Promise<Requester[]> {
  const response = await request(`${API_URL}/api/requesters`);
  if (!response.ok) {
    throw new Error("Could not load Development Requesters.");
  }
  return (await response.json()) as Requester[];
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
  return new ApiError(
    envelope?.error?.message ?? "The request could not be completed.",
    envelope?.error?.code,
    envelope?.error?.fieldErrors,
    response.status,
  );
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
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

export async function fetchCategories(): Promise<Category[]> {
  return requestJson<Category[]>("/api/categories");
}

export async function fetchRelatedSystems(): Promise<RelatedSystem[]> {
  return requestJson<RelatedSystem[]>("/api/related-systems");
}

/**
 * The Requester travels in a header, never in the body (decision D-01), and the
 * idempotency key in another — both are transport metadata rather than part of
 * the ticket being described.
 */
export async function createTicket(
  ticket: NewTicket,
  requesterId: number,
  idempotencyKey: string,
): Promise<CreatedTicket> {
  return requestJson<CreatedTicket>("/api/tickets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-Requester-Id": String(requesterId),
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
export async function fetchTickets(
  params: TicketListParams,
  requesterId: number,
): Promise<TicketListResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "" || value === null) continue;
    query.set(key, String(value));
  }

  const suffix = query.toString();
  return requestJson<TicketListResponse>(`/api/tickets${suffix ? `?${suffix}` : ""}`, {
    headers: { "X-Dev-Requester-Id": String(requesterId) },
  });
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

/** The detail response: the create shape, with the attachments filled in. */
export interface TicketDetail extends CreatedTicket {
  attachments: Attachment[];
}

export async function fetchTicket(ticketId: number, requesterId: number): Promise<TicketDetail> {
  return requestJson<TicketDetail>(`/api/tickets/${ticketId}`, {
    headers: { "X-Dev-Requester-Id": String(requesterId) },
  });
}

export async function fetchAttachments(ticketId: number, requesterId: number): Promise<Attachment[]> {
  return requestJson<Attachment[]>(`/api/tickets/${ticketId}/attachments`, {
    headers: { "X-Dev-Requester-Id": String(requesterId) },
  });
}

/**
 * One file per request, under the field name the API expects.
 *
 * `Content-Type` is deliberately not set: the browser has to write it itself so
 * that it carries the multipart boundary. Setting it by hand produces a body the
 * server cannot parse, which then looks like a validation bug rather than a
 * transport one.
 */
export async function uploadAttachment(
  ticketId: number,
  file: File,
  requesterId: number,
): Promise<Attachment> {
  const body = new FormData();
  body.append("file", file);

  return requestJson<Attachment>(`/api/tickets/${ticketId}/attachments`, {
    method: "POST",
    headers: { "X-Dev-Requester-Id": String(requesterId) },
    body,
  });
}

export async function removeAttachment(
  ticketId: number,
  attachmentId: number,
  removalReason: string,
  requesterId: number,
): Promise<Attachment> {
  return requestJson<Attachment>(`/api/tickets/${ticketId}/attachments/${attachmentId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-Dev-Requester-Id": String(requesterId),
    },
    body: JSON.stringify({ removalReason }),
  });
}

/**
 * Downloads through fetch rather than a plain link.
 *
 * The endpoint is requester-scoped and identity travels in `X-Dev-Requester-Id`
 * (D-01), and a browser navigation cannot carry a custom header — an `<a href>`
 * would arrive without context and be answered `401`. So the bytes are fetched
 * with the header and handed to the caller to save.
 */
export async function downloadAttachment(
  ticketId: number,
  attachmentId: number,
  requesterId: number,
): Promise<Blob> {
  const response = await send(`/api/tickets/${ticketId}/attachments/${attachmentId}/download`, {
    headers: { "X-Dev-Requester-Id": String(requesterId) },
  });
  if (!response.ok) throw await toApiError(response);
  return response.blob();
}
