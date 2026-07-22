-- Two unrelated guards that happen to land together.
--
-- 1. Time-boxed payment modes. TEST and STUB both let a customer check out,
--    the kitchen cook, and no money arrive. Left on by accident that's a
--    restaurant giving away dinners, so a non-LIVE mode now carries an expiry
--    and a revert target instead of relying on somebody remembering.
--
-- 2. The www twin of a custom domain. Routing already strips www, but
--    Cloudflare issues a certificate per hostname — so without a second
--    registration, a visitor typing www gets a TLS warning on the owner's own
--    domain, which is worse than having no custom domain at all.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- ---------------------------------------------------------------------------
-- Payment mode guards
-- ---------------------------------------------------------------------------

ALTER TABLE "PlatformSetting" ADD COLUMN IF NOT EXISTS "modeExpiresAt"   TIMESTAMP(3);
ALTER TABLE "PlatformSetting" ADD COLUMN IF NOT EXISTS "modeRevertTo"    "PaymentMode";
ALTER TABLE "PlatformSetting" ADD COLUMN IF NOT EXISTS "modeRevertedAt"  TIMESTAMP(3);

-- Demo scaffolding (signup/onboarding autofill, tenant seeding, sample CSV).
-- Deliberately separate from paymentMode: testing a real payment flow must not
-- require exposing autofill buttons to real restaurant owners.
ALTER TABLE "PlatformSetting"
  ADD COLUMN IF NOT EXISTS "testModeEnabled" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- www custom hostname
-- ---------------------------------------------------------------------------

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cfWwwHostnameId" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cfWwwStatus"     TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cfWwwSslStatus"  TEXT;
