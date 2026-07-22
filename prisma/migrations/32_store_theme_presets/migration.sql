-- Storefront theme presets.
--
-- One column. Every tenant's website already shares a skeleton; this records
-- which surface it wears (see src/lib/store-theme.ts).
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- 'classic' is the palette the storefront has shipped with since it existed,
-- so backfilling every existing row to it changes nothing visually. That is
-- the point: a tenant who never opens the editor must not find their site
-- redecorated by a deploy.
ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "themePreset" TEXT NOT NULL DEFAULT 'classic';
