# docs/booking-roadmap.md - what is built and what is not

Source: `ezshots_website_upgrade_plan.md` (the owner's plan, kept outside the repo).
This file tracks it against reality so no session has to re-derive the gap.

## Built on 2026-09-11

- `book.html`, three screens, one form. Package, then property and time, then
  contact and pay. Mobile first, one action per screen, a sticky summary bar.
- `server.js`, replaces `serve` as `npm start`. It serves the same static files
  under the same rules `serve.json` used, plus an API.
- **A Railway Postgres, `server/db.js`, one dependency (`pg`).** The live config
  and the bookings both live there. Schema changes are files in
  `server/migrations`, applied on boot in name order and recorded in
  `schema_migrations`. Never edit an applied one, add the next number.
- **A bookings table and a real hold.** `POST /api/book` takes the slot in a
  transaction behind a Postgres advisory lock, so the second request for the
  same time waits and then finds it gone. Under that, a partial unique index on
  `(date, time) WHERE status = 'confirmed'` makes a double booking impossible
  whatever the code above it does. The hold runs 32 minutes with Stripe
  Checkout, 24 hours with a payment link.
- **The calendar is server side.** `GET /api/availability` is the only thing
  that says what can be booked. `server/availability.js` applies blocked date,
  one off list, weekday default, slots already held or confirmed, minimum
  notice, maximum advance, daily cap, then look busy. `book.html` paints what it
  is given; it never computes a rule, because it cannot know what is booked.
  Four weeks out, 8 AM to 8 PM every two hours, Sunday closed by default.
- **`POST /api/stripe/webhook`**, signature verified, confirms the booking on
  `checkout.session.completed`. `booked.html` confirms it too by reading the
  session back from Stripe, so a customer who returns is not lost when the
  webhook secret is missing.
- Server side Stripe Checkout Sessions when `STRIPE_SECRET_KEY` is set, so the
  browser sends a package id and the server decides the price. Payment links are
  the fallback when the key is missing or Stripe is unreachable.
- `config.json` in the repo is the seed only. With a database the server copies
  it into the `settings` table on first boot, and `admin.html` edits the copy.
- **`admin-bookings.html`**, the owner's day: today, needs attention, upcoming,
  mark paid, cancel, private note. `admin.html` stays settings only. Both boot
  through `js/admin-core.js`.
- **`manage.html`**, the customer's own view of one booking, by a 32 hex
  character token in the link. No account, no password. See it, add it to a
  calendar, cancel it.
- `js/prices.js` binds every price in the marketing copy to the same config, 45
  elements across nine pages, meta descriptions included. Marked one at a time on
  purpose: "Plus $75" for the twilight add on and "$100 to $175" for what other
  photographers charge must not move when a package price moves.
- `npm test` is `scripts/check-forms.mjs` plus `scripts/check-availability.mjs`,
  15 checks that pin the availability rules. Run it after touching either.

## Not built, in the order it is worth building

### 1. Half price that is actually checked
"Is this your first shoot" is a radio button and nothing checks it against past
bookings, so a returning agent who asks for half price gets it. The bookings
table now holds every email, so the check is a small query: count confirmed
bookings for `lower(email)` before deciding which price applies. The same hole
exists in the two public payment links on the pricing page, so closing it means
deciding what those links do too. Until then, do not describe the discount as
verified anywhere in the copy.

### 2. Google Calendar and Sheets
Every confirmed booking as a calendar event with the access and notes in the
description, and a Sheets mirror. Plan sections 23, 24.

### 3. Reminders
The bookings table has `starts_at`, so a job that emails or texts the day before
is now a query rather than a feature. Nothing schedules anything today.

### 4. Referrals
`/refer`, a partner code on the booking URL, the discount applied server side,
payout tracking. Plan sections 37 to 40. The pieces it leans on (server side
pricing, a bookings table) both exist now.

### 5. Customers and lifetime revenue
`admin-bookings.html` is per booking. Grouping by email into a customer with a
history and a lifetime number is the next admin step. Plan sections 44 to 47.

### 6. Editor portal and AI QC
The whole of plan section 43. Explicitly last: it is worth building only once
real shoots have been run through the manual version of the same workflow.

## Decisions worth not re-litigating

- **Prices in the plan are $200 and $300. The site charges $150 and $250.** The
  site is right. The offer in `CLAUDE.md` is the spec and the plan document was
  written with example numbers.
- **Look busy is cosmetic and must stay that way.** It hides a share of each
  day's open times so the calendar does not read as empty. `canBook()` skips it,
  a hold is never refused because of it, and it never takes a day's last slot.
  If it ever leaks into the hold check it becomes a bug that turns paying
  customers away.
- **No address autocomplete.** It needs a Google Places key and a billing
  account. One free text address field with `autocomplete="street-address"`
  until that exists.
- **No lockbox or gate code field**, on the booking page or anywhere else. The
  access notes field says the code gets texted the morning of the shoot. That is
  deliberate, see `CLAUDE.md`.
- **No customer accounts.** The plan says so, and the token link on
  `manage.html` is what replaces one.
- **Moving a booking is an email, not a button.** A move is a new slot, and the
  owner should see it happen rather than find out from the calendar.
- **No find and replace for prices in copy.** See above. It looks simpler and it
  silently rewrites the add on and competitor numbers.
- **Static files are `no-cache`.** No build step means no hashed filenames, so a
  long max-age lets a stale script outlive the deploy that fixed it.
