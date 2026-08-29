import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { StatusMessage } from "../components/index.js";
import { useRequester } from "./RequesterContext.js";

/**
 * AC-02 — a requester-scoped route opened directly shows the selector rather
 * than any ticket data.
 *
 * The guard is a route wrapper rather than a check inside each screen, so a
 * screen added later cannot forget it. It is a usability guard, not a security
 * one: the server enforces ownership on every request regardless (BR-08), and
 * this only decides what the browser renders.
 */
export default function RequireRequester({ children }: { children: ReactNode }) {
  const { requester, restoring } = useRequester();
  const location = useLocation();

  // Rendering the redirect before the stored selection has been resolved would
  // bounce a returning user to the selector on every reload.
  if (restoring) {
    return <StatusMessage>Restoring your Development Requester…</StatusMessage>;
  }

  if (requester === null) {
    return <Navigate to="/select-requester" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
