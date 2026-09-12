-- The owner's say over a paid booking, and money going back.
--
-- A booking used to be final the moment Stripe said paid. Now a paid booking
-- waits for the owner: status stays 'confirmed', because the slot is taken and
-- the unique index must keep guarding it, and `decision` says whether the owner
-- has accepted it yet. NULL means paid and waiting on him. 'declined' always
-- comes with status 'cancelled' and a refund.
--
-- Refunds are counted in cents because a partial refund can be $62.50 and
-- `amount` is whole dollars. `refunded_cents` only ever grows, and db.js adds to
-- it with a conditional update so two clicks cannot record one refund twice.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decision text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refunded_cents integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS refunded_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS stripe_refund_ids text NOT NULL DEFAULT '';

DO $$ BEGIN
  ALTER TABLE bookings ADD CONSTRAINT bookings_decision_check
    CHECK (decision IS NULL OR decision IN ('accepted', 'declined'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Everything already paid for before this existed was treated as booked, and
-- the customer was told so. It stays booked.
UPDATE bookings SET decision = 'accepted', decided_at = now(), decided_by = 'migration'
WHERE status = 'confirmed' AND decision IS NULL;
