-- Editable template copy for the /r/[slug] website (value cards, page banner
-- subtitles, footer CTA). Stored as one JSON blob so the schema stays flat;
-- see lib/site-content.ts for the shape. Empty object means "use defaults",
-- so existing restaurants are unaffected until an owner edits something.
-- Written idempotently so the boot-time runner can re-apply safely.

ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "siteContent" JSONB NOT NULL DEFAULT '{}';
