-- Real SMS delivery: give the Message table somewhere to record who was
-- actually dialled and what the carrier did with it.
--
-- The stub never needed either. A `Message` row meant "we decided to say this",
-- and that was the whole truth because nothing left the building. Once Twilio
-- is behind the seam, "we decided to say this", "Twilio accepted it" and "a
-- handset received it" are three different facts, and support calls turn on
-- which one you have.
--
-- Idempotent, like every migration here — scripts/migrate.mjs re-runs
-- `migrate deploy` on every boot.

-- The number as dialled, in E.164. Denormalised from Customer.phone on purpose:
-- a customer can change their number, and the question you ask six weeks later
-- is "where did this text go", not "where would it go now".
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "to" TEXT;

-- Carrier confirmation, which arrives later and out of band via the status
-- callback. Null forever is normal for the stub and for messages Twilio
-- accepted but never reported on.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "deliveredAt" TIMESTAMP(3);

-- SENT means Twilio took it. DELIVERED means a handset got it. UNDELIVERED
-- means the carrier gave up — which is invisible today and is the single most
-- useful thing to know about a customer who says "I never heard anything".
-- Top level, not wrapped in DO $$ — ADD VALUE can't run inside a transaction
-- block on older PGs and refuses to run in a function body at all. Same shape
-- as OrderStatus/REJECTED in 13_post_order_support.
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'UNDELIVERED';

-- Status callbacks arrive keyed by Twilio's SID and nothing else, so this is
-- the lookup path for every inbound delivery receipt.
CREATE INDEX IF NOT EXISTS "Message_providerRef_idx" ON "Message" ("providerRef");

-- The tenant's own sending number, E.164.
--
-- Per-tenant rather than one platform number for two reasons. A2P 10DLC
-- registers a brand and a campaign per *business*, and these are separate
-- businesses however the billing works. And an inbound STOP arrives addressed
-- only to the number that sent the original — so this column is also the sole
-- route from a delivery receipt back to a restaurant, which is why it's
-- unique. Null means the tenant isn't registered yet and falls back to the
-- platform messaging service.
ALTER TABLE "Restaurant" ADD COLUMN IF NOT EXISTS "smsFrom" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Restaurant_smsFrom_key" ON "Restaurant" ("smsFrom");
