# CLAUDE.md - EZ Shots

## What this is
EZ Shots is a marketing, portfolio and booking website for a real estate photography business serving realtors in Metro Detroit (photo, video, and licensed FAA Part 107 drone work). The pages are plain HTML, CSS, and vanilla JavaScript with no build step and no framework. Shared announcement bar, nav and footer are injected by `js/site.js`; portfolio and gallery content lives as data in `js/projects.js` and is rendered by `js/render.js`. Lead forms email submissions to the owner through EmailJS (client side).

Since 2026-09-11 there is also a small server, `server.js`, and it is what `npm start` runs. It exists for the things a static file cannot do: hold the live prices so the owner can change them on the site, hold the Stripe secret key so the browser never decides what a shoot costs, and own the calendar so two agents cannot book the same time. Its state lives in a Railway Postgres (`server/db.js`, one dependency, `pg`). Everything else is still static files served by the same rules `serve.json` used. `npm run start:static` still runs the old `serve` setup if the server is ever in the way, with online booking off.

## The offer the site sells
Everything on the site points at one offer. Do not water it down or contradict it in copy:
- First shoot 50% off. Listing Essentials $150 becomes $75, Listing Pro $250 becomes $125.
- If the client is not happy with a delivered gallery they do not pay for it: full refund
  plus $20 cash on top. Every gallery, the first one and every one after, with no deadline
  on the request. Never reintroduce a claim window, it was removed deliberately on 2026-09-10.
- Average delivery about 24 hours, hard ceiling 72 hours or the shoot is free.
- Drone aerials are included in both packages, never sold as an add on.
The full wording lives on `guarantee.html` and is restated formally on `refund.html`. If one changes, change both.

## Absolute rule: no dashes
Never write an em-dash or an en-dash anywhere: not in code, comments, docs, commit messages, or replies to the owner. Use a plain hyphen `-` or split the sentence in two. Check every file you touch before you finish. (Older untouched pages may still contain them; clean them only when you edit that file.)

## The booking flow, and where prices live
- `book.html` is the booking flow: package, then property and time, then contact
  and pay. Three screens, one `<form class="lead-form booking">`, so it reaches
  the inbox through `js/contact-form.js` like every other form. `js/booking.js`
  does only the parts that handler cannot.
- **Prices, packages, checkout links and the schedule live in the config**, not
  in code. `config.json` in the repo is only the seed for a fresh install: with
  `DATABASE_URL` set the server copies it into the `settings` table on first
  boot and `admin.html` edits the copy in Postgres. `js/config.js` is what every
  page reads it through. Do not hardcode a price into the booking flow again.
- **The calendar is worked out on the server and nowhere else.** `GET
  /api/availability` applies the plan's rules in order (blocked date, one off
  list, weekday, booked slots, minimum notice, booking window, daily cap, look
  busy) in `server/availability.js`, and `book.html` paints what it is given.
  Never compute availability in the browser again, the browser cannot know what
  is booked. `scripts/check-availability.mjs` pins the rules; run `npm test`
  after touching them.
- **A slot IS held now.** `POST /api/book` takes it inside a Postgres
  transaction behind an advisory lock (`server/db.js`), so two agents cannot
  both get one time. The hold lasts 32 minutes with Stripe Checkout, 24 hours
  with payment links, and becomes a confirmed booking when Stripe says paid
  (webhook or success page) or when the owner marks it paid in admin. The copy
  may say the time is held and locked in on payment.
- **Paid is booked.** Stripe's webhook, or the success page, confirms the
  booking and the server emails the owner and the client straight away. The
  owner's email has an Add to Google Calendar button: a plain
  calendar.google.com link with the shoot filled in, no Google sign in and no
  API. An accept or decline step, a Google sign in and a Calendar and Sheets
  sync were built on 2026-09-12 and taken out the same day because the owner
  wants it simple. Do not bring them back unasked.
- **Refunds go through Stripe from admin.** A booking card's Refund takes any
  amount up to what is left, with an optional cancel, behind a panel and a
  confirm dialog, and the server refuses one without `confirm: true`. Money
  moves first: if Stripe refuses, nothing changes and no email goes out. Each
  Stripe refund id is recorded once, so a double click is one refund.
  `npm run check:bookings` runs pay, both emails and refunds against a throwaway
  local Postgres with a fake Stripe and EmailJS; run it after touching any of
  this.
- **Look busy is cosmetic.** `availability.lookBusy` hides a share of each day's
  genuinely open times, always the same ones, never a day's last one, and the
  hold check ignores it. It only changes what is shown. Do not let it leak into
  `canBook`. The owner's reschedule and new booking pickers read
  `/api/availability?all=1`, which skips look busy and only answers with the
  admin cookie; the settings page preview deliberately keeps the customer view.
- **`[hidden]` is `display: none !important` in `styles.css`.** Every class with
  its own `display` (`.form-block`, `.btn`) used to beat the attribute, and the
  manage page showed "That link does not match a booking" under a real booking
  for a day. Toggle visibility with `el.hidden`, never with a class that sets
  `display` on something that also carries `hidden`.
- **Prose prices are bound to the config, one element at a time.** `js/prices.js`
  fills `data-price="{essentials.first}"` style templates on 45 elements across
  nine pages, including the meta descriptions and the package `<option>` rows.
  Add a new price to the copy and it needs a `data-price` or it will go stale.
  **Do not "simplify" this into a find and replace for `$150`.** `services.html`
  says "Plus $75" for the twilight and rush add ons and `faq.html` says other
  photographers charge "$100 to $175". Those numbers must not move when a package
  price moves, which is the whole reason the binding is explicit. The number
  typed in the HTML stays as the fallback for when the config cannot be reached.
- **The server decides the amount, not which of the two prices applies.**
  `/api/book` reads the package price out of its own config and the browser
  never sends a number. But "is this your first shoot" is a radio button, and
  nothing checks it against past bookings yet, so a returning agent who asks
  for half price gets it. That is equally true of the two public payment links
  on the pricing page, so it is not a regression. The bookings table now holds
  every email, so a check is a small query away; until it exists do not
  describe the discount as verified anywhere in the copy.
- **Two admin pages, one sign in, one look.** `admin-bookings.html` is the day
  (next shoot, numbers, list or week, a drawer per booking) and `admin.html` is
  settings (packages, weekly hours, rules, days off, one off days, a calendar
  preview, system status and a test email). Both boot through
  `EZAdmin.boot(page, onReady)` in `js/admin-core.js`, which also draws the top
  bar and owns toasts, the confirm dialog and icons. Add a third and it boots the
  same way. They load `css/admin.css` after `styles.css`, every admin rule is
  namespaced `.adm`, and nothing admin lives in `styles.css` any more: the old
  admin `.stat` rule had been restyling the public stat boxes. They carry no
  site header or footer; `site.js` still loads for `window.EZ_MARK`. `/admin`
  opens the bookings page and is linked only from the footer. Never put admin
  in the nav.
- **What the owner can do to a booking.** `PATCH /api/admin/bookings/:id` takes
  `confirm` (mark paid, also for a hand booking that was booked unpaid),
  `move` (any real date and time, refused only when another live booking owns
  the slot, taken behind the same advisory lock as a hold, optional `notify`
  sends the client the new time), `refund`, `cancel` and `note`.
  `POST /api/admin/bookings` adds a booking by hand for a client who phoned:
  status confirmed, `source` admin, paid or not as the owner says, any price,
  and the You are booked email only when it is paid and he ticks it, because that
  email says paid. The public schedule does not bind the owner, only clashes do.
- **The list flags a returning client at the first shoot price.**
  `clientBookings` on each booking is that email's confirmed count. It is the
  only check on the half price radio button, and it is a flag for the owner, not
  a block, so the copy still must not call the discount verified.
- **Schema changes are migration files** in `server/migrations`, applied on
  boot in name order and recorded in `schema_migrations`. Never edit an applied
  one, add the next number. Never create a table by hand in the Railway
  console.
- **Static files are served `no-cache`.** HTML, CSS, JS, JSON and SVG revalidate
  on every request and the ETag turns that into a 304. There is no build step and
  no hash in the filenames, so `js/booking.js` keeps its URL forever: with a long
  max-age a deploy reaches a returning visitor whenever their browser feels like
  it. This was a real bug on 2026-09-11, a week old `admin.js` ran against a new
  `admin.html`. Images and fonts keep the long cache, a new photo is a new name.
- Env vars the server reads: `DATABASE_URL` (the Railway Postgres; without it
  prices come from `DATA_DIR` or the seed and online booking is off),
  `ADMIN_PASSWORD` (admin is off without it, and there is no default),
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_SECRET`, `SITE_URL`, `TZ`
  (defaults to America/Detroit in `server.js` and the `Dockerfile`). `DATA_DIR`
  only matters with no database. Locally, `npm run dev` reads them from a
  gitignored `.env`.

## Rules that will bite you
- The git remote is named `ez-shots`, not `origin`. Pushes go to `git push ez-shots <branch>`. The GitHub repo is https://github.com/angelob120/ez-shots.git.
- There are two lead forms, one in the `#contact` section of `index.html` and one on `contact.html`. Both share `js/contact-form.js` via the `form.lead-form` class. Change form behaviour in the JS once, not per page. If you add a third form, give it class `lead-form` and it wires itself up.
- `form.name` in JavaScript returns the form's name attribute, not the input named "name". The handler reads fields with `form.elements.namedItem(...)` for this reason. Do not switch to `form.name.value`.
- EmailJS keys are publishable client-side keys and live in the `CONFIG` object at the top of `js/contact-form.js`, not in env files (this is a static site with no build step). The `PUBLIC_KEY` is a placeholder until the owner pastes the real one.
- Nav links are hardcoded in `js/site.js`. Adding a page means adding it to the `links` array there (or the footer block below it), not just creating the file. Nav is Services, Portfolio, Pricing (`packages.html`), Guarantee, About, Contact. Gallery, FAQ and Areas live in the footer only. `book.html` is deliberately not a nav row: it is the header CTA button, so booking never reads as a menu item.
- `serve.json` is no longer what runs in production, `server.js` is, but the rules
  in it are still load bearing because `server.js` reimplements them and
  `npm run start:static` still uses the file. The rules and why:  Without `cleanUrls: false`, `serve` 301s `/project.html?id=x` to `/project` and drops the query string, which breaks every portfolio detail page in production. The rewrites in that file also serve `/index.html` at `/` and let `/services` resolve to `/services.html`. Do not delete it.
- `Dockerfile` is load bearing. Railway builds with Docker because of it. Without it Railway
  falls back to Railpack, which mounts every Railway service variable into the build as a
  BuildKit secret, and on 2026-09-01 a variable named `EMAILJS.PUBLIC_KEY` (a dot is illegal
  in an env var name) took every deploy down with `secret EMAILJS not found`. Railway
  supplies `PORT` itself. The variables the site now DOES want are listed under "The
  booking flow" above, and all of them are ordinary names with no dot in them.
- Theme (light/dark) is set inline in each page's `<head>` before render to avoid a flash, and toggled in `js/site.js`. Keep both in sync if you touch theming.
- Portfolio content is data in `js/projects.js`. Edit content there, not in the HTML.
  The standalone gallery was removed on 2026-09-01; `p.gallery` on a project is the
  per property frame list and is a different thing.
- **`--brand` fills a shape, `--accent` colours text.** They are the same value in
  light mode and must not be in dark: a fill has to stay dark enough for white to sit
  on it, text has to stay light enough to read on a near black page. One token doing
  both is what made dark mode look wrong for months. New colour rules must pick the
  right one, and `[data-theme="dark"]` must define every token that light defines.
- **Forms: one handler, `js/contact-form.js`, for every `form.lead-form`.** Anything
  that is not name, email, phone or message is folded into the email body as a
  labelled line, because the EmailJS template has seven fixed variables and cannot
  grow one per question. So **every field needs a `<label for>` or a `data-label`**,
  or its answer arrives unnamed. Per form behaviour is declarative on the form
  element: `data-required`, `data-subject`, `data-subject-field`, `data-success`.
  Run `npm test` after touching any form; it catches the silent failures.
- **Never add a lockbox or gate code field to any form.** They email in plain text
  through a Gmail account and would sit in an inbox forever. `intake.html` says the
  code gets texted on the morning of the shoot instead, and that is the design.
- **Do not ship invented client names, quotes or phone numbers.** Both were live on
  production and both were removed on 2026-09-01. If there is no real proof yet, say
  so on the page; the honest version converts better than a caught fake.

## Session protocol
1. Start every session by reading `CLAUDE.md` and `PROJECT-STATE.md`.
2. Do all work on the `staging` branch. `main` is production.
3. Finish every session by appending a dated entry to the top of the Work Log in `PROJECT-STATE.md`: what changed, why, anything the next session would otherwise rediscover, and how you verified it.
4. Run git yourself and promote to production. The owner asked for this on 2026-09-01, it replaces the old "never run git, hand over commands" rule. Commit after every finished and verified change, not batched at the end of the session.
5. Local testing needs a Postgres: `createdb ez_shots_dev`, put `DATABASE_URL=postgresql://<you>@localhost:5432/ez_shots_dev` and an `ADMIN_PASSWORD` in `.env`, then `npm run dev`. `.claude/launch.json` runs that for the browser preview.

## Git flow (run this, do not hand it over)
Remote is `ez-shots`, not `origin`. After each finished change:

```
git checkout staging && git add <files> && git commit -F- <<'MSG'
Short imperative subject

- what was done, as a bullet
- another thing that was done
MSG
git push ez-shots staging
git checkout main && git pull ez-shots main && git merge staging && git push ez-shots main
git checkout staging && git merge main && git push ez-shots staging
```

Always end back on `staging` with both branches level. Verify with `git log --oneline -5` and confirm `main` moved before reporting done.

Commit message: short imperative subject, blank line, then `- ` bullets, one per line. No paragraphs, no `Co-Authored-By` or attribution trailer, no dashes of any kind (em or en) in the message.
