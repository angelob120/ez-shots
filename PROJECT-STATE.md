# PROJECT-STATE.md - EZ Shots

## How to use this file
This file is the memory between sessions. Read it at the start of every session along with `CLAUDE.md`. At the end of every session, append a new dated entry to the top of the Work Log describing what changed and anything the next session would otherwise have to rediscover. "Blocked on a human" lists things only the owner can do (accounts, keys, DNS, deploy clicks). Detailed per-area status lives in `docs/site.md`.

## Blocked on a human
- **The Stripe checkout is branded "Design Byte Agency".** Confirmed on 2026-09-01 by
  opening both payment links. A realtor clicks Buy on ezshots and lands on a card form
  for a company they have never heard of. That reads as a phishing page, and it is the
  most likely single reason a click does not become a payment. Fix in the Stripe
  dashboard, Settings, Business details, public business name, set it to EZ Shots.
- **Both Stripe products use internal shorthand as the customer facing name.**
  "Photography Pictures NO VIDEO" ($150) and "Photography Pictures WITH VIDEO" ($250).
  The customer sees those strings on the checkout. Rename them to Listing Essentials
  and Listing Pro.
- **Create the half price payment links, $75 and $125.** Until they exist the first
  shoot cannot be bought in one click. The site now routes first timers to the contact
  form and promises a half price invoice the same day, which is honest but slower.
  Paste the two links and they become the primary button on both package cards, and
  the manual invoice step disappears.
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

## Work Log (newest first)

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
