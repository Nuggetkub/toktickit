import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  LAB2_MIGRATIONS,
  LAB3_MIGRATION,
  LAB4_MIGRATIONS,
  applyMigration,
  dropSchema,
  executeSqlFile,
  resetSchema,
  schemaMatchesDatamodel,
  schemasMatch,
  scratchUrl,
} from "../lab-03/support.js";

// DB-01 in docs/lab-04/tests.md (AC-23), plus the CHECK constraints of
// specification §7.
//
// The Lab 4 migration is applied to a database that already holds Lab 3 data,
// every Lab 3 table is compared row by row before and after, and then the
// rollback script is run and the resulting schema is compared with one built
// from the Lab 3 migrations alone. A migration tested only on an empty schema
// has not been tested, and a rollback that has never been run is a hope.

const SCHEMA = "lab4_migration_test";
const REFERENCE = "lab4_migration_lab3_reference";
const url = scratchUrl(SCHEMA);
const referenceUrl = scratchUrl(REFERENCE);
const ROLLBACK = "prisma/rollback/20260925_lab4_actions_and_history.down.sql";
const clients: PrismaClient[] = [];

/** Every table that existed at the end of Lab 3. */
const LAB3_TABLES = [
  "User",
  "Session",
  "Category",
  "RelatedSystem",
  "Ticket",
  "Attachment",
  "PublicComment",
  "InternalNote",
  "TicketNumberSequence",
] as const;

function client(target = url): PrismaClient {
  const created = new PrismaClient({ datasourceUrl: target });
  clients.push(created);
  return created;
}

afterAll(async () => {
  for (const prisma of clients) await prisma.$disconnect();
  await dropSchema(SCHEMA);
  await dropSchema(REFERENCE);
});

/** Every Lab 4 migration, in order: the tables, then the request fingerprint. */
function applyLab4(target: string): void {
  for (const migration of LAB4_MIGRATIONS) applyMigration(migration, target);
}

/** A schema at the exact state Lab 3 left behind. */
async function buildLab3Database(schema: string, target: string): Promise<void> {
  await resetSchema(schema);
  for (const migration of LAB2_MIGRATIONS) applyMigration(migration, target);
  applyMigration(LAB3_MIGRATION, target);
}

/**
 * Lab 3 data of every kind the migration must not disturb: all three roles,
 * an inactive account, a session, a Ticket in every status with and without an
 * owner, an active and a soft-removed attachment, a status-change comment, a
 * note, and the Ticket Number counter.
 */
async function populate(prisma: PrismaClient): Promise<void> {
  const category = await prisma.category.create({ data: { name: "Network" } });
  const system = await prisma.relatedSystem.create({ data: { name: "Campus Wi-Fi" } });
  const requester = await prisma.user.create({
    data: { fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", passwordHash: "scrypt$1$1$1$c2FsdA$a2V5", mustChangePassword: false },
  });
  const staff = await prisma.user.create({ data: { fullName: "Grace Okafor", email: "grace.okafor@toktickit.local", role: "IT_STAFF" } });
  await prisma.user.create({ data: { fullName: "Wichai Boonmee", email: "wichai.boonmee@toktickit.local", role: "IT_STAFF", isActive: false } });
  await prisma.user.create({ data: { fullName: "Pim Srisawat", email: "pim.srisawat@toktickit.local", role: "ADMINISTRATOR" } });
  await prisma.session.create({ data: { tokenHash: "hash-of-a-token", userId: requester.id, expiresAt: new Date(Date.UTC(2026, 8, 30)) } });
  await prisma.ticketNumberSequence.create({ data: { year: 2026, lastValue: 8 } });

  const statuses = ["NEW", "OPEN", "IN_PROGRESS", "WAITING_FOR_REQUESTER", "RESOLVED", "CLOSED", "REOPENED", "CANCELLED"] as const;
  for (const [index, status] of statuses.entries()) {
    await prisma.ticket.create({
      data: {
        ticketNumber: `TKT-2026-0000${index + 1}`,
        requesterId: requester.id,
        ownerId: status === "NEW" || status === "OPEN" ? null : staff.id,
        categoryId: category.id,
        relatedSystemId: system.id,
        summary: `A ${status} ticket`,
        description: `A Lab 3 ticket left in ${status} when the migration runs.`,
        requestedPriority: "HIGH",
        itPriority: index % 2 === 0 ? "URGENT" : "HIGH",
        currentStatus: status,
        version: index + 1,
        resolutionSummary: status === "RESOLVED" || status === "CLOSED" ? "Fixed before Lab 4 existed." : null,
        requesterResolvedAt: status === "OPEN" ? new Date(Date.UTC(2026, 8, 20)) : null,
        idempotencyKey: `lab3-key-${index + 1}`,
      },
    });
  }

  const resolved = await prisma.ticket.findFirstOrThrow({ where: { currentStatus: "RESOLVED" } });
  await prisma.attachment.createMany({
    data: [
      { ticketId: resolved.id, storageKey: "key-active", originalFilename: "screenshot.png", mimeType: "image/png", sizeBytes: 2048 },
      {
        ticketId: resolved.id,
        storageKey: "key-removed",
        originalFilename: "wrong.png",
        mimeType: "image/png",
        sizeBytes: 1024,
        removedAt: new Date(Date.UTC(2026, 8, 21)),
        removedByRequesterId: requester.id,
        removalReason: "Uploaded the wrong file.",
      },
    ],
  });
  await prisma.publicComment.create({
    data: { ticketId: resolved.id, authorId: staff.id, content: "Resolved: fixed before Lab 4 existed.", statusChangedTo: "RESOLVED" },
  });
  await prisma.internalNote.create({ data: { ticketId: resolved.id, authorId: staff.id, content: "A private note from Lab 3." } });
}

/** Every Lab 3 row, as JSON, in primary-key order: the thing that must not change. */
async function snapshot(prisma: PrismaClient): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  for (const table of LAB3_TABLES) {
    const rows = await prisma.$queryRawUnsafe<Array<{ row: string }>>(
      `SELECT row_to_json(t)::text AS row FROM "${table}" t ORDER BY 1`,
    );
    result[table] = rows.map((r) => r.row);
  }
  return result;
}

async function tableExists(prisma: PrismaClient, table: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ found: string | null }>>(`SELECT to_regclass('"${table}"')::text AS found`);
  return rows[0]?.found !== null;
}

describe("Lab 4 migration against a populated Lab 3 database", () => {
  it("adds Actions Taken and history without changing any Lab 3 row, and matches schema.prisma", async () => {
    await buildLab3Database(SCHEMA, url);
    const prisma = client();
    await populate(prisma);
    const before = await snapshot(prisma);
    expect(before.Ticket).toHaveLength(8);

    applyLab4(url);

    // Row for row, column for column, every Lab 3 table is what it was.
    expect(await snapshot(prisma)).toEqual(before);
    // Nothing invented for existing Tickets: no Actions, no history (D-07).
    expect(await prisma.actionTaken.count()).toBe(0);
    expect(await prisma.ticketStatusEvent.count()).toBe(0);
    // And the hand-edited SQL has not drifted from the Prisma models.
    expect(schemaMatchesDatamodel(url)).toBe(true);
  }, 120_000);

  it("rolls back to exactly the Lab 3 schema, keeps every Lab 3 row, and can be re-applied", async () => {
    await buildLab3Database(SCHEMA, url);
    const prisma = client();
    await populate(prisma);
    const before = await snapshot(prisma);

    // The reference: a database the Lab 3 migrations alone produce.
    await buildLab3Database(REFERENCE, referenceUrl);

    applyLab4(url);

    // The comparison must be able to fail, or its later pass means nothing:
    // migrated, the schema is NOT Lab 3's.
    expect(schemasMatch(referenceUrl, url)).toBe(false);

    // Lab 4 data exists when the rollback runs, as it would in real use.
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { currentStatus: "IN_PROGRESS" } });
    const staff = await prisma.user.findFirstOrThrow({ where: { role: "IT_STAFF", isActive: true } });
    await prisma.actionTaken.create({
      data: { ticketId: ticket.id, actionAt: new Date(), description: "Checked the cabling.", followUpRequired: false, assigneeId: staff.id, createdById: staff.id, idempotencyKey: "rollback-probe" },
    });
    await prisma.ticketStatusEvent.create({ data: { ticketId: ticket.id, fromStatus: "OPEN", toStatus: "IN_PROGRESS", actorId: staff.id } });

    executeSqlFile(ROLLBACK, url);

    expect(await tableExists(prisma, "ActionTaken")).toBe(false);
    expect(await tableExists(prisma, "TicketStatusEvent")).toBe(false);
    expect(schemasMatch(referenceUrl, url)).toBe(true);
    expect(await snapshot(prisma)).toEqual(before);

    // The round trip works: the migration applies cleanly again afterwards.
    applyLab4(url);
    expect(schemaMatchesDatamodel(url)).toBe(true);
    expect(await snapshot(prisma)).toEqual(before);
  }, 180_000);

  it("refuses, in the database itself, every state the Action rules forbid", async () => {
    await buildLab3Database(SCHEMA, url);
    const prisma = client();
    await populate(prisma);
    applyLab4(url);

    const ticket = await prisma.ticket.findFirstOrThrow({ where: { currentStatus: "IN_PROGRESS" } });
    const staff = await prisma.user.findFirstOrThrow({ where: { role: "IT_STAFF", isActive: true } });
    const base = { ticketId: ticket.id, actionAt: new Date(), description: "Replaced the access point.", assigneeId: staff.id, createdById: staff.id };
    let key = 0;
    const create = (data: Record<string, unknown>) =>
      prisma.actionTaken.create({ data: { ...base, followUpRequired: false, idempotencyKey: `check-${++key}`, ...data } as never });

    // Completed with no performer, no time, or no result.
    await expect(create({ status: "COMPLETED", completedAt: new Date(), result: "Done." })).rejects.toThrow(/ActionTaken_completed_is_complete_check/);
    await expect(create({ status: "COMPLETED", performedById: staff.id, result: "Done." })).rejects.toThrow(/ActionTaken_completed_is_complete_check/);
    await expect(create({ status: "COMPLETED", performedById: staff.id, completedAt: new Date() })).rejects.toThrow(/ActionTaken_completed_is_complete_check/);
    // Cancelled with no canceller, no time, or no reason.
    await expect(create({ status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Duplicate." })).rejects.toThrow(/ActionTaken_cancelled_is_explained_check/);
    await expect(create({ status: "CANCELLED", cancelledById: staff.id, cancelledAt: new Date() })).rejects.toThrow(/ActionTaken_cancelled_is_explained_check/);
    // A follow-up note without follow-up.
    await expect(create({ followUpNote: "Check again next week." })).rejects.toThrow(/ActionTaken_follow_up_note_check/);

    // The lifecycle rules are mutually exclusive (Earth2509's review of PR #93):
    // no status may carry another status's audit facts.
    const completion = { performedById: staff.id, completedAt: new Date() };
    const cancellation = { cancelledById: staff.id, cancelledAt: new Date(), cancellationReason: "Duplicate." };
    // Open work with completion or cancellation facts.
    await expect(create({ performedById: staff.id })).rejects.toThrow(/ActionTaken_open_is_unfinished_check/);
    await expect(create({ completedAt: new Date() })).rejects.toThrow(/ActionTaken_open_is_unfinished_check/);
    await expect(create({ cancellationReason: "Not yet." })).rejects.toThrow(/ActionTaken_open_is_unfinished_check/);
    // Completed work that also claims to be cancelled, one fact at a time.
    for (const [field, value] of Object.entries(cancellation)) {
      await expect(create({ status: "COMPLETED", ...completion, result: "Done.", [field]: value })).rejects.toThrow(/ActionTaken_completed_is_complete_check/);
    }
    // Cancelled work that also claims a performer or a completion.
    await expect(create({ status: "CANCELLED", ...cancellation, performedById: staff.id })).rejects.toThrow(/ActionTaken_cancelled_is_explained_check/);
    await expect(create({ status: "CANCELLED", ...cancellation, completedAt: new Date() })).rejects.toThrow(/ActionTaken_cancelled_is_explained_check/);
    // `result` belongs to no single status: open work and a cancelled Action may keep one (BR-03).
    await expect(create({ result: "Partly done so far." })).resolves.toBeTruthy();
    await expect(create({ status: "CANCELLED", ...cancellation, result: "Partly done before cancelling." })).resolves.toBeTruthy();

    // The positive controls: each rule admits the state it describes, so the
    // refusals above are the constraints and not something else.
    await expect(create({ status: "COMPLETED", performedById: staff.id, completedAt: new Date(), result: "Done." })).resolves.toBeTruthy();
    await expect(create({ status: "CANCELLED", cancelledById: staff.id, cancelledAt: new Date(), cancellationReason: "Duplicate." })).resolves.toBeTruthy();
    await expect(create({ followUpRequired: true, followUpNote: "Check again next week." })).resolves.toBeTruthy();
    await expect(create({ assigneeId: null })).resolves.toBeTruthy();

    // ON DELETE RESTRICT: a Ticket or User with Actions or history cannot be deleted.
    await prisma.ticketStatusEvent.create({ data: { ticketId: ticket.id, fromStatus: "OPEN", toStatus: "IN_PROGRESS", actorId: staff.id } });
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "Ticket" WHERE id = ${ticket.id}`)).rejects.toThrow(/foreign key/i);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "User" WHERE id = ${staff.id}`)).rejects.toThrow(/foreign key/i);
  }, 120_000);
});
