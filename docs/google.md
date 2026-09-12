# Bookings into Google Calendar and Google Sheets

Every paid booking lands on the owner's Google Calendar and as a row in a Google
Sheet, and both update when the booking is accepted, declined, refunded or
cancelled. Built 2026-09-12.

## How it works, and why not the Google APIs

The Google Calendar and Sheets APIs need a Google Cloud project, an OAuth consent
screen or a service account shared into the calendar and the sheet, and a client
library. That is a lot of moving parts for one event and one row.

Instead the owner runs a small Google Apps Script, `server/google-apps-script.gs`,
on his own sheet, deployed as a web app. It runs as him, so it can already write
to his sheet and his calendar. The server only POSTs it JSON
(`server/google.js`), with a shared secret.

- **One row per booking** on a tab called `Bookings`, found by booking id and
  overwritten on every change. Cells a client typed that start with `=`, `+`, `-`
  or `@` are stored as text, so a note cannot run as a formula.
- **One calendar event per shoot**, 90 minutes. Titled `[Needs OK] EZ Shots:
  <address>` until accepted, then `EZ Shots: <address>`. Deleted on decline or
  cancel, so the time reads free again.
- **Out of order is safe.** Every POST carries the whole booking and its
  `updatedMs`. The script ignores anything older than the row it already has.
- **Only paid bookings are sent.** Holds that nobody paid for would be noise.
- **Fire and forget.** A slow or broken Google never holds up a webhook, a
  success page or a refund button. Every outcome is logged with the booking id:
  `synced to Google` or `Google sync failed`.

## Setting it up

`GOOGLE_SCRIPT_SECRET` is already set on the Railway service.

1. Make a new Google Sheet, for example `EZ Shots Bookings`.
2. Extensions, Apps Script. Delete what is there, paste the whole of
   `server/google-apps-script.gs`, Save.
3. Project Settings (gear icon), Script properties, Add script property:
   `SECRET` = the same value as `GOOGLE_SCRIPT_SECRET` in Railway.
   Optional: `CALENDAR_ID` to use a calendar other than the main one.
4. In the editor, choose `authorize` in the function dropdown and press Run.
   Allow access to Sheets and Calendar. Google warns the app is unverified;
   that is normal for your own script: Advanced, Go to project.
5. Deploy, New deployment, gear, Web app. Execute as **Me**, Who has access
   **Anyone**. Deploy and copy the Web app URL.
6. Put that URL in Railway as `GOOGLE_SCRIPT_URL`. The service redeploys and
   the next paid booking syncs.

"Anyone" means the site can reach the script without a Google sign in. Nothing
happens without the secret, and the script only ever writes.

If the script is edited later: Deploy, Manage deployments, edit the existing
deployment, Version: New version. A brand new deployment gets a new URL and the
old one in Railway stops working.

## Checking it

Railway logs, filter `Google`. A paid booking logs `EZ-000123 synced to Google,
paid`. `Google sync failed` names the reason: `bad secret` means the two secrets
differ, an HTML error page usually means the deployment is not set to Anyone.
