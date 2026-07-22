-- Per-restaurant payment settings: cached Connect account readiness and the
-- owner's card-payments switch.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "stripeChargesEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "stripePayoutsEnabled"   BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "stripeDetailsSubmitted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cardPaymentsEnabled"    BOOLEAN NOT NULL DEFAULT true;
