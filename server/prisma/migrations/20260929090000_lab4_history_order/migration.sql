-- Lab 4: one order for a Ticket's history and its Actions' completions
-- (issue #83, BR-19 condition 4; Earth2509's review of PR #95).
--
-- "Completed since the latest reopen" used to compare Action.completedAt, set by
-- the API server's clock, with TicketStatusEvent.createdAt, set by the
-- database's. The two clocks differ (here the database ran about 144 ms ahead),
-- so work done straight after a reopen could look older than the reopen, and
-- work done just before it could look newer. Both writes already happen under
-- the Ticket row lock, so what matters is their order, not their times. One
-- sequence gives that order, free of clocks and of the millisecond precision the
-- timestamps are stored at.
--
-- The sequence is TicketStatusEvent.seq's own (a BIGSERIAL, so Prisma models
-- it), and the API draws completion numbers from it too.
--
-- Additive. Existing events are numbered in the order the history route shows
-- them, by createdAt then id. Existing completed Actions get no number, which
-- counts as before any reopen: the conservative reading, since nothing records
-- which came first on one clock.

-- AlterTable
ALTER TABLE "ActionTaken" ADD COLUMN     "completionSeq" BIGINT;

-- AlterTable
ALTER TABLE "TicketStatusEvent" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- BIGSERIAL numbered the existing rows in storage order; renumber them in
-- history order. The sequence has already issued as many values as there are
-- rows, so new events still follow every existing one.
UPDATE "TicketStatusEvent" AS e
SET "seq" = o."n"
FROM (SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS "n" FROM "TicketStatusEvent") AS o
WHERE e."id" = o."id";
