-- Customer tags, saved segments, notes (owner's and ours, separately), and
-- import jobs with an undo marker.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to apply twice.

-- ── Import jobs ───────────────────────────────────────────────────────────
-- Created before Customer gains its foreign key to it.

CREATE TABLE IF NOT EXISTS "CustomerImportJob" (
  "id"               TEXT NOT NULL,
  "restaurantId"     TEXT NOT NULL,
  "filename"         TEXT,
  "created"          INTEGER NOT NULL DEFAULT 0,
  "updated"          INTEGER NOT NULL DEFAULT 0,
  "skipped"          INTEGER NOT NULL DEFAULT 0,
  "duplicatesInFile" INTEGER NOT NULL DEFAULT 0,
  "unusableRows"     INTEGER NOT NULL DEFAULT 0,
  "tagId"            TEXT,
  "undoneAt"         TIMESTAMP(3),
  "undoneCount"      INTEGER,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerImportJob_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CustomerImportJob"
    ADD CONSTRAINT "CustomerImportJob_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CustomerImportJob_restaurantId_createdAt_idx"
  ON "CustomerImportJob"("restaurantId", "createdAt");

-- ── Tags ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CustomerTag" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "slug"         TEXT NOT NULL,
  "color"        TEXT NOT NULL DEFAULT 'neutral',
  "system"       BOOLEAN NOT NULL DEFAULT false,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerTag_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CustomerTag"
    ADD CONSTRAINT "CustomerTag_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The slug, not the name, is what makes "VIP" and "vip" one tag. An owner who
-- ends up with three spellings has a filter that silently returns a third of
-- the people it should.
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerTag_restaurantId_slug_key"
  ON "CustomerTag"("restaurantId", "slug");
CREATE INDEX IF NOT EXISTS "CustomerTag_restaurantId_idx" ON "CustomerTag"("restaurantId");

DO $$ BEGIN
  ALTER TABLE "CustomerImportJob"
    ADD CONSTRAINT "CustomerImportJob_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "CustomerTag"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "CustomerTagLink" (
  "customerId" TEXT NOT NULL,
  "tagId"      TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerTagLink_pkey" PRIMARY KEY ("customerId", "tagId")
);

DO $$ BEGIN
  ALTER TABLE "CustomerTagLink"
    ADD CONSTRAINT "CustomerTagLink_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerTagLink"
    ADD CONSTRAINT "CustomerTagLink_tagId_fkey"
    FOREIGN KEY ("tagId") REFERENCES "CustomerTag"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CustomerTagLink_tagId_idx" ON "CustomerTagLink"("tagId");

-- ── Saved segments ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "CustomerSegment" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "query"        TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CustomerSegment"
    ADD CONSTRAINT "CustomerSegment_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerSegment_restaurantId_name_key"
  ON "CustomerSegment"("restaurantId", "name");
CREATE INDEX IF NOT EXISTS "CustomerSegment_restaurantId_idx" ON "CustomerSegment"("restaurantId");

-- ── Notes: two tables, deliberately ───────────────────────────────────────
-- `CustomerNote` is the owner's. `CustomerAdminNote` is ours. Same reasoning
-- as SupportMessage/SupportNote in 25_support_tickets: a visibility boolean
-- puts a candid internal note one forgotten WHERE clause away from the
-- restaurant reading it.

CREATE TABLE IF NOT EXISTS "CustomerNote" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "customerId"   TEXT NOT NULL,
  "authorUserId" TEXT,
  "authorName"   TEXT,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CustomerNote"
    ADD CONSTRAINT "CustomerNote_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CustomerNote"
    ADD CONSTRAINT "CustomerNote_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CustomerNote_customerId_createdAt_idx"
  ON "CustomerNote"("customerId", "createdAt");
CREATE INDEX IF NOT EXISTS "CustomerNote_restaurantId_idx" ON "CustomerNote"("restaurantId");

CREATE TABLE IF NOT EXISTS "CustomerAdminNote" (
  "id"           TEXT NOT NULL,
  "customerId"   TEXT NOT NULL,
  "authorUserId" TEXT,
  "authorName"   TEXT,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CustomerAdminNote_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "CustomerAdminNote"
    ADD CONSTRAINT "CustomerAdminNote_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CustomerAdminNote_customerId_createdAt_idx"
  ON "CustomerAdminNote"("customerId", "createdAt");

-- ── Customer gains the import marker ──────────────────────────────────────

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "importJobId" TEXT;

DO $$ BEGIN
  ALTER TABLE "Customer"
    ADD CONSTRAINT "Customer_importJobId_fkey"
    FOREIGN KEY ("importJobId") REFERENCES "CustomerImportJob"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Customer_restaurantId_importJobId_idx"
  ON "Customer"("restaurantId", "importJobId");

-- The filter bar's sort and filter columns. Compound rather than single so
-- they match the shapes lib/customers.ts actually composes.
CREATE INDEX IF NOT EXISTS "Customer_restaurantId_optInStatus_idx"
  ON "Customer"("restaurantId", "optInStatus");
CREATE INDEX IF NOT EXISTS "Customer_restaurantId_lastOrderAt_idx"
  ON "Customer"("restaurantId", "lastOrderAt");
CREATE INDEX IF NOT EXISTS "Customer_restaurantId_orderCount_idx"
  ON "Customer"("restaurantId", "orderCount");
CREATE INDEX IF NOT EXISTS "Customer_restaurantId_lifetimeCts_idx"
  ON "Customer"("restaurantId", "lifetimeCts");
