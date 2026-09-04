import { getPrisma } from "../src/prisma.js";
import { seedReferenceData } from "../src/seed-data.js";

// Thin runner. The data and the upsert logic live in src/seed-data.ts so that
// tests/lab-02/seed.test.ts can execute them directly and prove the seed is
// idempotent, rather than relying on someone remembering to run it twice.

async function main() {
  const prisma = getPrisma();

  await seedReferenceData(prisma);

  const categories = await prisma.category.findMany({ orderBy: { id: "asc" } });
  console.log(`Seeded ${categories.length} categories:`);
  for (const category of categories) {
    console.log(`  ${category.id}  ${category.name}`);
  }

  const relatedSystems = await prisma.relatedSystem.findMany({ orderBy: { id: "asc" } });
  console.log(`Seeded ${relatedSystems.length} related systems:`);
  for (const relatedSystem of relatedSystems) {
    console.log(`  ${relatedSystem.id}  ${relatedSystem.name}`);
  }

  const requesters = await prisma.requester.findMany({ orderBy: { id: "asc" } });
  const active = requesters.filter((requester) => requester.isActive).length;
  console.log(`Seeded ${requesters.length} requesters (${active} active, ${requesters.length - active} inactive):`);
  for (const requester of requesters) {
    console.log(`  ${requester.id}  ${requester.isActive ? "active  " : "inactive"}  ${requester.fullName}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
