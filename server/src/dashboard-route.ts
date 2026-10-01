import type { Request, Response } from "express";
import { Prisma, type PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";
import { sendDependencyUnavailable, sendError } from "./errors.js";
import { currentUser } from "./auth-middleware.js";
import { ACTIVE_STATUSES, TICKET_STATUSES } from "./status-filter.js";

// GET /api/dashboard/requester and GET /api/dashboard/staff (api-spec.md §6,
// specification BR-25 to BR-29, issue #84).
//
// Every number is the server's. Each response is read inside one read-only
// REPEATABLE READ transaction, so a card and its breakdown, or a card and the
// list beside it, come from the same snapshot and cannot disagree (BR-25).
// Roles are refused by requireRole before this runs (BR-29), so a refusal never
// depends on, or reveals, what the data holds.
//
// "Now" is the database's own clock, read inside that transaction. The 168-hour
// window is compared with TicketStatusEvent.createdAt, which the database
// writes, so the window and the events share one clock (D-08, and the lesson of
// D-16: never compare two clocks).

type Tx = Prisma.TransactionClient;

const WINDOW_HOURS = 168;
const ACTIVE = [...ACTIVE_STATUSES];
const ACTIVE_QUERY = ACTIVE.join(",");
const PRIORITIES = ["URGENT", "HIGH", "MEDIUM", "LOW"] as const;
const ROLES = ["REQUESTER", "IT_STAFF", "ADMINISTRATOR"] as const;

/** A dashboard takes no parameters (api-spec §6). One sent by mistake is refused, not ignored. */
function refuseParameters(req: Request, res: Response): boolean {
  const keys = Object.keys(req.query);
  if (keys.length === 0) return false;
  const fieldErrors = Object.fromEntries(keys.map((key) => [key, "This endpoint takes no query parameters."]));
  sendError(res, 400, "VALIDATION_FAILED", "The dashboard takes no query parameters.", fieldErrors);
  return true;
}

async function snapshot<T>(prisma: PrismaClient, read: (tx: Tx, now: Date) => Promise<T>): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT now() AS now`;
      return read(tx, now);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}

const card = (value: number, query: Record<string, string> | null) => ({ value, query });

// ---------------------------------------------------------------------------
// Requester (BR-26)
// ---------------------------------------------------------------------------

const requesterCardSelect = {
  id: true,
  ticketNumber: true,
  summary: true,
  currentStatus: true,
  requestedPriority: true,
  updatedAt: true,
} satisfies Prisma.TicketSelect;

const newestFirst: Prisma.TicketOrderByWithRelationInput[] = [{ updatedAt: "desc" }, { id: "desc" }];

export async function requesterDashboard(req: Request, res: Response): Promise<void> {
  if (refuseParameters(req, res)) return;
  const requesterId = currentUser(res).id;

  try {
    const body = await snapshot(getPrisma(), async (tx, now) => {
      const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
      const own = { requesterId };

      const activeTickets = await tx.ticket.count({ where: { ...own, currentStatus: { in: ACTIVE } } });
      const waiting = await tx.ticket.count({ where: { ...own, currentStatus: "WAITING_FOR_REQUESTER" } });
      const resolved = await tx.ticket.count({ where: { ...own, currentStatus: "RESOLVED" } });
      const all = await tx.ticket.count({ where: own });

      // R-4 and the Recently resolved list: one row per Ticket, at the time of its
      // latest event into RESOLVED, kept when that is inside the window. A Ticket
      // resolved twice counts once, and by its later resolution.
      const resolutions = await tx.$queryRaw<Array<{ ticketId: number; resolvedAt: Date }>>`
        SELECT e."ticketId" AS "ticketId", max(e."createdAt") AS "resolvedAt"
        FROM "TicketStatusEvent" e
        JOIN "Ticket" t ON t."id" = e."ticketId"
        WHERE e."toStatus" = 'RESOLVED' AND t."requesterId" = ${requesterId}
        GROUP BY e."ticketId"
        HAVING max(e."createdAt") >= ${windowStart}
        ORDER BY max(e."createdAt") DESC, e."ticketId" DESC`;

      // Needs your attention: WAITING_FOR_REQUESTER first, then RESOLVED (BR-26).
      const waitingRows = await tx.ticket.findMany({ where: { ...own, currentStatus: "WAITING_FOR_REQUESTER" }, orderBy: newestFirst, take: 5, select: requesterCardSelect });
      const resolvedRows = waitingRows.length < 5
        ? await tx.ticket.findMany({ where: { ...own, currentStatus: "RESOLVED" }, orderBy: newestFirst, take: 5 - waitingRows.length, select: requesterCardSelect })
        : [];

      const recentlyUpdated = await tx.ticket.findMany({ where: own, orderBy: newestFirst, take: 5, select: requesterCardSelect });

      const shown = resolutions.slice(0, 5);
      const resolvedCards = await tx.ticket.findMany({ where: { id: { in: shown.map((r) => r.ticketId) } }, select: requesterCardSelect });
      const byId = new Map(resolvedCards.map((t) => [t.id, t]));

      return {
        generatedAt: now,
        windowStart,
        cards: {
          activeTickets: card(activeTickets, { currentStatus: ACTIVE_QUERY }),
          waitingForMe: card(waiting, { currentStatus: "WAITING_FOR_REQUESTER" }),
          resolvedAwaitingClosure: card(resolved, { currentStatus: "RESOLVED" }),
          resolvedLast7Days: card(resolutions.length, null),
        },
        lists: {
          needsAttention: { total: waiting + resolved, items: [...waitingRows, ...resolvedRows] },
          recentlyUpdated: { total: all, items: recentlyUpdated },
          recentlyResolved: {
            total: resolutions.length,
            items: shown.map((r) => ({ ...byId.get(r.ticketId)!, resolvedAt: r.resolvedAt })),
          },
        },
      };
    });
    res.status(200).json(body);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/dashboard/requester", error);
  }
}

// ---------------------------------------------------------------------------
// IT Staff and Administrator (BR-27, BR-28)
// ---------------------------------------------------------------------------

const staffCardSelect = {
  id: true,
  ticketNumber: true,
  summary: true,
  currentStatus: true,
  itPriority: true,
  owner: { select: { id: true, fullName: true, role: true } },
  updatedAt: true,
} satisfies Prisma.TicketSelect;

export async function staffDashboard(req: Request, res: Response): Promise<void> {
  if (refuseParameters(req, res)) return;
  const caller = currentUser(res);

  try {
    const body = await snapshot(getPrisma(), async (tx, now) => {
      const windowStart = new Date(now.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
      const active = { currentStatus: { in: ACTIVE } };

      const unassignedActive = await tx.ticket.count({ where: { ...active, ownerId: null } });
      const myActive = await tx.ticket.count({ where: { ...active, ownerId: caller.id } });
      // S-3 needs no status condition: an open Action exists only on an active
      // Ticket (BR-12, BR-20). The API test asserts that rather than assuming it.
      const myOpenActionsWhere: Prisma.ActionTakenWhereInput = { status: "OPEN", assigneeId: caller.id };
      const myOpenActions = await tx.actionTaken.count({ where: myOpenActionsWhere });
      const requesterIndicated = await tx.ticket.count({ where: { ...active, requesterResolvedAt: { not: null } } });

      const statusCounts = await tx.ticket.groupBy({ by: ["currentStatus"], _count: { _all: true } });
      const priorityCounts = await tx.ticket.groupBy({ by: ["itPriority"], where: active, _count: { _all: true } });
      const countOf = <K extends string>(rows: Array<Record<string, unknown> & { _count: { _all: number } }>, key: string, value: K) =>
        rows.find((row) => row[key] === value)?._count._all ?? 0;

      const openActions = await tx.actionTaken.findMany({
        where: myOpenActionsWhere,
        orderBy: [{ actionAt: "asc" }, { id: "asc" }],
        take: 10,
        select: { id: true, ticketId: true, actionAt: true, description: true, ticket: { select: { ticketNumber: true, summary: true } } },
      });
      const urgentWhere: Prisma.TicketWhereInput = { ...active, itPriority: "URGENT" };
      const urgentTotal = await tx.ticket.count({ where: urgentWhere });
      const urgent = await tx.ticket.findMany({ where: urgentWhere, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: 5, select: staffCardSelect });
      const allTickets = await tx.ticket.count();
      const recentlyUpdated = await tx.ticket.findMany({ orderBy: newestFirst, take: 10, select: staffCardSelect });

      const users = caller.role === "ADMINISTRATOR"
        ? await (async () => {
            const counts = await tx.user.groupBy({ by: ["role", "isActive"], _count: { _all: true } });
            const of = (role: string, isActive: boolean) =>
              counts.find((row) => row.role === role && row.isActive === isActive)?._count._all ?? 0;
            return Object.fromEntries(ROLES.map((role) => [role, { active: of(role, true), inactive: of(role, false), query: { role } }]));
          })()
        : undefined;

      return {
        generatedAt: now,
        windowStart,
        cards: {
          unassignedActive: card(unassignedActive, { owner: "unassigned", currentStatus: ACTIVE_QUERY }),
          myActive: card(myActive, { owner: "me", currentStatus: ACTIVE_QUERY }),
          myOpenActions: card(myOpenActions, null),
          requesterIndicated: card(requesterIndicated, { requesterIndicated: "true", currentStatus: ACTIVE_QUERY }),
        },
        byStatus: Object.fromEntries(
          TICKET_STATUSES.map((status) => [status, card(countOf(statusCounts, "currentStatus", status), { currentStatus: status })]),
        ),
        activeByItPriority: Object.fromEntries(
          PRIORITIES.map((priority) => [priority, card(countOf(priorityCounts, "itPriority", priority), { itPriority: priority, currentStatus: ACTIVE_QUERY })]),
        ),
        lists: {
          myOpenActions: {
            total: myOpenActions,
            items: openActions.map((a) => ({
              actionId: a.id,
              ticketId: a.ticketId,
              ticketNumber: a.ticket.ticketNumber,
              summary: a.ticket.summary,
              actionAt: a.actionAt,
              description: a.description,
            })),
          },
          urgentActive: { total: urgentTotal, items: urgent },
          recentlyUpdated: { total: allTickets, items: recentlyUpdated },
        },
        // BR-28: present only for an Administrator; absent, not null, for IT Staff.
        ...(users ? { users } : {}),
      };
    });
    res.status(200).json(body);
  } catch (error) {
    sendDependencyUnavailable(res, "GET /api/dashboard/staff", error);
  }
}
