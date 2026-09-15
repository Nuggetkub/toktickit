import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { Role } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { COOKIE_SECURE } from "./config.js";

// Server-side sessions (BR-13, BR-14, BR-15).
//
// The cookie carries an opaque random token; the database stores only its
// SHA-256 hash, so a stolen database row cannot be replayed as a cookie. Server
// sessions rather than a signed token because logout, deactivation and a role
// change have to take effect on the *next* request (decision D-01) — a stateless
// token stays valid until it expires unless a revocation list is added, which is
// a session table under another name.

export const SESSION_COOKIE = "toktickit_session";
export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

/** What every authenticated route needs to know about the caller. */
export type SessionUser = {
  id: number;
  fullName: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
};

const sessionUserSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  mustChangePassword: true,
} as const;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

/** Issues a session and returns the token the cookie must carry. */
export async function createSession(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt },
  });

  return { token, expiresAt };
}

/**
 * Resolves the cookie to an active user, or undefined.
 *
 * Expiry and activation are re-checked on every request (BR-14), so deactivating
 * an account ends its open sessions without anything having to hunt them down.
 * An expired or orphaned row is deleted as it is found, which keeps the table
 * from accumulating dead sessions without a scheduled job.
 */
export async function resolveSession(req: Request): Promise<SessionUser | undefined> {
  const token = sessionTokenFrom(req);
  if (!token) return undefined;

  const tokenHash = hashToken(token);
  const session = await getPrisma().session.findUnique({
    where: { tokenHash },
    select: { expiresAt: true, user: { select: sessionUserSelect } },
  });

  if (!session) return undefined;

  if (session.expiresAt <= new Date()) {
    await deleteSession(tokenHash);
    return undefined;
  }

  // The user row is the authority on activation, not the session row.
  const active = await getPrisma().user.findFirst({
    where: { id: session.user.id, isActive: true },
    select: sessionUserSelect,
  });
  if (!active) return undefined;

  return active;
}

export async function deleteSessionFor(req: Request): Promise<void> {
  const token = sessionTokenFrom(req);
  if (token) await deleteSession(hashToken(token));
}

async function deleteSession(tokenHash: string): Promise<void> {
  await getPrisma().session.deleteMany({ where: { tokenHash } });
}

/** Ends every session a user holds (BR-15): password change, reset, role change, deactivation. */
export async function deleteAllSessionsFor(userId: number): Promise<void> {
  await getPrisma().session.deleteMany({ where: { userId } });
}

export function sessionTokenFrom(req: Request): string | undefined {
  const header = req.header("cookie");
  if (!header) return undefined;

  const cookie = header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!cookie) return undefined;

  try {
    return decodeURIComponent(cookie.slice(SESSION_COOKIE.length + 1)) || undefined;
  } catch {
    return undefined;
  }
}

export function setSessionCookie(res: Response, token: string): void {
  const attributes = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${Math.floor(SESSION_LIFETIME_MS / 1000)}`,
    ...(COOKIE_SECURE ? ["Secure"] : []),
  ];
  res.append("Set-Cookie", attributes.join("; "));
}

export function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

/** The shape every authenticated response uses for the caller (api-spec.md §1). */
export function currentUserDto(user: SessionUser) {
  return {
    id: user.id,
    fullName: user.fullName,
    email: user.email,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };
}
