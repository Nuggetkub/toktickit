-- Lab 4: Actions Taken and Ticket status history (docs/lab-04/specification.md §7).
--
-- Additive only (BR-34): one enum, two tables, their indexes and foreign keys,
-- and one index on "Ticket". No existing column, value or id changes, and no
-- row is written: existing Tickets start with zero Actions and no history, and
-- none is invented for them (D-07).
--
-- The body below is what `prisma migrate diff` generates from the Lab 3 schema
-- to the Lab 4 schema. The CHECK constraints at the end are hand-written,
-- because Prisma cannot express them. Prisma also does not introspect them, so
-- they cause no drift against schema.prisma.
--
-- Rollback: prisma/rollback/20260925_lab4_actions_and_history.down.sql, which
-- is safe because this migration alters nothing that existed before it.

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ActionTaken" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "actionAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "result" TEXT,
    "followUpRequired" BOOLEAN NOT NULL,
    "followUpNote" TEXT,
    "attachmentNotes" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" INTEGER,
    "performedById" INTEGER,
    "createdById" INTEGER NOT NULL,
    "cancelledById" INTEGER,
    "cancellationReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionTaken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TicketStatusEvent" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "fromStatus" "TicketStatus",
    "toStatus" "TicketStatus" NOT NULL,
    "actorId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TicketStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ActionTaken_idempotencyKey_key" ON "ActionTaken"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_actionAt_id_idx" ON "ActionTaken"("ticketId", "actionAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ActionTaken_assigneeId_status_idx" ON "ActionTaken"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "TicketStatusEvent_ticketId_createdAt_id_idx" ON "TicketStatusEvent"("ticketId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "TicketStatusEvent_toStatus_createdAt_idx" ON "TicketStatusEvent"("toStatus", "createdAt");

-- CreateIndex
CREATE INDEX "Ticket_requesterId_currentStatus_idx" ON "Ticket"("requesterId", "currentStatus");

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusEvent" ADD CONSTRAINT "TicketStatusEvent_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TicketStatusEvent" ADD CONSTRAINT "TicketStatusEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written: the state rules of specification §7, enforced by the database
-- itself. The three lifecycle rules are mutually exclusive: each status carries
-- exactly its own audit facts and none of another's, so a code path that forgets
-- to clear a column cannot store a contradictory record. `result` is not part of
-- them, because BR-03 allows it on open work and a cancelled Action may keep it.

-- An open Action has been neither completed nor cancelled (BR-05: Performed by
-- is empty while it is open).
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_open_is_unfinished_check"
    CHECK ("status" <> 'OPEN' OR ("performedById" IS NULL AND "completedAt" IS NULL
        AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL));

-- A completed Action names who did it, when, and what came of it, and was not
-- cancelled (BR-03, BR-05).
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_completed_is_complete_check"
    CHECK ("status" <> 'COMPLETED' OR ("performedById" IS NOT NULL AND "completedAt" IS NOT NULL AND "result" IS NOT NULL
        AND "cancelledById" IS NULL AND "cancelledAt" IS NULL AND "cancellationReason" IS NULL));

-- A cancelled Action names who cancelled it, when, and why, and has no
-- performer or completion (BR-03; BR-05: a cancelled Action has no performer).
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_cancelled_is_explained_check"
    CHECK ("status" <> 'CANCELLED' OR ("cancelledById" IS NOT NULL AND "cancelledAt" IS NOT NULL AND "cancellationReason" IS NOT NULL
        AND "performedById" IS NULL AND "completedAt" IS NULL));

-- No follow-up means no follow-up note (BR-09).
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_follow_up_note_check"
    CHECK ("followUpRequired" OR "followUpNote" IS NULL);
