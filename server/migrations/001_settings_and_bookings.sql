-- The first schema. Applied once by server/db.js on boot, recorded in
-- schema_migrations, never edited afterwards: the next change is 002.

CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bookings (
  number                 bigserial PRIMARY KEY,
  id                     text NOT NULL UNIQUE,
  status                 text NOT NULL CHECK (status IN ('held', 'confirmed', 'cancelled')),
  date                   date NOT NULL,
  time                   text NOT NULL,
  starts_at              timestamptz NOT NULL,
  package_id             text NOT NULL,
  package_name           text NOT NULL,
  first_shoot            boolean NOT NULL DEFAULT true,
  amount                 integer NOT NULL,
  list_price             integer NOT NULL,
  name                   text NOT NULL,
  email                  text NOT NULL,
  phone                  text NOT NULL,
  brokerage              text NOT NULL DEFAULT '',
  address                text NOT NULL,
  size                   text NOT NULL DEFAULT '',
  occupancy              text NOT NULL DEFAULT '',
  access                 text NOT NULL DEFAULT '',
  access_notes           text NOT NULL DEFAULT '',
  notes                  text NOT NULL DEFAULT '',
  internal_notes         text NOT NULL DEFAULT '',
  paid                   boolean NOT NULL DEFAULT false,
  paid_at                timestamptz,
  checkout_mode          text NOT NULL DEFAULT '',
  checkout_url           text NOT NULL DEFAULT '',
  stripe_session_id      text,
  stripe_payment_intent  text,
  stripe_customer_id     text,
  token                  text NOT NULL UNIQUE,
  expires_at             timestamptz,
  cancelled_at           timestamptz,
  cancelled_by           text,
  source                 text NOT NULL DEFAULT 'site',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bookings_date_time_idx ON bookings (date, time);
CREATE INDEX IF NOT EXISTS bookings_starts_at_idx ON bookings (starts_at);
CREATE INDEX IF NOT EXISTS bookings_session_idx ON bookings (stripe_session_id);
CREATE INDEX IF NOT EXISTS bookings_email_idx ON bookings (lower(email));

-- The backstop against a double booking: two confirmed rows can never share a
-- slot, whatever the code above them does. Holds are serialised in db.js with
-- an advisory lock, since "held and not yet expired" is not a thing an index
-- can say.
CREATE UNIQUE INDEX IF NOT EXISTS bookings_one_confirmed_per_slot
  ON bookings (date, time) WHERE status = 'confirmed';
