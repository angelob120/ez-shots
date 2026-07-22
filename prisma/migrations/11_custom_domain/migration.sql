-- Custom (bring-your-own) domains for a restaurant's website + ordering flow.
-- Written idempotently (IF NOT EXISTS) so the boot-time runner can re-apply safely.

ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "customDomain" TEXT,
  ADD COLUMN IF NOT EXISTS "domainVerifiedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "domainVerifyToken" TEXT;

-- One tenant per hostname.
CREATE UNIQUE INDEX IF NOT EXISTS "Restaurant_customDomain_key"
  ON "Restaurant" ("customDomain");
