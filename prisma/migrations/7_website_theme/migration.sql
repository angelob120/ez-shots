-- Per-tenant website theme for the /r/[slug] landing site.
-- LIGHT | DARK | SYSTEM. SYSTEM (the default) follows the visitor's device,
-- which is the behaviour every existing restaurant had before this column.
-- Written idempotently so the boot-time runner can re-apply safely.

ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'SYSTEM';
