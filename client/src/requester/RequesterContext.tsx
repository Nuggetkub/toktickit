import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { fetchRequesters, type Requester } from "../api.js";

// Only the id is persisted (BR-07). There is no credential or token in Lab 2 to
// persist, and storing the whole requester would let a stale name or e-mail
// survive a change on the server.
const STORAGE_KEY = "toktickit.lab2.requesterId";

type RequesterContextValue = {
  requester: Requester | null;
  /** True until the stored selection has been resolved against the API. */
  restoring: boolean;
  select: (requester: Requester) => void;
  clear: () => void;
};

const RequesterContext = createContext<RequesterContextValue | null>(null);

function readStoredId(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  } catch {
    // Storage can throw in a private window. A missing selection is recoverable;
    // an exception on mount is not.
    return null;
  }
}

function writeStoredId(id: number | null): void {
  try {
    if (id === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch {
    // Selection still works for this session; it just will not survive a reload.
  }
}

export function RequesterProvider({ children }: { children: ReactNode }) {
  const [requester, setRequester] = useState<Requester | null>(null);
  const [restoring, setRestoring] = useState(true);

  // A stored id is a claim, not a fact. It is resolved against the live list of
  // *active* requesters, so a selection whose requester has since been
  // deactivated is dropped rather than silently kept (BR-06).
  useEffect(() => {
    const storedId = readStoredId();
    if (storedId === null) {
      setRestoring(false);
      return;
    }

    let cancelled = false;
    fetchRequesters()
      .then((requesters) => {
        if (cancelled) return;
        const match = requesters.find((candidate) => candidate.id === storedId) ?? null;
        if (match === null) writeStoredId(null);
        setRequester(match);
      })
      .catch(() => {
        // The API is unreachable. Keep the stored id for a later reload rather
        // than discarding a valid selection because the network blipped, but do
        // not pretend a requester is selected.
        if (!cancelled) setRequester(null);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const select = useCallback((next: Requester) => {
    writeStoredId(next.id);
    setRequester(next);
  }, []);

  // BR-11: changing requester clears the selection so requester-scoped screens
  // unmount and refetch under the new context rather than showing the previous
  // requester's data while they load.
  const clear = useCallback(() => {
    writeStoredId(null);
    setRequester(null);
  }, []);

  const value = useMemo(
    () => ({ requester, restoring, select, clear }),
    [requester, restoring, select, clear],
  );

  return <RequesterContext.Provider value={value}>{children}</RequesterContext.Provider>;
}

export function useRequester(): RequesterContextValue {
  const value = useContext(RequesterContext);
  if (value === null) {
    throw new Error("useRequester must be used inside a RequesterProvider.");
  }
  return value;
}

export const REQUESTER_STORAGE_KEY = STORAGE_KEY;
