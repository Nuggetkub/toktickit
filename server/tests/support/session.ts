import { getPrisma } from "../../src/prisma.js";
import { createSession, SESSION_COOKIE } from "../../src/session.js";

// How the API suites identify themselves, now that issue #47 has retired the
// `X-Dev-Requester-Id` header.
//
// The session is minted directly rather than obtained by posting to
// `/api/auth/login`. Two reasons, both about keeping the Lab 2 suites honest
// rather than about convenience:
//
//   - Signing in verifies a scrypt hash at N = 2^15 on every call, and these
//     suites identify themselves several hundred times. That is seconds per file
//     spent proving something none of them is asserting.
//   - Repeated sign-ins for one email would trip the login throttle (BR-09), and
//     the Lab 2 suites would then fail for a reason with nothing to do with the
//     behaviour under test.
//
// What sign-in itself does — the credentials, the cookie attributes, the
// throttle, revocation — is asserted in `tests/lab-03/auth.api.test.ts`, and the
// guards these cookies pass through are asserted in
// `tests/lab-03/authorization.api.test.ts`. What the Lab 2 suites need is simply
// a caller the server recognises.

/** Every state-changing request needs a trusted Origin (BR-16), tests included. */
export const TEST_ORIGIN = "http://localhost:5173";

/** A `Cookie` header value carrying a live session for this user, as they are. */
export async function rawSessionCookieFor(userId: number): Promise<string> {
  const { token } = await createSession(userId);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}`;
}

/**
 * A `Cookie` header value that signs the given user in and gets them past the
 * first-login password gate.
 *
 * Clearing `mustChangePassword` is a real mutation of the shared test schema, so
 * it is worth saying why it is the right one: the seed deliberately sets that
 * flag on every account it issues a password to (BR-12), and
 * `requirePasswordChangeComplete` would otherwise answer `403` to every request
 * these suites make. They test what an established user can do; the separate
 * question of what a brand-new account must do first is asserted directly, with
 * the flag left on, in the Lab 3 suites.
 */
export async function sessionCookieFor(userId: number): Promise<string> {
  await getPrisma().user.update({
    where: { id: userId },
    data: { mustChangePassword: false },
  });

  return rawSessionCookieFor(userId);
}
