-- One package and one add on, since 2026-10-06.
--
-- The two packages (Listing Essentials $150, Listing Pro $250, each half price
-- on a first shoot) became one Real Estate Media Package at $199 with a
-- Listing Video add on at $100, $299 together. No first shoot discount.
--
-- A booking now records what it was priced from, so the gallery, admin and
-- the emails can say it without working it out again:
--
--   base_price         the package price on the day it was booked
--   video_selected     the video add on was ticked
--   video_addon_price  what the video added, 0 without it
--   total_amount       what is due; the same number as `amount`, which every
--                      older part of the server still reads
--
-- Older bookings keep their own package, price and half price flag. They are
-- given a base price equal to what they owe, so nothing reads NULL.

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS base_price integer;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_selected boolean NOT NULL DEFAULT false;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS video_addon_price integer NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS total_amount integer;

UPDATE bookings SET base_price = amount WHERE base_price IS NULL;
UPDATE bookings SET total_amount = amount WHERE total_amount IS NULL;
-- Listing Pro was the package with the video in it.
UPDATE bookings SET video_selected = true WHERE package_id = 'pro' AND video_selected = false;

-- The live price list is the config row, not config.json, so it is rewritten
-- here once. Availability and every other setting are kept.
UPDATE settings
SET value = jsonb_set(jsonb_set(jsonb_set(value,
      '{packages}', '[{
        "id": "media",
        "name": "Real Estate Media Package",
        "blurb": "Professional listing photography plus aerial drone photography.",
        "price": 199,
        "firstPrice": 199,
        "active": true,
        "badge": "",
        "bullets": ["Interior photos", "Exterior photos", "Drone photos", "Professional editing", "Up to 75 finished images", "24 to 48 hour turnaround", "No upfront payment"],
        "checkoutFull": "",
        "checkoutFirst": "",
        "checkoutVideo": ""
      }]'::jsonb, true),
      '{addons}', '[{
        "id": "video",
        "name": "Listing Video",
        "blurb": "A one minute walkthrough, edited and scored, plus a vertical cut for Reels and TikTok.",
        "price": 100,
        "active": true
      }]'::jsonb, true),
      '{maxPhotos}', '75'::jsonb, true),
    updated_at = now()
WHERE key = 'config';
