import { getPrisma } from "../src/prisma.js";

// The four supported IT request categories, in the order they should appear.
// Seeding sequentially (not in parallel) keeps autoincrement ids in this order
// on a fresh database, which is what the categories test asserts.
const CATEGORY_NAMES = [
  "Account and Access",
  "Hardware",
  "Software",
  "Network",
];

async function main() {
  const prisma = getPrisma();

  for (const name of CATEGORY_NAMES) {
    // upsert on the unique name: re-running the seed updates nothing and
    // creates nothing, so it never produces duplicates.
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const seeded = await prisma.category.findMany({ orderBy: { id: "asc" } });
  console.log(`Seeded ${seeded.length} categories:`);
  for (const category of seeded) {
    console.log(`  ${category.id}  ${category.name}`);
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
