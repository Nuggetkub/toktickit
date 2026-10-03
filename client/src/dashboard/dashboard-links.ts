// A dashboard card's `query` is the server's own list parameters for that card
// (api-spec §6), so the link is built from it rather than from a second copy
// of the rules. The list screens read the same parameters back (ui-spec §2).

/** `/queue?owner=me&currentStatus=…`, or the bare path when there is no query. */
export function linkFor(path: string, query: Record<string, string> | null): string {
  if (!query || Object.keys(query).length === 0) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, value);
  return `${path}?${params.toString()}`;
}

/** The five active statuses (Lab 4 BR-25), as the queue and My Tickets send them. */
export const ACTIVE_STATUS_LIST = "NEW,OPEN,IN_PROGRESS,WAITING_FOR_REQUESTER,REOPENED";
