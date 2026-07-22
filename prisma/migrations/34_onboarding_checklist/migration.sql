-- Manual onboarding checklist: the operator-followed steps of getting a
-- restaurant live, with per-tenant completion state and admin-only notes.
--
--   1. OnboardingTask  — one row per (restaurant, step key), the tick state
--      for a step whose definition lives in lib/onboarding-checklist.ts. Not
--      the same thing as lib/readiness.ts, which derives facts the DB already
--      knows; these steps happen on a phone call and cannot be derived.
--   2. OnboardingNote  — an admin's running note on a tenant's onboarding.
--      Ours, never the tenant's — a separate table, not a visibility flag,
--      exactly like CustomerAdminNote and SupportNote.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- ── OnboardingTask ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OnboardingTask" (
  "id"              TEXT NOT NULL,
  "restaurantId"    TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "done"            BOOLEAN NOT NULL DEFAULT false,
  "completedByName" TEXT,
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OnboardingTask_pkey" PRIMARY KEY ("id")
);

-- One row per step per tenant. The upsert in setStep depends on this being
-- unique — without it a double-click leaves two rows for the same step.
CREATE UNIQUE INDEX IF NOT EXISTS "OnboardingTask_restaurantId_key_key"
  ON "OnboardingTask"("restaurantId", "key");

CREATE INDEX IF NOT EXISTS "OnboardingTask_restaurantId_idx"
  ON "OnboardingTask"("restaurantId");

DO $$ BEGIN
  ALTER TABLE "OnboardingTask"
    ADD CONSTRAINT "OnboardingTask_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── OnboardingNote ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "OnboardingNote" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  -- "onboarding" (working notes while getting them live) or "account" (ongoing
  -- notes once trading). Two streams, one table — see the schema comment.
  "kind"         TEXT NOT NULL DEFAULT 'onboarding',
  "authorUserId" TEXT,
  "authorName"   TEXT,
  "body"         TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OnboardingNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OnboardingNote_restaurantId_kind_createdAt_idx"
  ON "OnboardingNote"("restaurantId", "kind", "createdAt");

DO $$ BEGIN
  ALTER TABLE "OnboardingNote"
    ADD CONSTRAINT "OnboardingNote_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── Editable step wording ──────────────────────────────────────────────────
-- Operator-edited label/detail overrides for the checklist, so the text can be
-- changed from the admin UI without a deploy. Shape { [key]: { label, detail } }.
ALTER TABLE "PlatformSetting"
  ADD COLUMN IF NOT EXISTS "onboardingStepOverrides" JSONB NOT NULL DEFAULT '{}';
