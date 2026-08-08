const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export interface Category {
  id: number;
  name: string;
}

export interface SystemStatus {
  online: boolean;
  categories: Category[];
}

// Issue 2 + Issue 4 — call the backend.
// Throwing on failure lets the UI show a single Offline/error state. A server
// that is down makes fetch() reject on its own, so that path needs no handling
// here — it surfaces as the same Offline state.
export async function checkSystem(): Promise<SystemStatus> {
  const health = await fetch(`${API_URL}/api/health`);
  if (!health.ok) {
    throw new Error(`Health check failed (HTTP ${health.status}).`);
  }

  // TODO(Issue 4): fetch `${API_URL}/api/categories`, throw if not ok, and
  // return the real list here instead of the empty one.
  return { online: true, categories: [] };
}
