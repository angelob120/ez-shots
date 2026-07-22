-- Automations: the visual journey builder, its templates, and the per-customer
-- enrollments that walk them.
--
-- See docs/automations.md. Written idempotently — scripts/migrate.mjs re-runs
-- `migrate deploy` on every boot, so every statement here has to be safe twice.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  CREATE TYPE "AutomationStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'WAITING', 'COMPLETED', 'EXITED', 'FAILED', 'CANCELED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReentryPolicy" AS ENUM ('ONCE', 'ONCE_PER_TRIGGER', 'COOLDOWN', 'ALWAYS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'RETIRED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "TemplateSyncPolicy" AS ENUM ('ALWAYS', 'AUTO_UNLESS_CUSTOMIZED', 'OPT_IN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A new MessageKind. ADD VALUE IF NOT EXISTS is idempotent on its own and,
-- unlike CREATE TYPE, cannot be wrapped in a transaction on older Postgres —
-- so it stands alone rather than inside a DO block.
ALTER TYPE "MessageKind" ADD VALUE IF NOT EXISTS 'AUTOMATION';

-- ---------------------------------------------------------------------------
-- Templates (created first: Automation references them)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AutomationTemplate" (
  "id"                 TEXT NOT NULL,
  "name"               TEXT NOT NULL,
  "slug"               TEXT NOT NULL,
  "blurb"              TEXT,
  "category"           TEXT NOT NULL DEFAULT 'other',
  "status"             "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
  "syncPolicy"         "TemplateSyncPolicy" NOT NULL DEFAULT 'AUTO_UNLESS_CUSTOMIZED',
  "triggerType"        TEXT NOT NULL,
  "triggerConfig"      JSONB,
  "draftGraph"         JSONB,
  "publishedVersionId" TEXT,
  "adoptionCount"      INTEGER NOT NULL DEFAULT 0,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutomationTemplate_slug_key" ON "AutomationTemplate"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationTemplate_publishedVersionId_key" ON "AutomationTemplate"("publishedVersionId");
CREATE INDEX IF NOT EXISTS "AutomationTemplate_status_category_idx" ON "AutomationTemplate"("status", "category");

CREATE TABLE IF NOT EXISTS "AutomationTemplateVersion" (
  "id"                TEXT NOT NULL,
  "templateId"        TEXT NOT NULL,
  "version"           INTEGER NOT NULL,
  "graph"             JSONB NOT NULL,
  "triggerType"       TEXT NOT NULL,
  "triggerConfig"     JSONB,
  "notes"             TEXT,
  "publishedByUserId" TEXT,
  "publishedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationTemplateVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutomationTemplateVersion_templateId_version_key"
  ON "AutomationTemplateVersion"("templateId", "version");

-- ---------------------------------------------------------------------------
-- Automation
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "Automation" (
  "id"              TEXT NOT NULL,
  "restaurantId"    TEXT NOT NULL,
  "name"            TEXT NOT NULL,
  "status"          "AutomationStatus" NOT NULL DEFAULT 'DRAFT',
  "triggerType"     TEXT NOT NULL,
  "triggerConfig"   JSONB,
  "reentry"         "ReentryPolicy" NOT NULL DEFAULT 'ONCE',
  "reentryDays"     INTEGER NOT NULL DEFAULT 30,
  "quietStartMin"   INTEGER NOT NULL DEFAULT 540,
  "quietEndMin"     INTEGER NOT NULL DEFAULT 1200,
  "activeVersionId" TEXT,
  "draftGraph"      JSONB,
  "templateId"                       TEXT,
  "templateVersionId"                TEXT,
  "templateForkedAt"                 TIMESTAMP(3),
  "templateUpdateAvailableVersionId" TEXT,
  "hookToken"       TEXT,
  "enteredCount"    INTEGER NOT NULL DEFAULT 0,
  "completedCount"  INTEGER NOT NULL DEFAULT 0,
  "goalCount"       INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt"     TIMESTAMP(3),
  CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Automation_activeVersionId_key" ON "Automation"("activeVersionId");
CREATE UNIQUE INDEX IF NOT EXISTS "Automation_hookToken_key" ON "Automation"("hookToken");
CREATE INDEX IF NOT EXISTS "Automation_restaurantId_status_idx" ON "Automation"("restaurantId", "status");
CREATE INDEX IF NOT EXISTS "Automation_restaurantId_triggerType_status_idx" ON "Automation"("restaurantId", "triggerType", "status");
CREATE INDEX IF NOT EXISTS "Automation_status_triggerType_idx" ON "Automation"("status", "triggerType");
CREATE INDEX IF NOT EXISTS "Automation_templateId_idx" ON "Automation"("templateId");

CREATE TABLE IF NOT EXISTS "AutomationVersion" (
  "id"                TEXT NOT NULL,
  "automationId"      TEXT NOT NULL,
  "version"           INTEGER NOT NULL,
  "graph"             JSONB NOT NULL,
  "triggerType"       TEXT NOT NULL,
  "triggerConfig"     JSONB,
  "templateVersionId" TEXT,
  "createdByUserId"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AutomationVersion_automationId_version_key"
  ON "AutomationVersion"("automationId", "version");

-- ---------------------------------------------------------------------------
-- Enrollments and their step log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AutomationEnrollment" (
  "id"            TEXT NOT NULL,
  "automationId"  TEXT NOT NULL,
  "restaurantId"  TEXT NOT NULL,
  "customerId"    TEXT NOT NULL,
  "versionId"     TEXT NOT NULL,
  "status"        "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
  "currentNodeId" TEXT,
  "resumeAt"      TIMESTAMP(3),
  "context"       JSONB,
  "variant"       TEXT,
  "steps"         INTEGER NOT NULL DEFAULT 0,
  "goalMetAt"     TIMESTAMP(3),
  "exitReason"    TEXT,
  "enteredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"       TIMESTAMP(3),
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationEnrollment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationEnrollment_status_resumeAt_idx" ON "AutomationEnrollment"("status", "resumeAt");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_automationId_status_idx" ON "AutomationEnrollment"("automationId", "status");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_restaurantId_enteredAt_idx" ON "AutomationEnrollment"("restaurantId", "enteredAt");
CREATE INDEX IF NOT EXISTS "AutomationEnrollment_customerId_idx" ON "AutomationEnrollment"("customerId");

-- The re-entry guard, and the reason it is here rather than in schema.prisma:
-- Prisma cannot express a partial unique index. This is the enforcement;
-- `canEnroll` in lib/automations.ts is the courtesy that produces a readable
-- error. Two order events a second apart is exactly how somebody gets enrolled
-- twice and texted twice, and the read in `canEnroll` is stale the moment it
-- returns.
--
-- It has to stay PARTIAL. Made total, a customer who completed this journey in
-- March could never enter it again — which silently breaks every ALWAYS and
-- COOLDOWN re-entry policy.
CREATE UNIQUE INDEX IF NOT EXISTS "AutomationEnrollment_live_unique"
  ON "AutomationEnrollment"("automationId", "customerId")
  WHERE "status" IN ('ACTIVE', 'WAITING');

CREATE TABLE IF NOT EXISTS "AutomationStep" (
  "id"           TEXT NOT NULL,
  "enrollmentId" TEXT NOT NULL,
  "nodeId"       TEXT NOT NULL,
  "nodeKind"     TEXT NOT NULL,
  "outcome"      TEXT NOT NULL,
  "detail"       TEXT,
  "messageId"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AutomationStep_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AutomationStep_enrollmentId_createdAt_idx" ON "AutomationStep"("enrollmentId", "createdAt");

-- ---------------------------------------------------------------------------
-- Message attribution
-- ---------------------------------------------------------------------------

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "automationId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "enrollmentId" TEXT;

CREATE INDEX IF NOT EXISTS "Message_automationId_status_idx" ON "Message"("automationId", "status");
CREATE INDEX IF NOT EXISTS "Message_enrollmentId_idx" ON "Message"("enrollmentId");

-- ---------------------------------------------------------------------------
-- Foreign keys
--
-- Each wrapped, because ADD CONSTRAINT has no IF NOT EXISTS. Deletion
-- behaviour is not uniform and the differences are deliberate:
--
--   - Message → Automation/Enrollment is SET NULL. The record of who we
--     contacted outlives the owner tidying up their automations; it is what
--     answers a carrier complaint.
--   - Enrollment → AutomationVersion is RESTRICT. A version an enrollment is
--     pinned to must not vanish underneath it — that is the whole point of
--     pinning.
-- ---------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE "Automation" ADD CONSTRAINT "Automation_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Automation" ADD CONSTRAINT "Automation_activeVersionId_fkey"
    FOREIGN KEY ("activeVersionId") REFERENCES "AutomationVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Automation" ADD CONSTRAINT "Automation_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "AutomationTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationVersion" ADD CONSTRAINT "AutomationVersion_automationId_fkey"
    FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationTemplate" ADD CONSTRAINT "AutomationTemplate_publishedVersionId_fkey"
    FOREIGN KEY ("publishedVersionId") REFERENCES "AutomationTemplateVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationTemplateVersion" ADD CONSTRAINT "AutomationTemplateVersion_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "AutomationTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_automationId_fkey"
    FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_restaurantId_fkey"
    FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationEnrollment" ADD CONSTRAINT "AutomationEnrollment_versionId_fkey"
    FOREIGN KEY ("versionId") REFERENCES "AutomationVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "AutomationStep" ADD CONSTRAINT "AutomationStep_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_automationId_fkey"
    FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_enrollmentId_fkey"
    FOREIGN KEY ("enrollmentId") REFERENCES "AutomationEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
