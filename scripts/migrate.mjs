/**
 * Boot-time migration runner.
 *
 * Prisma refuses to apply anything once a migration row is left in a failed
 * state (P3009), and Railway gives you no natural place to run a one-off
 * `prisma migrate resolve`. So before deploying, clear any half-finished rows —
 * which is exactly what `migrate resolve --rolled-back` does — and then let
 * `migrate deploy` re-run them.
 *
 * Safe because every migration in this repo is written idempotently
 * (IF NOT EXISTS / guarded UPDATE). If you ever add one that isn't, make it so.
 */

import { spawnSync } from "node:child_process";

const CLEAR_FAILED = `
DO $$
BEGIN
  IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
    DELETE FROM "_prisma_migrations"
    WHERE "finished_at" IS NULL AND "rolled_back_at" IS NULL;
  END IF;
END
$$;
`;

function run(args, opts = {}) {
  const res = spawnSync("npx", args, { stdio: ["pipe", "inherit", "inherit"], ...opts });
  return res.status ?? 1;
}

console.log("[migrate] clearing any failed migration rows…");
const cleared = run(["prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--stdin"], {
  input: CLEAR_FAILED,
});
if (cleared !== 0) {
  // A brand-new database has no _prisma_migrations table yet; that's fine.
  console.warn("[migrate] cleanup step returned non-zero — continuing to deploy.");
}

console.log("[migrate] applying migrations…");
const status = run(["prisma", "migrate", "deploy"]);
process.exit(status);
