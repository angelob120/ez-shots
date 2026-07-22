-- Pricing plans: owners can choose, swap, and pay for a plan.
--
-- The public pricing page has advertised three plans and "switch whenever you
-- want" since launch, and the product had no concept of a plan at all. Every
-- tenant is on ZERO, which is what they were effectively on already, so this
-- migration changes nobody's billing on the way in.
--
-- Written idempotently — see scripts/migrate.mjs for why.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "Plan" AS ENUM ('ZERO', 'FLAT', 'HYBRID');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Restaurant
-- ---------------------------------------------------------------------------
--
-- Defaulting to ZERO is the safe direction: it is what every existing tenant is
-- already doing, and the alternative — defaulting to a paid plan — would bill
-- people who never asked.

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "plan" "Plan" NOT NULL DEFAULT 'ZERO';
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "pendingPlan" "Plan";
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "planPeriodEnd" TIMESTAMP(3);
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "planPastDueSince" TIMESTAMP(3);

-- Stripe objects on the PLATFORM account, not the tenant's connected account.
-- Deliberately separate columns from `stripeAccountId`: this is the only place
-- in the product where money moves towards us rather than through us, and
-- sharing a column would make that distinction invisible at every call site.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "stripeSubscriptionId" TEXT;

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "planCardBrand" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "planCardLast4" TEXT;

-- One tenant per Stripe customer. Without this, a retried upgrade that failed
-- part-way can leave two customer objects and two subscriptions, which bills
-- the restaurant twice and is very hard to notice from our side.
CREATE UNIQUE INDEX IF NOT EXISTS "Restaurant_stripeCustomerId_key"
  ON "Restaurant" ("stripeCustomerId") WHERE "stripeCustomerId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Restaurant_stripeSubscriptionId_key"
  ON "Restaurant" ("stripeSubscriptionId") WHERE "stripeSubscriptionId" IS NOT NULL;

-- Finding everyone whose grace period has expired, for the dunning sweep.
CREATE INDEX IF NOT EXISTS "Restaurant_planPastDueSince_idx"
  ON "Restaurant" ("planPastDueSince") WHERE "planPastDueSince" IS NOT NULL;

-- Finding scheduled switches that are due.
CREATE INDEX IF NOT EXISTS "Restaurant_pendingPlan_idx"
  ON "Restaurant" ("planPeriodEnd") WHERE "pendingPlan" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Plan change history
-- ---------------------------------------------------------------------------
--
-- Append-only in spirit, the same as ServiceSuspension: "what were they on in
-- March, and who moved them" is what answers the billing dispute. A tenant
-- whose plan changed under them because a card expired especially needs a
-- record that can be shown to them.

CREATE TABLE IF NOT EXISTS "PlanChange" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "fromPlan"     "Plan" NOT NULL,
  "toPlan"       "Plan" NOT NULL,
  -- "owner" | "admin" | "dunning"
  "source"       TEXT NOT NULL,
  "actorId"      TEXT,
  "effectiveAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlanChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PlanChange_restaurantId_createdAt_idx"
  ON "PlanChange" ("restaurantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "PlanChange"
    ADD CONSTRAINT "PlanChange_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
