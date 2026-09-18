import type { Request, Response } from "express";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import { hashPassword } from "./password.js";
import { TERMINAL_STATUSES } from "./ticket-workflow.js";
import {
  losesOperatorAccess,
  removesLastActiveAdministrator,
  revokesSessions,
  selfProtectionRefusal,
  validateInitialPasswordReset,
  validateUserCreate,
  validateUserEdit,
  validateUserListQuery,
  type UserRole,
} from "./users-admin.js";

// Administrator user management (api-spec.md §8, FR-16).
//
// Every route is mounted behind requireRole("ADMINISTRATOR"), so IT Staff and
// Requesters are refused at step 4 — before any lookup, and identically for a
// user id that exists and one that does not (BR-18, AC-23).

/**
 * What an Administrator sees. `passwordHash` is absent by construction rather
 * than deleted afterwards: a select that never reads it cannot leak it through
 * a later `...spread` that someone adds without thinking.
 */
const adminUserSelect = {
  id: true,
  fullName: true,
  email: true,
  role: true,
  isActive: true,
  mustChangePassword: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

type AdminUserRow = Prisma.UserGetPayload<{ select: typeof adminUserSelect }>;

function userId(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function notFound(res: Response): void {
  sendError(res, 404, "USER_NOT_FOUND", "That user could not be found.");
}

/** Prisma's unique-constraint code, for the email race a pre-check cannot win. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "P2002";
}

function duplicateEmail(res: Response): void {
  sendError(res, 409, "EMAIL_ALREADY_EXISTS", "Another account already uses that email address.");
}

/**
 * BR-42's lock. Locking the active Administrator rows is what makes the count
 * that follows trustworthy: two Administrators deactivating each other at the
 * same instant both read "2 active" without it, and both proceed.
 *
 * Our api-spec says "locks the active Administrator rows", so it is a row lock
 * rather than the advisory lock my peer's contract specifies for the same rule —
 * his spec, his mechanism; ours is this one.
 */
async function lockActiveAdministrators(tx: Prisma.TransactionClient): Promise<number> {
  const rows = await tx.$queryRaw<{ id: number }[]>`
    SELECT "id" FROM "User" WHERE "role"::text = 'ADMINISTRATOR' AND "isActive" = true FOR UPDATE
  `;
  return rows.length;
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const validation = validateUserListQuery(req.query as Record<string, unknown>);
  if (!validation.value) {
    sendError(res, 400, "VALIDATION_FAILED", "The user list query is not valid.", validation.fieldErrors);
    return;
  }

  const { search, role } = validation.value;
  try {
    // BR-38: case-insensitive substring on name or email, ordered by name then
    // id. The id tie-breaker is not decoration — two people can share a name,
    // and without it their order changes between requests.
    const items = await getPrisma().user.findMany({
      where: {
        ...(role === undefined ? {} : { role }),
        ...(search === undefined
          ? {}
          : {
              OR: [
                { fullName: { contains: search, mode: "insensitive" } },
                { email: { contains: search, mode: "insensitive" } },
              ],
            }),
      },
      orderBy: [{ fullName: "asc" }, { id: "asc" }],
      select: adminUserSelect,
    });

    res.status(200).json({ items });
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/admin/users", error);
  }
}

export async function createUser(req: Request, res: Response): Promise<void> {
  const validation = validateUserCreate(req.body);
  if (!validation.value) {
    sendError(res, 400, "VALIDATION_FAILED", "The user could not be created.", validation.fieldErrors);
    return;
  }

  const input = validation.value;
  try {
    const passwordHash = await hashPassword(input.initialPassword);
    const user = await getPrisma().user.create({
      // BR-39: the account always starts requiring a password change, whoever
      // created it and whatever password they chose. It is not a field the
      // request may influence.
      data: {
        fullName: input.fullName,
        email: input.email,
        role: input.role as UserRole,
        isActive: input.isActive,
        passwordHash,
        mustChangePassword: true,
      },
      select: adminUserSelect,
    });

    res.status(201).json(user);
  } catch (error) {
    // The pre-check cannot win a race against a concurrent create, so the
    // database's unique index is the authority and this is its answer.
    if (isUniqueViolation(error)) {
      duplicateEmail(res);
      return;
    }
    sendDependencyUnavailable(res, "POST /api/admin/users", error);
  }
}

type EditOutcome =
  | { kind: "missing" }
  | { kind: "refused"; status: number; code: "CANNOT_DEACTIVATE_SELF" | "CANNOT_CHANGE_OWN_ROLE" | "LAST_ACTIVE_ADMINISTRATOR"; message: string }
  | { kind: "duplicate" }
  | { kind: "updated"; user: AdminUserRow; unassignedTicketCount: number };

export async function editUser(req: Request, res: Response): Promise<void> {
  const targetId = userId(req.params.userId);
  const validation = validateUserEdit(req.body);
  if (targetId === null) {
    notFound(res);
    return;
  }
  if (!validation.value) {
    sendError(res, 400, "VALIDATION_FAILED", "The user could not be updated.", validation.fieldErrors);
    return;
  }

  const edit = validation.value;
  const actor = currentUser(res);

  try {
    const outcome = await getPrisma().$transaction(async (tx): Promise<EditOutcome> => {
      // The lock comes first, before the target is read, so the count below and
      // the write that follows are one atomic step (BR-42).
      const activeAdministratorCount = await lockActiveAdministrators(tx);

      const target = await tx.user.findUnique({
        where: { id: targetId },
        select: { id: true, role: true, isActive: true },
      });
      if (!target) return { kind: "missing" };

      const targetRole = target.role as UserRole;

      // BR-41 before BR-42: "you cannot do this to yourself" is the truer answer
      // than "this would leave no Administrator", and it is the one the reader
      // can act on.
      const self = selfProtectionRefusal({ actorId: actor.id, targetId, targetRole, edit });
      if (self) return { kind: "refused", status: 409, code: self.code, message: self.message };

      if (
        removesLastActiveAdministrator({
          targetRole,
          targetIsActive: target.isActive,
          edit,
          activeAdministratorCount,
        })
      ) {
        return {
          kind: "refused",
          status: 409,
          code: "LAST_ACTIVE_ADMINISTRATOR",
          message: "At least one active Administrator must remain. Promote another account first.",
        };
      }

      const user = await tx.user.update({ where: { id: targetId }, data: edit, select: adminUserSelect });

      // BR-15. A rename ends nobody's session; a role change or a deactivation
      // ends every session that account holds.
      if (revokesSessions({ targetRole, targetIsActive: target.isActive, edit })) {
        await tx.session.deleteMany({ where: { userId: targetId } });
      }

      // BR-25, as one statement rather than a row-by-row loop.
      //
      // A loop that writes each ticket under its own `version` predicate and
      // does `if (count !== 1) continue` silently leaves a ticket owned by a
      // deactivated operator whenever someone else touches it first — the
      // non-blocking finding I left on my peer's PR #49. One `updateMany` keyed
      // on the owner has no such gap, and `count` is then the honest number to
      // report. `version` is incremented because the ticket really did change,
      // so a stale editor is refused by BR-24 rather than overwriting this.
      let unassignedTicketCount = 0;
      if (losesOperatorAccess({ targetRole, edit })) {
        const unassigned = await tx.ticket.updateMany({
          where: { ownerId: targetId, currentStatus: { notIn: [...TERMINAL_STATUSES] } },
          data: { ownerId: null, version: { increment: 1 } },
        });
        unassignedTicketCount = unassigned.count;
      }

      return { kind: "updated", user, unassignedTicketCount };
    });

    if (outcome.kind === "missing") {
      notFound(res);
      return;
    }
    if (outcome.kind === "refused") {
      sendError(res, outcome.status, outcome.code, outcome.message);
      return;
    }
    if (outcome.kind === "duplicate") {
      duplicateEmail(res);
      return;
    }

    res.status(200).json({ user: outcome.user, unassignedTicketCount: outcome.unassignedTicketCount });
  } catch (error) {
    if (isUniqueViolation(error)) {
      duplicateEmail(res);
      return;
    }
    sendDependencyUnavailable(res, "PATCH /api/admin/users/:userId", error);
  }
}

export async function setInitialPassword(req: Request, res: Response): Promise<void> {
  const targetId = userId(req.params.userId);
  if (targetId === null) {
    notFound(res);
    return;
  }

  try {
    // The target's email is read first because BR-11 refuses a password equal to
    // it, and that rule is about the account being changed rather than about the
    // Administrator doing the changing.
    const target = await getPrisma().user.findUnique({ where: { id: targetId }, select: { id: true, email: true } });
    if (!target) {
      notFound(res);
      return;
    }

    const validation = validateInitialPasswordReset(req.body, target.email);
    if (!validation.value) {
      sendError(res, 400, "VALIDATION_FAILED", "The initial password could not be set.", validation.fieldErrors);
      return;
    }

    const passwordHash = await hashPassword(validation.value.initialPassword);

    const user = await getPrisma().$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: targetId },
        data: { passwordHash, mustChangePassword: true },
        select: adminUserSelect,
      });
      // BR-15: a new initial password ends the account's open sessions in the
      // same transaction, so the old credential cannot outlive the new one.
      await tx.session.deleteMany({ where: { userId: targetId } });
      return updated;
    });

    // The password is never echoed, not even the one just accepted.
    res.status(200).json(user);
  } catch (error) {
    sendDependencyUnavailable(res, "POST /api/admin/users/:userId/initial-password", error);
  }
}
