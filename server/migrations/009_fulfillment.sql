-- Fulfillment inside EZ Shots, since 2026-10-06.
--
-- The owner used to edit somewhere else and paste two links into admin, a
-- preview gallery and a full resolution folder. Now the whole shoot is
-- uploaded to the booking, the chosen photos are edited by the AI editor, the
-- server makes every size from the edited master, and the client gets a
-- gallery on ezshots.org. preview_url and final_url stay, and old bookings
-- keep working on them: a gallery booking simply fills both with its gallery
-- address when it is marked ready.
--
-- One row per uploaded photo. The bytes are in object storage (server/
-- storage.js), never in Postgres; this is what each one is and where it is
-- in the job.
--
--   selected_for_delivery  in the final gallery. The 75 limit counts these,
--                          interior, exterior and drone together. Category is
--                          only for sorting and never limits anything.
--   selected_for_edit      sent to the AI editor at least once
--   ai_edit_status         none, queued, processing, complete, failed
--   edit_source            ai, or original when the owner delivers a frame as
--                          shot without spending an AI edit on it
--   reedit_requested       an intentional Re-edit: the worker calls the AI
--                          again even though a master exists. Nothing else
--                          ever pays twice for a photo.
--   locked_at              when a worker took it; a processing row whose lock
--                          is old belonged to a server that restarted
--   next_attempt_at        a rate limited or failed edit waits until then
--
-- Keys: original (as uploaded), source_thumb and source_preview (made from
-- the original at upload, for picking and Compare), edited_master (the AI
-- result, or the original as a clean JPEG), high_res, low_res, thumbnail and
-- preview (watermarked, the only full view an unpaid gallery gets).

CREATE TABLE IF NOT EXISTS photos (
  id                         bigserial PRIMARY KEY,
  booking_id                 text NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  original_filename          text NOT NULL DEFAULT '',
  sort_order                 integer NOT NULL DEFAULT 0,
  category                   text NOT NULL DEFAULT 'uncategorized'
                               CHECK (category IN ('interior', 'exterior', 'drone', 'uncategorized')),
  sha256                     text NOT NULL,
  mime_type                  text NOT NULL,
  original_storage_key       text NOT NULL,
  source_thumb_key           text,
  source_preview_key         text,
  edited_master_storage_key  text,
  high_res_storage_key       text,
  low_res_storage_key        text,
  thumbnail_storage_key      text,
  preview_storage_key        text,
  original_width             integer,
  original_height            integer,
  edited_width               integer,
  edited_height              integer,
  original_size              bigint NOT NULL DEFAULT 0,
  edited_size                bigint NOT NULL DEFAULT 0,
  high_res_size              bigint NOT NULL DEFAULT 0,
  low_res_size               bigint NOT NULL DEFAULT 0,
  derived_size               bigint NOT NULL DEFAULT 0,
  selected_for_edit          boolean NOT NULL DEFAULT false,
  selected_for_delivery      boolean NOT NULL DEFAULT false,
  ai_edit_status             text NOT NULL DEFAULT 'none'
                               CHECK (ai_edit_status IN ('none', 'queued', 'processing', 'complete', 'failed')),
  edit_source                text CHECK (edit_source IS NULL OR edit_source IN ('ai', 'original')),
  reedit_requested           boolean NOT NULL DEFAULT false,
  ai_model                   text NOT NULL DEFAULT '',
  ai_attempt_count           integer NOT NULL DEFAULT 0,
  ai_edit_count              integer NOT NULL DEFAULT 0,
  ai_cost_estimate           numeric(10, 4) NOT NULL DEFAULT 0,
  locked_at                  timestamptz,
  next_attempt_at            timestamptz,
  error_message              text NOT NULL DEFAULT '',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  edited_at                  timestamptz,
  approved_at                timestamptz
);
CREATE INDEX IF NOT EXISTS photos_booking ON photos (booking_id, sort_order, id);
CREATE INDEX IF NOT EXISTS photos_queue ON photos (ai_edit_status, next_attempt_at) WHERE ai_edit_status IN ('queued', 'processing');
-- The same file dropped twice into one booking is one photo.
CREATE UNIQUE INDEX IF NOT EXISTS photos_booking_sha ON photos (booking_id, sha256);

-- The gallery and the delivery, on the booking.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_token text;
CREATE UNIQUE INDEX IF NOT EXISTS bookings_gallery_token ON bookings (gallery_token) WHERE gallery_token IS NOT NULL;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_created_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gallery_first_viewed_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS downloads_unlocked_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sms_copied_at timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS delivery_email_sent_at timestamptz;
-- What the owner tells the AI editor for this shoot only ("slightly warmer").
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS edit_instructions text NOT NULL DEFAULT '';
-- Send up to two of the client's reference photos with each edit. Off by
-- default: every extra image is paid for on every photo.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS edit_use_references boolean NOT NULL DEFAULT false;
-- The finished listing video, when the video add on was bought.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_storage_key text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_name text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_mime text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_size bigint NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_override boolean NOT NULL DEFAULT false;

-- Anything already paid before this existed counts as unlocked when it was paid.
UPDATE bookings SET downloads_unlocked_at = paid_at WHERE paid = true AND downloads_unlocked_at IS NULL;
