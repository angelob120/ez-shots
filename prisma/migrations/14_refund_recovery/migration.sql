-- Refund recovery: make a failed payout something the dashboard can track to
-- a conclusion instead of a dead row nobody ever reads.
--
-- Idempotent, like every migration here — scripts/migrate.mjs re-runs
-- `migrate deploy` on every boot.

ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "attempts"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "resolvedAt"   TIMESTAMP(3);
ALTER TABLE "Refund" ADD COLUMN IF NOT EXISTS "resolvedNote" TEXT;

-- The banner query: outstanding failures, newest first.
CREATE INDEX IF NOT EXISTS "Refund_status_resolvedAt_idx" ON "Refund" ("status", "resolvedAt");

-- Historic failures predate the retry flow and nobody is going to work through
-- a backlog they've never seen. Close them out rather than opening the feature
-- with a banner full of orders from months ago.
UPDATE "Refund"
   SET "resolvedAt" = "createdAt",
       "resolvedNote" = 'Closed automatically — predates refund retry.'
 WHERE "status" = 'FAILED' AND "resolvedAt" IS NULL;
