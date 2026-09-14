import type { PrismaClient } from "@prisma/client";
import { hashPassword } from "./password.js";

// The Lab 3 reference data, and the function that applies it.
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

/**
 * The one development password shared by every seeded account (BR-45).
 *
 * This is a fixture credential for a `.local` domain, not a secret: the peer
 * reviewer and the grader must be able to sign in as each role on a fresh clone,
 * and labsheet §5.3 requires seeded local-development credentials to be clearly
 * documented. It is overridable so a machine can use its own.
 */
export const DEVELOPMENT_PASSWORD = process.env.SEED_PASSWORD ?? "TokTickIT-dev-2026";

export type SeedUser = {
  fullName: string;
  email: string;
  role: "REQUESTER" | "IT_STAFF" | "ADMINISTRATOR";
  isActive: boolean;
};

/**
 * The accounts specification.md §7 requires: four active Requesters and one
 * inactive, three active IT Staff and one inactive, and one Administrator.
 *
 * The first five Requesters carry the Lab 2 e-mail addresses unchanged, because
 * those rows are *migrated*, not recreated — the seed finds them by email and
 * only fills in what the migration left empty (BR-43, BR-44).
 */
export const USERS: readonly SeedUser[] = [
  { fullName: "Nadia Rahman", email: "nadia.rahman@toktickit.local", role: "REQUESTER", isActive: true },
  { fullName: "Somchai Pattana", email: "somchai.pattana@toktickit.local", role: "REQUESTER", isActive: true },
  { fullName: "Marisa Chen", email: "marisa.chen@toktickit.local", role: "REQUESTER", isActive: true },
  { fullName: "Tobias Lindqvist", email: "tobias.lindqvist@toktickit.local", role: "REQUESTER", isActive: true },
  { fullName: "Priya Anand (retired account)", email: "priya.anand@toktickit.local", role: "REQUESTER", isActive: false },
  { fullName: "Ananya Wong", email: "ananya.wong@toktickit.local", role: "REQUESTER", isActive: true },
  { fullName: "Arthit Chaiyaporn", email: "arthit.chaiyaporn@toktickit.local", role: "IT_STAFF", isActive: true },
  { fullName: "Grace Okafor", email: "grace.okafor@toktickit.local", role: "IT_STAFF", isActive: true },
  { fullName: "Daniel Reyes", email: "daniel.reyes@toktickit.local", role: "IT_STAFF", isActive: true },
  { fullName: "Wichai Boonmee (on leave)", email: "wichai.boonmee@toktickit.local", role: "IT_STAFF", isActive: false },
  { fullName: "Pim Srisawat", email: "pim.srisawat@toktickit.local", role: "ADMINISTRATOR", isActive: true },
] as const;

/**
 * No account carries its own "must change" flag, because BR-12 leaves no choice:
 * **setting an initial password always marks the account as requiring a change.**
 * The seed is one of the two things permitted to set an initial password, so
 * every account it provisions starts in mandatory-change mode — including the
 * Lab 2 Requesters it finds already migrated, which is what DB-05 requires.
 */

/**
 * The Requester subset, kept as its own export because the Lab 2 suites assert
 * on it and because "at least four active and one inactive Requester" is a
 * labsheet requirement about Requesters specifically, not about accounts.
 */
export const REQUESTERS = USERS.filter((user) => user.role === "REQUESTER");

/**
 * Applies the reference data. Every write is an upsert on a unique natural key,
 * so running this twice creates nothing and changes nothing.
 *
 * Rows are seeded sequentially rather than in parallel: on a fresh database that
 * keeps autoincrement ids in declaration order, which several tests rely on.
 *
 * No tickets are seeded here, deliberately. The demo tickets live in
 * seedDemoTickets so that the automated suites still start with none and create
 * exactly what they assert on (Lab 2 decision D-11, kept by decision D-13).
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

  const passwordHash = await hashPassword(DEVELOPMENT_PASSWORD);

  for (const user of USERS) {
    const existing = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true, passwordHash: true },
    });

    if (!existing) {
      // Requiring the change is not optional: this account is being given an
      // initial password, and BR-12 says that always leaves the gate on.
      await prisma.user.create({ data: { ...user, passwordHash, mustChangePassword: true } });
      continue;
    }

    // `fullName`, `role` and `isActive` are restored, because those are the
    // fields a test or a demonstration flips by hand and the seed must be able
    // to put back. The password is filled in only when the account has none —
    // which is exactly the state the migration leaves a Lab 2 Requester in
    // (BR-43) — so re-seeding never undoes a password somebody has changed
    // (BR-44).
    //
    // Filling that hash *is* issuing an initial password, so the account stays in
    // mandatory-change mode (BR-12). This is the migrated Lab 2 Requester's path
    // into the system: it receives the documented development password and is
    // still refused everything else until it saves a new one (DB-05).
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        fullName: user.fullName,
        role: user.role,
        isActive: user.isActive,
        ...(existing.passwordHash === null
          ? { passwordHash, mustChangePassword: true }
          : {}),
      },
    });
  }
}
