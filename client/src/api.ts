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

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, init);
  } catch {
    // The browser's raw TypeError never reaches a component (BR-43).
    throw new ApiError(UNREACHABLE_MESSAGE);
  }

  if (!response.ok) {
    // Named rather than inferred: `typeof envelope` narrows to `null` after the
    // initialiser, so casting to it would collapse the parsed body to `never`.
    let envelope: ErrorEnvelope | null = null;
    try {
      envelope = (await response.json()) as ErrorEnvelope;
    } catch {
      // A non-JSON error body is itself a failure worth reporting safely.
    }
    throw new ApiError(
      envelope?.error?.message ?? "The request could not be completed.",
      envelope?.error?.code,
      envelope?.error?.fieldErrors,
      response.status,
    );
  }

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
