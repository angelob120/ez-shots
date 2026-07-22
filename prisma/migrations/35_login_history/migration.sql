-- Operator login history: a ledger of authentications (LoginEvent) and a feed
-- of authenticated page loads (ActivityEvent). Admin-only reporting; no
-- customer surface exists yet.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "LoginMethod" AS ENUM (
    'PASSWORD', 'SIGNUP', 'INVITE', 'OAUTH', 'IMPERSONATE'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- LoginEvent
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "LoginEvent" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "method"    "LoginMethod" NOT NULL,
  "ip"        TEXT,
  "userAgent" TEXT,
  "at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "LoginEvent"
    ADD CONSTRAINT "LoginEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "LoginEvent_userId_at_idx" ON "LoginEvent"("userId", "at");
CREATE INDEX IF NOT EXISTS "LoginEvent_at_idx" ON "LoginEvent"("at");

-- ---------------------------------------------------------------------------
-- ActivityEvent
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "ActivityEvent" (
  "id"     TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "path"   TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'GET',
  "at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "ActivityEvent"
    ADD CONSTRAINT "ActivityEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ActivityEvent_userId_at_idx" ON "ActivityEvent"("userId", "at");
CREATE INDEX IF NOT EXISTS "ActivityEvent_at_idx" ON "ActivityEvent"("at");
