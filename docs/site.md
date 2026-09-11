# docs/site.md - EZ Shots site plan

One plan file is enough for a site this small. Mark items done in place as they land.
This file covers the site. `docs/plan.md` covers the business the site serves and
outranks it on anything about pricing, capacity or how leads arrive.

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
- Pending, do not ship yet: `docs/plan.md` sets $200 for photos plus drone and $300 for
  photos plus drone plus video, after initial proof. Both need a Stripe link that charges
  the amount before any page can quote it.
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
- Left: real photos and real client names. Everything else is written copy that can ship.
  Placeholders still in the site: Unsplash stock images, the phone number (248) 555-0139,
  and three testimonials attributed to "Realtor name / Brokerage, city".

## Contact / lead capture
- Done: EmailJS on both forms (index `#contact` and `contact.html`), shared through
  `js/contact-form.js` (`form.lead-form`). Fields Name, Email, Phone, Package, Property
  details. Package options now read Listing Essentials $150 / Listing Pro $250.
- Half done: needs the real EmailJS Public Key pasted and the template confirmed and saved
  in the dashboard. See PROJECT-STATE.md "Blocked on a human".

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
- Done: `package.json` serves static files with `serve` on Railway's `$PORT` (`npm start`).
- Done: `serve.json` sets `cleanUrls: false` plus rewrites. This matters: with the default
  config `serve` 301s `/project.html?id=x` to `/project` and drops the query string, which
  broke every portfolio detail page in production.
- Left: connect the GitHub repo to Railway and add a public domain. **The domain is
  `ezshots.org`**, named in the outreach message in `docs/plan.md`. It has to resolve to
  this site before automated outreach starts pointing agents at it. There are no
  canonical or Open Graph URL tags on any page yet; add them once it is live.
- Note, corrected 2026-09-11: `CLAUDE.md`, `PROJECT-STATE.md` and `docs/` are **not** served
  by the site. `.dockerignore` excludes `docs` and `*.md`, so the Docker build Railway uses
  never copies them into the image. The older warning here said the opposite and predated
  the Dockerfile.
- They are public anyway, because `angelob120/ez-shots` is a public GitHub repo. That is the
  reason the personal money section of `docs/plan.md` is held back rather than committed.
