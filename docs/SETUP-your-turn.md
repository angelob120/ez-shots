# Your turn — everything a coding session can't do

Everything from this round is written, typechecked and tested. What's below is
the part that needs a human with credentials, a browser, and in one case a
lawyer. It's in the order that unblocks the most.

Estimated total: **about 90 minutes**, plus waiting on other people for #6.

---

## 1. Run the migrations — 5 minutes, blocks the most

Nothing OAuth-related works until this runs, and four earlier migrations are
waiting behind it too. The sandbox can't do this because `binaries.prisma.sh`
refuses to serve it a client.

On your own machine, in the repo:

```bash
npx prisma generate
npm run db:push
```

Unblocks migrations `22_tenant_invites`, `24_storefront_analytics`,
`25_support_tickets`, `26_customer_crm`, `27_oauth_accounts`,
`28_campaigns_and_email`, `29_pricing_plans`, `30_booking_calendar`,
`31_automations`, `32_store_theme_presets`,
`33_password_reset_and_menu_submission` and `35_login_history`.

**`35_login_history` is new this round.** It adds the operator login history —
`prisma.loginEvent` and `prisma.activityEvent` (an admin-only view at
`/admin/activity`). Until it runs, every operator sign-in and every admin/owner
page load calls into `lib/activity.ts`, which swallows the "table doesn't exist"
error, so nothing breaks — but nothing is recorded either, and `/admin/activity`
stays empty. Idempotent; run it and the page starts filling.

**`33_password_reset_and_menu_submission` is new this round** and blocks three
things until it runs: the operator forgot-password flow (`prisma.passwordResetToken`),
the "have us build your menu" onboarding path (`prisma.menuSubmission`), and —
because the onboarding page and the dashboard layout both count
`menuSubmission` — **every owner page and the whole onboarding wizard**. Same
blast radius as `30_booking_calendar`; run it.

**Expect the customer pages and all of `/dashboard/marketing` to be broken
until you do this** — `26_customer_crm`
changed the list query, so it isn't only the new features that are waiting.

**And expect every owner page to be broken until you do this.**
`30_booking_calendar` is worse than the rest: the setup-call banner queries
`prisma.booking` from the dashboard *layout*, so a missing table takes the
whole dashboard down rather than one route. That's the widest blast radius of
any un-run migration in the repo — do this one first.

After it runs, `npx tsc --noEmit` should also drop from ~200 fake errors to
approximately zero. If real ones appear, they were hiding behind the stale
client and are worth reading.

---

## 1b. SendGrid — 20 minutes, plus DNS propagation

> **STATUS (2026-07-21): API key done, provider still OFF — on purpose.**
> The restricted Mail-Send API key exists and `SENDGRID_API_KEY` is set in
> Railway. `EMAIL_PROVIDER` is deliberately left UNSET, so the app is still on
> the email stub (records, sends nothing) and the boot check stays happy.
>
> **DO THIS WHEN YOU ADD THE REAL WEBSITE DOMAIN** (the thing you said you'd
> forget): once the domain is live and authenticated in SendGrid (step 2 below),
> flip email on in one move — add `EMAIL_FROM=no-reply@<your-domain>` and set
> `EMAIL_PROVIDER=sendgrid`, then redeploy. Don't set `EMAIL_PROVIDER=sendgrid`
> before `EMAIL_FROM` exists — the boot check will refuse to start.
>
> Also rotate the current API key when you go live: it was pasted into a chat
> during setup. Delete it, make a fresh restricted Mail-Send key, update Railway.

Marketing email is written and tested and delivers nothing until this is done.
The stub records every send as `SENT`, which is the worst possible failure mode:
an owner runs a promotion, sees "sent to 240 people", and learns weeks later
from the redemption rate that nothing left the building. `scripts/config-check.mjs`
refuses to boot on the half-configured cases, but it can't catch "not configured
at all" — that's the intended default.

1. Sign up at <https://sendgrid.com>. Free tier is 100/day, enough to prove the
   path works.
2. **Settings → Sender Authentication → Authenticate Your Domain.** Do the
   *domain*, not "Single Sender Verification".

   This is the step to not skip. A single verified sender passes SendGrid's own
   check and then fails DMARC at the recipient, so the mail is accepted by the
   API, reported as delivered, and lands in spam. Every metric says it worked.

   SendGrid gives you three CNAME records. Add them at your DNS provider and
   wait — propagation is usually minutes, occasionally hours.
3. **Settings → API Keys → Create API Key.** Restricted access, "Mail Send"
   only. Copy it now; SendGrid shows it once.
4. Set the environment:
   ```
   EMAIL_PROVIDER=sendgrid
   SENDGRID_API_KEY=SG.xxxxx
   EMAIL_FROM=no-reply@<your-authenticated-domain>
   ```
   `EMAIL_FROM` must be on the domain you authenticated in step 2. It is the
   sender for every tenant who hasn't verified an address of their own, which is
   all of them on day one.
5. Optional while testing: `SENDGRID_SANDBOX=1`. Validates the whole request
   including the credential and delivers nothing — which a stub cannot do,
   because a stub can't tell you your API key is wrong.

**Then send yourself one.** Create a campaign at `/dashboard/marketing`, point it
at a segment containing only your own address, launch it, and press the campaign
drain button in `/admin/tools`. Check where it lands — inbox or spam — because
that is the number that matters and no test in this repo can tell you.

### Still outstanding after that

- **The bounce/complaint webhook doesn't exist.** `suppressEmailAddress()` is
  written and nothing calls it, so a hard bounce is retried and a spam complaint
  is never recorded. It's the P1 in `docs/marketing.md` and it is what protects
  the sending domain. Needs a route at SendGrid's Event Webhook.
- **A tenant using their own from-address** needs `emailSenderVerifiedAt` set by
  us after their domain is authenticated in SendGrid. There is deliberately no
  owner-facing control for it — see `docs/marketing.md`.
- **Operator forgot-password email rides the same SendGrid key.** New this
  round: `/forgot-password` mints a reset token and hands the link to
  `lib/operator-email.ts`, which uses `SENDGRID_API_KEY` (+ `EMAIL_FROM`). Until
  the key is set the whole flow still works end to end — token minted, row
  written, `/reset-password` page functional — but the email is a **no-op that
  logs the link to the server console** instead of sending. Set the key and it
  sends with no code change. This is a separate path from customer email
  (`lib/email.ts`) on purpose: a reset is transactional and has no consent gate.

---

## 1c. Stripe Prices for the paid plans — 10 minutes

Owners can now pick and pay for a plan at `/dashboard/plan`. Zero Monthly works
today; the two paid plans need Prices that don't exist yet.

1. Stripe dashboard → **Product catalogue → Add product.**
   - "EZ Orders — Flat", recurring, **monthly**, **$399.00**.
   - "EZ Orders — Hybrid", recurring, **monthly**, **$149.00**.
2. Copy each Price id (`price_...`) into the environment:
   ```
   STRIPE_PRICE_FLAT=price_xxxx
   STRIPE_PRICE_HYBRID=price_xxxx
   ```
3. On your existing webhook endpoint, add three events:
   `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.

   Without the middle one nothing ever starts the grace clock, so a card that
   stops working is never noticed and the tenant keeps a paid plan for free.

The amounts must match the pricing page. `assertPriceSanity` refuses to bill
when the Stripe Price disagrees with the code, rather than quietly charging the
Stripe number — so a typo here fails loudly at upgrade time instead of
overcharging somebody.

Until both Price ids are set, `/dashboard/plan` shows the three plans, says paid
plans aren't switched on yet, and Zero Monthly behaves exactly as it does today.

**Note the 4% on Hybrid comes out of the restaurant's proceeds, not the
customer's bill** — that's what the pricing page promises, and it's now what the
code does.

---

## 1d. Set your calendar availability — 10 minutes, blocks every booking

The booking calendar is built and both call types are seeded, and **they hand
out zero slots** until you fill in the grid. `/book/setup` and `/book/chat`
currently render "No times available", the contact page links to one, and the
onboarding banner links to the other. Nothing about that looks like a
configuration gap from the outside — it looks like a broken booking page.

The engine fails closed on purpose (see `docs/booking.md`); an empty calendar
offering nothing is the safe direction, but it does mean this step is not
optional.

1. Log in as an admin, go to **/admin/calendar → Availability**.
2. For **Setup call** (20 min) and **Quick 10 minute chat** (10 min):
   - Tick the days you'll take calls and set a window on each.
   - Check the timezone is yours — it defaults to `America/New_York`.
   - Paste your Zoom or Meet room into **Meeting link**. Without one the
     confirmation page says "we'll email you a link", and nothing currently
     sends that email.
3. Open `/book/chat` in a private window and book yourself in, to see what a
   stranger sees. Then cancel it from the link you get.

Be meaner with the chat window than the setup window. The first is strangers,
the second is people already paying you.

**Known gap while you're in there:** there is no confirmation email yet, and
"Pick a different time" makes a second booking rather than moving the first.
Both are written up in `docs/booking.md` as P1. Until the email exists, the
only notification that somebody booked is `/admin/calendar`, so it's worth
opening daily — or pointing your existing Zapier at it.

---

## 2. Google sign-in — 15 minutes

1. Go to <https://console.cloud.google.com/apis/credentials>.
2. Create a project if you don't have one. Name doesn't matter.
3. **OAuth consent screen** first — Google won't let you create a client
   without it.
   - User type: **External**.
   - App name: `EZ Orders`. Support email: yours.
   - **Authorized domains:** your APP_URL domain, no scheme, no path.
   - App home page: `https://<your-domain>`
   - Privacy policy: `https://<your-domain>/legal/privacy`
   - Terms of service: `https://<your-domain>/legal/terms`
   - Scopes: leave the defaults. We only ask for `openid email profile`.
   - Publish it. In Testing mode only accounts you list can sign in, which will
     look like a bug in three weeks when you've forgotten.
4. **Credentials → Create credentials → OAuth client ID.**
   - Type: **Web application**.
   - Authorized redirect URI, exactly this and nothing else:
     ```
     https://<your-domain>/api/auth/google/callback
     ```
   - Add a second one for local work if you want it:
     `http://localhost:3000/api/auth/google/callback`
5. Copy the client ID and secret into your environment:
   ```
   GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   ```

The redirect URI must match **character for character**, including the absence
of a trailing slash. A mismatch produces `redirect_uri_mismatch` and nothing
else, which is the single most common way this stalls.

---

## 3. Apple sign-in — 30 minutes, needs a paid account

Apple is fiddlier and needs an active Apple Developer Program membership ($99/yr).
**If you don't have one, skip this entirely** — the code renders no Apple button
when it isn't configured, and Google alone works fine.

At <https://developer.apple.com/account/resources/identifiers/list>:

1. **Identifiers → +  → App IDs → App.** Create one; enable **Sign in with
   Apple**. You need this even though there's no iOS app — it's the parent for
   the Services ID.
2. **Identifiers → + → Services IDs.** Description `EZ Orders Web`, identifier
   something like `app.ezorders.web`. **This identifier is your
   `APPLE_OAUTH_CLIENT_ID`** — not the App ID, which is the mistake everyone
   makes.
3. Edit the Services ID → **Configure** next to Sign in with Apple:
   - Primary App ID: the one from step 1.
   - **Domains and Subdomains:** `<your-domain>` — no scheme.
   - **Return URLs:** `https://<your-domain>/api/auth/apple/callback`
   - Apple will not accept `localhost` here. Local Apple testing needs a tunnel
     (ngrok or similar) with the tunnel host registered.
4. **Keys → + .** Name it, tick **Sign in with Apple**, configure it against
   your primary App ID, and download the `.p8`. **You get one download, ever.**
5. Environment:
   ```
   APPLE_OAUTH_CLIENT_ID=app.ezorders.web
   APPLE_TEAM_ID=<10 chars, top right of the developer portal>
   APPLE_KEY_ID=<10 chars, on the key you just made>
   APPLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----"
   ```

On the private key: paste it with literal `\n` sequences rather than real
newlines. Railway mangles real ones; the code restores `\n` before parsing, so
that form is the one that works.

---

## 4. Set `APP_URL` — 1 minute, easy to miss

```
APP_URL=https://<your-domain>
```

The redirect URI is built from this. Without it every sign-in fails at the
provider with a mismatch that nothing in our logs explains. `npm run config:check`
now warns about exactly this — run it after setting the variables and read what
it says.

---

## 5. Verify it works — 10 minutes

0. **Before any of this:** the Google and Apple buttons are already visible on
   `/login`, `/dashboard/sign-in` and the storefront footer — greyed out and
   marked "coming soon", because no credentials exist yet. That is
   `OAUTH_PREVIEW_BUTTONS`, on by default. **Set `OAUTH_PREVIEW_BUTTONS=0` once
   you have real customers on a storefront and haven't finished the setup** —
   a placeholder is fine in front of you, and a dead end in front of a diner.

1. Deploy, then hit `/login`. You should see "Continue with Google" (and Apple
   if you did #3). **No button means the credentials aren't loaded** — that's
   the designed behaviour, not a bug, so check the env vars first.
2. Sign in with the Google account whose email matches an existing owner. It
   should land you on the dashboard.
3. Sign in with a Google account that matches **nothing**. It should refuse and
   tell you accounts come from an invite. If it creates an account instead,
   stop and tell me — that's the one thing this design must never do.
4. Go to **Settings → Sign-in** and check it shows Google as connected.
   Disconnect it, confirm it goes back to "Not connected", reconnect.
5. On a storefront, sign in from the footer, place a test order, then open
   "Your orders" and confirm the order is there.

---

## 6. Legal — the slow one, start it now

Nothing here is blocked by code, and all of it takes other people time.

- **Get the ten policies reviewed by an attorney.** They're at `/legal`. I'm not
  a lawyer and the text is generated — it's structured well and covers the real
  mechanics of your product (the surcharge, direct charges, TCPA consent,
  processor-vs-controller), but it hasn't been reviewed and shouldn't be relied
  on until it has.
- **Form the entity.** `COMPANY` in `src/lib/legal-base.ts` currently names
  "EZ Orders" with a placeholder address and Delaware governing law. A policy
  naming a company that doesn't exist isn't enforceable by anyone.
- **Make three email addresses work** — `privacy@`, `legal@` and `abuse@` at
  your domain. They're printed on public pages right now and route nowhere.
  A privacy request that bounces is a compliance problem rather than an inbox
  problem, so this is the most urgent item on this list that isn't a login.
  Forwarding aliases to your normal inbox is enough.
- Once all three are done, set `LEGAL_REVIEW_REQUIRED = false` in
  `src/lib/legal-base.ts` and the draft banners disappear.

---

## 7. Still outstanding from before this round

Neither is new, both still block real functionality:

- **The Railway sweep cron doesn't exist.** Stale-order expiry, overdue flags,
  refund retry, message retry and — as of this round — email retry and the
  marketing campaign drain are all written, tested, and never run. Steps are in
  `docs/deploy-sweep.md`; it's a second Railway service off this repo pointed at
  `railway.sweep.json` on `*/2 * * * *`.

  This one got worse this round rather than staying still. Without the cron a
  campaign an owner launches sits in `SENDING` forever and never finishes —
  visibly stuck, unlike the other sweeps, which merely fail to happen. The drain
  button in `/admin/tools` is a testing aid, not a substitute.
- **A2P 10DLC registration.** Weeks of lead time, and until it clears, every
  "we'll text you" in the product is false in production.

---

## What I'd do in what order

1. `npx prisma generate && npm run db:push` — five minutes, unblocks six
   migrations, and without it the whole owner dashboard is down rather than
   just the new pages.
2. Set your calendar availability (1d) — ten minutes, and until it's done every
   booking link you've just shipped renders "No times available".
3. Email aliases for `privacy@` / `legal@` / `abuse@` — ten minutes, closes a live compliance gap.
4. Google sign-in — fifteen minutes, and it's the one people will actually use.
5. Send the policies to a lawyer — starts a clock you want running.
6. The Railway cron — it's been waiting the longest, and marketing campaigns
   now visibly hang without it rather than quietly not running.
7. SendGrid, including the domain authentication. Twenty minutes plus DNS, and
   it's the only channel that can actually reach customers before A2P clears —
   and it's what the booking confirmation email will need when that gets built.
8. Apple sign-in, whenever the developer account exists.
