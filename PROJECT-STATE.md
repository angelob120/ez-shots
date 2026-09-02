# PROJECT-STATE.md - EZ Shots

## How to use this file
This file is the memory between sessions. Read it at the start of every session along with `CLAUDE.md`. At the end of every session, append a new dated entry to the top of the Work Log describing what changed and anything the next session would otherwise have to rediscover. "Blocked on a human" lists things only the owner can do (accounts, keys, DNS, deploy clicks). Detailed per-area status lives in `docs/site.md`.

## Blocked on a human
- **Decide how the 50% first shoot discount gets charged.** There is no half price checkout
  link, so today it has to be a manual invoice or a Stripe coupon.
- **Real phone number.** `(248) 555-0139` is a placeholder used in `js/site.js`,
  `index.html` and `contact.html`. Replace it or remove the phone rows.
- **Real photos.** Every image is Unsplash stock. Drop real files in an `img/` folder and
  swap the `IMG(...)` calls in `js/projects.js` plus the hero and section images.
- **Real testimonials.** The three quotes on the home page are attributed to
  "Realtor name / Brokerage, city" on purpose. Put real names in or delete the section
  before launch. Do not ship invented client names.
- **EmailJS Public Key.** `js/contact-form.js` has `PUBLIC_KEY: "__PASTE_EMAILJS_PUBLIC_KEY_HERE__"`. Paste the real key from EmailJS -> Account -> General -> API Keys. The form cannot send until this is done.
- **Confirm the EmailJS Template ID.** The code uses `template_qlotxua`. The template that actually sends to the lead inbox is whichever of `template_qlotxua` / `template_ztl1ney` has its "To Email" set to angelobrown1000@gmail.com. Open both in the dashboard, confirm which one, and update `TEMPLATE_ID` if it is the other.
- **Save the EmailJS template changes.** In the chosen template set Subject to `New lead from {{site_name}} - {{from_name}}` and include a `Site: {{site_name}}` line plus Name, Email, Phone, Message in the body, with "To Email" = angelobrown1000@gmail.com and "Reply To" = `{{reply_to}}`. Make sure the template contains these variables: `site_name`, `from_name`, `email_id`, `reply_to`, `phone`, `message`, `subject`. Click Save in the dashboard, template edits do not deploy from code.
- **Create the `staging` branch.** The repo currently has only `main`. Create `staging` before doing branch-based work (command is in the git handover of the session below).
- **Delete the `EMAILJS` variable on the Railway staging service.** It is what breaks
  the build (`failed to solve: secret EMAILJS not found`). Railway -> EZ Shots -> staging
  service -> Variables -> delete `EMAILJS`, then redeploy. Nothing in the site reads it.
- **No branch protection** is set on `main`. Optional: add protection on GitHub so production is only updated via the tested staging flow.

## Work Log (newest first)

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
