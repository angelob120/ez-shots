-- Onboarding progress fields + PENDING default for self-serve signups.

ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "onboardingStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "onboardedAt" TIMESTAMP(3);

-- Everything that already exists was admin-created and is already live.
UPDATE "Restaurant"
SET "onboardingStep" = 4,
    "onboardedAt" = COALESCE("onboardedAt", "createdAt")
WHERE "onboardedAt" IS NULL;

ALTER TABLE "Restaurant" ALTER COLUMN "status" SET DEFAULT 'PENDING';
