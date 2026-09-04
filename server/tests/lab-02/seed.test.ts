import { describe, it, expect } from "vitest";
import { getPrisma } from "../../src/prisma.js";
import {
  CATEGORY_NAMES,
  RELATED_SYSTEM_NAMES,
  REQUESTERS,
  seedReferenceData,
} from "../../src/seed-data.js";

// The seed has to be safe to run repeatedly (specification.md §7). Checking that
// by hand once proves it was true once; this proves it stays true.

describe("reference data seed", () => {
  it("creates no duplicates when run a second time", async () => {
    const prisma = getPrisma();

    const before = {
      categories: await prisma.category.count(),
      relatedSystems: await prisma.relatedSystem.count(),
      requesters: await prisma.requester.count(),
    };

    await seedReferenceData(prisma);

    expect(await prisma.category.count()).toBe(before.categories);
    expect(await prisma.relatedSystem.count()).toBe(before.relatedSystems);
    expect(await prisma.requester.count()).toBe(before.requesters);
  });

  it("restores a requester that was deactivated by hand", async () => {
    const prisma = getPrisma();
    const target = REQUESTERS.find((requester) => requester.isActive)!;

    await prisma.requester.update({ where: { email: target.email }, data: { isActive: false } });
    await seedReferenceData(prisma);

    const restored = await prisma.requester.findUniqueOrThrow({ where: { email: target.email } });
    expect(restored.isActive).toBe(true);
  });

  it("seeds the reference data the labsheet requires", async () => {
    const prisma = getPrisma();

    expect(CATEGORY_NAMES).toHaveLength(4);
    expect(RELATED_SYSTEM_NAMES.length).toBeGreaterThanOrEqual(6);
    expect(REQUESTERS.filter((r) => r.isActive).length).toBeGreaterThanOrEqual(4);
    expect(REQUESTERS.filter((r) => !r.isActive).length).toBeGreaterThanOrEqual(1);

    // And the seed creates no tickets, so evidence screenshots can only show
    // tickets the application actually created (decision D-11).
    //
    // Asserted as a delta rather than an absolute zero: the create-ticket suite
    // now makes real tickets in this schema, and an absolute count would make
    // this test depend on which file ran first. What is actually being claimed
    // is that *seeding* adds none.
    const ticketsBefore = await prisma.ticket.count();
    await seedReferenceData(prisma);
    expect(await prisma.ticket.count()).toBe(ticketsBefore);
  });
});
