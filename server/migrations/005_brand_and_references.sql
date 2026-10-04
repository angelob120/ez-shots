-- What the client wants the photos to look like, before the shoot.
--
-- Two kinds of file a client can add from their manage page:
--
--   watermark  their brokerage's logo, one per booking, a new one replaces it.
--              The owner only puts it on the photos when `watermark_wanted`
--              is true; `watermark_spot` is where it goes.
--   reference  example photos of the look they like, up to twelve a booking.
--              The browser shrinks them to about 2000px before upload, so a
--              set is a few MB, not a phone's worth of originals.
--
-- The files live in Postgres as bytea. It is a handful of small images a job
-- and the database already has its own volume, so there is no bucket to set
-- up and nothing else to lose in a redeploy. PNG, JPEG and WebP only: an SVG
-- can carry script, and these are served back on the same origin as admin.
--
-- `reference_notes` is free text for links (a Zillow listing, a Pinterest
-- board) and what they like about them.

CREATE TABLE IF NOT EXISTS booking_files (
  id          serial PRIMARY KEY,
  booking_id  text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('watermark', 'reference')),
  name        text NOT NULL DEFAULT '',
  mime        text NOT NULL CHECK (mime IN ('image/png', 'image/jpeg', 'image/webp')),
  size        integer NOT NULL,
  data        bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS booking_files_booking ON booking_files (booking_id);

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS watermark_wanted boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS watermark_spot text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reference_notes text NOT NULL DEFAULT '';
