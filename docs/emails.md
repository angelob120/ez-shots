# Booking emails

Every email the site sends goes from the server through Gmail SMTP
(nodemailer), built in `server/email.js`. EmailJS was removed on 2026-10-04.

Since 2026-10-03 a booking costs nothing and the client pays after seeing the
photos, so every step between has its own email and the client never has to
ask what happens next:

| When | To | Subject starts |
|---|---|---|
| Booked on the site | owner (`OWNER_EMAIL`) | `Booked:`, nothing paid yet, Add to Google Calendar button |
| Booked on the site | client | `You are booked for`, $0 today, the four steps, prep list, calendar file |
| A day before the shoot (the clock) | client | `Tomorrow: your shoot at` |
| Owner presses Shoot done | client | `Shoot done at` |
| Owner sends the photos | client | `Your photos are ready:`, previews, Pay and Not happy buttons |
| Paid (Stripe or owner) | client | `Paid, here are your files:`, files link, Book another shoot |
| Paid | owner | `Paid $X:` |
| A day after a paid delivery (the clock) | client | `How did the photos do`, review link from `REVIEW_URL` |
| Client presses Not happy | owner | `Not happy:`, with what they wrote |
| Client cancels | owner | `Cancelled:` |
| Owner moves the shoot, notify ticked | client | `Your shoot is now` |
| Owner refunds in admin | client | `Refund of $X` |

A flagged (not happy) job gets none of the automatic client emails until the
owner clears the flag. The reminder and the review are claimed in the database
before they send, so each goes once.

The Google Calendar button is a plain `calendar.google.com/calendar/render`
link with the title, time, address and client details filled in. No sign in,
no API. A normal job sends about 8 emails: booked (2), reminder, shoot done,
ready, delivered (2), review. A personal Gmail account sends to about 500
people a day, far above that.

The lead forms go through the server too: `js/contact-form.js` posts to
`POST /api/contact`, which sends a lead email in the same layout to
`OWNER_EMAIL` with the visitor as Reply To.

## The thing that decides the whole design

(Written when payment happened at booking. Now the booking emails go from
`book()` and the delivery emails from `paidAfter()`, which the webhook and the
return to the manage page both reach. The reasoning below is unchanged.)

A Gmail password cannot ship to a browser, and 2 and 3 cannot be sent from one.

The moment a booking becomes real is `confirmFromSession()` in `server.js`. It
is reached two ways: Stripe's webhook, and the customer landing on
`booked.html`. The webhook is the reliable one, and it arrives at the server
with no browser involved at all. If the emails are sent from the success page
instead, then every customer who pays and closes the tab, or whose phone drops
the connection on the Stripe redirect, gets no confirmation and the owner gets
no notification, for a shoot that is paid for and on the calendar.

So 2 and 3 are sent **from the server**, in `confirmFromSession()`, which is
already the single chokepoint both paths funnel through.

## Sending twice, for one booking

The webhook and the success page both call `confirmFromSession()`, and on a fast
redirect they can both get there. `db.confirm()` is already idempotent, so the
booking is safe; the emails are not. Two confirmations for one shoot is the kind
of thing that makes a customer phone to ask whether they were charged twice.

Add a `notified_at` column in migration `002`, and have the send claim it with a
conditional update:

```sql
UPDATE bookings SET notified_at = now()
WHERE id = $1 AND notified_at IS NULL
RETURNING id
```

No row back means somebody else is already sending, so this caller does nothing.
The claim has to happen before the HTTP call, not after.

An email that fails must never fail the webhook. Returning non-200 to Stripe
makes it retry the whole event, which re-runs confirmation for a booking that is
already confirmed. Wrap the send, log the failure loudly with the booking id,
and still return 200. A booking that exists with no email sent is recoverable by
hand; a Stripe retry storm is not.

## Turning it on

Three variables on the Railway service, all set since 2026-10-04:

| Variable | Value |
|---|---|
| `GMAIL_USER` | `brownangelob27@gmail.com`, the address every email is sent from |
| `GMAIL_APP_PASSWORD` | a Google app password for it (Google account, Security, App passwords; needs 2 Step Verification) |
| `OWNER_EMAIL` | `angelobrown1000@gmail.com,hello@ezorders.shop`, one email to both |

The server builds the whole HTML: a wordmark, a card with the details, buttons,
the prep list. Tables and inline styles only, because Gmail strips `<style>`
and Outlook lays out with Word. Every customer value is escaped before it goes
in. Each email also carries a plain text version.

`scripts/preview-emails.mjs` renders both booking emails for a sample booking
without sending, fails on an `undefined`, an unescaped value, an empty
optional row or a dash, and with a directory argument writes the `.html` files
to look at.

`POST /api/admin/test-email`, signed in to admin, sends both booking emails for
a made up booking to `OWNER_EMAIL` only.

Without the two Gmail variables the site books exactly as before and simply
sends nothing, which the boot log says out loud and `/api/admin/session`
reports as `email: false`. `scripts/check-bookings.mjs` sets
`EMAIL_TEST_ENDPOINT` and catches every email on a local fake instead.

A first email from a new Gmail sender can land in spam, so every form's success
message ends with "Not in your inbox? Check your spam folder."
