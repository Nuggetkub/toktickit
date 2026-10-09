import type { PrismaClient, TicketStatus } from "@prisma/client";

// Lab 4 demo activity: Actions Taken and Status Events for the demo Tickets that
// src/demo-tickets.ts creates (docs/lab-04/specification.md BR-35).
//
// Kept apart from seedDemoTickets so that a development database whose demo
// Tickets already exist from Lab 3 still receives them: that function skips a
// Ticket it finds, and would never reach new rows added to it.
//
// Idempotent in the BR-35 sense:
// - every Action carries a fixed `idempotencyKey`, and is created only when no
//   Action has that key. An existing one is never updated, so an Action edited
//   between two runs keeps the edit.
// - Status Events are written only for a Ticket that has none at all. Once the
//   application has recorded real history for a Ticket, the seed leaves it alone.
//
// Times are placed between the Ticket's own creation and now, so no Action or
// event predates its Ticket (BR-07). The one exception is a planned Action,
// which is dated in the future on purpose.

const ARTHIT = "arthit.chaiyaporn@toktickit.local";
const GRACE = "grace.okafor@toktickit.local";
const DANIEL = "daniel.reyes@toktickit.local";

type DemoAction = {
  status: "OPEN" | "COMPLETED" | "CANCELLED";
  createdBy: string;
  /** null records an assignee cleared by a deactivation (BR-17). Defaults to createdBy. */
  assignee?: string | null;
  description: string;
  result?: string;
  followUpNote?: string;
  attachmentNotes?: string;
  cancellationReason?: string;
  /** Where the Action falls between the Ticket's creation (0) and now (1). */
  at: number;
  /** For planned work: this many days after now, instead of `at`. */
  plannedInDays?: number;
};

/**
 * Actions by demo Ticket key. Tickets not listed have none, which is itself part
 * of the demonstration: zero, one and several Actions all exist (BR-35).
 */
const ACTIONS: Record<string, DemoAction[]> = {
  // IN_PROGRESS, owner Arthit: completed work plus planned work for a colleague (BR-02).
  "seed-demo-002": [
    {
      status: "COMPLETED",
      createdBy: ARTHIT,
      description: "Ran the battery diagnostics and read the health report.",
      result: "Battery health is 61 percent, below the 80 percent warranty threshold.",
      followUpNote: "Order a warranty replacement battery and book a fitting slot.",
      attachmentNotes: "Diagnostics report battery-health-0923.pdf in the Attachments tab.",
      at: 0.3,
    },
    {
      status: "OPEN",
      createdBy: ARTHIT,
      assignee: GRACE,
      description: "Fit the replacement battery in office 4-218.",
      plannedInDays: 2,
      at: 0.6,
    },
  ],
  // WAITING_FOR_REQUESTER, owner Grace: one completed Action.
  "seed-demo-003": [
    {
      status: "COMPLETED",
      createdBy: GRACE,
      description: "Compared the failed submissions with the registrar service log.",
      result: "Each failure matches a timeout from the registrar service, not a validation error.",
      at: 0.5,
    },
  ],
  // RESOLVED, owner Daniel: the gate is satisfied — no open Action, and the
  // latest completed one needs no follow-up (BR-19).
  "seed-demo-004": [
    {
      status: "COMPLETED",
      createdBy: DANIEL,
      description: "Compared the account's groups with a working remote-access account.",
      result: "The remote-access group was missing from this account.",
      followUpNote: "Add the group and test from an external network.",
      at: 0.3,
    },
    {
      status: "COMPLETED",
      createdBy: DANIEL,
      description: "Added the remote-access group and tested from a mobile hotspot.",
      result: "VPN connected and stayed up for ten minutes from an external network.",
      at: 0.6,
    },
  ],
  // CLOSED, owner Arthit: one completed Action.
  "seed-demo-005": [
    {
      status: "COMPLETED",
      createdBy: ARTHIT,
      description: "Rebuilt the local mail profile and re-added the shared mailbox.",
      result: "The shared mailbox synced within two minutes on the desktop client.",
      at: 0.5,
    },
  ],
  // REOPENED, owner Grace: every Action status on one Ticket — a completed fix
  // that did not hold, a cancelled idea, and open work that is now overdue.
  "seed-demo-007": [
    {
      status: "COMPLETED",
      createdBy: GRACE,
      description: "Re-applied the enrolment sync for the new term.",
      result: "The course workspace appeared in the list again.",
      at: 0.2,
    },
    {
      status: "CANCELLED",
      createdBy: GRACE,
      description: "Re-create the course workspace from the template.",
      cancellationReason: "Would lose the term's submissions; the vendor fix is the safer route.",
      at: 0.4,
    },
    {
      status: "OPEN",
      createdBy: GRACE,
      assignee: ARTHIT,
      description: "Chase the LEB2 vendor for a fix to the nightly enrolment job.",
      at: 0.6,
    },
  ],
  // CANCELLED Ticket: its open Action was cancelled with it (BR-20).
  "seed-demo-008": [
    {
      status: "CANCELLED",
      createdBy: DANIEL,
      description: "Request an individual licence quote from the vendor.",
      cancellationReason: "Cancelled with the ticket: the department has purchased a site licence.",
      at: 0.5,
    },
  ],
  // IN_PROGRESS, owner Daniel: an open Action whose assignee was cleared when
  // Wichai Boonmee went on leave and was deactivated (BR-17).
  "seed-demo-009": [
    {
      status: "OPEN",
      createdBy: DANIEL,
      assignee: null,
      description: "Test a longer VPN keepalive interval on the affected mobile carrier.",
      at: 0.5,
    },
  ],
  // OPEN, owner Grace: planned work only.
  "seed-demo-012": [
    {
      status: "OPEN",
      createdBy: GRACE,
      description: "Run a wireless site survey in the second-floor seminar room.",
      attachmentNotes: "The floor plan seminar-room-2F.png is in the Attachments tab.",
      plannedInDays: 3,
      at: 0.5,
    },
  ],
};

/** The status path a Ticket in each status plausibly took, from creation. */
const PATHS: Record<TicketStatus, TicketStatus[]> = {
  NEW: ["NEW"],
  OPEN: ["NEW", "OPEN"],
  IN_PROGRESS: ["NEW", "OPEN", "IN_PROGRESS"],
  WAITING_FOR_REQUESTER: ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER"],
  RESOLVED: ["NEW", "OPEN", "IN_PROGRESS", "RESOLVED"],
  CLOSED: ["NEW", "OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  REOPENED: ["NEW", "OPEN", "IN_PROGRESS", "RESOLVED", "REOPENED"],
  CANCELLED: ["NEW", "CANCELLED"],
};

export type DemoActivityResult = { actionsCreated: number; actionsSkipped: number; eventsCreated: number; ticketsGivenHistory: number };

/** The key of the n-th demo Action on a demo Ticket; stable across runs. */
export function demoActionKey(ticketKey: string, index: number): string {
  return `seed-action-${ticketKey}-${index + 1}`;
}

/**
 * Adds the demo Actions and Status Events that do not exist yet. Requires
 * seedReferenceData and seedDemoTickets to have run.
 */
export async function seedDemoActivity(prisma: PrismaClient, now = new Date()): Promise<DemoActivityResult> {
  const result: DemoActivityResult = { actionsCreated: 0, actionsSkipped: 0, eventsCreated: 0, ticketsGivenHistory: 0 };

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  const userId = new Map(users.map((user) => [user.email, user.id]));
  const idOf = (email: string): number => {
    const id = userId.get(email);
    if (!id) throw new Error(`Demo activity references ${email}, which does not exist. Run seedReferenceData first.`);
    return id;
  };

  const tickets = await prisma.ticket.findMany({
    where: { idempotencyKey: { startsWith: "seed-demo-" } },
    select: { id: true, idempotencyKey: true, currentStatus: true, requesterId: true, ownerId: true, createdAt: true, _count: { select: { statusEvents: true } } },
    orderBy: { id: "asc" },
  });
  const byKey = new Map(tickets.map((ticket) => [ticket.idempotencyKey!, ticket]));

  const at = (createdAt: Date, fraction: number) => new Date(createdAt.getTime() + (now.getTime() - createdAt.getTime()) * fraction);

  for (const [ticketKey, actions] of Object.entries(ACTIONS)) {
    const ticket = byKey.get(ticketKey);
    if (!ticket) throw new Error(`Demo ticket ${ticketKey} does not exist. Run seedDemoTickets first.`);

    for (const [index, demo] of actions.entries()) {
      const key = demoActionKey(ticketKey, index);
      if (await prisma.actionTaken.findUnique({ where: { idempotencyKey: key }, select: { id: true } })) {
        result.actionsSkipped += 1;
        continue;
      }
      const when = demo.plannedInDays !== undefined
        ? new Date(now.getTime() + demo.plannedInDays * 24 * 60 * 60 * 1000)
        : at(ticket.createdAt, demo.at);
      const creator = idOf(demo.createdBy);
      await prisma.actionTaken.create({
        data: {
          ticketId: ticket.id,
          idempotencyKey: key,
          actionAt: when,
          description: demo.description,
          result: demo.result ?? null,
          followUpRequired: demo.followUpNote !== undefined,
          followUpNote: demo.followUpNote ?? null,
          attachmentNotes: demo.attachmentNotes ?? null,
          status: demo.status,
          createdById: creator,
          assigneeId: demo.assignee === null ? null : demo.assignee ? idOf(demo.assignee) : creator,
          // A completed demo Action was done by the person who recorded it, when
          // they recorded it (BR-05). It takes no place in the history order
          // (completionSeq, D-16), so it counts as done before any reopen: true
          // of every demo Action, whose times all precede the demo's last event.
          ...(demo.status === "COMPLETED" ? { performedById: creator, completedAt: when } : {}),
          ...(demo.status === "CANCELLED"
            ? { cancelledById: creator, cancelledAt: when, cancellationReason: demo.cancellationReason! }
            : {}),
        },
      });
      result.actionsCreated += 1;
    }
  }

  for (const ticket of tickets) {
    if (ticket._count.statusEvents > 0) continue;

    // Creation by the Requester; every later change by the owner, or by the
    // first IT Staff member when the demo Ticket has none.
    const path = PATHS[ticket.currentStatus];
    const staff = ticket.ownerId ?? idOf(ticket.idempotencyKey === "seed-demo-008" ? DANIEL : ARTHIT);
    // Creation at the Ticket's own time, the middle steps early on, and the
    // last change near now, after every demo Action on the Ticket.
    const fractions = path.map((_, i) => (i === 0 ? 0 : i === path.length - 1 ? 0.9 : 0.1 + (0.4 * (i - 1)) / Math.max(1, path.length - 2)));
    await prisma.ticketStatusEvent.createMany({
      data: path.map((toStatus, i) => ({
        ticketId: ticket.id,
        fromStatus: i === 0 ? null : path[i - 1],
        toStatus,
        actorId: i === 0 ? ticket.requesterId : staff,
        createdAt: at(ticket.createdAt, fractions[i]),
      })),
    });
    result.eventsCreated += path.length;
    result.ticketsGivenHistory += 1;
  }

  return result;
}

// Re-exported for the seed test, which checks that the demo covers what BR-35 promises.
export const DEMO_ACTIONS: Readonly<Record<string, readonly DemoAction[]>> = ACTIONS;
