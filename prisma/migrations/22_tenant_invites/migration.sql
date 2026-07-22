-- Single-use, expiring invite links that provision an owner login.
--
-- Replaces "create the user with a password and tell them the password", which
-- is both a bad look on a first contact and a credential that then lives in
-- somebody's sent messages forever.
--
-- Written idempotently — see scripts/migrate.mjs for why every migration in
-- this repo has to be safe to re-run.

CREATE TABLE IF NOT EXISTS "Invite" (
  "id"           TEXT NOT NULL,
  -- SHA-256 of the token. The token itself is returned once at creation and
  -- never stored, so a database backup contains no usable invites.
  "tokenHash"    TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "email"        TEXT NOT NULL,
  "role"         "Role" NOT NULL DEFAULT 'OWNER',
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById"  TEXT,
  "redeemedAt"   TIMESTAMP(3),
  "redeemedById" TEXT,
  "revokedAt"    TIMESTAMP(3),

  CONSTRAINT "Invite_pkey" PRIMARY KEY ("id")
);

-- Unique so redemption is one indexed read and two racing requests cannot each
-- match a row. The optimistic lock in lib/invites.ts is what makes the redeem
-- itself single-use; this makes the lookup unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "Invite_tokenHash_key" ON "Invite"("tokenHash");

-- "What is still outstanding for this tenant" is the query the admin console
-- runs on every tenant page and on the attention list.
CREATE INDEX IF NOT EXISTS "Invite_restaurantId_redeemedAt_idx"
  ON "Invite"("restaurantId", "redeemedAt");

CREATE INDEX IF NOT EXISTS "Invite_email_idx" ON "Invite"("email");

DO $$ BEGIN
  ALTER TABLE "Invite"
    ADD CONSTRAINT "Invite_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
