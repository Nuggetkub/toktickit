-- Lab 3: authentication, roles and the IT Staff workflow (specification.md §7).
--
-- Hand-edited where Prisma's generated SQL would have dropped and recreated the
-- Requester table. Renaming it instead keeps every id, so each existing
-- Ticket."requesterId" and Attachment."removedByRequesterId" still points at the
-- same person and no row is rewritten (BR-43, decision D-14).

-- 1. Preflight. Two Lab 2 emails that differ only in case or surrounding space
--    would collide once normalised, and the unique index added below would fail
--    halfway through. Stop first, changing nothing, and say what to fix.
DO $$
BEGIN
  IF EXISTS (
    SELECT lower(btrim("email"))
    FROM "Requester"
    GROUP BY lower(btrim("email"))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Lab 3 migration stopped: two Requester emails are identical after trimming and lowercasing. Resolve the duplicates, then run the migration again.';
  END IF;
END $$;

-- 2. Rename the table and the constraints Prisma names after it, so the result
--    matches schema.prisma exactly and `prisma migrate diff` reports no drift.
--    Foreign keys follow the table automatically and keep their own names.
ALTER TABLE "Requester" RENAME TO "User";
ALTER TABLE "User" RENAME CONSTRAINT "Requester_pkey" TO "User_pkey";
ALTER INDEX "Requester_email_key" RENAME TO "User_email_key";

-- 3. Normalise the emails that are now uniquely indexed case-insensitively (BR-08).
UPDATE "User" SET "email" = lower(btrim("email"));

-- 4. Roles and credentials. Every migrated account is a Requester with no
--    password, which cannot authenticate until an Administrator or the
--    development seed sets one (BR-43, BR-06).
CREATE TYPE "Role" AS ENUM ('REQUESTER', 'IT_STAFF', 'ADMINISTRATOR');

ALTER TABLE "User"
  ADD COLUMN "role" "Role" NOT NULL DEFAULT 'REQUESTER',
  ADD COLUMN "passwordHash" TEXT,
  ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- 5. The remaining seven ticket statuses, in lifecycle order (BR-26).
--    None of them is used by this migration, so adding them here is safe.
ALTER TYPE "TicketStatus" ADD VALUE 'OPEN';
ALTER TYPE "TicketStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "TicketStatus" ADD VALUE 'WAITING_FOR_REQUESTER';
ALTER TYPE "TicketStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "TicketStatus" ADD VALUE 'CLOSED';
ALTER TYPE "TicketStatus" ADD VALUE 'REOPENED';
ALTER TYPE "TicketStatus" ADD VALUE 'CANCELLED';

-- 6. Ticket workflow columns. itPriority is added nullable, backfilled from the
--    Requested Priority for every existing ticket (BR-23), then made NOT NULL.
ALTER TABLE "Ticket"
  ADD COLUMN "itPriority" "RequestedPriority",
  ADD COLUMN "ownerId" INTEGER,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "resolutionSummary" TEXT,
  ADD COLUMN "requesterResolvedAt" TIMESTAMP(3);

UPDATE "Ticket" SET "itPriority" = "requestedPriority";

ALTER TABLE "Ticket" ALTER COLUMN "itPriority" SET NOT NULL;

CREATE INDEX "Ticket_ownerId_idx" ON "Ticket"("ownerId");
CREATE INDEX "Ticket_currentStatus_idx" ON "Ticket"("currentStatus");
CREATE INDEX "Ticket_updatedAt_idx" ON "Ticket"("updatedAt");

ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_ownerId_fkey"
  FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. Sessions. Only the token hash is stored (BR-13).
CREATE TABLE "Session" (
    "id" SERIAL NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 8. Discussion. Two tables rather than one with a visibility flag, so a
--    Requester-facing query cannot return a private note even when written
--    carelessly (§7, decision D-11).
CREATE TABLE "PublicComment" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "statusChangedTo" "TicketStatus",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicComment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalNote" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "authorId" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PublicComment_ticketId_createdAt_idx" ON "PublicComment"("ticketId", "createdAt" DESC);
CREATE INDEX "InternalNote_ticketId_createdAt_idx" ON "InternalNote"("ticketId", "createdAt" DESC);

ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PublicComment" ADD CONSTRAINT "PublicComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
