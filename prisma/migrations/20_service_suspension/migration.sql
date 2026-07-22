-- Per-tenant service suspension: the platform switching payments, SMS, or
-- email off for one restaurant, with a record of who did it and why.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

DO $$ BEGIN
  CREATE TYPE "ServiceKind" AS ENUM ('PAYMENTS', 'SMS', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ServiceSuspension" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "service"      "ServiceKind" NOT NULL,
  "reason"       TEXT,
  "internalNote" TEXT,
  "suspendedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspendedBy"  TEXT,
  "liftedAt"     TIMESTAMP(3),
  "liftedBy"     TEXT,
  CONSTRAINT "ServiceSuspension_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ServiceSuspension"
    ADD CONSTRAINT "ServiceSuspension_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ServiceSuspension_restaurantId_service_idx"
  ON "ServiceSuspension"("restaurantId", "service");

CREATE INDEX IF NOT EXISTS "ServiceSuspension_service_liftedAt_idx"
  ON "ServiceSuspension"("service", "liftedAt");

-- At most one *live* suspension per tenant per service. Partial, because lifted
-- rows are kept forever and a tenant may well be suspended, restored, and
-- suspended again. Prisma can't express a partial unique index, so it lives
-- here and lib/entitlements.ts relies on it: the insert is the lock, and a
-- unique violation means another admin got there first rather than a bug.
CREATE UNIQUE INDEX IF NOT EXISTS "ServiceSuspension_active_unique"
  ON "ServiceSuspension"("restaurantId", "service")
  WHERE "liftedAt" IS NULL;
