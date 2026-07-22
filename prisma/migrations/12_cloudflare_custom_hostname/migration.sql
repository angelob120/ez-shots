-- Cloudflare for SaaS custom hostname tracking
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cfHostnameId" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cfStatus" TEXT;
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "cfSslStatus" TEXT;
