# docs/booking-roadmap.md - what is built and what is not

Source: `ezshots_website_upgrade_plan.md` (the owner's plan, kept outside the repo).
This file tracks it against reality so no session has to re-derive the gap.

## Built on 2026-09-11

- `book.html`, three screens, one form. Package, then property and time, then
  contact and pay. Mobile first, one action per screen, a sticky summary bar.
- `server.js`, Node built ins only, replaces `serve` as `npm start`. It serves the
  same static files under the same rules `serve.json` used, plus an API.
- `config.json` is the one source for packages, prices, checkout links and
  availability. `admin.html` edits it through `/api/admin/config`.
- Server side Stripe Checkout Sessions when `STRIPE_SECRET_KEY` is set, so the
  browser sends a package id and the server decides the price. Payment links are
  the fallback when the key is missing or Stripe is unreachable.
- `booked.html`, the confirmation, reads the paid session back from Stripe rather
  than trusting the query string.
- Availability rules in the order the plan sets out: blocked date, date override,
  weekday default, minimum notice, maximum advance, days offered.
- `js/prices.js` binds every price in the marketing copy to the same config, 45
  elements across nine pages, meta descriptions included. Marked one at a time on
  purpose: "Plus $75" for the twilight add on and "$100 to $175" for what other
  photographers charge must not move when a package price moves.

## Not built, in the order it is worth building

### 1. A bookings table, and with it slot locking
Nothing holds a slot today. Two agents can pick the same 1 PM and both get
through, which is why the page says the exact time is confirmed by email rather
than claiming the calendar is locked. This is the single biggest gap and every
item below leans on it.

Needs: Postgres (Railway add on), a `bookings` table, a unique constraint on
(date, time), a hold created before checkout and confirmed by the Stripe webhook.
Plan sections 13, 22, 57, 59.

### 2. The Stripe webhook
`POST /api/stripe/webhook` with signature verification, so payment confirms the
booking server side instead of the browser being trusted to arrive at the success
page. Plan sections 16, 17.

### 3. Admin dashboard past settings
`admin.html` is settings only. Today's schedule, bookings list, booking detail,
status moves, customers, lifetime revenue, notes and analytics all need the
bookings table first. Plan sections 25 to 34, 44 to 47.

### 4. Google Calendar and Sheets
Every confirmed booking as a calendar event with the access and notes in the
description, and a Sheets mirror. Plan sections 23, 24.

### 5. Referrals
`/refer`, a partner code on the booking URL, the discount applied server side,
payout tracking. Needs the bookings table and server side pricing, both of which
the checkout endpoint already does half of. Plan sections 37 to 40.

### 6. Editor portal and AI QC
The whole of plan section 43. Explicitly last: it is worth building only once
real shoots have been run through the manual version of the same workflow.

## Decisions worth not re-litigating

- **Prices in the plan are $200 and $300. The site charges $150 and $250.** The
  site is right. The offer in `CLAUDE.md` is the spec and the plan document was
  written with example numbers.
- **No address autocomplete.** It needs a Google Places key and a billing
  account. One free text address field with `autocomplete="street-address"`
  until that exists.
- **No lockbox or gate code field**, on the booking page or anywhere else. The
  access notes field says the code gets texted the morning of the shoot. That is
  deliberate, see `CLAUDE.md`.
- **No customer accounts.** The plan says so and nothing here needs one.
- **No find and replace for prices in copy.** See above. It looks simpler and it
  silently rewrites the add on and competitor numbers.
- **Static files are `no-cache`.** No build step means no hashed filenames, so a
  long max-age lets a stale script outlive the deploy that fixed it.
