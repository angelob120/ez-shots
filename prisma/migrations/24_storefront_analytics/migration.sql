-- Storefront analytics: Visit (one customer, one sitting) and VisitEvent
-- (append-only detail). See the schema comments for why these are two tables
-- rather than one.
--
-- Written idempotently — scripts/migrate.mjs re-runs migrations on every boot,
-- so every statement here has to survive being applied twice.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "VisitEventKind" AS ENUM (
    'PAGE_VIEW', 'VIEW_CHANGE', 'ITEM_VIEW', 'ITEM_ADD', 'ITEM_REMOVE',
    'CART_VIEW', 'CHECKOUT_START', 'CHECKOUT_ERROR', 'ORDER_PLACED',
    'SEARCH', 'HEARTBEAT'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VisitSource" AS ENUM (
    'DIRECT', 'QR', 'SEARCH_ENGINE', 'SOCIAL', 'MAPS', 'SMS', 'REFERRAL', 'UNKNOWN'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "VisitDevice" AS ENUM ('MOBILE', 'TABLET', 'DESKTOP', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- Visit
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Visit" (
  "id"              TEXT NOT NULL,
  "restaurantId"    TEXT NOT NULL,
  "anonId"          TEXT NOT NULL,
  "orderId"         TEXT,
  "startedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dwellMs"         INTEGER NOT NULL DEFAULT 0,
  "source"          "VisitSource" NOT NULL DEFAULT 'UNKNOWN',
  "device"          "VisitDevice" NOT NULL DEFAULT 'UNKNOWN',
  "referrerHost"    TEXT,
  "viewedMenu"      BOOLEAN NOT NULL DEFAULT false,
  "viewedItem"      BOOLEAN NOT NULL DEFAULT false,
  "addedToCart"     BOOLEAN NOT NULL DEFAULT false,
  "startedCheckout" BOOLEAN NOT NULL DEFAULT false,
  "converted"       BOOLEAN NOT NULL DEFAULT false,
  "eventCount"      INTEGER NOT NULL DEFAULT 0,
  "simulated"       BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Visit_restaurantId_anonId_startedAt_key"
  ON "Visit"("restaurantId", "anonId", "startedAt");
CREATE INDEX IF NOT EXISTS "Visit_restaurantId_startedAt_idx"
  ON "Visit"("restaurantId", "startedAt");
CREATE INDEX IF NOT EXISTS "Visit_restaurantId_converted_startedAt_idx"
  ON "Visit"("restaurantId", "converted", "startedAt");
CREATE INDEX IF NOT EXISTS "Visit_restaurantId_simulated_startedAt_idx"
  ON "Visit"("restaurantId", "simulated", "startedAt");
CREATE INDEX IF NOT EXISTS "Visit_orderId_idx" ON "Visit"("orderId");

DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SetNull, not Cascade: an order being deleted must not silently delete the
-- traffic that produced it.
DO $$ BEGIN
  ALTER TABLE "Visit" ADD CONSTRAINT "Visit_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- VisitEvent
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "VisitEvent" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "visitId"      TEXT NOT NULL,
  "kind"         "VisitEventKind" NOT NULL,
  "at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "itemId"       TEXT,
  "view"         TEXT,
  "valueCts"     INTEGER,
  "dwellMs"      INTEGER,
  "label"        TEXT,
  "simulated"    BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "VisitEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VisitEvent_restaurantId_at_idx"
  ON "VisitEvent"("restaurantId", "at");
CREATE INDEX IF NOT EXISTS "VisitEvent_restaurantId_kind_at_idx"
  ON "VisitEvent"("restaurantId", "kind", "at");
CREATE INDEX IF NOT EXISTS "VisitEvent_visitId_at_idx"
  ON "VisitEvent"("visitId", "at");
CREATE INDEX IF NOT EXISTS "VisitEvent_itemId_kind_idx"
  ON "VisitEvent"("itemId", "kind");

DO $$ BEGIN
  ALTER TABLE "VisitEvent" ADD CONSTRAINT "VisitEvent_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "VisitEvent" ADD CONSTRAINT "VisitEvent_visitId_fkey"
    FOREIGN KEY ("visitId") REFERENCES "Visit"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- SetNull: deleting a menu item must not rewrite the history of the traffic
-- that looked at it, the same way it doesn't rewrite the orders containing it.
DO $$ BEGIN
  ALTER TABLE "VisitEvent" ADD CONSTRAINT "VisitEvent_itemId_fkey"
    FOREIGN KEY ("itemId") REFERENCES "MenuItem"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
