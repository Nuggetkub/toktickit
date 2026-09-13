import { getPrisma } from "../src/prisma.js";
import { seedReferenceData } from "../src/seed-data.js";
import { seedDemoTickets } from "../src/demo-tickets.js";

// Thin runner. The data and the upsert logic live in src/seed-data.ts and
// src/demo-tickets.ts so that the Lab 3 seed tests can execute them directly and
// prove they are idempotent, rather than relying on someone remembering to run
// the command twice.

async function main() {
  const prisma = getPrisma();

  await seedReferenceData(prisma);
  const demo = await seedDemoTickets(prisma);

  const categories = await prisma.category.count();
  const relatedSystems = await prisma.relatedSystem.count();
  console.log(`Seeded ${categories} categories and ${relatedSystems} related systems.`);

  const users = await prisma.user.findMany({
    orderBy: { id: "asc" },
    select: { id: true, fullName: true, email: true, role: true, isActive: true, mustChangePassword: true },
  });

  console.log(`Seeded ${users.length} users:`);
  for (const user of users) {
    const flags = [user.isActive ? "active" : "inactive", user.mustChangePassword ? "must change password" : ""]
      .filter(Boolean)
      .join(", ");
    console.log(`  ${String(user.id).padStart(3)}  ${user.role.padEnd(13)}  ${user.email.padEnd(38)}  ${flags}`);
  }

  console.log(
    `Demo tickets: ${demo.created} created, ${demo.skipped} already present ` +
      `(${demo.comments} comments and ${demo.notes} internal notes created).`,
  );
  console.log("The development password for every seeded account is in README.md — it is a local fixture, not a secret.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await getPrisma().$disconnect();
  });
