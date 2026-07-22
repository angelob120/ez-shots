-- Platform-wide payment mode, held in the database so it can be flipped from
-- /admin without a redeploy. LIVE / TEST / STUB — see schema.prisma.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

DO $$ BEGIN
  CREATE TYPE "PaymentMode" AS ENUM ('LIVE', 'TEST', 'STUB');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "PlatformSetting" (
  "id"          TEXT NOT NULL,
  "paymentMode" "PaymentMode" NOT NULL DEFAULT 'STUB',
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT,
  CONSTRAINT "PlatformSetting_pkey" PRIMARY KEY ("id")
);
