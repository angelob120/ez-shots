-- Website customization fields for the /r/[slug] landing site.
-- Written idempotently (IF NOT EXISTS) so the boot-time runner can re-apply safely.

ALTER TABLE "Restaurant"
  ADD COLUMN IF NOT EXISTS "heroHeadline" TEXT,
  ADD COLUMN IF NOT EXISTS "heroCtaLabel" TEXT,
  ADD COLUMN IF NOT EXISTS "aboutTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "aboutBody" TEXT,
  ADD COLUMN IF NOT EXISTS "galleryUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "showAbout" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "showGallery" BOOLEAN NOT NULL DEFAULT true;
