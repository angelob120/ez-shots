-- Stripe payments: the tenant's Connect account, where card funds settle and
-- against which the surcharge is charged as an application fee.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "stripeAccountId" TEXT;

-- @unique in the schema. A partial index would also do, but a plain unique
-- index matches what Prisma expects to find and tolerates the many NULLs
-- (Postgres does not treat NULLs as equal, so unregistered tenants don't
-- collide with each other).
CREATE UNIQUE INDEX IF NOT EXISTS "Restaurant_stripeAccountId_key"
  ON "Restaurant" ("stripeAccountId");
