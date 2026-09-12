# Confirmation and notification emails

The owner wants three emails, all through EmailJS:

1. A contact or intake form is submitted, and the owner gets it. **This already
   works**, client side, in `js/contact-form.js`.
2. A shoot is paid for, and the owner gets a booking notification.
3. The same shoot is paid for, and the customer gets a confirmation with the
   instructions for the day.

All three are built as of 2026-09-12. 2 and 3 live in `server/email.js`, called
from `notify()` in `server.js`. This file is why they are shaped the way they
are.

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

## Turning it on

Five variables, all set on the Railway service as of 2026-09-12:

| Variable | Value | Set? |
|---|---|---|
| `EMAILJS_SERVICE_ID` | `service_dburs96` | yes |
| `EMAILJS_PUBLIC_KEY` | `ki7V3klQWzRzeIMte` | yes |
| `OWNER_EMAIL` | `angelobrown1000@gmail.com,hello@ezorders.shop` | yes |
| `EMAILJS_PRIVATE_KEY` | the account private key | yes, 2026-09-12 |
| `EMAILJS_TEMPLATE_BOOKING` | the new template's id | yes, 2026-09-12 |

The template to create: To Email `{{to_email}}`, Subject `{{subject}}`, Reply To
`{{reply_to}}`, From Name `EZ Shots`, default From Email. Nothing in Bcc or Cc.

The body is where the design lives, and the server builds all of it. Since
2026-09-12 both emails are HTML: a wordmark, a card with the booking details,
buttons (Open bookings, Call, Email for the owner; Add to calendar, Change or
cancel for the customer) and the prep list as a checklist. Tables and inline
styles only, because Gmail strips `<style>` and Outlook lays out with Word.
Every customer value is escaped before it goes in.

The server sends two versions of each email: `message` (plain text) and
`message_html` (the finished HTML). In the template, click Edit Content, switch
to raw HTML mode, clear it, and paste exactly this and nothing else:

```
{{{message_html}}}
```

Three braces, not two. Two braces makes EmailJS escape the HTML and the email
arrives as a page of visible tags. Nothing else belongs in the template: no
greeting, no signature, no logo, because anything around it appears outside
the card.

`scripts/preview-emails.mjs` renders both emails for a sample booking without
sending, fails on an `undefined`, an unescaped value, an empty optional row or
a dash, and with a directory argument writes the `.html` files to look at.

`POST /api/admin/test-email`, signed in to admin, sends both emails for a made
up booking to `OWNER_EMAIL` only. It is the way to prove the keys, the template
and the non-browser switch without booking a shoot. It costs two requests.

And in EmailJS, Account, Security: turn on API access for non-browser
applications. Without it every send comes back `403 API calls in strict mode`.

Until both missing variables are set the site books and charges exactly as
before and simply sends nothing, which the boot log says out loud and
`/api/admin/session` reports as `email: false`.

## Two owner inboxes

`OWNER_EMAIL` is a comma separated list and both addresses go out on ONE EmailJS
request, because the free plan counts requests and not addresses, and a second
inbox should not halve the month's quota. If EmailJS turns out to refuse several
addresses in `{{to_email}}`, the send is retried one address at a time, which
costs an extra request but does not lose the notification. The first address in
the list is the one the customer's confirmation replies to.

The CONTACT form is not covered by this. It is still client side and its
recipient is the To Email set on `template_qlotxua` in the EmailJS dashboard,
not anything in this repo. To have form leads reach both inboxes as well, add
the second address to that template's To Email field.

## Still unresolved

Which of `template_qlotxua` and `template_ztl1ney` delivers to
angelobrown1000@gmail.com. `js/contact-form.js` names `template_qlotxua` and the
dashboard screenshots show the two edit pages by URL slug, not by template id,
so the two cannot be matched up from outside. Open `template_qlotxua` from the
templates list and read the URL: `4f1brpw` is the gmail one, `gowiejr` is the
yahoo one. If it is the yahoo one, every lead the site has ever sent has gone to
another project's inbox, and EmailJS reported success every time.
