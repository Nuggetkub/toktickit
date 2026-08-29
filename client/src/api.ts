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
