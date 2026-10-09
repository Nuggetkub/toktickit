import type { Prisma } from "@prisma/client";

/**
 * True when the user is an active IT Staff member or Administrator, and holds a
 * share lock on their row until the transaction ends.
 *
 * Every assignment of work to a person uses this: an Action's assignee (Lab 4
 * BR-06), a Ticket Owner (Lab 3 BR-21), and a claim (Lab 3 BR-22). A plain read
 * is not enough. It sees the last committed version of the user, so a
 * deactivation that has updated the user and already cleared their open work,
 * but has not yet committed, is invisible to it. The assignment then writes
 * after the cleanup, and open work is left with someone who can no longer sign
 * in. Earth2509 found this in review of PR #94.
 *
 * With the share lock, the two serialise, because a deactivation or a role
 * change updates this row:
 * - if the deactivation is first, this waits, then Postgres re-checks the WHERE
 *   against the committed row and finds it inactive, so the answer is false;
 * - if the assignment is first, the deactivation waits, and its cleanup then
 *   sees the committed assignment and clears it.
 *
 * Lock order. The deactivation locks the user, then the Tickets it unassigns.
 * A caller that also takes a Ticket lock must take this one first, or the two
 * can deadlock.
 */
export async function lockEligibleOperator(tx: Prisma.TransactionClient, userId: number): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ id: number }>>`
    SELECT "id" FROM "User"
    WHERE "id" = ${userId} AND "isActive" = true AND "role" IN ('IT_STAFF', 'ADMINISTRATOR')
    FOR SHARE
  `;
  return rows.length === 1;
}
