-- Bookable every 30 minutes, 8:00 AM to 8:00 PM, on every day that is open.
--
-- The owner asked on 2026-10-04 for a time on every hour and half hour. The
-- live schedule is the config row in settings, not config.json, so this
-- rewrites it once. Closed days stay closed. After this the times are edited
-- in admin settings as before.
UPDATE settings
SET value = jsonb_set(
      jsonb_set(value, '{availability,hours}', '{"start": "8:00 AM", "end": "8:00 PM", "every": 30}'::jsonb, true),
      '{availability,week}',
      COALESCE((
        SELECT jsonb_object_agg(d.key, CASE WHEN jsonb_array_length(d.value) > 0 THEN s.slots ELSE '[]'::jsonb END)
        FROM jsonb_each(value -> 'availability' -> 'week') AS d,
             (SELECT jsonb_agg(to_char(t, 'FMHH12:MI AM') ORDER BY t) AS slots
              FROM generate_series(timestamp '2000-01-01 08:00', timestamp '2000-01-01 20:00', interval '30 minutes') AS t) AS s
      ), '{}'::jsonb),
      true),
    updated_at = now()
WHERE key = 'config' AND value ? 'availability';
