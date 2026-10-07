-- A watermarked thumbnail for every finished photo, since 2026-10-06.
--
-- An unpaid gallery showed clean 600px thumbnails in its grid, which a client
-- could save and upscale without paying. Now everything an unpaid gallery
-- shows is watermarked, the grid included; the clean thumbnail is only served
-- once the booking is paid. Photos finished before this get theirs made the
-- next time the job is marked ready (no AI cost, it comes from the master).
ALTER TABLE photos ADD COLUMN IF NOT EXISTS preview_thumb_key text;

-- Change requests from the gallery. The client presses Request a change on
-- one photo or on the whole gallery and says what they want. It is not Not
-- happy: nothing is flagged and no email is held back. The owner is emailed,
-- sees it in the job workspace and marks it done.
CREATE TABLE IF NOT EXISTS change_requests (
  id           serial PRIMARY KEY,
  booking_id   text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  photo_ids    bigint[] NOT NULL DEFAULT '{}',
  photo_labels text NOT NULL DEFAULT '',
  message      text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
CREATE INDEX IF NOT EXISTS change_requests_booking ON change_requests (booking_id, created_at);
