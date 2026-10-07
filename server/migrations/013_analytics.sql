-- Site analytics, since 2026-10-07. One row per thing a visitor did: a page
-- view, a Book button pressed, a booking step reached, a booking made, a
-- contact form sent. server/analytics.js is the only thing that writes or
-- reads it.
--
-- No cookie and no name, email or IP is kept. `sid` is a random id the
-- browser keeps for one tab session, `visitor` a hash of the IP and browser
-- with a salt that changes every day, so a visitor can be counted once a day
-- and never followed from one day to the next.
CREATE TABLE IF NOT EXISTS analytics_events (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  name          text NOT NULL,
  path          text NOT NULL DEFAULT '',
  label         text NOT NULL DEFAULT '',
  sid           text NOT NULL DEFAULT '',
  visitor       text NOT NULL DEFAULT '',
  ref           text NOT NULL DEFAULT '',
  utm_source    text NOT NULL DEFAULT '',
  utm_medium    text NOT NULL DEFAULT '',
  utm_campaign  text NOT NULL DEFAULT '',
  device        text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS analytics_events_at_idx ON analytics_events (at);
CREATE INDEX IF NOT EXISTS analytics_events_sid_idx ON analytics_events (sid);
