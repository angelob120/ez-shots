-- The first shoot is $99, since 2026-10-06.
--
-- An agent's first booking with EZ Shots costs $99 for the Real Estate Media
-- Package instead of $199, and $199 with the video instead of $299. The
-- server only gives it to an email and phone with no earlier confirmed
-- booking (server.js, book()), so it is checked, not taken on trust.
UPDATE settings
SET value = jsonb_set(value, '{packages}', (
      SELECT jsonb_agg(CASE WHEN p ->> 'id' = 'media' THEN jsonb_set(p, '{firstPrice}', '99'::jsonb) ELSE p END)
      FROM jsonb_array_elements(value -> 'packages') AS p)),
    updated_at = now()
WHERE key = 'config' AND jsonb_typeof(value -> 'packages') = 'array';
