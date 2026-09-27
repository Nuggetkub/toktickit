-- Lab 4: the create request's fingerprint on each Action Taken (issue #82, BR-15).
--
-- A replayed create returns the original Action only when the request is the
-- same. An open Action can be edited after it is created, so a retry cannot be
-- compared with the row as it is now; it is compared with this hash of the
-- request as received. Null for rows no API request created, such as the demo
-- seed's.
--
-- A migration of its own rather than an edit to
-- 20260925090000_lab4_actions_and_history: that one has already merged, and a
-- database that applied it would never receive a column added to it afterwards.
--
-- Additive. The Lab 4 rollback script drops the whole ActionTaken table, which
-- includes this column, and forgets this migration too.

-- AlterTable
ALTER TABLE "ActionTaken" ADD COLUMN "requestFingerprint" TEXT;
