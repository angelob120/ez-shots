-- Template visibility: who sees a template.
--   PRIVATE — admins only (experiments, half-built drafts).
--   OWNERS  — shown in the owner gallery to adopt by hand (the default).
--   PRESET  — a done-for-you reordering preset: shown to owners AND driven by
--             the dial when its slug is one of the reorder- levels.
--
-- Replaces the removed `category` column as the one categorical distinction
-- that matters, and it's the one enforced in the owner gallery query.
--
-- Written idempotently — see scripts/migrate.mjs.

ALTER TABLE "AutomationTemplate"
  ADD COLUMN IF NOT EXISTS "visibility" TEXT NOT NULL DEFAULT 'OWNERS';

-- The three reordering presets are PRESET. Idempotent: safe if they don't exist
-- yet (seeded later) or already carry the value.
UPDATE "AutomationTemplate"
SET "visibility" = 'PRESET'
WHERE "slug" IN ('reorder-light', 'reorder-medium', 'reorder-heavy');
