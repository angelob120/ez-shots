-- Platform notifications: an inbox row per recipient per event, plus per-user
-- per-kind channel preferences, plus an operator phone number for SMS alerts.
--
-- Written idempotently — scripts/migrate.mjs re-runs `migrate deploy` on every
-- boot, so every statement here has to be safe to apply twice. See
-- prisma/migrations/33_password_reset_and_menu_submission for the pattern.

-- ── User.phone ────────────────────────────────────────────────────────────
-- Operator SMS target. Never a diner's number, never the customer consent gate.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

-- ── Enums ─────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "NotificationKind" AS ENUM (
    'ORDER_PLACED', 'REFUND_FAILED', 'SUPPORT_TICKET', 'CONTACT_FORM',
    'BOOKING_CREATED', 'BOOKING_REMINDER', 'MENU_SUBMISSION', 'NEW_OPERATOR',
    'SERVICE_SUSPENDED', 'PAYMENT_MODE_REVERTED', 'PLAN_CHANGED', 'BROADCAST',
    'REMINDER'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "NotificationSeverity" AS ENUM ('INFO', 'WARNING', 'URGENT');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Notification ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Notification" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "kind"         "NotificationKind" NOT NULL,
  "severity"     "NotificationSeverity" NOT NULL DEFAULT 'INFO',
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "link"         TEXT,
  "restaurantId" TEXT,
  "dedupeKey"    TEXT,
  "scheduledFor" TIMESTAMP(3),
  "readAt"       TIMESTAMP(3),
  "emailedAt"    TIMESTAMP(3),
  "smsedAt"      TIMESTAMP(3),
  "deliveredAt"  TIMESTAMP(3),
  "createdById"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_scheduledFor_idx"
  ON "Notification"("userId", "readAt", "scheduledFor");
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx"
  ON "Notification"("userId", "createdAt");

-- The drain's working set: scheduled rows whose outbound pass hasn't run.
-- Partial so it stays tiny — a live notification is delivered at creation and
-- never appears here.
CREATE INDEX IF NOT EXISTS "Notification_pending_delivery_idx"
  ON "Notification"("scheduledFor")
  WHERE "deliveredAt" IS NULL;

-- Dedupe: at most one row per (userId, dedupeKey) when a key is present.
-- Partial so the vast majority of rows (no key) are never constrained.
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_userId_dedupeKey_key"
  ON "Notification"("userId", "dedupeKey")
  WHERE "dedupeKey" IS NOT NULL;

DO $$ BEGIN
  ALTER TABLE "Notification"
    ADD CONSTRAINT "Notification_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── NotificationPref ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "NotificationPref" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "kind"      "NotificationKind" NOT NULL,
  "inApp"     BOOLEAN NOT NULL DEFAULT true,
  "email"     BOOLEAN NOT NULL DEFAULT false,
  "sms"       BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationPref_userId_kind_key"
  ON "NotificationPref"("userId", "kind");

DO $$ BEGIN
  ALTER TABLE "NotificationPref"
    ADD CONSTRAINT "NotificationPref_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
