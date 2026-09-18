/** Authentication for the client. Screens import from here, never from files. */
export { AuthProvider, useAuth, landingPath } from "./AuthContext.js";
export { default as Login } from "./Login.js";
export {
  default as ChangePassword,
  PASSWORD_RULES,
  // The subset an Administrator's initial-password field can honestly show: the
  // two rules needing a current password or a confirmation are excluded rather
  // than satisfied vacuously (issue #55).
  INITIAL_PASSWORD_RULES,
  type Rule,
} from "./ChangePassword.js";
export { default as RequireAuth } from "./RequireAuth.js";
export { default as Forbidden } from "./Forbidden.js";
