# Setting up the sweep cron on Railway

This is the deploy step that three finished features are waiting on: the
stale-order sweeps (`expireStaleOrders`/`flagOverdueOrders`), refund retry, and
SMS send retry. The code exists and is tested; nothing runs it because the cron
service has never been created. Until this is done, that code is correct and
dormant.

Railway takes one `railway.json` per repo, and that file already defines the
**web** service (`npm run start`). The sweep needs a **second service off the
same repo** with a different start command and a cron schedule. That can't live
in the shared `railway.json`, so it's configured in the Railway UI, where
service-level settings override the file.

## What the sweep is

`scripts/sweep.ts` (`npm run sweep`) runs once and exits — no supervised
process, which is exactly what a cron wants. It's idempotent and cheap, and
exits non-zero on an unhandled error so a failure shows up in Railway's cron
history rather than looking like a clean run.

## Steps

1. **New service, same repo.** In the Railway project, *New → GitHub Repo* and
   pick this same repo. You now have a second service building from the same
   source as the web app. Name it something like `sweep`.

2. **Override the start command.** Open the new service → *Settings → Deploy →
   Custom Start Command* and set:

   ```
   npm run sweep
   ```

   This overrides the `startCommand` in `railway.json` for this service only;
   the web service keeps `npm run start`.

3. **Set the cron schedule.** Same *Settings* page → *Cron Schedule*:

   ```
   */2 * * * *
   ```

   Every two minutes. Both sweeps are idempotent and the cost of running one
   late is a customer waiting longer than they should. With a cron schedule set,
   Railway runs the start command on that schedule and lets it exit — it does
   not treat the exit as a crash.

4. **Turn off restart-on-failure for this service.** *Settings → Deploy →
   Restart Policy* → **Never** (or leave the cron behavior to Railway). The web
   service's `ON_FAILURE`/10-retries policy is wrong for a job that's *supposed*
   to exit; without this, a job that exits non-zero could be restarted in a loop
   instead of just being recorded as a failed run.

5. **Share the database and app config.** The sweep needs the same
   `DATABASE_URL` as the web service, plus whatever the send/refund paths read
   (`APP_URL`, and — once live — `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`,
   `TWILIO_AUTH_TOKEN`). In the sweep service's *Variables*, reference the
   Postgres plugin's variable rather than pasting a URL:

   ```
   DATABASE_URL = ${{Postgres.DATABASE_URL}}
   ```

   (Use the same variable reference the web service uses — check its Variables
   tab for the exact plugin name.) Copy across the same app-level vars so a
   message the sweep sends builds the same links and uses the same provider as
   one the web app sends.

6. **No volume needed.** The web service mounts `/data`; the sweep doesn't touch
   it. Leave the sweep service without a volume.

## Verifying it runs

- After the first scheduled fire, the sweep service's *Deployments*/cron history
  shows a run. `sweep.ts` logs a one-line summary (counts of expired and overdue
  orders) and exits 0 on success.
- A deliberate way to see it working end to end: leave an order unacknowledged
  past its window on a test tenant and confirm the next sweep expires it.
- A failing run exits non-zero and is flagged in the history — that's the signal
  to check logs, not a silent no-op.

## What this unblocks

Once the cron exists, two more things can hang off the same schedule (both are
coded and currently consume nothing):

- **Refund retry** for transient provider failures (item 3 in
  `post-order-gaps.md`).
- **SMS send retry** — `SendResult.retryable` is populated and nothing reads it
  (item 11).

Wiring those into `runOrderSweeps` (or a sibling called from `sweep.ts`) is a
code task, but it's only worth doing once this cron is live — the same reason
the sweeps themselves sat inert until now.
