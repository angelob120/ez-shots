-- Post-order support: prevention (hours, closures, pause) plus recovery
-- (state machine, refunds, issues, event log).
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

-- REJECTED joins the existing OrderStatus. ADD VALUE cannot run inside a
-- transaction block on older PGs, and IF NOT EXISTS makes the re-run safe.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

DO $$ BEGIN
  CREATE TYPE "OrderProblem" AS ENUM (
    'OUT_OF_STOCK', 'CLOSING_SOON', 'CLOSED', 'TOO_BUSY', 'KITCHEN_ISSUE',
    'WEATHER', 'CUSTOMER_REQUEST', 'NO_SHOW', 'PRICING_ERROR',
    'DUPLICATE_ORDER', 'QUALITY', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ActorKind" AS ENUM ('CUSTOMER', 'RESTAURANT', 'SYSTEM', 'ADMIN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "RefundStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueKind" AS ENUM (
    'MISSING_ITEM', 'WRONG_ITEM', 'QUALITY', 'LONG_WAIT', 'CLOSED_ON_ARRIVAL',
    'NEVER_RECEIVED', 'CHARGED_WRONG', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DECLINED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Restaurant: ordering availability
-- ---------------------------------------------------------------------------

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "hoursJson"      JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "timezone"       TEXT  NOT NULL DEFAULT 'America/New_York';
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "pausedUntil"    TIMESTAMP(3);
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "pauseReason"    TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "prepMinutes"    INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "lastCallMins"   INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "autoAccept"     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "autoExpireMins" INTEGER NOT NULL DEFAULT 10;

-- ---------------------------------------------------------------------------
-- Order: public token + lifecycle
-- ---------------------------------------------------------------------------

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "publicToken" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "refundedCts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "promisedAt"  TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "acceptedAt"  TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "readyAt"     TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "canceledAt"  TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "problem"     "OrderProblem";
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "problemNote" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "endedBy"     "ActorKind";

-- Backfill tokens for orders placed before this migration, then make the
-- column mandatory. gen_random_uuid() ships with pgcrypto/PG13+; the md5
-- fallback keeps this working on anything older.
DO $$ BEGIN
  UPDATE "Order"
     SET "publicToken" = replace(gen_random_uuid()::text, '-', '')
   WHERE "publicToken" IS NULL;
EXCEPTION WHEN undefined_function THEN
  UPDATE "Order"
     SET "publicToken" = md5(random()::text || clock_timestamp()::text || "id")
   WHERE "publicToken" IS NULL;
END $$;

ALTER TABLE "Order" ALTER COLUMN "publicToken" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_publicToken_key" ON "Order"("publicToken");
CREATE INDEX IF NOT EXISTS "Order_restaurantId_status_idx" ON "Order"("restaurantId", "status");

-- ---------------------------------------------------------------------------
-- OrderItem: partial fulfilment
-- ---------------------------------------------------------------------------

ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "fulfilledQty" INTEGER;

-- ---------------------------------------------------------------------------
-- New tables
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "OrderEvent" (
  "id"         TEXT NOT NULL,
  "orderId"    TEXT NOT NULL,
  "kind"       TEXT NOT NULL,
  "actor"      "ActorKind" NOT NULL,
  "fromStatus" "OrderStatus",
  "toStatus"   "OrderStatus",
  "publicNote" TEXT,
  "meta"       JSONB NOT NULL DEFAULT '{}',
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");

CREATE TABLE IF NOT EXISTS "Refund" (
  "id"                TEXT NOT NULL,
  "orderId"           TEXT NOT NULL,
  "amountCts"         INTEGER NOT NULL,
  "reason"            "OrderProblem" NOT NULL,
  "note"              TEXT,
  "status"            "RefundStatus" NOT NULL DEFAULT 'PENDING',
  "includedSurcharge" BOOLEAN NOT NULL DEFAULT false,
  "provider"          TEXT,
  "providerRef"       TEXT,
  "error"             TEXT,
  "issuedBy"          "ActorKind" NOT NULL DEFAULT 'RESTAURANT',
  "issuedById"        TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "succeededAt"       TIMESTAMP(3),
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Refund_orderId_idx" ON "Refund"("orderId");

CREATE TABLE IF NOT EXISTS "OrderIssue" (
  "id"             TEXT NOT NULL,
  "orderId"        TEXT NOT NULL,
  "restaurantId"   TEXT NOT NULL,
  "kind"           "IssueKind" NOT NULL,
  "status"         "IssueStatus" NOT NULL DEFAULT 'OPEN',
  "body"           TEXT NOT NULL,
  "resolution"     TEXT,
  "resolvedAt"     TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OrderIssue_restaurantId_status_idx" ON "OrderIssue"("restaurantId", "status");
CREATE INDEX IF NOT EXISTS "OrderIssue_orderId_idx" ON "OrderIssue"("orderId");

CREATE TABLE IF NOT EXISTS "Closure" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "startDate"    TEXT NOT NULL,
  "endDate"      TEXT NOT NULL,
  "reason"       TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Closure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Closure_restaurantId_startDate_idx" ON "Closure"("restaurantId", "startDate");

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrderIssue" ADD CONSTRAINT "OrderIssue_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "OrderIssue" ADD CONSTRAINT "OrderIssue_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Closure" ADD CONSTRAINT "Closure_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
