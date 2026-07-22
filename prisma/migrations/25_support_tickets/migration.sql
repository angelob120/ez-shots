-- Support tickets from owners, enquiries from the public contact form, and the
-- admin-only notes attached to either.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to apply twice.

DO $$ BEGIN
  CREATE TYPE "SupportStatus" AS ENUM ('OPEN', 'WAITING', 'RESOLVED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "SupportCategory" AS ENUM
    ('BUG', 'BILLING', 'MENU', 'ORDERS', 'MESSAGING', 'ACCOUNT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Tickets ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SupportTicket" (
  "id"             TEXT NOT NULL,
  "restaurantId"   TEXT NOT NULL,
  "userId"         TEXT,
  "contactName"    TEXT NOT NULL,
  "contactEmail"   TEXT NOT NULL,
  "subject"        TEXT NOT NULL,
  "category"       "SupportCategory" NOT NULL DEFAULT 'OTHER',
  "priority"       "SupportPriority" NOT NULL DEFAULT 'NORMAL',
  "status"         "SupportStatus" NOT NULL DEFAULT 'OPEN',
  "number"         INTEGER NOT NULL,
  "firstReadAt"    TIMESTAMP(3),
  "resolvedAt"     TIMESTAMP(3),
  "archivedAt"     TIMESTAMP(3),
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupportTicket"
    ADD CONSTRAINT "SupportTicket_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupportTicket"
    ADD CONSTRAINT "SupportTicket_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "SupportTicket_number_key" ON "SupportTicket"("number");
CREATE INDEX IF NOT EXISTS "SupportTicket_status_lastActivityAt_idx"
  ON "SupportTicket"("status", "lastActivityAt");
CREATE INDEX IF NOT EXISTS "SupportTicket_restaurantId_status_lastActivityAt_idx"
  ON "SupportTicket"("restaurantId", "status", "lastActivityAt");

-- Ticket numbers come from a sequence rather than `max(number) + 1`.
--
-- The read-then-write shape is the exact bug class `docs/post-order-gaps.md`
-- items 1–4 were about: two owners filing at the same moment both read the
-- same max and the second insert dies on the unique index. A sequence hands
-- out numbers without a read, so concurrent filers simply get different ones.
-- Gaps are fine — a ticket number is a label, not a count.
DO $$ BEGIN
  CREATE SEQUENCE "SupportTicket_number_seq" OWNED BY "SupportTicket"."number";
EXCEPTION WHEN duplicate_table THEN NULL; END $$;

ALTER TABLE "SupportTicket"
  ALTER COLUMN "number" SET DEFAULT nextval('"SupportTicket_number_seq"');

-- ── Contact submissions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ContactSubmission" (
  "id"                  TEXT NOT NULL,
  "name"                TEXT NOT NULL,
  "email"               TEXT NOT NULL,
  "phone"               TEXT,
  "business"            TEXT,
  "message"             TEXT NOT NULL,
  "sourcePath"          TEXT,
  "status"              "SupportStatus" NOT NULL DEFAULT 'OPEN',
  "matchedRestaurantId" TEXT,
  "readAt"              TIMESTAMP(3),
  "resolvedAt"          TIMESTAMP(3),
  "archivedAt"          TIMESTAMP(3),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactSubmission_pkey" PRIMARY KEY ("id")
);

-- No foreign key on `matchedRestaurantId`, deliberately. The match is made by
-- comparing an *unverified* email address against owner logins, so it is a hint
-- for whoever reads the enquiry and nothing more. A real FK would dress a guess
-- up as a fact, and a tenant deletion would then cascade into a stranger's
-- message.
CREATE INDEX IF NOT EXISTS "ContactSubmission_status_createdAt_idx"
  ON "ContactSubmission"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "ContactSubmission_email_idx"
  ON "ContactSubmission"("email");

-- ── Messages (both parties see these) ─────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SupportMessage" (
  "id"         TEXT NOT NULL,
  "ticketId"   TEXT NOT NULL,
  "fromAdmin"  BOOLEAN NOT NULL,
  "authorName" TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupportMessage"
    ADD CONSTRAINT "SupportMessage_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "SupportMessage_ticketId_createdAt_idx"
  ON "SupportMessage"("ticketId", "createdAt");

-- ── Notes (admin-only, and a separate table for that reason) ──────────────

CREATE TABLE IF NOT EXISTS "SupportNote" (
  "id"          TEXT NOT NULL,
  "ticketId"    TEXT,
  "contactId"   TEXT,
  "body"        TEXT NOT NULL,
  "authorId"    TEXT,
  "authorEmail" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportNote_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "SupportNote"
    ADD CONSTRAINT "SupportNote_ticketId_fkey"
    FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SupportNote"
    ADD CONSTRAINT "SupportNote_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "ContactSubmission"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Exactly one parent. Prisma can't express this, so it lives here — a note
-- attached to neither is invisible forever, and one attached to both would
-- appear on two unrelated conversations.
DO $$ BEGIN
  ALTER TABLE "SupportNote"
    ADD CONSTRAINT "SupportNote_one_parent"
    CHECK (("ticketId" IS NULL) <> ("contactId" IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "SupportNote_ticketId_createdAt_idx"
  ON "SupportNote"("ticketId", "createdAt");
CREATE INDEX IF NOT EXISTS "SupportNote_contactId_createdAt_idx"
  ON "SupportNote"("contactId", "createdAt");
