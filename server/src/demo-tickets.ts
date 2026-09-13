import type { PrismaClient, RequestedPriority, TicketStatus } from "@prisma/client";
import { formatTicketNumber } from "./ticket-create.js";

// Demo tickets for local development and for the Part 6 to Part 9 evidence.
//
// Lab 2 deliberately seeded no tickets (decision D-11) so that every ticket in a
// screenshot had been created through the application. Lab 3 needs a populated
// IT Staff queue — labsheet §5.3 asks for tickets spread across statuses,
// priorities and ownership — so these live here, in their own function, and the
// automated suites keep calling seedReferenceData alone and still start empty
// (decision D-13).
//
// Idempotency uses the Lab 2 unique `idempotencyKey` column: each demo ticket
// has a stable key, so a second run finds it and creates nothing.

type DemoComment = { author: string; content: string; statusChangedTo?: TicketStatus };

type DemoTicket = {
  key: string;
  requester: string;
  owner?: string;
  category: (typeof CATEGORIES)[number];
  relatedSystem: string;
  summary: string;
  description: string;
  requestedPriority: RequestedPriority;
  itPriority?: RequestedPriority;
  status: TicketStatus;
  resolutionSummary?: string;
  requesterResolved?: boolean;
  comments?: DemoComment[];
  notes?: { author: string; content: string }[];
};

const CATEGORIES = ["Account and Access", "Hardware", "Software", "Network"] as const;

const NADIA = "nadia.rahman@toktickit.local";
const SOMCHAI = "somchai.pattana@toktickit.local";
const MARISA = "marisa.chen@toktickit.local";
const TOBIAS = "tobias.lindqvist@toktickit.local";
const ARTHIT = "arthit.chaiyaporn@toktickit.local";
const GRACE = "grace.okafor@toktickit.local";
const DANIEL = "daniel.reyes@toktickit.local";

/**
 * Twelve worked examples covering every status, both assigned and unassigned,
 * a resolution indication, and the two kinds of discussion.
 */
const WORKED: DemoTicket[] = [
  {
    key: "seed-demo-001",
    requester: NADIA,
    category: "Network",
    relatedSystem: "Campus Wi-Fi",
    summary: "Cannot connect to Campus Wi-Fi in Building 4",
    description:
      "My laptop reports an authentication failure on the campus network from Monday afternoon onward. Other devices connect normally in the same room.",
    requestedPriority: "HIGH",
    status: "NEW",
  },
  {
    key: "seed-demo-002",
    requester: SOMCHAI,
    owner: ARTHIT,
    category: "Hardware",
    relatedSystem: "Corporate Laptop",
    summary: "Laptop battery drains within an hour",
    description:
      "The battery falls from a full charge to about ten percent in under an hour, even with only a browser open. It began after last week's system update.",
    requestedPriority: "MEDIUM",
    itPriority: "HIGH",
    status: "IN_PROGRESS",
    comments: [
      { author: ARTHIT, content: "Thank you for the report. I have ordered a replacement battery and will fit it on Thursday." },
      { author: SOMCHAI, content: "Thursday works for me. The machine is in office 4-218." },
    ],
    notes: [{ author: ARTHIT, content: "Battery health reads 61 percent in the diagnostics log. Replacement approved under warranty." }],
  },
  {
    key: "seed-demo-003",
    requester: MARISA,
    owner: GRACE,
    category: "Software",
    relatedSystem: "Grade Submission App",
    summary: "Grade submission fails at the final confirmation step",
    description:
      "Submitting final grades returns a generic error on the confirmation screen. The grades appear saved as a draft but never reach the registrar.",
    requestedPriority: "URGENT",
    status: "WAITING_FOR_REQUESTER",
    comments: [
      { author: GRACE, content: "Could you send the exact time of your last attempt so I can match it against the server log?" },
    ],
    notes: [{ author: GRACE, content: "Suspect the submission times out against the registrar service rather than failing validation." }],
  },
  {
    key: "seed-demo-004",
    requester: TOBIAS,
    owner: DANIEL,
    category: "Account and Access",
    relatedSystem: "VPN",
    summary: "VPN rejects my credentials from home",
    description:
      "The VPN client reports invalid credentials from my home connection, but the same account signs in normally from the office network.",
    requestedPriority: "HIGH",
    status: "RESOLVED",
    resolutionSummary: "The account was missing the remote-access group. Added it and confirmed a successful connection from an external network.",
    comments: [
      {
        author: DANIEL,
        content:
          "Resolved: the account was missing the remote-access group. Added it and confirmed a successful connection from an external network.",
        statusChangedTo: "RESOLVED",
      },
    ],
  },
  {
    key: "seed-demo-005",
    requester: NADIA,
    owner: ARTHIT,
    category: "Software",
    relatedSystem: "Email",
    summary: "Shared mailbox stopped syncing on the desktop client",
    description:
      "The departmental shared mailbox no longer updates in the desktop client, although it is current in the web interface. Restarting the client does not help.",
    requestedPriority: "MEDIUM",
    status: "CLOSED",
    resolutionSummary: "Rebuilt the local mail profile and re-added the shared mailbox. Sync confirmed by the requester.",
    comments: [
      { author: ARTHIT, content: "Resolved: rebuilt the local mail profile and re-added the shared mailbox.", statusChangedTo: "RESOLVED" },
      { author: NADIA, content: "Confirmed working again, thank you." },
    ],
  },
  {
    key: "seed-demo-006",
    requester: SOMCHAI,
    category: "Hardware",
    relatedSystem: "Printer",
    summary: "Printer on floor 3 jams on every duplex job",
    description:
      "Any double-sided job jams in the same place. Single-sided printing is unaffected. The jam clears easily but returns on the next duplex job.",
    requestedPriority: "LOW",
    status: "OPEN",
    requesterResolved: true,
    comments: [{ author: SOMCHAI, content: "The vendor engineer visited for another floor and adjusted this one too. It looks fixed now." }],
  },
  {
    key: "seed-demo-007",
    requester: MARISA,
    owner: GRACE,
    category: "Account and Access",
    relatedSystem: "LEB2 App",
    summary: "Cannot see my course workspace after the term rollover",
    description:
      "After the term rollover my course workspace is missing from the list. Colleagues teaching the same course can still open it normally.",
    requestedPriority: "HIGH",
    status: "REOPENED",
    comments: [
      { author: GRACE, content: "Resolved: re-applied the enrolment sync for the new term.", statusChangedTo: "RESOLVED" },
      { author: MARISA, content: "It worked for a day and then disappeared again this morning." },
      { author: GRACE, content: "Reopened: the enrolment sync did not persist across the nightly job.", statusChangedTo: "REOPENED" },
    ],
    notes: [{ author: GRACE, content: "Nightly job overwrites manual enrolment fixes. Raised with the LEB2 vendor." }],
  },
  {
    key: "seed-demo-008",
    requester: TOBIAS,
    category: "Software",
    relatedSystem: "Corporate Laptop",
    summary: "Request licence for statistical analysis software",
    description:
      "I need a licence for the statistical package used in the research methods course, installed on my department laptop before the term begins.",
    requestedPriority: "LOW",
    status: "CANCELLED",
    comments: [
      {
        author: DANIEL,
        content: "Cancelled: the department has purchased a site licence, so no individual request is needed.",
        statusChangedTo: "CANCELLED",
      },
    ],
  },
  {
    key: "seed-demo-009",
    requester: NADIA,
    owner: DANIEL,
    category: "Network",
    relatedSystem: "VPN",
    summary: "VPN disconnects every few minutes on mobile broadband",
    description:
      "The VPN session drops roughly every five minutes when I work from a mobile broadband connection, forcing a reconnection each time.",
    requestedPriority: "MEDIUM",
    itPriority: "MEDIUM",
    status: "IN_PROGRESS",
    notes: [{ author: DANIEL, content: "Matches the keepalive interval issue seen with one mobile carrier. Testing a longer interval." }],
  },
  {
    key: "seed-demo-010",
    requester: MARISA,
    category: "Hardware",
    relatedSystem: "Corporate Laptop",
    summary: "Docking station does not detect the second monitor",
    description:
      "The docking station drives one external monitor but never detects the second one, regardless of which port the cable uses.",
    requestedPriority: "MEDIUM",
    status: "NEW",
  },
  {
    key: "seed-demo-011",
    requester: SOMCHAI,
    owner: ARTHIT,
    category: "Account and Access",
    relatedSystem: "Email",
    summary: "New teaching assistant needs a departmental mailbox",
    description:
      "A new teaching assistant starts on Monday and needs access to the departmental mailbox and the shared calendar for the course team.",
    requestedPriority: "HIGH",
    status: "WAITING_FOR_REQUESTER",
    comments: [{ author: ARTHIT, content: "Please confirm the assistant's staff number so I can attach the correct account." }],
  },
  {
    key: "seed-demo-012",
    requester: TOBIAS,
    owner: GRACE,
    category: "Network",
    relatedSystem: "Campus Wi-Fi",
    summary: "Wi-Fi signal unusable in the seminar room",
    description:
      "The seminar room on the second floor has almost no usable signal, which makes it impossible to run the online portion of a seminar.",
    requestedPriority: "URGENT",
    itPriority: "URGENT",
    status: "OPEN",
    requesterResolved: true,
    notes: [{ author: GRACE, content: "Access point in that room is on the oldest hardware revision. Survey scheduled." }],
  },
];

// Filler so the queue has enough rows for pagination (labsheet §5.3 and the
// Part 6 evidence). Deterministic, so a second run produces the same keys and
// creates nothing.
const FILLER_SUMMARIES = [
  "Password reset for the shared lab account",
  "Projector remote missing from the teaching room",
  "Slow file access on the shared drive",
  "Mailbox over quota warning every morning",
  "Screen flickers when the laptop is undocked",
  "Cannot install the approved PDF editor",
  "Printer credit not updating after top-up",
  "Keyboard keys unresponsive after a spill",
  "Access request for the research data share",
  "Video conferencing camera not detected",
  "Duplicate calendar invitations for the course team",
  "External display shows the wrong resolution",
  "Software update fails with an unknown error",
  "Guest Wi-Fi voucher expired early",
  "Laptop fan runs constantly at full speed",
  "Email rules stopped filtering course mail",
  "Cannot join the department shared channel",
  "Desk phone forwards to the wrong extension",
  "Backup client reports an old restore point",
  "Screen sharing fails in the lecture theatre",
] as const;

const FILLER_STATUSES: TicketStatus[] = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"];
const FILLER_PRIORITIES: RequestedPriority[] = ["LOW", "MEDIUM", "HIGH", "URGENT"];
const FILLER_REQUESTERS = [NADIA, SOMCHAI, MARISA, TOBIAS];
const FILLER_OWNERS = [ARTHIT, GRACE, DANIEL];
const RELATED_SYSTEMS = ["Email", "Campus Wi-Fi", "VPN", "LEB2 App", "Grade Submission App", "Printer", "Corporate Laptop"];

const FILLER: DemoTicket[] = FILLER_SUMMARIES.map((summary, index) => {
  const status = FILLER_STATUSES[index % FILLER_STATUSES.length];
  const needsOwner = status !== "NEW" && status !== "CANCELLED";
  return {
    key: `seed-demo-1${String(index).padStart(2, "0")}`,
    requester: FILLER_REQUESTERS[index % FILLER_REQUESTERS.length],
    owner: needsOwner ? FILLER_OWNERS[index % FILLER_OWNERS.length] : undefined,
    category: CATEGORIES[index % CATEGORIES.length],
    relatedSystem: RELATED_SYSTEMS[index % RELATED_SYSTEMS.length],
    summary,
    description: `${summary}. Reported through the service desk; this demonstration record exists so the queue has realistic volume for search, filtering and paging.`,
    requestedPriority: FILLER_PRIORITIES[index % FILLER_PRIORITIES.length],
    status,
    resolutionSummary:
      status === "RESOLVED" || status === "CLOSED"
        ? "Handled by the service desk and confirmed with the requester."
        : undefined,
  };
});

export const DEMO_TICKETS: readonly DemoTicket[] = [...WORKED, ...FILLER];

export type DemoSeedResult = { created: number; skipped: number; comments: number; notes: number };

/**
 * Creates the demo tickets that do not exist yet, taking each Ticket Number from
 * the same per-year counter the application uses, so seeded and application
 * tickets never collide (Lab 2 BR-02, BR-20).
 */
export async function seedDemoTickets(prisma: PrismaClient): Promise<DemoSeedResult> {
  const result: DemoSeedResult = { created: 0, skipped: 0, comments: 0, notes: 0 };

  const [users, categories, relatedSystems] = await Promise.all([
    prisma.user.findMany({ select: { id: true, email: true } }),
    prisma.category.findMany({ select: { id: true, name: true } }),
    prisma.relatedSystem.findMany({ select: { id: true, name: true } }),
  ]);

  const userId = new Map(users.map((user) => [user.email, user.id]));
  const categoryId = new Map(categories.map((category) => [category.name, category.id]));
  const relatedSystemId = new Map(relatedSystems.map((system) => [system.name, system.id]));

  for (const demo of DEMO_TICKETS) {
    const existing = await prisma.ticket.findUnique({ where: { idempotencyKey: demo.key }, select: { id: true } });
    if (existing) {
      result.skipped += 1;
      continue;
    }

    const requesterId = userId.get(demo.requester);
    const ownerId = demo.owner ? userId.get(demo.owner) : undefined;
    const category = categoryId.get(demo.category);
    const relatedSystem = relatedSystemId.get(demo.relatedSystem);
    if (!requesterId || !category || !relatedSystem) {
      throw new Error(`Demo ticket ${demo.key} references seed data that does not exist. Run seedReferenceData first.`);
    }

    await prisma.$transaction(async (tx) => {
      const year = new Date().getUTCFullYear();
      const rows = await tx.$queryRaw<{ lastValue: number }[]>`
        INSERT INTO "TicketNumberSequence" ("year", "lastValue")
        VALUES (${year}, 1)
        ON CONFLICT ("year") DO UPDATE SET "lastValue" = "TicketNumberSequence"."lastValue" + 1
        RETURNING "lastValue"
      `;

      const ticket = await tx.ticket.create({
        data: {
          ticketNumber: formatTicketNumber(year, rows[0].lastValue),
          requesterId,
          ownerId: ownerId ?? null,
          categoryId: category,
          relatedSystemId: relatedSystem,
          summary: demo.summary,
          description: demo.description,
          requestedPriority: demo.requestedPriority,
          itPriority: demo.itPriority ?? demo.requestedPriority,
          currentStatus: demo.status,
          resolutionSummary: demo.resolutionSummary ?? null,
          requesterResolvedAt: demo.requesterResolved ? new Date() : null,
          idempotencyKey: demo.key,
        },
        select: { id: true },
      });

      for (const comment of demo.comments ?? []) {
        const authorId = userId.get(comment.author);
        if (!authorId) throw new Error(`Demo comment on ${demo.key} references an unknown author.`);
        await tx.publicComment.create({
          data: {
            ticketId: ticket.id,
            authorId,
            content: comment.content,
            statusChangedTo: comment.statusChangedTo ?? null,
          },
        });
        result.comments += 1;
      }

      for (const note of demo.notes ?? []) {
        const authorId = userId.get(note.author);
        if (!authorId) throw new Error(`Demo note on ${demo.key} references an unknown author.`);
        await tx.internalNote.create({ data: { ticketId: ticket.id, authorId, content: note.content } });
        result.notes += 1;
      }
    });

    result.created += 1;
  }

  return result;
}
