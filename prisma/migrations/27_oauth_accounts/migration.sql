-- Sign in with Google and Apple.
--
-- Two tables rather than one with a nullable owner, and that is the same split
-- as SupportNote/SupportMessage and CustomerNote/CustomerAdminNote elsewhere in
-- this schema. A single `oauth_identity` table with both `userId` and
-- `customerAccountId` nullable would put a customer identity one forgotten
-- WHERE clause away from authenticating into an owner dashboard. Two tables
-- make that mistake unavailable rather than discouraged.
--
-- Written idempotently — see scripts/migrate.mjs for why.

-- ---------------------------------------------------------------------------
-- Staff identities (owners and admins)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "OAuthIdentity" (
  "id"          TEXT NOT NULL,
  "provider"    TEXT NOT NULL,
  "subject"     TEXT NOT NULL,
  "email"       TEXT,
  "userId"      TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt" TIMESTAMP(3),
  CONSTRAINT "OAuthIdentity_pkey" PRIMARY KEY ("id")
);

-- The provider's subject is the identity, not the email address: people change
-- the address on a Google account and the account is still the same account.
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthIdentity_provider_subject_key"
  ON "OAuthIdentity" ("provider", "subject");

CREATE INDEX IF NOT EXISTS "OAuthIdentity_userId_idx" ON "OAuthIdentity" ("userId");

-- One link per provider per user. Without this, a user can accumulate two
-- Google identities and "unlink Google" becomes ambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS "OAuthIdentity_userId_provider_key"
  ON "OAuthIdentity" ("userId", "provider");

DO $$ BEGIN
  ALTER TABLE "OAuthIdentity"
    ADD CONSTRAINT "OAuthIdentity_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Customer accounts (storefront)
-- ---------------------------------------------------------------------------
--
-- Scoped to a restaurant, deliberately. A diner who signs in at two
-- restaurants on the platform has two accounts and neither can see the other,
-- which is the same isolation every other customer-shaped table has. The
-- alternative — one platform-wide identity — turns the tenant's own customer
-- list into a shared directory, and the customer list is the product.

CREATE TABLE IF NOT EXISTS "CustomerAccount" (
  "id"           TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "provider"     TEXT NOT NULL,
  "subject"      TEXT NOT NULL,
  "email"        TEXT,
  "name"         TEXT,
  -- Null until the account is matched to a Customer row, which only happens at
  -- checkout when a phone number is supplied. An account is not a customer:
  -- Customer.phone is the dedupe key for the tenant's list and an email address
  -- cannot stand in for it.
  "customerId"   TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLoginAt"  TIMESTAMP(3),
  CONSTRAINT "CustomerAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CustomerAccount_restaurant_provider_subject_key"
  ON "CustomerAccount" ("restaurantId", "provider", "subject");

CREATE INDEX IF NOT EXISTS "CustomerAccount_restaurantId_idx"
  ON "CustomerAccount" ("restaurantId");

CREATE INDEX IF NOT EXISTS "CustomerAccount_customerId_idx"
  ON "CustomerAccount" ("customerId");

DO $$ BEGIN
  ALTER TABLE "CustomerAccount"
    ADD CONSTRAINT "CustomerAccount_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SET NULL rather than CASCADE: an import undo or a privacy deletion that
-- removes a Customer row must not silently delete the sign-in that person uses
-- to reach their order history.
DO $$ BEGIN
  ALTER TABLE "CustomerAccount"
    ADD CONSTRAINT "CustomerAccount_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
