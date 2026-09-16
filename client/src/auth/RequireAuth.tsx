import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { StatusMessage } from "../components/index.js";
import type { Role } from "../api.js";
import { useAuth } from "./AuthContext.js";
import Forbidden from "./Forbidden.js";

/**
 * The route guard: signed in, past the password gate, and holding a permitted
 * role (ui-spec.md §2, §5).
 *
 * It decides only what the browser renders. The server refuses the same requests
 * on its own account — issue #47 put every endpoint behind the authorization
 * matrix — because hiding a screen is not authorization. This exists so that a
 * signed-out user sees Login instead of a screen that would fill with errors.
 */
export default function RequireAuth({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Nothing private is rendered while "who am I" is still in flight, so a
  // reload never flashes a screen the answer might then take away.
  if (loading) return <StatusMessage>Loading TokTickIT…</StatusMessage>;

  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  // BR-02: an account with an initial password may reach nothing else.
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;

  if (roles && !roles.includes(user.role)) return <Forbidden />;

  return <>{children}</>;
}
