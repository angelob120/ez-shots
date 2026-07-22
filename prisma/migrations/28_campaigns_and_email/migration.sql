-- Owner-composed marketing campaigns, over SMS and email.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to apply twice.
--
-- Two things here are worth reading before changing anything:
--
--   1. There is no CampaignRecipient table. A recipient is a Message row with
--      a campaignId, so a campaign send goes through the same single door and
--      the same consent gate every other message does.
--   2. Email suppression is a nullable timestamp, not a mirror of the SMS
--      OptInStatus enum. Email is opt-out (CAN-SPAM), SMS is opt-in (TCPA).
--      See the comments on Customer in schema.prisma.

-- ── Enums ─────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "MessageChannel" AS ENUM ('SMS', 'EMAIL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELED', 'FAILED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ALTER TYPE ... ADD VALUE is idempotent with IF NOT EXISTS from PG 12, and
-- unlike CREATE TYPE it cannot be wrapped in an exception block that catches
-- anything useful.
ALTER TYPE "MessageKind" ADD VALUE IF NOT EXISTS 'CAMPAIGN';

-- ── Campaign ──────────────────────────────────────────────────────────────
-- Created before Message gains its foreign key to it.

CREATE TABLE IF NOT EXISTS "Campaign" (
  "id"              TEXT NOT NULL,
  "restaurantId"    TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "channel"         "MessageChannel" NOT NULL,
  "status"          "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "audienceQuery"   TEXT NOT NULL DEFAULT '',
  "segmentId"       TEXT,
  "subject"         TEXT,
  "body"            TEXT NOT NULL,
  "scheduledFor"    TIMESTAMP(3),
  "startedAt"       TIMESTAMP(3),
  "completedAt"     TIMESTAMP(3),
  "canceledAt"      TIMESTAMP(3),
  "error"           TEXT,
  "audienceCount"   INTEGER NOT NULL DEFAULT 0,
  "queuedCount"     INTEGER NOT NULL DEFAULT 0,
  "sentCount"       INTEGER NOT NULL DEFAULT 0,
  "failedCount"     INTEGER NOT NULL DEFAULT 0,
  "skippedCount"    INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Campaign"
    ADD CONSTRAINT "Campaign_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Campaign_restaurantId_createdAt_idx"
  ON "Campaign"("restaurantId", "createdAt");

-- The scheduler sweep runs unscoped across every tenant looking for campaigns
-- whose time has come, so the index leads on status rather than restaurant.
CREATE INDEX IF NOT EXISTS "Campaign_status_scheduledFor_idx"
  ON "Campaign"("status", "scheduledFor");

-- ── Message: channel, subject, campaign ───────────────────────────────────
--
-- channel defaults to SMS, which is the correct label for every row that
-- already exists rather than a guess: email had no sender before this.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "channel" "MessageChannel" NOT NULL DEFAULT 'SMS';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

-- SET NULL, not CASCADE. Deleting a campaign must not delete the record of
-- what was sent — that record is what answers a carrier or ISP complaint, and
-- it has to outlive an owner tidying their campaign list.
DO $$ BEGIN
  ALTER TABLE "Message"
    ADD CONSTRAINT "Message_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Message_campaignId_status_idx"
  ON "Message"("campaignId", "status");

CREATE INDEX IF NOT EXISTS "Message_restaurantId_channel_createdAt_idx"
  ON "Message"("restaurantId", "channel", "createdAt");

-- ── Customer: email suppression ───────────────────────────────────────────

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emailOptOutAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emailOptOutReason" TEXT;
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "emailUnsubToken" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Customer_emailUnsubToken_key"
  ON "Customer"("emailUnsubToken");

CREATE INDEX IF NOT EXISTS "Customer_restaurantId_emailOptOutAt_idx"
  ON "Customer"("restaurantId", "emailOptOutAt");

-- ── Restaurant: sender identity ───────────────────────────────────────────

ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "emailFrom" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "emailFromName" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "emailReplyTo" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "emailSenderVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "emailFooterAddress" TEXT;
