# PROJECT-STATE.md - EZ Shots

## How to use this file
This file is the memory between sessions. Read it at the start of every session along with `CLAUDE.md`. At the end of every session, append a new dated entry to the top of the Work Log describing what changed and anything the next session would otherwise have to rediscover. "Blocked on a human" lists things only the owner can do (accounts, keys, DNS, deploy clicks). Detailed per-area status lives in `docs/site.md`.

## Blocked on a human
- **The Railway project was deleted on 2026-09-12 and the site now runs from a
  rebuilt one.** Everything below is what only the owner can finish.
- **Point `ezshots.org` at the new service.** The root record is still the CNAME
  to the deleted service, `pq6e6bom.up.railway.app`. At the registrar, change it
  to `a4clpd3t.up.railway.app`. Until then the domain 404s and only
  `https://ez-shots-production-e091.up.railway.app` serves the site. The custom
  domain is already attached on the Railway side and is waiting on the record.
- **Set `ADMIN_PASSWORD` on the new service.** It is unset, so `/admin` is off
  and nobody can mark a booking paid by hand. The old value was `123`.
- **Paste `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` into the new service.**
  Both were set on the old project and neither survived it. Without the secret
  key checkout falls back to payment links and the hold runs 24 hours instead of
  32 minutes. The webhook endpoint has to be recreated in Stripe too, pointing at
  `https://ezshots.org/api/stripe/webhook` for `checkout.session.completed`.
- **Ask Railway to restore the deleted project, if the booking rows matter.**
  Deleting a project takes its Postgres volume with it and Railway's own docs say
  only an offsite logical dump survives that. There was no dump. Any booking that
  was actually paid for still exists in Stripe, with `booking_id`, `address`,
  `shoot_date` and `shoot_time` in the session metadata, so the calendar can be
  rebuilt from Stripe if a restore is refused.
- **Turn on EmailJS non-browser API access. This is the one thing stopping the
  booking emails.** Account, Security, "API access from non-browser
  environments". Checked on 2026-09-12: a server side send came back `403 API
  access from non-browser environments is currently disabled`. Until it is on,
  every paid booking logs `email failed` and neither the owner nor the customer
  hears anything. Both templates are made and Railway points at the right one.
  Then sign in and `POST /api/admin/test-email` to prove it.
- **The booking form still offers "Door code" and a free text access notes box.**
  CLAUDE.md says never collect lockbox or gate codes, and whatever a customer
  types there is now emailed to the owner inboxes. The owner should decide
  whether to drop the "Door code" option and reword the notes placeholder to ask
  where the lockbox is, not what the code is.
- **Rotate the EmailJS private key.** It was shown on screen in a shared
  screenshot on 2026-09-12. "Refresh Keys" in the EmailJS account rotates the
  public key with it, and the public key is hardcoded in `js/contact-form.js`,
  so the file has to be updated in the same pass.
- **The admin password is `123`.** The owner chose it on 2026-09-11 after being
  told it is guessable by hand in under an hour and that the page controls what
  customers get charged. It stands until he says otherwise. If he ever asks to
  harden it, change `ADMIN_PASSWORD` in Railway and nothing else needs touching.
- **Paste `STRIPE_SECRET_KEY` into Railway.** Still not set, and it is now the
  biggest remaining gap, because the hold the server takes is worth much more
  with it. With the key, `/api/book` creates a Checkout Session at the price the
  server read from its own config, and the slot is held 32 minutes while the
  agent pays. Without it the booking falls back to a public payment link and the
  hold has to run 24 hours, because nothing tells the site the payment happened.
  Use the live key, not the test one, and never put it in a file in this repo.
- **Then add `STRIPE_WEBHOOK_SECRET`.** In Stripe, Developers, Webhooks, add an
  endpoint at `https://ezshots.org/api/stripe/webhook` for
  `checkout.session.completed`, and paste its signing secret into Railway. That
  is what turns a held slot into a confirmed booking without anyone watching. The
  success page confirms it too, so a customer who pays and does come back is not
  lost without the webhook; one who closes the tab at the card form is the case
  it covers.
- **Add on prices are still copy, not config.** The twilight and rush add ons on
  `services.html` say "Plus $75" and that number is typed into the page. They are
  not packages, they are not bookable, and nothing charges them automatically, so
  they were left alone on purpose. If they ever become real line items they want
  to be packages in the config like everything else.
- **The $20 in the guarantee is copy too.** It appears 13 times on
  `guarantee.html` alone. Changing it is a wording decision across several pages,
  not a number to flip in admin, so it was not bound.
- **The Stripe checkout is branded "Design Byte Agency".** Confirmed on 2026-09-01 by
  opening both payment links. A realtor clicks Buy on ezshots and lands on a card form
  for a company they have never heard of. That reads as a phishing page, and it is the
  most likely single reason a click does not become a payment. Fix in the Stripe
  dashboard, Settings, Business details, public business name, set it to EZ Shots.
- **Both Stripe products use internal shorthand as the customer facing name.**
  "Photography Pictures NO VIDEO" ($150) and "Photography Pictures WITH VIDEO" ($250).
  The customer sees those strings on the checkout. Rename them to Listing Essentials
  and Listing Pro.
- **Confirm the EmailJS Template ID, now a one click check.** Open the template that
  delivers to `wolvesmaneappointments@yahoo.com` (dashboard URL ends `/gowiejr`) and
  click its **Settings** tab, which shows that template's `template_...` id. The other
  id is the gmail one, and that is what `TEMPLATE_ID` in `js/contact-form.js` must be.
  The list view and the edit URL use different ids, which is why three rounds of
  screenshots could not settle it.
- **Decide how the 50% first shoot discount gets charged.** There is no half price checkout
  link, so today it has to be a manual invoice or a Stripe coupon.
- **Real phone number.** The placeholder `(248) 555-0139` was REMOVED on 2026-09-01,
  it is in the reserved fictional 555-01xx block and was a live `tel:` link in every
  footer. Those rows now point at the TidyCal 10 minute call. Send a real number and
  it goes back into `js/site.js`, `index.html` and `contact.html`.
- **Real photos, the rest of them.** The five portfolio covers are now real files in `img/`,
  and `js/projects.js` loads nothing from a stock library. Still Unsplash stock: the hero,
  the portrait of the photographer on `about.html` and `index.html`, and the section images
  in the page HTML.
- **A photo of the owner.** He has one, a podium shot in a suit, but it was pasted into chat
  rather than saved, so it never reached the repo. It replaces the stock portrait in two
  places once the file exists: `about.html` and the home page about block.
- **More portfolio shoots.** The portfolio is five entries because five photos were
  supplied. Each detail page therefore shows one frame. Send more per property and the
  `gallery` arrays fill out without any code change.
- **Real testimonials.** The three fake quotes were REMOVED on 2026-09-01 and replaced
  with an honest "I do not have reviews yet" section built on the refund window, the $75
  first shoot and the portfolio. When real clients exist, their quotes can go back in as
  a `.quotes` block; the CSS for it is still in `styles.css`. Do not ship invented names.
- **Confirm the EmailJS Template ID.** STILL OPEN and now blocking the intake form.
  Screenshots on 2026-09-01 confirmed one template delivers to
  `wolvesmaneappointments@yahoo.com` (a different project) and one to
  `angelobrown1000@gmail.com`. The dashboard edit URLs use a different id than the
  template list, so which of `template_qlotxua` / `template_ztl1ney` is the gmail one
  could not be read off the screenshots. Open the gmail one, read its ID from the
  Email Templates list, and set `TEMPLATE_ID` in `js/contact-form.js`. Sending to the
  wrong one loses the lead silently, EmailJS still reports success.
- **Set the template Subject to `{{subject}}` and fix its body.** Both templates ship
  the EmailJS default, which opens `Hello {{to_name}},` and the site never sends a
  `to_name`, so every email arrives addressed to nobody. Both Subject fields are also
  hardcoded to `New message from {{from_name}}`, which makes a booking enquiry and a
  20 field intake look identical in the inbox. Recommended body:

  ```
  {{subject}}

  Site: {{site_name}}
  Name: {{from_name}}
  Email: {{email_id}}
  Phone: {{phone}}

  {{message}}
  ```

  One template serves both forms this way, which matters on a 200 send a month plan.
- **The EmailJS private key was visible in a shared screenshot** on 2026-09-01.
  The site does not use it, so nothing is broken. If that image went anywhere else,
  hit Refresh Keys, but note that rotates the PUBLIC key too and
  `js/contact-form.js` would need the new one.
- **Old blocker, unchanged:** The code uses `template_qlotxua`. The template that actually sends to the lead inbox is whichever of `template_qlotxua` / `template_ztl1ney` has its "To Email" set to angelobrown1000@gmail.com. Open both in the dashboard, confirm which one, and update `TEMPLATE_ID` if it is the other.
- **Save the EmailJS template changes.** In the chosen template set Subject to `New lead from {{site_name}} - {{from_name}}` and include a `Site: {{site_name}}` line plus Name, Email, Phone, Message in the body, with "To Email" = angelobrown1000@gmail.com and "Reply To" = `{{reply_to}}`. Make sure the template contains these variables: `site_name`, `from_name`, `email_id`, `reply_to`, `phone`, `message`, `subject`. Click Save in the dashboard, template edits do not deploy from code.
- **Delete all 5 Railway variables, in production and in staging.** They were
  `EMAILJS.PUBLIC_KEY`, `PUBLIC_KEY="11"`, and empty `SERVICE_ID`, `SITE_NAME`, `TEMPLATE_ID`.
  The dot in `EMAILJS.PUBLIC_KEY` is an illegal env var name and is what broke every build.
  Nothing on the site reads any of them. The correct end state is zero variables you set,
  Railway supplies `PORT` on its own. Also check Project Settings -> Shared Variables.
- **No branch protection** is set on `main`. Optional: add protection on GitHub so production is only updated via the tested staging flow.

## The four Stripe links, and what each one actually charges

Opened and read on 2026-09-01 rather than trusted. If any of these change, open the
link and check the amount before editing the button label. A button whose number does
not match its checkout is the worst bug this site can have.

| Button | Link ends | Charges |
| --- | --- | --- |
| Book your first shoot, $75 | `...FzaVa0q` | $75.00 |
| Booked before? Pay $150 | `...BvaVa0n` | $150.00 |
| Book your first shoot, $125 | `...93aVa0p` | $125.00 |
| Booked before? Pay $250 | `...0VaVa0o` | $250.00 |

All four still present as **Design Byte Agency**, selling "Photography Pictures NO
VIDEO" and "WITH VIDEO". See Blocked above.

## Work Log (newest first)

### 2026-09-12 (evening) - EmailJS templates made, and a full check of the live site
- Two EmailJS templates now. `template_lybu0cj` (was named Contact Us, rename to EZ
  Shots Booking) is the booking template: To `{{to_email}}`, Subject `{{subject}}`,
  Reply To `{{reply_to}}`, content `{{{message_html}}}`. Railway
  `EMAILJS_TEMPLATE_BOOKING` set to it; redeploy logged `confirmation emails on`.
- `template_qlotxua` (My Default Template) is the form template used by
  `js/contact-form.js`. Its dashboard URL is `/4f1brpw`, which settles the old
  question: it is the gmail one, so form leads have been reaching the right inbox.
  The owner was given a branded HTML body for it that keeps `{{message}}` in a
  `white-space:pre-wrap` block so intake lines survive.
- Live checks, both `ezshots.org` and the Railway domain: every page and
  `/api/config`, `/api/availability`, `/api/admin/session` 200; bad manage and ics
  tokens 404; unsigned webhook `Bad signature.`; session reports stripe, webhook,
  bookings and email all true. `ezshots.org` serves the new service even though its
  CNAME still reads `pq6e6bom.up.railway.app`, confirmed by the `email` flag, which
  only exists in the new code.
- A server side EmailJS send was refused with 403, non-browser access disabled.
  That is now the top blocker.

### 2026-09-12 (latest) - HTML booking emails, a test send, and a bug that would have said "undefined"
- Both booking emails are now designed HTML, built in `server/email.js` from the
  same rows and prep list as the plain text, so the two versions cannot drift. The
  template content must be `{{{message_html}}}`, three braces; `docs/emails.md`
  has the steps.
- **Bug fixed before it shipped a single email.** `publicBooking()` in `server.js`
  names the package `package`, but the emails read `packageName`, so every email
  would have said "Dana booked undefined". `notify()` now passes `packageName`.
- The owner email linked "Calendar" to `admin.html`, which is settings. It now
  goes to `admin-bookings.html`, and has Call and Email buttons for the customer.
- `POST /api/admin/test-email`, signed in, sends both emails for a made up booking
  to `OWNER_EMAIL` only.
- `scripts/preview-emails.mjs` renders both emails and fails on `undefined`,
  unescaped input, empty optional rows and dashes.
- Owner added `EMAILJS_PRIVATE_KEY` and `EMAILJS_TEMPLATE_BOOKING` in Railway; the
  redeploy logged `confirmation emails on`.

### 2026-09-12 (later) - Confirmation and notification emails on a paid booking
- `server/email.js` is new. When a shoot is paid for, the owner gets a notification
  with the whole booking and the customer gets a confirmation with the prep
  instructions, a manage link and an .ics link.
- **Sent from the server, not the browser**, unlike the contact form. The only
  reliable moment a booking becomes real is Stripe's webhook, which arrives with no
  browser involved. Sending from `booked.html` would mean every customer who closes
  the tab on the redirect gets no confirmation and the owner no notification, for a
  shoot that is paid for and on the calendar. EmailJS's REST endpoint plus the
  private key does this; `accessToken` in the body is the private key.
- Migration `002_notified_at.sql` adds `notified_at`, and `db.claimNotify()` claims
  it with a conditional update before anything is sent. The webhook and the success
  page both reach `confirmFromSession`, and on a fast redirect both get there; the
  loser of that update sends nothing. `db.releaseNotify()` hands the claim back when
  neither email got out, so a retry can still work.
- `notify()` in `server.js` is deliberately not awaited. A slow or failing EmailJS
  must not make the webhook answer Stripe late or non-200, which would make Stripe
  retry the whole event; and it must not make a customer who has just paid watch a
  spinner. Every outcome is logged with the booking id.
- The two emails go out 1.1 seconds apart, because EmailJS allows one request a
  second.
- Boot now prints whether the emails are on, and names the missing variables when
  they are not. `/api/admin/session` gained an `email` flag for the same reason.
- `OWNER_EMAIL` set to `angelobrown1000@gmail.com,hello@ezorders.shop`: a comma
  separated list, sent as one request with both recipients so a second inbox does
  not cost double the monthly quota, with a one-at-a-time retry if EmailJS refuses
  the multi recipient send. The contact form is separate and still delivers to
  whatever the EmailJS template says; add the second address there too if wanted. Verified by
  rendering both emails against a stubbed `fetch`: correct recipients, subjects and
  bodies, blank optional fields omitted rather than printed as empty labels, and
  `reply_to` crossed over so replying to the notification reaches the customer.
  Also verified that an unconfigured emailer and a 403 from EmailJS both return
  their errors instead of throwing.
- Free plan is 200 requests a month. A booking now costs 2 of them and a contact
  form 1.

### 2026-09-12 - The Railway project was deleted, and the site was rebuilt onto a new one
- The owner deleted the `WEBSITE EZ Shots` Railway project by accident. Not just the
  service: the project, and with it the Postgres and its volume. `ezshots.org` served
  Railway's "Application not found" 404. The API disagreed with itself for a while -
  `list-projects` still returned the project while `railway status -p <id>` said
  "Project is deleted" - so trust the live site and `railway status`, not the listing.
- Rebuilt as a NEW project, `WEBSITE EZ Shots (rebuild)`, id
  `e3dff336-d401-4d59-9f3e-6599971041b0`, deliberately leaving the old one alone so a
  Railway support restore stays possible. Postgres provisioned, service `ez-shots`
  connected to `angelob120/ez-shots` on `main`, Railway domain
  `ez-shots-production-e091.up.railway.app` generated, `ezshots.org` attached and
  waiting on the CNAME.
- Verified after deploy: `/api/config` serves the seeded packages, `/api/availability`
  returns four weeks of slots, and `/api/admin/session` reports `bookings: true`, which
  means the migrations ran against the new database. `stripe`, `webhook` and the admin
  password are all still false or unset - see "Blocked on a human".
- Nothing was lost from the code. The working tree was clean and GitHub `main` was
  already at `30d4c16`, the same commit as local, so the rebuild deployed exactly what
  was running before.
- Variables set on the new service: `TZ`, `DATABASE_URL` (a reference to the new
  Postgres), `SITE_URL`, `SITE_NAME`, and the three publishable EmailJS values, now
  under honest names - `EMAILJS_SERVICE_ID`, `EMAILJS_PUBLIC_KEY`,
  `EMAILJS_TEMPLATE_CONTACT`. The old dead `PUBLIC_KEY` / `SERVICE_ID` / `TEMPLATE_ID`
  leftovers were not recreated, and neither was the illegal `EMAILJS.PUBLIC_KEY` that
  broke deploys on 2026-09-01. That blocker is now closed by the rebuild.
- Still not started: the confirmation and notification emails the owner asked for
  (contact form to the owner, and a post-purchase email to both the owner and the
  customer). The design work done before the deletion is written up in `docs/emails.md`.

### 2026-09-11 (latest) - Postgres, a slot that is actually held, and four weeks of calendar

The booking flow shipped earlier in the day could take a booking but could not
keep one. Two agents could pick the same 1:00 PM, the availability was worked
out in the browser, and the prices the owner set in admin were about to be wiped
by the next deploy because the `/data` volume nobody had added was really the
container filesystem. All three had the same fix.

**A Railway Postgres, and it replaced the volume rather than waiting for it.**
`server/db.js` is the whole database layer, one dependency (`pg`). The config
and the bookings both live there now. `DATA_DIR` still works with no database,
so `npm run start:static` and a laptop with no Postgres are unaffected, but
production reads `DATABASE_URL` and the volume item is off the blocked list: the
Postgres service has its own volume and nobody has to remember to attach one.
Schema lives in `server/migrations`, applied on boot in name order and recorded
in `schema_migrations`. `001_settings_and_bookings.sql` is the only one so far.
Never edit an applied migration, add `002`.

**The slot is held.** `POST /api/book` runs in a transaction behind a Postgres
advisory lock on that one slot, so the second request for the same time waits
for the first and then finds it gone. Under that, a partial unique index on
`(date, time) WHERE status = 'confirmed'` means two confirmed bookings can never
share a slot even if every line of the code above it is wrong. A hold lasts 32
minutes with Stripe Checkout and 24 hours with a payment link (nothing tells the
site a link was paid, so it gets the longer rope), and becomes a confirmed
booking when Stripe says paid or when the owner marks it paid in admin. The copy
on `book.html` now says the time is held, and locked in on payment. It used to
say the exact time would be confirmed by email, which was the honest thing to
say when nothing held anything.

**The calendar moved to the server, and that was the point.** `GET
/api/availability` is now the only thing that says what can be booked, and
`server/availability.js` applies the rules in the plan's order: blocked date,
one off list, weekday default, slots already held or confirmed, minimum notice,
maximum advance, daily cap, then look busy. The browser cannot run rule four, it
does not know what is booked, so `book.html` paints what it is given and nothing
else. `TZ` defaults to `America/Detroit` in `server.js` and the `Dockerfile`, so
a plain local `Date` is Detroit time on a Railway box that thinks it is in UTC.

**Four weeks, 8 AM to 8 PM, which is what was asked for.** `maxAdvanceDays` is
28 and the hours are 8:00 AM to 8:00 PM every two hours, seven start times a
day, Monday to Saturday. Sunday is closed and the owner can open it in admin
without touching code. Verified against production: `/api/availability` returns
`today 2026-09-11`, `to 2026-10-09`, no Sunday, and the day lists run 8:00 AM to
8:00 PM.

**Look busy.** `availability.lookBusy` is a percentage that hides a share of each
day's genuinely open times. Always the same ones for a given day, never a day's
last remaining time, and it comes back off as real bookings fill the day. It is
cosmetic: `canBook()` skips it, so a slot hidden by look busy is still bookable
by anyone holding a direct link, and a hold is never refused because of it.

**The Stripe webhook.** `POST /api/stripe/webhook` verifies the signature and
confirms the booking on `checkout.session.completed`. The success page confirms
it too, from `/api/session`, so a customer who pays and comes back is not lost
without the webhook; the one who closes the tab at the card form is the case the
webhook covers. `STRIPE_WEBHOOK_SECRET` is not set yet, see "Blocked on a human".

**Two more pages.** `admin-bookings.html` is the owner's day: today, needs
attention, upcoming, mark paid, cancel, private note. `manage.html` is the
customer's own view of one booking, reached by a 32 hex character token in a
link, no account and no password, and deliberately small: see it, add it to a
calendar, cancel it. Moving a booking is an email, because a move is a new slot
and the owner should watch it happen. Both admin pages boot through
`js/admin-core.js`; a third would boot the same way.

**One crash worth remembering.** The first cut called the migrations on boot and
awaited them, so a deploy that started before Postgres was reachable took the
whole site down, brochure pages included, for a database the brochure does not
need. The connection now retries in the background and the static site serves
throughout.

**Verified.** `npm test` is 15 availability checks plus the form checks, and it
pins the rules that matter: seven start times ending at 8:00 PM, a window of
four weeks, the 24 hour notice, a closed weekday, a one off list overriding it,
five bookings closing a day, and look busy never taking a day's last slot. The
whole flow was then walked in the browser: a held slot, the email stub, the
redirect, the back button finding the hold still there, and the "just booked"
path scrolling to the time picker rather than the top of the page. Production is
live at https://ezshots.org with `DATABASE_URL` and `TZ` set.


### 2026-09-11 (last) - Audit pass, and the booking flow is live on ezshots.org

Went back over everything that had been built but not actually exercised.

**The one path never tested was the one that matters: what a booking sends.**
Stubbed the EmailJS send and ran a real booking through. The body arrives as a
readable block, in form order, with the package, the price charged, the date and
time, the address, the size, occupancy, access, access notes and brokerage, then
the client's own notes under a "Notes:" heading, with the subject reading
`New booking - 18 Kenwood Ct, Royal Oak, MI 48067`. One clumsy line was fixed:
the first shoot answer read `First shoot: First shoot, half price`. It now reads
`First time booking: Yes, half price applied`, and `js/booking.js` reads a
`data-first` flag rather than pattern matching the value text, so that wording
can change again without silently flipping the price the page charges.

**Every validation path was walked**, in order, with nothing filled in: address,
then size, then occupancy, then access, then day, then time, then name, email and
mobile, then a bad email address. All nine give a plain English sentence.

**The Stripe handoff was proved end to end**, redirect included: the button
changes to "Opening checkout...", the status line shows, and the browser lands on
the next page. The real link it would have used was the correct Essentials first
shoot link.

**Three server fixes.** HEAD requests were sending a body. The login attempt map
grew one entry per address forever, a slow leak on a process meant to run for
months, and now prunes itself past 500. And `/api/checkout` now carries a comment
saying plainly what it does and does not decide: the AMOUNT is the server's, read
from its own config, but WHICH of the two prices applies is a radio button the
browser sends, because nothing can check "have you booked before" without a
customers table. That is equally true of the two public payment links already on
the pricing page, so it is not a new hole, but the earlier note claiming the
server decides the price was too strong and has been corrected in `CLAUDE.md`.

**`book.html` had nothing on it with scripting off**, since the packages render
from config. It now carries a `<noscript>` pointing at the pricing page, the
contact page and the call link.

**Light mode was checked for the first time** on `book.html`, `booked.html` and
`admin.html`, at 375px. All three read correctly: the struck through full price,
the selected day and time, the greyed "Closed" placeholder on Sunday, the sticky
bars.

**Production.** `ADMIN_PASSWORD`, `DATA_DIR=/data` and `SITE_URL` were set on the
Railway production environment and the service redeployed. Confirmed live against
https://ezshots.org: `/book` serves, `/api/config` returns the packages,
`/api/admin/session` reports admin enabled, the password works and a wrong one is
refused, and an authenticated read and write of the config both return 200. The
volume is the one thing still missing, see "Blocked on a human".

### 2026-09-11 (later) - Every price in the copy now comes from the config

The prices in the marketing copy were the one thing left lying about: change a
price in admin and the booking page moved while the sentence on the home page
still said $150. All 45 of them across nine pages are now bound to the live
config through `js/prices.js`, including the two meta descriptions and the
package `<option>` rows in the contact and intake forms.

**The binding is explicit, one element at a time, and that is not an accident.**
A find and replace for "$150" would have been ten minutes of work and a bug
waiting to happen: `services.html` says **"Plus $75"** for the twilight and rush
add ons, and `services.html` and `faq.html` both say other photographers charge
**"$100 to $175"**. Those are different numbers that happen to look the same, and
a blind replace would have silently rewritten them the first time a package price
changed. So a price that should move carries
`data-price="{essentials.first}"` and anything unmarked is left alone. The number
typed into the HTML is the fallback if the config cannot be reached, which is
also what a plain static deploy with no server falls back to.

**A real bug the testing turned up: static files were cached for a week.** The
server was sending `max-age=604800` on everything that was not HTML or JSON, so
a browser kept running a week old `js/admin.js` against a freshly deployed
`admin.html`. That is exactly how a price fix outlives the deploy that made it.
HTML, CSS, JS, JSON and SVG are now `no-cache` and the ETag makes the
revalidation a 304. Images and fonts keep the long cache, since a new photo gets
a new filename.

**Two smaller things.** Adding two packages in a row in admin used to give both
the id `new-package`, and the server rejected the save with an error that read
like the owner's fault. Fixed by excluding the package being named from its own
uniqueness check. And the admin Save button is now a sticky bar that says
"Unsaved changes" while there are any, stays disabled when there are none, and
guards a tab close, because Save used to be four blocks of fields below whatever
you had just typed.

The hero CTA on the home page and the "Listing Pro is $250" button on
`services.html` were still pointing at the pricing page. Both now go to the
booking flow, so every primary button on the site ends in the same place.

Verified: prices were set to $199 / $99 and $349 / $174 through the admin page,
and every page was then loaded in a browser and read back. No page showed a stale
$150, $250, $75 or $125 anywhere, the meta description on `packages.html`
rewrote itself, and the package dropdowns on the contact and intake forms read
"Listing Essentials, $199". At the same time `services.html` still said "Plus
$75" twice, `faq.html` and `services.html` still said "$100 to $175", and
`about.html` still said "$400", which is the whole point. Prices were then set
back and every page re-checked. The no server path was tested by running
`npm run start:static` on another port: `/api/config` 404s, the pages fall back
to `/config.json` and render correctly. Deleting the Pro package entirely was
tested too: no `{pro}` token leaks onto any page, the copy keeps the number it
was shipped with, and the booking page offers one card. The full booking flow
was run again end to end at 375px and produced the right button, the right
Stripe link and the right summary. `npm test` passes. No em or en dashes.

### 2026-09-11 - Booking flow, a server, and prices the owner can change on the site

The owner handed over `ezshots_website_upgrade_plan.md`, a full plan for self
serve booking plus an admin operating system, and then said two things mid
session that decided the architecture: **"i should be able to set prices on the
site its self"** and **"i will add stripe api links for this"**. Both need a
server. A static page can only remember a price on the one device that typed it,
and a Stripe secret key can never sit in client side JavaScript. So the site is
no longer purely static.

**What shipped**

- `book.html`, the three screen flow from the plan. Package, then property and
  time, then contact and pay. One `<form class="lead-form booking">`, so the
  whole booking reaches the inbox through the existing `js/contact-form.js`
  rather than growing a second handler. `js/booking.js` does only what that
  handler cannot.
- `server.js`, Node built ins only, no new dependency. It replaces `serve` as
  `npm start` and reimplements the `serve.json` rules, including `cleanUrls`
  staying off, which is what keeps `/project.html?id=x` working. It also stops
  serving `CLAUDE.md`, `PROJECT-STATE.md`, `docs/` and `scripts/`, which the old
  static deploy was handing to anyone who asked.
- `config.json` is now the one source for packages, prices, checkout links and
  availability. `admin.html` edits it, the server validates and writes it to
  `DATA_DIR`, `js/config.js` is what the pages read it through. There is
  deliberately no second copy of the prices in the JavaScript: a hardcoded
  fallback is how a stale price ends up on screen months later with nobody able
  to say where it came from.
- `/api/checkout` creates a Stripe Checkout Session server side when
  `STRIPE_SECRET_KEY` is set, with the amount read from the server's own config.
  The browser only ever sends a package id. With no key set, or if Stripe is
  unreachable, it falls back to the existing payment links, so a Stripe outage
  cannot cost a booking.
- `booked.html`, the confirmation, reads the paid session back from Stripe
  through `/api/session` rather than trusting `?session_id`. A page that prints
  "Paid $125" because the URL said so is a page anyone can screenshot.
- The package buttons on `index.html` and `packages.html` now go to the booking
  flow instead of jumping straight to Stripe with no property, date or time
  attached. The header CTA points at `book.html`.

**Two things in the plan that were not followed, on purpose**

- The plan prices the packages at $200 and $300 under new names. The site charges
  $150 and $250. The site is right, the offer in `CLAUDE.md` is the spec, and the
  plan was written with example numbers. Flagged to the owner in session.
- The plan's booking notes placeholder invites a gate code. `CLAUDE.md` forbids a
  lockbox or code field anywhere, so the access notes field says the code gets
  texted the morning of the shoot, same as `intake.html`.

**The honest limit: a slot is not held.** There is no bookings table, so two
agents can pick the same 1 PM and both get through. Every line of copy on the
page is written to match that: it says the exact time is confirmed by email the
same day, and it never claims the calendar is locked. Do not "tidy" that copy
into a promise the code cannot keep. `docs/booking-roadmap.md` lists what is
built against the plan and what is not, in the order worth building, with the
bookings table first because everything else leans on it.

`scripts/check-forms.mjs` learned about radio groups: a shared name is a bug for
text inputs and correct for radios, and it now also catches a radio with no
`value`, which would submit blank and could never satisfy a required field.

Verified: `npm test` passes with four lead forms. The server was run and driven
end to end at 375px, choosing Listing Pro, filling the property, picking Tuesday
Sep 15 at 1:00 PM and reaching the last screen with the summary reading $250
less $125 and the submit button carrying the right Stripe link. Availability was
checked against the clock: Saturday Sep 12 correctly disappears because all three
of its slots fall inside the 24 hour notice window, and Sundays never appear.
Admin was signed into, a price was changed to $165, saved, read back from
`/api/config` as 165, then set back to 150. A bad price was rejected with a
readable message. Every page on the site returns 200 through the new server and
`/CLAUDE.md` returns 404. No em or en dashes in any file touched.

### 2026-09-10 - The guarantee is now "you do not pay, plus $20", and the 48 hour window is gone

The owner reworded the offer. It used to be "50% off the first shoot and a 48 hour full
refund window". It is now "50% off the first shoot, and if you are not happy you do not
pay and you get $20 cash on top". Both changes were deliberate and both were confirmed
by the owner mid session:

- The **48 hour claim window is removed everywhere**, on purpose. The owner's reasoning:
  the promise is about whether the client is happy, not about beating a clock, so a
  deadline works against the thing being promised. Do not put it back. `refund.html`
  section 1 now says in as many words that no deadline applies.
- The **$20 applies to every gallery, forever**, not just the first shoot, same as the
  old refund window did. It is paid once per gallery, alongside that gallery's refund.
- Because Stripe charges up front, "you do not pay" is never left as a bare claim. Every
  place it appears, the next clause says the money goes back on the original card. That
  was the owner's follow up point and it is why the copy reads the way it does.
- The **$20 is not paid on a shoot that was already free** under the 72 hour delivery
  guarantee, since no money was taken. Stated in `refund.html` section 1 so the two
  promises cannot be stacked into a $20 payout on a free shoot.

Changed in 14 files: `js/site.js` (announce bar and the footer badge), `index.html`
(meta, hero trust row, offer strip, guarantee block and its four key list, the no
reviews card, the FAQ answer, the closing CTA), `guarantee.html` (h1, promise two,
the why block, four FAQ entries including a new "Why $20 on top" one, the CTA),
`refund.html` (short version callout and sections 1 and 2), `terms.html` (section 6),
`packages.html` (meta, lead, offer strip, a second comparison table row for the $20,
the booking steps, the CTA), plus `contact.html`, `about.html`, `services.html`,
`faq.html`, `portfolio.html`, `project.html`, `intake.html`, `README.md`.
`CLAUDE.md` and `docs/site.md` now carry the new offer as the spec.

**The 48 hour strings that are still in the repo are all scheduling lead time**, not the
guarantee: "most shoots scheduled within 48 hours" in `contact.html` (twice),
`index.html`, `faq.html` and `intake.html`. Leave them.

Verified: `npm test` passes (three lead forms still wire up), no em or en dashes anywhere
in the tree, and the site was rendered at 800px and at 375px. Checked the announce bar,
the hero trust row, the offer strips, the guarantee promise cards and the two new pricing
table rows. No element overflows its container and the table still scrolls inside its own
wrapper on mobile.

**Still open for the owner:** the Stripe half price links and the branding blockers above
are unchanged by this. Nothing in the payment flow mentions the $20, so if a client claims
it, it is a manual send.

### 2026-09-01 (later still) - The first shoot can be bought in one click

The owner created the two half price payment links. Opened both to confirm the amounts
before wiring anything: `...FzaVa0q` charges $75.00 and `...93aVa0p` charges $125.00,
matching Essentials and Pro. They are now the primary button on both package cards, on
the home page and on the pricing page, and the full rate links moved to a secondary
"Booked before?" row.

That closes the gap found earlier the same day, where the page quoted $75 and the
checkout asked for $150. All four price claims on the site now match a checkout amount
that was actually read, not assumed. The table above records the mapping so the next
session does not have to re-derive it.

The invoice workaround is gone from the copy with it: the pricing note, the booking
column and the FAQ answer all said or implied that you ask for the discount and get an
invoice back. You do not, the price is on the button.

Still branded Design Byte Agency, still selling "Photography Pictures NO VIDEO". Those
are two fields in the Stripe dashboard and they are the last thing between a click and
a payment.


### 2026-09-01 (later) - The checkout was contradicting the price, and the README was fiction

**The find that mattered.** Opened both Stripe payment links rather than trusting the
markup. Essentials charges $150 and Pro charges $250, while the card directly above
each button promised "Your first shoot: $75" and "$125". So the entire site headline,
the announcement bar, the hero, the guarantee page, led a first time realtor to a card
form asking for double the number they had just been quoted. Worse, both checkouts are
branded **Design Byte Agency** with product names "Photography Pictures NO VIDEO" and
"WITH VIDEO". Whatever the copy does upstream, that page was undoing it.

Fixed on the site side, which is the half that lives in this repo: the first shoot is
now the primary button on both cards and routes to the contact form, where the half
price invoice actually comes from today. The Stripe links stay, relabelled "Booked
before? Pay $150" and "Pay $250", so the number on the button matches the number on the
card form. The Stripe branding and the missing $75 and $125 links are in Blocked above.

**Also removed the reveal step.** `.pkg-book` was a button whose only job was to hide
two other buttons. That is an extra click between a ready buyer and a checkout, at the
one place on the page where friction costs money. Both routes now show at once, and the
dead handler came out of `js/site.js`.

**Pricing clicks now carry context.** `contact.html?package=Essentials` preselects the
matching option, so a buyer who just clicked a package does not land on a blank select
and have to choose it again. Substring match, so the link stays readable.

**README was actively misleading.** It described a FormSubmit backend (it has been
EmailJS for a while), listed `gallery.html` (deleted earlier the same day), and told
the reader to update a phone number that is no longer in the site. Rewritten around
what a new reader actually needs: the page table, where the moving parts live, the one
form handler and its label requirement, the brand versus accent split, and a section
naming the two files that look deletable and are not, `serve.json` and `Dockerfile`.

**Verified rather than assumed.** Ran the nav drawer through open, Escape, outside
click and link press at 375px, and confirmed the Book a shoot button survives the
940px collapse. Confirmed the dark palette resolves to the elevation ramp it was meant
to (`--bg` #0b1220 < `--surface` #121d31 < `--card` #16223a) and that nav text on the
page ground is 8.5:1. Stubbed `emailjs.send` and submitted both forms: all 22 intake
fields arrive labelled and in form order, `reply_to` is the realtor so Reply works,
the subject carries the property address, empty submits are blocked and the honeypot
absorbs a bot without telling it that it failed. Validation now reads "name, email and
property details" rather than joining the list with commas.

**Not changed, deliberately.** The Stripe links themselves. Creating payment links and
renaming a Stripe business are account actions, and guessing at either would be worse
than the honest routing that is there now.


### 2026-09-01 - Nav rebuilt, dark mode fixed at the token level, intake form added

**Dark mode.** The root cause was one token doing two jobs. `--brand` filled shapes
that carry white text AND coloured text sitting on the page background, and in dark
those need opposite lightness, so whichever way the value went half the site was
wrong. Split `--accent` out for foreground use (26 rules moved). Dark `--brand` is
now `#2f6fe6`, giving white on it 4.63:1 where `#3b82f6` gave 3.2:1.

The dark palette was also flat: `--bg`, `--surface`, `--card` and `--navy` sat within
eight hex points, so cards, soft sections and the footer melted together and the
footer at `#060d19` read as a hole cut in the page. Rebuilt around elevation,
bg < surface < card, with navy panels ABOVE the page and a `--panel-line` hairline,
since a shadow does nothing on a dark ground. Every text pair in both themes clears
WCAG AA now, checked numerically.

**Nav.** The Book a shoot button lived inside `.nav-links`, which collapses at 940px,
so the only button on the site that takes money was hidden behind a hamburger on
every phone. Moved to the header tools where it survives. Also: emoji glyphs replaced
with inline SVG that inherits text colour, active link gets a bar not just a shade,
drawer closes on Escape / outside click / link press / leaving the breakpoint, drawer
hangs off `top: 100%` rather than a magic 76px, skip link plus `id="main"` on all 14
pages, focus-visible ring everywhere.

**Intake form.** New `intake.html`, noindex, linked from the footer as "After you book"
and from the Buy now timeline on `packages.html`. 23 fields in five blocks.
`js/contact-form.js` was rewritten so any field that is not name/email/phone/message
is folded into the message body as a labelled line in form order. That is the whole
trick: the EmailJS template has seven fixed variables and cannot grow one per
question, so a 23 field intake and a 4 field enquiry share one template and one 200 a
month quota. Per form behaviour is now declarative on the form element:
`data-required`, `data-subject`, `data-subject-field`, `data-success`.

Deliberately **no lockbox or gate code field**. The form emails in plain text through
a Gmail account; a code entered there would sit in an inbox forever. The page says it
will be texted the morning of the shoot instead. Do not add one back.

**New check.** `scripts/check-forms.mjs`, wired to `npm test`. It catches a field with
no label (it would reach the inbox unnamed), a duplicate name or id, a `data-required`
naming a field that does not exist, a missing honeypot and a missing status element.
Every one of those fails silently in a browser and drops an answer.

**Copy.** Two things were actively costing conversions and both were live on
production. Three five star testimonials signed "Realtor name / Brokerage, city",
replaced with an honest "no reviews yet" section built on the refund window and the
$75 first shoot. And `(248) 555-0139`, a reserved fictional number, wired as a real
`tel:` link in every footer; those rows now point at the TidyCal call. Also dropped an
unsourced "aerials sell faster" claim, stopped the pricing page CTA sending a ready
buyer away from its own Stripe links, and unified four different reply time promises
into one.

**Bug found while reading.** The stylesheet defines `.vcard .ico` and the markup writes
`class="ic"` in about twenty places across five pages, so those icon tiles rendered as
bare emoji with no blue tile. Fixed in CSS by accepting both, rather than chasing
every call site.

**Verified:** `npm test` passes on all three forms, a rendered sample intake email
reads correctly end to end, every internal link across all 14 pages resolves, no em or
en dashes in any served file, CSS braces balance, both scripts pass `node --check`, and
both palettes were audited numerically for AA contrast and elevation separation.
**Not verified in a browser** - the preview pane in this session is pinned to a
different project root and will not launch this server, so the nav and dark mode have
not been seen rendered. Worth an eyeball with `npm start` before trusting the layout.

### 2026-09-01 - Gallery removed, page and all

- The owner called the home page "A few frames" strip bad and asked for the gallery gone.
  It was eighteen Unsplash frames of houses nobody shot, sitting under a portfolio that had
  just become real photos, which is the worst possible order to read a page in.
- Removed: the `A few frames` section on `index.html`, the `Individual frames` section on
  `portfolio.html` that pointed at it, `gallery.html` itself, the `Photo gallery` footer link
  in `js/site.js`, the `#gallery-strip` branch of `js/render.js`, the `window.EZ_GALLERY`
  array and the `IMG()` stock helper in `js/projects.js`, and the now unused `.masonry`
  rules in `css/styles.css`.
- `p.gallery` on each project is a different thing and stays. It is the per property frame
  list that `project.html` renders, and it holds real local files.
- Gallery was a footer only link, never in the nav, so nothing in `js/site.js` `links` had to
  change. Nothing else in the site linked to `gallery.html`.
- The word "gallery" is still all over the copy and should stay. It means the delivered set
  of photos a client receives, which is what the guarantee and the refund policy are written
  about.
- Verified with a grep for `gallery.html`, `EZ_GALLERY`, `gallery-strip`, `masonry` and
  `IMG(` across the served files: zero hits. The only remaining hits are in the stale
  `ez-shots/` duplicate folder, which is dockerignored and not served. `node --check` passes
  on both scripts and `EZ_GALLERY` is now undefined at load.

### 2026-09-01 - Real photos on the portfolio, eight shoots cut to five

- The owner supplied five exterior photos. Converted them to JPEG with `sips` at quality 66
  (1448 x 1086, 265KB to 498KB each) and put them in a new `img/` folder. Source PNGs were
  about 2.9MB apiece, too heavy to ship.
- Rewrote `window.EZ_PROJECTS` in `js/projects.js` from eight entries to five, one per real
  photo, each matched to a house that actually looks like the story next to it: Birmingham
  brick colonial, Royal Oak craftsman, Rochester Hills new build farmhouse, Northville
  twilight estate, Troy brick colonial. `cover` and `gallery` are local `img/...` paths.
- Dropped `grosse-pointe-waterfront`, `detroit-riverfront-loft`, `ferndale-ranch` and
  `troy-townhome`, and renamed `royal-oak-bungalow` to `royal-oak-craftsman`. Reason: a real
  photo beside three stock ones reads worse than five real ones, and reusing one photo for
  two different properties on a photography portfolio is the one lie a visitor can spot.
  The dropped copy is in git at 32ecd7c if any of it is wanted back.
- Each project now has a one image `gallery`. That renders fine: `.gallery img:first-child`
  is full width at 16/9, so a single frame reads as a hero rather than a lonely tile.
- `pkg: "Listing Pro + twilight"` became `Listing Pro`. The uncommitted pricing pass in the
  working tree removes add ons and size tiers, and a package name with a `+` in it
  contradicts it. Twilight stays in the services list and in `services.html`, it is included
  work now rather than an upsell.
- `portfolio.html`: stat 8 becomes 5, the "13 Metro Detroit cities" stat relabelled "cities
  served" so it does not read as a count of shoots on the page, and the lead and the meta
  description no longer promise a lakefront or a Detroit loft that is no longer shown.
- `EZ_GALLERY` is untouched and still stock. That is the gallery page, not the portfolio,
  and it was out of scope for this change.
- Verified by loading `js/projects.js` in node: five unique ids, every `cover` and `gallery`
  path exists on disk and starts with a JPEG magic number, every project carries drone
  aerials so the "100%" stat still holds, and no page or doc still references a dropped id.
  Not verified in a browser, the CSS was not touched.

### 2026-09-01 - Railway build fixed at the source, Dockerfile added, EmailJS key live

- Root cause of every failed deploy since 19:50, in both environments: a Railway variable
  literally named `EMAILJS.PUBLIC_KEY`. A dot is not legal in an environment variable name,
  so Railpack read it as a reference to a variable called `EMAILJS`, asked BuildKit for a
  secret by that name, found none, and failed with `secret EMAILJS not found`. The earlier
  guess in the entry below, that the value was a broken `${{...}}` reference, was wrong. It
  was the name, not the value. Adding more variables made no difference because nothing in
  the site reads any of them.
- Added a `Dockerfile` so Railway builds with Docker instead of Railpack. Railpack is what
  turns every service variable into a BuildKit secret, so a bad variable name can never
  take the build down again. Node 22 alpine, `npm install --omit=dev`, `CMD npm start`.
  Added `.dockerignore` so the image skips `.git`, `docs`, markdown, the stale `ez-shots/`
  duplicate and the zip. Delete the Dockerfile to go back to Railpack.
- Added `.gitignore` (`node_modules`, `.DS_Store`). The repo had none, so a local
  `npm install` would have left the whole dependency tree stageable.
- Committed `package-lock.json`, which Railpack had been warning about. The Dockerfile uses
  `npm ci --omit=dev` so the image installs exactly what the lockfile pins.
- Pasted the real EmailJS public key into `js/contact-form.js`, replacing the placeholder.
  `TEMPLATE_ID` is still unconfirmed, see the item above.
- `.claude/launch.json` now runs `npm run start` with `autoPort`, so the local preview uses
  the same command and the same `$PORT` handling as the container instead of a hardcoded
  `npx serve -l 3000`.
- How verified: `node --check js/contact-form.js` passed. Started the site with `npm start`,
  which picked up the assigned `$PORT` (53147) and proved the container CMD honours Railway's
  injected port. `curl` returned 200 on `/`, `/index.html`, `/contact`, `/contact.html` and
  `/project.html?id=birmingham-colonial`, so `serve.json` still survives the change. Loaded
  `contact.html` in a browser: no console errors, the EmailJS SDK is defined, one
  `form.lead-form` found with fields name, phone, email, package, message, and the served
  `js/contact-form.js` carries the real key. Docker is installed locally but the daemon was
  not running, so the image itself was not built here. Railway's build is the first real
  test of the Dockerfile.

### 2026-09-01 - Railway staging build failure traced to a stray EMAILJS service variable

- Symptom: staging deploy `43aaa077` failed at Build > Build image with
  `failed to solve: secret EMAILJS not found`. Build logs stop right after
  `install mise packages: node`, so it never reached `npm install` or `npm run start`.
- Cause is on the Railway side, not in this repo. Railpack mounts every Railway service
  variable into the image build as a BuildKit secret. The failing deployment shows
  "1 Variable" on its Details tab. That variable is named `EMAILJS` and its value does not
  resolve (a `${{...}}` reference to a shared variable or another service that no longer
  exists, or the variable was removed after the plan was generated), so BuildKit is asked
  for a secret that is not there and the daemon aborts the build.
- Verified the repo is clean: `grep -rniI EMAILJS` finds no environment variable use
  anywhere in code, only the EmailJS SDK script tags and the client side `CONFIG` object in
  `js/contact-form.js`. There is no `Dockerfile`, `railway.json`, `railway.toml`,
  `railpack.json` or `nixpacks.toml` in the repo, so nothing here declares a build secret.
  Nothing was changed in the site to fix this.
- Fix for the owner: Railway -> EZ Shots -> staging service -> Variables, delete the
  `EMAILJS` variable (this static site does not need it, EmailJS keys are publishable and
  live in `js/contact-form.js`), then redeploy. If it is wanted for some later reason, set
  it to a literal value rather than a reference.
- Also noted: the build ran from a local snapshot upload (`railway up`), not from GitHub.
  The commit shown, `43aaa077`, does not exist in this repo on any branch, local or remote,
  where both `main` and `staging` sit at `93d9be9`. If GitHub deploys are wanted, connect
  the service to `angelob120/ez-shots` and pin the staging environment to the `staging`
  branch.
- Railpack also warns there is no `package-lock.json`. Not the cause of this failure, but
  committing a lockfile would make installs deterministic.

### 2026-09-01 - Full redesign around the 50% off and money back offer

- Rebuilt the whole site as a professional real estate photography site for Metro Detroit
  realtors, replacing the generic "warm and approachable" layout. New design system in
  `css/styles.css` (rewritten from scratch): white ground, deep navy bands, one blue accent
  (#1d4ed8), Inter, 14px radii, light and dark tokens.
- The offer is now the spine of the site, not a footnote: first shoot 50% off, a 48 hour
  full refund window on every gallery, and a 72 hour delivery ceiling or the shoot is free.
  It appears in the announcement bar, the hero, an offer strip on three pages, a navy
  promise block on the home page, and its own page.
- Pricing changed to the real numbers: Listing Essentials $150 (25 to 30 photos, 5 to 8
  drone aerials) and Listing Pro $250 (35 to 45 photos, 8 to 12 aerials, one minute video
  plus a vertical cut). Photo counts were set from 2025 to 2026 industry pricing guides,
  which put 15 to 30 frames as standard under 2,000 sq ft and 30 to 50 above it. Both
  packages are flat rate to 3,000 sq ft, with add ons priced on the pricing page.
- New pages: `services.html`, `guarantee.html`, `faq.html`, `areas.html`. Rewrote
  `index.html`, `packages.html`, `portfolio.html`, `gallery.html`, `about.html`,
  `contact.html`, `project.html` and `refund.html`. Light edits to `terms.html` and
  `privacy.html` (dates, the reshoot clause replaced by the refund policy, dashes removed).
- Nav is now Services, Portfolio, Pricing, Guarantee, About, Contact plus a Book a Shoot
  button. Gallery, FAQ and Areas moved to the footer. Nav lives in `js/site.js` as always.
- `js/projects.js` replaced with eight real Metro Detroit shoots (Birmingham, Royal Oak,
  Grosse Pointe Farms, Rochester Hills, Detroit, Northville, Ferndale, Troy), each with
  square footage, package, photo count and turnaround. `js/render.js` rewritten to render
  the richer card and to escape data before injecting it. `project.html` now shows a spec
  row and three related shoots.
- **Production bug found and fixed.** With no `serve.json`, `serve` 301 redirects
  `/project.html?id=x` to `/project` and drops the query string, so every portfolio detail
  page would have said "Shoot not found" on Railway. Added `serve.json` with
  `cleanUrls: false`, a `/` to `/index.html` rewrite, and a `/:page` to `/:page.html`
  rewrite so both `/services` and `/services.html` work and query strings survive.
- Stripe: both links the owner supplied mid session are wired in on `index.html` and
  `packages.html`. $150 Essentials is `4gM5kEaUIb3B4zV9BvaVa0n` ("Photography Pictures NO
  VIDEO"), $250 Pro is `3cI8wQ6Es5JhaYj00VaVa0o` ("Photography Pictures WITH VIDEO"). The
  two old links from the retired $199 and $349 packages are gone from the site.
- How verified: served the site locally with `serve` and stepped through every page in a
  browser at desktop and mobile widths, in light and dark mode. Checked the mobile menu
  opens, the package Book buttons reveal the Stripe and TidyCal options, the portfolio grid
  renders eight cards, and the project detail template renders its spec row and gallery.
  `node --check` passed on all three JS files. Every internal href resolves to a file that
  exists. `curl` confirmed `/`, `/index.html`, `/services`, `/services.html` and
  `/project.html?id=...` all return 200 with no redirect. Confirmed no em dash or en dash in
  any file touched. Fixed along the way: the brand mark was invisible (a `.brand span` rule
  overrode its color, now an SVG camera in a blue tile), checklist bullets split into two
  flex columns, guarantee list keys did not align, and both the white button and the CTA
  band gradient lost contrast in dark mode.

### 2026-08-22 - Add EmailJS contact form and set up project memory
- Set up project memory files so future sessions start from written state: `CLAUDE.md`, this `PROJECT-STATE.md`, and `docs/site.md`.
- Replaced the FormSubmit forms on `index.html` (#contact section) and `contact.html` with an EmailJS integration. Both forms share `js/contact-form.js` via the `form.lead-form` class.
- Added client-side validation (Name, Email, Message required; Phone optional; email format checked), a disabled "Sending..." button state, and visible success ("Thanks, we'll be in touch.") and error states via a `.form-status` element styled in `css/styles.css`.
- Hardcoded `SITE_NAME = "EZ Shots"` and send it as `site_name` on every submission so the lead email always names its origin even though templates are shared across sites. Subject is `New lead from EZ Shots - {name}`. The Package dropdown choice is folded into the message body.
- EmailJS config (Service ID `service_dburs96`, Template ID, Public Key placeholder, SITE_NAME) lives in the `CONFIG` object at the top of `js/contact-form.js`. These are publishable client-side keys; a static site has no build step so there are no env files.
- How verified: `node --check` passed on the JS; confirmed no em-dashes or en-dashes in any touched file (`index.html`, `contact.html`, `css/styles.css`, `js/contact-form.js`, and the new markdown). Could not do a live test submit because the Public Key is still a placeholder. See "Blocked on a human" for the manual steps needed to make sending work.
- Note: the free EmailJS plan has a monthly request cap (currently showing 200 sends/month). Fine for lead volume, not for bulk.
- Staging branch does not exist yet. Create it with: `git checkout -b staging` (from `main`), then push with `git push -u ez-shots staging`.
