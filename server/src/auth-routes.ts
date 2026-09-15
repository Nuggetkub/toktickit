import type { Request, Response } from "express";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { dummyPasswordHash, hashPassword, normalizeEmail, validateNewPassword, verifyPassword } from "./password.js";
import { clearFailures, recordFailure, throttleState } from "./login-throttle.js";
import {
  clearSessionCookie,
  createSession,
  currentUserDto,
  deleteAllSessionsFor,
  deleteSessionFor,
  setSessionCookie,
} from "./session.js";
import { currentUser } from "./auth-middleware.js";

// Sign-in, current user, password change and sign-out (api-spec.md §2).

type Credentials = { email: string; password: string };

function credentials(body: unknown): Credentials | { fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  const input = (body ?? {}) as Record<string, unknown>;

  const email = normalizeEmail(input.email);
  if (!email) fieldErrors.email = "Enter your email address.";
  if (typeof input.password !== "string" || input.password.length === 0) {
    fieldErrors.password = "Enter your password.";
  }

  if (Object.keys(fieldErrors).length > 0) return { fieldErrors };
  return { email: email!, password: input.password as string };
}

/**
 * `POST /api/auth/login`.
 *
 * The three ways to fail — unknown email, wrong password, an account the
 * migration left without a password — are one response with one message
 * (BR-06). The dummy hash is what makes that true in *time* as well as in
 * words: without it, an unknown email returns before any key derivation and the
 * difference is measurable, which would hand an attacker the account list that
 * BR-16 and the role filters exist to protect.
 */
export async function login(req: Request, res: Response): Promise<void> {
  const parsed = credentials(req.body);
  if ("fieldErrors" in parsed) {
    sendError(res, 400, "VALIDATION_FAILED", "Enter your email address and password.", parsed.fieldErrors);
    return;
  }

  const { email, password } = parsed;
  const throttle = throttleState(email);
  if (throttle.throttled) {
    // Sent even when the password is correct: the point is to stop guessing,
    // and an exception for the right password would confirm the guess (BR-09).
    res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
    sendError(res, 429, "LOGIN_THROTTLED", "Too many sign-in attempts. Try again later.");
    return;
  }

  try {
    const user = await getPrisma().user.findUnique({
      where: { email },
      select: { id: true, fullName: true, email: true, role: true, isActive: true, mustChangePassword: true, passwordHash: true },
    });

    const storedHash = user?.passwordHash ?? (await dummyPasswordHash());
    const passwordMatches = await verifyPassword(password, storedHash);

    if (!user || !user.passwordHash || !passwordMatches) {
      recordFailure(email);
      sendError(res, 401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
      return;
    }

    // Only now, with the password proven, is it safe to say the account is
    // deactivated: this tells nothing to anyone who does not already hold the
    // password (BR-07).
    if (!user.isActive) {
      recordFailure(email);
      sendError(res, 403, "ACCOUNT_INACTIVE", "This account has been deactivated. Contact your administrator.");
      return;
    }

    clearFailures(email);
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(200).json({ user: currentUserDto(user) });
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/auth/login", error);
  }
}

/** `GET /api/auth/me` — who the cookie belongs to, for the client's start-up decision. */
export async function me(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ user: currentUserDto(currentUser(res)) });
}

/**
 * `POST /api/auth/change-password`.
 *
 * A wrong current password is a `400` on that field, never a `401` (api-spec.md
 * §2): the session is perfectly valid, and the client treats every `401` as
 * "your session ended" (BR-47), so answering `401` here would sign a user out
 * for a typo.
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = currentUser(res);
  const input = (req.body ?? {}) as Record<string, unknown>;
  const currentPassword = typeof input.currentPassword === "string" ? input.currentPassword : "";

  // Read the window before validating anything, exactly as sign-in does.
  // Recording failures without checking them counts attempts that nothing ever
  // enforces, which would leave a stolen session free to guess the current
  // password indefinitely — the very thing BR-09 extends this rule to cover.
  const throttle = throttleState(user.email);
  if (throttle.throttled) {
    res.setHeader("Retry-After", String(throttle.retryAfterSeconds));
    sendError(res, 429, "LOGIN_THROTTLED", "Too many attempts. Try again later.");
    return;
  }

  const check = validateNewPassword({
    newPassword: input.newPassword,
    confirmPassword: input.confirmPassword,
    currentPassword,
    email: user.email,
  });

  if (!currentPassword) {
    const fieldErrors = { currentPassword: "Enter your current password.", ...(check.fieldErrors ?? {}) };
    sendError(res, 400, "VALIDATION_FAILED", "The password could not be changed.", fieldErrors);
    return;
  }

  try {
    const stored = await getPrisma().user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });

    const matches = stored?.passwordHash ? await verifyPassword(currentPassword, stored.passwordHash) : false;
    if (!matches) {
      // Counted against the same window as sign-in, so a stolen session cannot
      // be used to guess the current password at leisure (BR-09).
      recordFailure(user.email);
      const fieldErrors = { currentPassword: "That is not your current password.", ...(check.fieldErrors ?? {}) };
      sendError(res, 400, "VALIDATION_FAILED", "The password could not be changed.", fieldErrors);
      return;
    }

    if (check.fieldErrors) {
      sendError(res, 400, "VALIDATION_FAILED", "The password could not be changed.", check.fieldErrors);
      return;
    }

    const passwordHash = await hashPassword(input.newPassword as string);

    // Every session goes, including this one, and a fresh session replaces it
    // (BR-15). A password change is exactly when someone else's stolen cookie
    // must stop working.
    await getPrisma().$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.session.deleteMany({ where: { userId: user.id } });
    });

    clearFailures(user.email);
    const { token } = await createSession(user.id);
    setSessionCookie(res, token);
    res.status(200).json({ user: currentUserDto({ ...user, mustChangePassword: false }) });
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/auth/change-password", error);
  }
}

/**
 * `POST /api/auth/logout` — always `204`, with or without a valid session, so
 * signing out is safe to retry and never reports whether the cookie was real.
 */
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    await deleteSessionFor(req);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/auth/logout", error);
  }
}

/** Used by the Administrator routes in a later issue; kept beside its rule (BR-15). */
export { deleteAllSessionsFor };
