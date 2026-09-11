# docs/site.md - EZ Shots site plan

One plan file is enough for a site this small. Mark items done in place as they land.

## Positioning
Real estate photography for realtors in Metro Detroit (Wayne, Oakland, Macomb). The
offer the whole site is built around:
- First shoot 50% off. $150 becomes $75, $250 becomes $125.
- Not happy with a delivered gallery means you do not pay: full refund plus $20 cash, on
  every gallery, first shoot and every one after, with no deadline on the request.
- Average delivery about 24 hours, hard ceiling 72 hours or the shoot is free.
- Drone aerials included in both packages, not sold as an add on.

## Packages
- Listing Essentials, $150: 25 to 30 finished photos, interior and exterior, 5 to 8 drone
  aerials, MLS sized plus full resolution, homes up to 3,000 sq ft.
- Listing Pro, $250: 35 to 45 photos, 8 to 12 aerials, one minute listing video plus a
  vertical social cut, same delivery.
- Add ons: twilight +$75, 3,000 to 4,500 sq ft +$50, over 4,500 quoted, rush 12 hour +$75,
  aerial only video +$60, vacant land and commercial quoted.
- Photo counts came from 2025 to 2026 industry pricing guides: 15 to 30 finished frames is
  standard under 2,000 sq ft, 30 to 50 above it.

## Pages and shared chrome
- Done: `index.html`, `services.html`, `portfolio.html`, `gallery.html`, `packages.html`
  (pricing), `guarantee.html`, `faq.html`, `areas.html`, `about.html`, `contact.html`,
  `project.html` (detail by `?id=`), legal (`terms.html`, `refund.html`, `privacy.html`).
- Done: announcement bar, nav, footer injected by `js/site.js`; light/dark theme with a
  no-flash inline set in each `<head>` and a toggle in the header.
- Done: portfolio and gallery data in `js/projects.js`, rendered by `js/render.js`. Eight
  shoots with size, package, photo count and turnaround per shoot.
- Left: real photos. Everything else is written copy that can ship. The fake phone
  number and the three invented testimonials were removed on 2026-09-01 and must
  not come back without real ones behind them. `gallery.html` was removed the same
  day. Still placeholder: Unsplash stock for the hero, the portrait and the section
  images.

## Contact / lead capture
- Done: EmailJS on both forms (index `#contact` and `contact.html`), shared through
  `js/contact-form.js` (`form.lead-form`). Fields Name, Email, Phone, Package, Property
  details. Package options now read Listing Essentials $150 / Listing Pro $250.
- Half done: needs the real EmailJS Public Key pasted and the template confirmed and saved
  in the dashboard. See PROJECT-STATE.md "Blocked on a human".

## Booking flow (2026-09-11)
- Done: `book.html`, three screens, package then property and time then contact and
  pay, driven by `js/booking.js`. `booked.html` is the confirmation.
- Done: `admin.html` plus `server.js`, so prices, checkout links and the schedule
  are edited on the site. They are stored in a Railway Postgres (`server/db.js`);
  `config.json` in the repo is only the seed a fresh install starts from.
- Done: the calendar is worked out on the server, `GET /api/availability`, four
  weeks out, 8 AM to 8 PM every two hours, Sunday closed by default. The browser
  paints what it is given and never computes a rule.
- Done: a bookings table and a real hold. `POST /api/book` takes the slot behind a
  Postgres advisory lock, a partial unique index makes a double booking
  impossible, and `POST /api/stripe/webhook` confirms it when Stripe says paid.
- Done: `admin-bookings.html` for the owner's day and `manage.html` for the
  customer's own booking by token link.
- Done: server side Stripe Checkout Sessions when `STRIPE_SECRET_KEY` is set,
  payment links as the fallback.
- Done: every price in the marketing copy bound to the config through
  `js/prices.js`, so one change in admin moves the whole site. Add on prices and
  competitor comparisons are deliberately not bound.
- Left: half price checked against past bookings, Google Calendar and Sheets,
  reminders, referrals, customers and lifetime revenue, the editor portal. See
  `docs/booking-roadmap.md`.

## Commerce and booking
- Done: TidyCal link https://tidycal.com/angelo3/quick-10-minute-chat on every package and
  in the footer.
- Done: Stripe Buy Now links, both supplied by the owner and both live on `index.html` and
  `packages.html`. Listing Essentials $150 is
  https://buy.stripe.com/4gM5kEaUIb3B4zV9BvaVa0n ("Photography Pictures NO VIDEO").
  Listing Pro $250 is https://buy.stripe.com/3cI8wQ6Es5JhaYj00VaVa0o
  ("Photography Pictures WITH VIDEO").
- Left: a half price checkout path for first time clients, or handle the 50% manually by
  invoice until there is one.

## Deploy
- Done: `npm start` runs `server.js` on Railway's `$PORT`, with the `Dockerfile`
  forcing a Docker build. `npm run start:static` still runs the old `serve` setup
  if the server is ever in the way, with online booking off.
- Done: a Railway Postgres with its own volume holds the config and the bookings.
  `DATABASE_URL` and `TZ` are set on production.
- Done: `serve.json` sets `cleanUrls: false` plus rewrites. This matters: with the default
  config `serve` 301s `/project.html?id=x` to `/project` and drops the query string, which
  broke every portfolio detail page in production.
- Done: the GitHub repo is connected to Railway and the site is live at
  https://ezshots.org.
- Fixed 2026-09-11: `CLAUDE.md`, `PROJECT-STATE.md`, `docs/`, `scripts/` and the
  package files used to be served publicly. `server.js` returns 404 for all of them.
