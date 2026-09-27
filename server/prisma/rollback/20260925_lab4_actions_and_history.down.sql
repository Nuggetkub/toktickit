-- Rollback for migration 20260925090000_lab4_actions_and_history
-- (docs/lab-04/specification.md §7, "Rollback").
--
-- The migration only added objects, so undoing it only removes them. Nothing
-- that existed in Lab 3 is touched. What IS lost is every Action Taken and
-- every Status Event recorded since the migration, so take a backup first:
--
--   docker exec toktickit-db pg_dump -U toktickit -d toktickit -n <your schema, "public" by default> > backup.sql
--
-- Run it with:
--
--   npx prisma db execute --file prisma/rollback/20260925_lab4_actions_and_history.down.sql
--
-- then check out the Lab 3 code, whose schema.prisma this leaves the database
-- matching. server/tests/lab-04/migration.test.ts proves that match against a
-- database built from the Lab 3 migrations alone.
--
-- One transaction: either the database is fully back at Lab 3, or it is
-- untouched.

BEGIN;

DROP TABLE "ActionTaken";
DROP TABLE "TicketStatusEvent";
DROP TYPE "ActionStatus";
DROP INDEX "Ticket_requesterId_currentStatus_idx";

-- Forget the migration too, so `prisma migrate deploy` would apply it again
-- rather than believe it is still in place. The table exists only in a database
-- managed by `migrate deploy`; the tests apply migrations with `db execute`.
DO $$
BEGIN
  IF to_regclass('_prisma_migrations') IS NOT NULL THEN
    DELETE FROM _prisma_migrations WHERE migration_name = '20260925090000_lab4_actions_and_history';
  END IF;
END $$;

COMMIT;
