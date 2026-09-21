import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import {
  LAB2_MIGRATIONS,
  LAB3_MIGRATION,
  applyMigration,
  dropSchema,
  resetSchema,
  schemaMatchesDatamodel,
  scratchUrl,
} from "./support.js";

// DB-01, DB-02 and DB-03 in docs/lab-03/tests.md.
//
// The point of these is that the Lab 3 migration is applied to a database that
// already holds Lab 2 data. A migration tested only against an empty schema has
// not been tested at all: renaming a table is exactly where ids and foreign keys
// get lost, and there is no undo once it has run on real data.

const SCHEMA = "lab3_migration_test";
const url = scratchUrl(SCHEMA);
const clients: PrismaClient[] = [];

function client(): PrismaClient {
  const created = new PrismaClient({ datasourceUrl: url });
  clients.push(created);
  return created;
}

/** A schema at the exact state Lab 2 left behind. */
async function buildLab2Database(): Promise<PrismaClient> {
  await resetSchema(SCHEMA);
  for (const migration of LAB2_MIGRATIONS) applyMigration(migration, url);
  return client();
}

afterAll(async () => {
  for (const prisma of clients) await prisma.$disconnect();
  await dropSchema(SCHEMA);
});

describe("Lab 3 migration against a populated Lab 2 database", () => {
  it("keeps every id, owner link and removal attribution", async () => {
    const prisma = await buildLab2Database();

    // Lab 2 rows, written through raw SQL because the Prisma client in this
    // repository already describes the Lab 3 shape.
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Category" ("id", "name", "isActive", "createdAt")
      VALUES (7, 'Network', true, CURRENT_TIMESTAMP);
      `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "RelatedSystem" ("id", "name", "isActive", "createdAt", "updatedAt")
      VALUES (9, 'Campus Wi-Fi', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Requester" ("id", "fullName", "email", "isActive", "createdAt", "updatedAt")
      VALUES
        (41, 'Nadia Rahman', '  Nadia.Rahman@TokTickIT.local ', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (42, 'Priya Anand', 'priya.anand@toktickit.local', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Ticket" (
        "id", "ticketNumber", "requesterId", "categoryId", "relatedSystemId", "summary", "description",
        "requestedPriority", "currentStatus", "idempotencyKey", "createdAt", "updatedAt"
      ) VALUES
        (51, 'TKT-2026-00051', 41, 7, 9, 'Cannot connect to Campus Wi-Fi', 'Authentication fails on the campus network from Monday.', 'HIGH', 'NEW', 'key-51', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (52, 'TKT-2026-00052', 42, 7, 9, 'Printer queue stuck', 'Jobs stay queued and never print, on the third floor printer.', 'LOW', 'NEW', NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Attachment" (
        "id", "ticketId", "storageKey", "originalFilename", "mimeType", "sizeBytes",
        "uploadedAt", "removedAt", "removedByRequesterId", "removalReason"
      ) VALUES
        (61, 51, 'storage-key-61', 'screenshot.png', 'image/png', 2048, CURRENT_TIMESTAMP, NULL, NULL, NULL),
        (62, 51, 'storage-key-62', 'wrong-file.png', 'image/png', 1024, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 41, 'Uploaded the wrong screenshot.');
      `);

    applyMigration(LAB3_MIGRATION, url);

    const migrated = client();

    // Same people, same ids, now Users with no password and a pending change.
    const nadia = await migrated.user.findUniqueOrThrow({ where: { id: 41 } });
    expect(nadia).toMatchObject({
      id: 41,
      fullName: "Nadia Rahman",
      // Normalised by the migration, so the case-insensitive unique index holds.
      email: "nadia.rahman@toktickit.local",
      role: "REQUESTER",
      isActive: true,
      passwordHash: null,
      mustChangePassword: true,
    });
    expect(await migrated.user.findUniqueOrThrow({ where: { id: 42 } })).toMatchObject({ isActive: false });

    // Ownership and numbering survive unchanged, and IT Priority is copied.
    const ticket = await migrated.ticket.findUniqueOrThrow({ where: { id: 51 } });
    expect(ticket).toMatchObject({
      id: 51,
      ticketNumber: "TKT-2026-00051",
      requesterId: 41,
      requestedPriority: "HIGH",
      itPriority: "HIGH",
      currentStatus: "NEW",
      ownerId: null,
      version: 1,
      resolutionSummary: null,
      requesterResolvedAt: null,
    });
    expect(await migrated.ticket.findUniqueOrThrow({ where: { id: 52 } })).toMatchObject({
      requesterId: 42,
      requestedPriority: "LOW",
      itPriority: "LOW",
    });

    // The soft-removal audit trail still names the person who removed the file.
    expect(await migrated.attachment.findUniqueOrThrow({ where: { id: 62 } })).toMatchObject({
      ticketId: 51,
      storageKey: "storage-key-62",
      removedByRequesterId: 41,
      removalReason: "Uploaded the wrong screenshot.",
    });
    expect(await migrated.attachment.findUniqueOrThrow({ where: { id: 61 } })).toMatchObject({ removedAt: null });

    // Nothing was dropped or recreated: the counts are what Lab 2 left.
    expect(await migrated.user.count()).toBe(2);
    expect(await migrated.ticket.count()).toBe(2);
    expect(await migrated.attachment.count()).toBe(2);

    // And a migrated account cannot sign in, because it has no password at all.
    expect(nadia.passwordHash).toBeNull();
  }, 60_000);

  it("stops before renaming anything when two emails collide once normalised", async () => {
    const prisma = await buildLab2Database();

    await prisma.$executeRawUnsafe(`
      INSERT INTO "Requester" ("id", "fullName", "email", "isActive", "createdAt", "updatedAt")
      VALUES
        (71, 'Nadia Rahman', 'nadia.rahman@toktickit.local', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        (72, 'Nadia Rahman (duplicate)', ' NADIA.RAHMAN@toktickit.local ', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
      `);

    expect(() => applyMigration(LAB3_MIGRATION, url)).toThrow();

    // The preflight must abort before the rename, leaving Lab 2 intact — a
    // half-migrated database is the one outcome with no easy way back.
    const tables = await prisma.$queryRaw<Array<{ requester: string | null; user: string | null }>>`
      SELECT to_regclass('"Requester"')::text AS requester, to_regclass('"User"')::text AS user
    `;
    expect(tables[0]?.requester).toBe(`"Requester"`);
    expect(tables[0]?.user).toBeNull();
  }, 60_000);

  it("leaves a schema that matches schema.prisma, with no drift", async () => {
    await resetSchema(SCHEMA);
    for (const migration of LAB2_MIGRATIONS) applyMigration(migration, url);
    applyMigration(LAB3_MIGRATION, url);

    // If this fails, the hand-edited SQL and the Prisma models have diverged,
    // and the next `migrate dev` would generate a surprise migration.
    expect(schemaMatchesDatamodel(url)).toBe(true);
  }, 60_000);
});
