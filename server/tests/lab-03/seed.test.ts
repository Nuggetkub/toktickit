import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPMENT_PASSWORD, USERS, seedReferenceData } from "../../src/seed-data.js";
import { seedDemoTickets } from "../../src/demo-tickets.js";
import { verifyPassword } from "../../src/password.js";
import { deployMigrations, dropSchema, resetSchema, scratchUrl } from "./support.js";

// DB-04, and the part of DB-05 that exists in this increment.
//
// This runs in a schema of its own because the demo seed creates about thirty
// tickets; in the shared test schema they would change what the Lab 2 My Tickets
// suites see, and those assert on a requester's exact ticket list.

const SCHEMA = "lab3_seed_test";
const url = scratchUrl(SCHEMA);
let prisma: PrismaClient;

beforeAll(async () => {
  await resetSchema(SCHEMA);
  deployMigrations(url);
  prisma = new PrismaClient({ datasourceUrl: url });
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await dropSchema(SCHEMA);
});

describe("the Lab 3 seed", () => {
  it("creates the accounts the labsheet requires", async () => {
    await seedReferenceData(prisma);

    const users = await prisma.user.findMany();
    const count = (role: string, isActive: boolean) =>
      users.filter((user) => user.role === role && user.isActive === isActive).length;

    // Labsheet §5.3 minimums.
    expect(count("REQUESTER", true)).toBeGreaterThanOrEqual(4);
    expect(count("REQUESTER", false)).toBeGreaterThanOrEqual(1);
    expect(count("IT_STAFF", true)).toBeGreaterThanOrEqual(3);
    expect(count("IT_STAFF", false)).toBeGreaterThanOrEqual(1);
    expect(count("ADMINISTRATOR", true)).toBeGreaterThanOrEqual(1);

    expect(await prisma.category.count()).toBe(4);
    expect(await prisma.relatedSystem.count()).toBeGreaterThanOrEqual(6);
  });

  it("gives every seeded account the documented development password", async () => {
    const users = await prisma.user.findMany();

    for (const user of users) {
      expect(user.passwordHash).not.toBeNull();
      await expect(verifyPassword(DEVELOPMENT_PASSWORD, user.passwordHash!)).resolves.toBe(true);
    }

    // Every one of them is left requiring a change, because the seed issued the
    // password (BR-12). There is no seeded account that can reach the
    // application without choosing its own password first.
    expect(users.filter((user) => !user.mustChangePassword)).toEqual([]);
  });

  it("creates nothing on a second run and never resets a changed password", async () => {
    const before = {
      users: await prisma.user.count(),
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
    };

    // Somebody changes their password, and a fixture is deactivated by hand.
    const target = await prisma.user.findFirstOrThrow({ where: { role: "REQUESTER", isActive: true } });
    await prisma.user.update({
      where: { id: target.id },
      data: { passwordHash: "scrypt$32768$8$3$c2FsdA$a2V5", mustChangePassword: false, isActive: false },
    });

    await seedReferenceData(prisma);

    expect(await prisma.user.count()).toBe(before.users);
    expect(await prisma.category.count()).toBe(before.categories);
    expect(await prisma.relatedSystem.count()).toBe(before.relatedSystems);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    // Activation is restored, because that is state a demonstration flips and
    // the seed must be able to put back...
    expect(after.isActive).toBe(true);
    // ...but the password is not, because re-seeding must never undo a password
    // somebody has chosen (BR-44).
    expect(after.passwordHash).toBe("scrypt$32768$8$3$c2FsdA$a2V5");
  });

  it("provisions a migrated Requester that has no password, and only then", async () => {
    // The state the migration leaves a Lab 2 Requester in (BR-43).
    const migrated = await prisma.user.create({
      data: {
        fullName: "Migrated Requester",
        email: "migrated.requester@toktickit.local",
        role: "REQUESTER",
        isActive: true,
        passwordHash: null,
        mustChangePassword: true,
      },
    });

    // Not one of the seeded fixtures, so the seed leaves it untouched: an
    // account the Administrator must provision instead (BR-12, BR-43).
    await seedReferenceData(prisma);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: migrated.id } })).passwordHash).toBeNull();

    // A seeded fixture whose hash the migration left empty is filled in, which
    // is how the four Lab 2 Requesters receive their initial password.
    const fixture = USERS.find((user) => user.role === "REQUESTER" && user.isActive)!;
    // Exactly the state the migration leaves behind: no password, and the gate
    // on. `mustChangePassword: false` is set here deliberately, so that if the
    // seed ever cleared the gate again this assertion would catch it.
    await prisma.user.update({
      where: { email: fixture.email },
      data: { passwordHash: null, mustChangePassword: false },
    });
    await seedReferenceData(prisma);

    const provisioned = await prisma.user.findUniqueOrThrow({ where: { email: fixture.email } });
    expect(provisioned.passwordHash).not.toBeNull();
    await expect(verifyPassword(DEVELOPMENT_PASSWORD, provisioned.passwordHash!)).resolves.toBe(true);
    // DB-05: receiving the development password does not admit the account to
    // the application — it must still choose its own password first (BR-12).
    expect(provisioned.mustChangePassword).toBe(true);
  });
});

describe("the demo tickets", () => {
  it("fills the queue across every status, with and without an owner", async () => {
    const result = await seedDemoTickets(prisma);

    expect(result.created).toBeGreaterThanOrEqual(30);
    expect(result.comments).toBeGreaterThan(0);
    expect(result.notes).toBeGreaterThan(0);

    const tickets = await prisma.ticket.findMany({ select: { currentStatus: true, ownerId: true, itPriority: true, requestedPriority: true } });
    const statuses = new Set(tickets.map((ticket) => ticket.currentStatus));
    expect([...statuses].sort()).toEqual(
      ["CANCELLED", "CLOSED", "IN_PROGRESS", "NEW", "OPEN", "REOPENED", "RESOLVED", "WAITING_FOR_REQUESTER"],
    );

    expect(tickets.some((ticket) => ticket.ownerId !== null)).toBe(true);
    expect(tickets.some((ticket) => ticket.ownerId === null)).toBe(true);
    expect(new Set(tickets.map((ticket) => ticket.requestedPriority)).size).toBe(4);

    // At least one ticket carries the Requester's "problem appears resolved"
    // signal, so the queue evidence can show the marker (BR-32).
    expect(await prisma.ticket.count({ where: { requesterResolvedAt: { not: null } } })).toBeGreaterThanOrEqual(1);

    // Every owner is an IT Staff member or an Administrator (BR-21).
    const owners = await prisma.user.findMany({
      where: { id: { in: tickets.map((ticket) => ticket.ownerId).filter((id): id is number => id !== null) } },
      select: { role: true },
    });
    expect(owners.every((owner) => owner.role === "IT_STAFF" || owner.role === "ADMINISTRATOR")).toBe(true);
  }, 120_000);

  it("creates nothing on a second run", async () => {
    const before = await prisma.ticket.count();
    const comments = await prisma.publicComment.count();

    const result = await seedDemoTickets(prisma);

    expect(result.created).toBe(0);
    expect(result.skipped).toBeGreaterThanOrEqual(30);
    expect(await prisma.ticket.count()).toBe(before);
    expect(await prisma.publicComment.count()).toBe(comments);
  }, 120_000);
});
