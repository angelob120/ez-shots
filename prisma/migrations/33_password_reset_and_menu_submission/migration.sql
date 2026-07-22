-- Two additions, unrelated except that they ship together:
--
--   1. PasswordResetToken — the storage behind the operator "forgot password"
--      flow. Same shape as Invite: SHA-256 of a 160-bit token, single-use,
--      expiring, never deleted.
--   2. MenuSubmission — a "build my menu for me" request captured during
--      onboarding. A submission, not a menu; nothing here writes MenuItem.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- ── PasswordResetToken ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "PasswordResetToken" (
  "id"        TEXT NOT NULL,
  -- SHA-256 of the token. The token is emailed once and never stored, so a
  -- database backup contains no usable reset links.
  "tokenHash" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt"    TIMESTAMP(3),

  CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PasswordResetToken_tokenHash_key"
  ON "PasswordResetToken"("tokenHash");

CREATE INDEX IF NOT EXISTS "PasswordResetToken_userId_idx"
  ON "PasswordResetToken"("userId");

DO $$ BEGIN
  ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ── MenuSubmission ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "MenuSubmission" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "links"        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "pastedText"   TEXT,
  "photoUrls"    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notes"        TEXT,
  "fulfilledAt"  TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MenuSubmission_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "MenuSubmission_restaurantId_fulfilledAt_idx"
  ON "MenuSubmission"("restaurantId", "fulfilledAt");

CREATE INDEX IF NOT EXISTS "MenuSubmission_fulfilledAt_createdAt_idx"
  ON "MenuSubmission"("fulfilledAt", "createdAt");

DO $$ BEGIN
  ALTER TABLE "MenuSubmission"
    ADD CONSTRAINT "MenuSubmission_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
