-- Delivery: a fourth suspendable service, plus the owner-side switch it pairs
-- with. Nothing in the ordering flow reads either one yet — this puts the
-- controls in place ahead of the feature.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- ADD VALUE cannot run inside a transaction block on older PGs, and
-- IF NOT EXISTS makes the re-run safe.
ALTER TYPE "ServiceKind" ADD VALUE IF NOT EXISTS 'DELIVERY';

-- Defaults off. A tenant that never asked for delivery must not find it on.
ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "deliveryEnabled" BOOLEAN NOT NULL DEFAULT false;
