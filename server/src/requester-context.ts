import type { Request } from "express";
import { getPrisma } from "./prisma.js";

// The Development Requester travels in a header, not in the body or the query
// string (decision D-01). That keeps identity out of the resource payload, gives
// ownership checks one place to live, and makes Lab 3 a substitution at this
// single seam rather than a change to every route signature (BR-44).
//
// It is emphatically not authentication: the header is trivially forgeable and
// BR-05 says so out loud. What it buys is that every requester-scoped route
// resolves identity the same way, so when a real identity replaces it there is
// exactly one function to change.
export const REQUESTER_HEADER = "x-dev-requester-id";

export type RequesterContext = { id: number; fullName: string };

export type RequesterContextResult =
  | { requester: RequesterContext; failure?: never }
  | { requester?: never; failure: "MISSING" | "MALFORMED" | "NOT_ACTIVE" };

/**
 * Resolves the header to an active Requester. A missing header, an unparseable
 * value and an id that does not belong to an active Requester are deliberately
 * reported the same way to the client — the distinction is useful in a log, not
 * to a caller.
 */
export async function resolveRequester(req: Request): Promise<RequesterContextResult> {
  const raw = req.header(REQUESTER_HEADER);
  if (raw === undefined || raw.trim() === "") return { failure: "MISSING" };

  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return { failure: "MALFORMED" };

  const id = Number(trimmed);
  if (!Number.isSafeInteger(id) || id < 1) return { failure: "MALFORMED" };

  const requester = await getPrisma().requester.findFirst({
    where: { id, isActive: true },
    select: { id: true, fullName: true },
  });

  // An inactive Requester cannot become the active context (BR-06).
  if (!requester) return { failure: "NOT_ACTIVE" };

  return { requester };
}
