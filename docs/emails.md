# Confirmation and notification emails

The owner wants three emails, all through EmailJS:

1. A contact or intake form is submitted, and the owner gets it. **This already
   works**, client side, in `js/contact-form.js`.
2. A shoot is paid for, and the owner gets a booking notification.
3. The same shoot is paid for, and the customer gets a confirmation with the
   instructions for the day.

Only the first one is built. This file is the design for the other two, written
before the Railway project was deleted on 2026-09-12 so the next session does
not have to work it out again.

## The thing that decides the whole design

EmailJS is a browser library, and 2 and 3 cannot be sent from a browser.

The moment a booking becomes real is `confirmFromSession()` in `server.js`. It
is reached two ways: Stripe's webhook, and the customer landing on
`booked.html`. The webhook is the reliable one, and it arrives at the server
with no browser involved at all. If the emails are sent from the success page
instead, then every customer who pays and closes the tab, or whose phone drops
the connection on the Stripe redirect, gets no confirmation and the owner gets
no notification, for a shoot that is paid for and on the calendar.

So 2 and 3 are sent **from the server**, in `confirmFromSession()`, which is
already the single chokepoint both paths funnel through.

EmailJS supports this. `POST https://api.emailjs.com/api/v1.0/email/send`, JSON
body:

```json
{
  "service_id":  "service_dburs96",
  "template_id": "<template>",
  "user_id":     "<public key>",
  "accessToken": "<private key>",
  "template_params": { }
}
```

Rate limit is 1 request per second. The private key is the part that makes it
work off a browser, and it is the reason `EMAILJS_PRIVATE_KEY` has to exist as a
Railway variable. Before this will send at all, EmailJS Account, Security needs
API access for non-browser applications turned on - the dashboard blocks
server-side calls by default.

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

## Templates, and the free plan

The account is on the free plan: 200 requests a month, 0 used as of 2026-09-12,
resetting on the 9th. A booking costs 2 of those, a contact form costs 1. That
is a real ceiling but not a close one at current volume. Worth watching, and
worth saying out loud that this is a lead and confirmation channel, never a
marketing one.

The free plan is also thin on template slots, and the account already holds two
templates both called "My Default Template", one of which belongs to a different
project and delivers to a yahoo address. So do **not** plan on a template per
email.

Instead use one generic transactional template for 2 and 3, the same trick
`js/contact-form.js` already uses for its forms: the template's To Email is
`{{to_email}}`, its subject is `{{subject}}`, its body is `{{message}}`, and the
server decides all three. Owner notification and customer confirmation are then
the same template called twice with different parameters, and the template never
has to grow a variable per field.

Set its id as `EMAILJS_TEMPLATE_BOOKING`. `EMAILJS_TEMPLATE_CONTACT` stays
pointed at the existing form template.

## Still unresolved

Which of `template_qlotxua` and `template_ztl1ney` delivers to
angelobrown1000@gmail.com. `js/contact-form.js` names `template_qlotxua` and the
dashboard screenshots show the two edit pages by URL slug, not by template id,
so the two cannot be matched up from outside. Open `template_qlotxua` from the
templates list and read the URL: `4f1brpw` is the gmail one, `gowiejr` is the
yahoo one. If it is the yahoo one, every lead the site has ever sent has gone to
another project's inbox, and EmailJS reported success every time.
