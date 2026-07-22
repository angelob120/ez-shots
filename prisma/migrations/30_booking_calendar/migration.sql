-- The booking calendar: bookable call types, and the calls booked against them.
--
-- Replaces a planned TidyCal integration. Built in-house because the calendar
-- has to know about tenants — an onboarding call belongs to a restaurant, shows
-- on that owner's dashboard, and lingers until it happens. A third-party
-- scheduler cannot do any of that without a sync job whose failure mode is an
-- owner staring at a banner for a call they already had.
--
-- Written idempotently — see scripts/migrate.mjs for why.

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "BookingStatus" AS ENUM ('SCHEDULED', 'CANCELED', 'ATTENDED', 'NO_SHOW');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- BookingType
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "BookingType" (
  "id"               TEXT NOT NULL,
  "slug"             TEXT NOT NULL,
  "name"             TEXT NOT NULL,
  "blurb"            TEXT,
  "durationMins"     INTEGER NOT NULL DEFAULT 10,
  "bufferMins"       INTEGER NOT NULL DEFAULT 5,
  "minNoticeMins"    INTEGER NOT NULL DEFAULT 120,
  "maxDaysAhead"     INTEGER NOT NULL DEFAULT 21,
  "availabilityJson" JSONB,
  "timezone"         TEXT NOT NULL DEFAULT 'America/New_York',
  "meetingUrl"       TEXT,
  "active"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BookingType_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "BookingType_slug_key" ON "BookingType"("slug");
CREATE INDEX IF NOT EXISTS "BookingType_active_idx" ON "BookingType"("active");

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Booking" (
  "id"             TEXT NOT NULL,
  "typeId"         TEXT NOT NULL,
  "restaurantId"   TEXT,
  "name"           TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "phone"          TEXT,
  "note"           TEXT,
  "startsAt"       TIMESTAMP(3) NOT NULL,
  "endsAt"         TIMESTAMP(3) NOT NULL,
  "bookerTimezone" TEXT,
  "status"         "BookingStatus" NOT NULL DEFAULT 'SCHEDULED',
  "meetingUrl"     TEXT,
  "publicToken"    TEXT NOT NULL,
  "canceledAt"     TIMESTAMP(3),
  "attendedAt"     TIMESTAMP(3),
  "source"         TEXT NOT NULL DEFAULT 'web',
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_publicToken_key" ON "Booking"("publicToken");
CREATE INDEX IF NOT EXISTS "Booking_startsAt_idx" ON "Booking"("startsAt");
CREATE INDEX IF NOT EXISTS "Booking_status_startsAt_idx" ON "Booking"("status", "startsAt");
CREATE INDEX IF NOT EXISTS "Booking_restaurantId_idx" ON "Booking"("restaurantId");
CREATE INDEX IF NOT EXISTS "Booking_email_idx" ON "Booking"("email");

-- The double-booking guard, and the reason this migration exists at all.
--
-- Partial on purpose. Two people hitting Confirm on the same 2pm slot within
-- the same second is the one race this system has, and it cannot be closed by
-- checking for a conflict before inserting — that read is stale the moment it
-- returns. The unique index makes the second INSERT fail, which is a error the
-- booking module catches and turns into "that slot just went".
--
-- It must exclude non-scheduled rows: a canceled 2pm has to leave 2pm bookable
-- again, and a plain unique constraint would burn the slot forever on the first
-- cancellation. Prisma cannot express a WHERE on a unique index, so it lives
-- here and not in schema.prisma — same arrangement as ServiceSuspension.

CREATE UNIQUE INDEX IF NOT EXISTS "Booking_type_start_live_key"
  ON "Booking"("typeId", "startsAt")
  WHERE "status" = 'SCHEDULED';

-- ---------------------------------------------------------------------------
-- Foreign keys
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "Booking" ADD CONSTRAINT "Booking_typeId_fkey"
    FOREIGN KEY ("typeId") REFERENCES "BookingType"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SET NULL rather than CASCADE: if a tenant is deleted we still want the
-- record that we spent half an hour on a call with them.
DO $$ BEGIN
  ALTER TABLE "Booking" ADD CONSTRAINT "Booking_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Seed the two types that exist
-- ---------------------------------------------------------------------------
--
-- Seeded here rather than in db:seed because the onboarding banner and the
-- contact page both link to a slug and would 404 on a fresh database. No
-- availability is set — the calendar hands out nothing until an admin sets
-- windows on /admin/calendar, which is the safe direction: an empty picker
-- says "no times available" and a wrongly-populated one books calls at 3am.

INSERT INTO "BookingType" ("id", "slug", "name", "blurb", "durationMins", "minNoticeMins", "maxDaysAhead", "updatedAt")
VALUES (
  'btype_onboarding',
  'setup',
  'Setup call',
  'A quick walkthrough of your ordering page, your menu, and getting orders into your kitchen. Bring your menu if you have it.',
  20, 120, 21, CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "BookingType" ("id", "slug", "name", "blurb", "durationMins", "minNoticeMins", "maxDaysAhead", "updatedAt")
VALUES (
  'btype_intro',
  'chat',
  'Quick 10 minute chat',
  'No pitch. Tell us what you are running and we will tell you straight whether this is a fit.',
  10, 120, 21, CURRENT_TIMESTAMP
)
ON CONFLICT ("slug") DO NOTHING;
