-- Retry queue for transient send failures: give the Message table the two
-- columns a sweep needs to tell "try again" from "give up".
--
-- SendResult.retryable was populated at send time and read by nobody — a
-- provider timeout and a landline both landed as a plain FAILED row, so a
-- retry sweep had no way to hammer only the ones worth hammering. This records
-- the verdict, and a count so a message failing every attempt looks different
-- from one that blipped once (same shape as Refund.attempts in 14_refund_recovery).
--
-- Idempotent, like every migration here — scripts/migrate.mjs re-runs
-- `migrate deploy` on every boot.

-- Attempts so far. 0 for a row skipped before any provider call, 1 once tried,
-- more after the retry sweep has had a go. The sweep caps on this so a
-- permanently failing send can't loop forever.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;

-- Whether a FAILED send is worth another go. Null on rows that never failed;
-- true for a timeout or a 5xx; false for a landline or a rejected number that
-- will fail identically forever.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "retryable" BOOLEAN;

-- The retry sweep's lookup: the set of sends still worth attempting.
CREATE INDEX IF NOT EXISTS "Message_status_retryable_idx" ON "Message" ("status", "retryable");
