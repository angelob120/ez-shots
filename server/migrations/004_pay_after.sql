-- Book for $0, pay after the photos are seen.
--
-- A booking from the site is now confirmed the moment it is made, with nothing
-- paid. `stage` is where the job is after that, and it is what the customer's
-- manage page and the emails are driven from:
--
--   booked     on the calendar, nothing due
--   shot       the owner pressed Shoot done, editing
--   ready      previews sent, payment due
--   delivered  paid, the clean files link is unlocked
--
-- `flagged_at` is the unhappy path. A flagged job gets no reminder, no payment
-- nudge and no review request until the owner clears it.
--
-- The payment's Checkout Session goes in the existing stripe_session_id, so
-- the webhook finds the booking the same way it always has.
--
-- `final_url` is never shown to the customer before `paid` is true. That is
-- the whole protection on the work: the preview link is what the owner chose
-- to send unpaid (watermarked or low resolution, his call), the clean files
-- link is released by the payment.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'booked';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS shot_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ready_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS preview_url text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS final_url text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flagged_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS flag_reason text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminded_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS review_sent_at timestamptz;

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_stage_check
    CHECK (stage IN ('booked', 'shot', 'ready', 'delivered'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Everything paid at booking under the old model is already past the money.
-- Its shoot may still be ahead, so it is booked, not delivered; the owner
-- moves it on from admin like any other.
