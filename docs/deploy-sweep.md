# Deploying the sweep cron

The scheduled job (`scripts/sweep.ts`, `npm run sweep`) is correct, tested code
that does nothing until something runs it on a timer. Four features depend on
it: the stale-order and overdue sweeps (gaps doc item 5), refund retry (item 3),
and send retry (item 11). This is the one manual step that turns all of them on.

Railway runs one config file per service and auto-detects `railway.json` at the
repo root — which belongs to the **web** service. The cron is a **second
service** off the same repo, pointed at `railway.sweep.json` instead. That file
already exists in the repo; these steps wire a service to it.

## One-time setup in the Railway dashboard

1. Open the project → **New** → **GitHub Repo** → pick this repo. This creates a
   second service alongside the web one. Name it something like `sweep`.
2. In the new service: **Settings → Config-as-code → Config File Path** →
   set it to `railway.sweep.json`. (Without this it would inherit `railway.json`
   and try to boot a second web server.)
3. **Settings → Variables**: give it the same variables the web service has.
   The quickest way is a shared variable group, or reference the web service's
   values. At minimum the sweep needs:
   - `DATABASE_URL` — same database as the web service. Non-negotiable; the
     sweep is entirely database work.
   - `APP_URL` (or `NEXT_PUBLIC_APP_URL`) — the sweep sends texts (overdue
     apologies, recovered refunds) and every one carries an `/o/<token>` link.
     Without a base URL those links are a bare path a customer can't open. Same
     footgun `config-check.mjs` guards on the web boot — but note the sweep does
     **not** run that preflight (it isn't `npm run start`), so this one is on you.
   - `SMS_PROVIDER`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
     `TWILIO_MESSAGING_SERVICE_SID` — only once SMS is live. Until A2P 10DLC
     clears and `SMS_PROVIDER=twilio`, the sweep uses the stub like everything
     else: it runs, retries, and writes rows, but sends nothing.
4. Confirm the schedule. `railway.sweep.json` sets `cronSchedule` to
   `*/2 * * * *` (every two minutes). If your Railway plan/UI surfaces the cron
   field separately, it should read the same. Every two minutes is deliberate:
   both order sweeps are idempotent and cheap, and the cost of a late run is a
   customer waiting a little longer, not a double action.

## Why these settings

- **`startCommand: npm run sweep`**, not `npm run start`. The sweep is a one-off
  that runs and exits, so it fits a cron. It deliberately does **not** run
  migrations or the config/storage preflights — the web service owns those. The
  sweep only reads a schema that the web deploy has already migrated.
- **`restartPolicyType: NEVER`.** A cron process that exits 0 succeeded; the
  scheduler re-invokes it on the next tick. A restart policy would fight the
  scheduler and turn one bad run into a hot loop. `sweep.ts` exits non-zero on an
  unhandled error on purpose, so a failing run shows up red in Railway's cron
  history instead of looking like a clean run that found nothing.
- **No volume.** `railway.json` mounts `/data` for the web service's storage
  driver; the sweep touches Postgres only and needs no disk.

## Verifying it works

The job logs exactly one line every run, always — a log that only appears when
something happened can't be told apart from a job that stopped running:

```
[sweep] expired=0 overdue=0 refunds=0 messages=0 in 42ms at 2026-07-19T...
```

Check the sweep service's logs (or Railway's cron history) after a couple of
minutes. A row of zeros is healthy — it means the job ran and found nothing to
do. A red run in cron history is the sweep exiting non-zero; open its logs.

To force a run without waiting for the schedule, use the service's **Deploy /
Run now** action in the dashboard, or run `npm run sweep` locally against the
production `DATABASE_URL`.
