import type { PrismaClient } from "@prisma/client";

// The Lab 2 reference data, and the function that applies it.
//
// This lives in src/ rather than inside prisma/seed.ts so that the seeding
// logic can be imported and executed by a test. A seed whose idempotency is
// only ever checked by a human running it twice is a seed whose idempotency
// stops being true the moment someone edits it.

// The four supported IT request categories, in the order they should appear.
export const CATEGORY_NAMES = [
  "Account and Access",
  "Hardware",
  "Software",
  "Network",
] as const;

// The specific service, application or device a ticket concerns. The labsheet
// asks for at least six.
export const RELATED_SYSTEM_NAMES = [
  "Email",
  "Campus Wi-Fi",
  "VPN",
  "LEB2 App",
  "Grade Submission App",
  "Printer",
  "Corporate Laptop",
] as const;

// Four active Development Requesters plus one inactive. The inactive row must
// never reach the selector (BR-06), so it is test fixture as much as seed data.
export const REQUESTERS = [
  { fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", isActive: true },
  { fullName: "Somchai Pattana", email: "somchai.pattana@toktickit.local", isActive: true },
  { fullName: "Marisa Chen", email: "marisa.chen@toktickit.local", isActive: true },
  { fullName: "Tobias Lindqvist", email: "tobias.lindqvist@toktickit.local", isActive: true },
  { fullName: "Priya Anand (retired account)", email: "priya.anand@toktickit.local", isActive: false },
] as const;

/**
 * Applies the reference data. Every write is an upsert on a unique natural key,
 * so running this twice creates nothing and changes nothing.
 *
 * Rows are seeded sequentially rather than in parallel: on a fresh database that
 * keeps autoincrement ids in declaration order, which several tests rely on.
 *
 * No tickets are seeded, deliberately. Every ticket in the Part 6 and Part 7
 * evidence must have been created through the application, or the screenshots
 * prove nothing about the software (decision D-11).
 */
export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const name of CATEGORY_NAMES) {
    await prisma.category.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const name of RELATED_SYSTEM_NAMES) {
    await prisma.relatedSystem.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  for (const requester of REQUESTERS) {
    // `isActive` is in the update clause because it is the one field the seed
    // must be able to correct: a requester flipped active by hand during
    // testing has to return to its seeded state on the next run.
    await prisma.requester.upsert({
      where: { email: requester.email },
      update: { fullName: requester.fullName, isActive: requester.isActive },
      create: requester,
    });
  }
}
