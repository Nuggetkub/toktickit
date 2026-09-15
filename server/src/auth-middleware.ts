import type { NextFunction, Request, RequestHandler, Response } from "express";
import { CLIENT_ORIGINS } from "./config.js";
import { sendError } from "./errors.js";
import { resolveSession, type SessionUser } from "./session.js";

// The checks every protected route runs, in the order api-spec.md §1 fixes
// (BR-18). Each one lives here rather than in the routes so that a new endpoint
// cannot forget one, and so #47 can apply the same guards to the Lab 2 routes.

/** The caller, once `requireAuthenticatedUser` has run. */
export function currentUser(res: Response): SessionUser {
  const user = res.locals.user as SessionUser | undefined;
  if (!user) throw new Error("currentUser() called on a route without requireAuthenticatedUser.");
  return user;
}

/**
 * Step 1 — the Origin check (BR-16, decision D-03).
 *
 * Runs before authentication, and only for state-changing methods: a `GET`
 * cannot be a CSRF write, and requiring an Origin on reads would break `curl`
 * evidence for no gain. `SameSite=Lax` already stops a cross-*site* request from
 * carrying the cookie; this stops a same-site one — another app on a different
 * localhost port — which the cookie rule does not cover.
 */
export const requireTrustedOrigin: RequestHandler = (req, res, next) => {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();

  const origin = req.header("origin");
  if (!origin || !CLIENT_ORIGINS.includes(origin)) {
    sendError(res, 403, "ORIGIN_REJECTED", "This request did not come from a trusted origin.");
    return;
  }
  next();
};

/**
 * Step 2 — a valid, unexpired session belonging to an active user (BR-14).
 *
 * Every failure is the same `401`: an absent cookie, an unknown token, an
 * expired session and a deactivated account are indistinguishable to the caller,
 * because the difference is useful in a log and not to whoever is asking.
 */
export const requireAuthenticatedUser: RequestHandler = async (req, res, next) => {
  try {
    const user = await resolveSession(req);
    if (!user) {
      sendError(res, 401, "UNAUTHENTICATED", "Sign in to continue.");
      return;
    }

    res.locals.user = user;
    // Private responses are never cached: a shared cache must not be able to
    // hand one signed-in user's data to the next.
    res.setHeader("Cache-Control", "no-store");
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Step 3 — the mandatory first-login password change (BR-02).
 *
 * Applied to everything except current-user, change-password and logout, so a
 * pending account can see who it is, fix the password, or leave — and nothing
 * else, including through a direct API call.
 */
export const requirePasswordChangeComplete: RequestHandler = (_req, res, next) => {
  const user = res.locals.user as SessionUser | undefined;
  if (!user) {
    sendError(res, 401, "UNAUTHENTICATED", "Sign in to continue.");
    return;
  }

  if (user.mustChangePassword) {
    sendError(
      res,
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Choose a new password before using the application.",
    );
    return;
  }
  next();
};

/** Wraps an async handler so a rejected promise reaches Express's error handler. */
export function asyncRoute(handler: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next: NextFunction) => {
    handler(req, res).catch(next);
  };
}
