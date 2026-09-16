import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  fetchCurrentUser,
  setUnauthorizedHandler,
  signIn as signInRequest,
  signOut as signOutRequest,
  type AuthUser,
} from "../api.js";

// Who is signed in, for the whole application (ui-spec.md §2).
//
// Nothing is persisted. Lab 2 stored a requester id in localStorage because the
// "identity" was a testing convenience; a real session lives in an HttpOnly
// cookie the client cannot read, so the only honest answer to "who am I" comes
// from the server. That also means a session revoked elsewhere — a password
// change, a deactivation — is noticed on the next request rather than trusted
// from stale local state (BR-14).

type AuthContextValue = {
  user: AuthUser | null;
  /** True until `GET /api/auth/me` has answered at start-up. */
  loading: boolean;
  /** Set when a session ends mid-use, so Login can explain why (BR-47). */
  sessionEnded: boolean;
  signIn: (email: string, password: string) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  /** Replaces the cached user after a password change. */
  setUser: (user: AuthUser) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionEnded, setSessionEnded] = useState(false);

  useEffect(() => {
    let active = true;
    fetchCurrentUser()
      .then((current) => {
        if (active) setUserState(current);
      })
      .catch(() => {
        // The API is unreachable. Nobody is signed in as far as this client is
        // concerned; Login will report the connection problem when it is used.
        if (active) setUserState(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Any 401 from any endpoint ends the session here, once, for every screen.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUserState((current) => {
        // Only a *lost* session is worth announcing. A 401 while nobody is
        // signed in is just an unauthenticated request.
        if (current !== null) setSessionEnded(true);
        return null;
      });
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const signedIn = await signInRequest(email, password);
    setSessionEnded(false);
    setUserState(signedIn);
    return signedIn;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await signOutRequest();
    } finally {
      // Cleared even if the request failed: the user asked to leave, and the
      // cookie is gone from the server's point of view on any successful call.
      setSessionEnded(false);
      setUserState(null);
    }
  }, []);

  const setUser = useCallback((next: AuthUser) => setUserState(next), []);

  const value = useMemo(
    () => ({ user, loading, sessionEnded, signIn, signOut, setUser }),
    [user, loading, sessionEnded, signIn, signOut, setUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) throw new Error("useAuth must be used inside an AuthProvider.");
  return value;
}

/** Where each role starts (ui-spec.md §2). */
export function landingPath(role: AuthUser["role"]): string {
  return role === "REQUESTER" ? "/tickets" : "/workspace";
}
