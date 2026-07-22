-- Drop AutomationTemplate.category. Templates are no longer grouped by a
-- category: the owner gallery lists them flat, and the one categorical
-- distinction that mattered (reordering templates vs the rest) is carried by
-- the reorder- slug prefix and enforced in code, not by this column.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- The composite index went with the column; replace it with one on status.
DROP INDEX IF EXISTS "AutomationTemplate_status_category_idx";
CREATE INDEX IF NOT EXISTS "AutomationTemplate_status_idx"
  ON "AutomationTemplate"("status");

ALTER TABLE "AutomationTemplate" DROP COLUMN IF EXISTS "category";
