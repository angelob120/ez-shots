-- Done-for-you reordering: the owner's on/off choice, the intensity dial, and
-- when they last answered the onboarding question.
--
--   reorderCampaigns — the on/off switch, default off (an existing tenant has
--                      not opted in and must not start sending unasked).
--   reorderMode      — LIGHT | MEDIUM | HEAVY, resolved through coerceMode in
--                      lib/reorder.ts; a String, not an enum, so a level can be
--                      renamed without migrating every row.
--   reorderChoiceAt  — when the owner last answered. The reordering step is
--                      required-to-answer but not launch-gating, so this — not
--                      the onboarding gate — decides whether the dashboard nags.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "reorderCampaigns" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "reorderMode" TEXT NOT NULL DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "reorderChoiceAt" TIMESTAMP(3);
