# EZ Orders

Ordering and repeat-business platform for independent restaurants.

The ordering flow is not the product — it's the capture point. A customer taps a
link from the restaurant's Google or Apple Maps profile, orders through a
per-tenant PWA, and hands over their phone number and messaging consent on the
way through. What that builds is an owned customer list, which is what the
rewards and SMS win-back engine runs on.

Revenue is a per-order surcharge that rides on the **customer's** bill, not the
owner's. The owner pays no monthly fee and keeps 100% of margin.

---

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router) + TypeScript |
| Database | Postgres + Prisma |
| Auth | Signed-cookie sessions (`jose` + `bcryptjs`), roles `ADMIN` / `OWNER` |
| Styling | Tailwind on operator surfaces; inline tokens on the customer PWA |
| Hosting | Railway — one service + Postgres plugin |

Payments, SMS, and A2P registration are deferred behind interfaces. Nothing in
V1 blocks on them.

---

## Local setup

```bash
npm install
cp .env.example .env          # fill in DATABASE_URL and SESSION_SECRET
npx prisma migrate deploy     # applies prisma/migrations/0_init
npm run db:seed               # demo restaurant + logins
npm run dev
```

`SESSION_SECRET` must be at least 16 characters. Generate one with
`openssl rand -base64 32`.

### Seeded logins

| Role | Email | Password |
|---|---|---|
| Admin | `admin@hearth.app` | `hearth-admin-2026` |
| Owner | `owner@angelos.com` | `angelos-2026` |

Demo storefront: `/r/angelos-pizza`

Override the seed credentials with `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`,
`SEED_OWNER_EMAIL`, `SEED_OWNER_PASSWORD`.

---

## Deploying to Railway

1. Create a project, add the **Postgres** plugin.
2. Deploy this repo as a service. Railway detects Next.js via Nixpacks.
3. Set variables on the **app** service (not the Postgres one):
   - `DATABASE_URL` — reference the Postgres plugin variable, e.g.
     `${{Postgres.DATABASE_URL}}`. Use the internal URL, not
     `DATABASE_PUBLIC_URL`, which routes over the internet and is metered.
   - `SESSION_SECRET` — a long random string (`openssl rand -base64 32`).
     The app throws on boot if this is missing or under 16 characters.
   - `NEXT_PUBLIC_APP_URL` — your public URL
4. Seed once, from the Railway shell: `npm run db:seed`

`npm start` runs `scripts/config-check.mjs` before the app and refuses to boot
on configurations that would otherwise fail silently. Run it locally with
`npm run config:check` to see what it thinks of your environment.

### Text messaging

Off by default. The app records every message it would send in the `Message`
table and delivers nothing until you turn a provider on:

- `SMS_PROVIDER=twilio` — anything else, including unset, uses the stub.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` — from the Twilio console.
- `TWILIO_MESSAGING_SERVICE_SID` — optional. Sends for tenants that have no
  number of their own yet. Without it, a restaurant with no `smsFrom` can't
  send at all.
- `APP_URL` — required once SMS is live. Order links in texts are built from
  it, and a missing value produces a bare `/o/<token>` path that no customer
  can act on. The config check makes this fatal rather than silent.

Point two Twilio webhooks at the app, both POST:

- Messaging → *A message comes in*: `https://<your-host>/api/sms/inbound`
- Status callbacks are configured automatically from `APP_URL`.

**US delivery also requires A2P 10DLC registration** — a brand and a campaign
per restaurant, submitted through the Twilio console. It takes days to weeks
and carriers will filter unregistered traffic regardless of what the code does.
Start it before you need it.

### Why migrations run at start, not at build

Railway's private network (`postgres.railway.internal`) only resolves at
**runtime**. During the build step there is no database to reach, so
`prisma migrate deploy` belongs in the start command:

```
build:  prisma generate && next build
start:  prisma migrate deploy && next start
```

Putting the migration in the build script fails with `P1001: Can't reach
database server`. `migrate deploy` is idempotent, so running it on every boot is
safe. If you ever scale past one replica, move it to a Railway
[pre-deploy command](https://docs.railway.com/reference/deployments) so two
instances don't race to migrate.

`prisma` and `tsx` are runtime dependencies rather than dev dependencies for the
same reason — the start command and the seed script both need them after the
build stage is gone.

---

## The three surfaces

### `/admin` — yours

Every restaurant is a tenant row. Creating one provisions the tenant, four
starter menu categories, and the owner login in a single step.

- Platform metrics: orders, volume, **surcharge collected**, hours per account
- Create / suspend / activate / delete restaurants (delete requires typing the
  slug — it cascades to orders and the customer list)
- One-click "Open dashboard" impersonation, with a persistent banner and a
  return path
- Per-tenant surcharge configuration
- **Support load** page: weekly hours per account, with the trend surfaced —
  this is the number that decides whether 40–60 accounts is a cash cow or a
  full-time job

### `/dashboard` — the owner's

Everything scoped to the logged-in owner's tenant. No query runs without a
`restaurantId` filter derived from the session; nothing accepts a tenant id from
the client.

- Live orders kanban: Incoming → Preparing → Ready
- Orders by hour, new vs returning
- Menu manager: card grid, modal editor, availability toggles ("86 it")
- Branding: logo, hero, accent color, hours, address — with a live preview and
  a panel showing what the customer pays vs. what the owner keeps
- Customers: the owned list, with opt-in status and cohort

### `/r/[slug]` — the customer PWA

One shell, themed at runtime from the tenant's branding. This URL is what goes
in the restaurant's Google Business Profile.

Menu → cart → checkout → confirmation. The surcharge appears as its own
labelled line **before** payment, with an explanation of what it covers.
Phone and marketing consent are captured at checkout. Cart survives a page
reload. Per-tenant web manifest, network-first service worker.

---

## Design constraints wired in from day one

**Surcharge disclosure.** Junk-fee and drip-pricing rules are an active
regulatory area, so the fee is never rolled into item prices or revealed at the
last step. It is a named line item on the cart and on the checkout sheet, above
the pay button. `lib/money.ts` is the only place the math exists.

**SMS consent.** `Customer` stores `optInStatus`, `optInAt`, `optInSource`, and
`optInText` — the exact disclosure string shown at capture, stored verbatim so
consent can be proven later. `lib/sms.ts` refuses any non-transactional send to
a customer who isn't explicitly opted in. Existing consent is never silently
downgraded by a later order.

**The holdout.** Every new customer is assigned a cohort once, at creation, at a
20% holdout rate, and it never changes. The SMS seam excludes holdout customers
from campaigns unconditionally. Without this the lift number means nothing, and
the lift number is the only thing the pilot has to prove.

**Price integrity.** `placeOrderAction` re-reads every item price from the
database and recomputes totals server-side. Client-sent amounts are ignored.

---

## Surcharge shape

Percent of subtotal, clamped between a floor and a ceiling. Defaults are 3.5%,
$1.00 min, $20.00 max:

| Ticket | Fee |
|---|---|
| $7.00 | $1.00 |
| $16.00 | $1.00 |
| $32.00 | $1.12 |
| $120.00 | $4.20 |
| $450.00 | $15.75 |
| $600.00+ | $20.00 |

Small orders stay in noise territory nobody feels; the fee only gets large where
the order can absorb it. Configurable per tenant from `/admin/restaurants`.

Tax is applied to the food subtotal only, not to the service fee.

---

## Deferred, with seams already in place

| Deferred | Seam that exists now |
|---|---|
| Stripe Connect, surcharge as application fee | `PaymentProvider` in `lib/payments.ts` |
| Twilio + the three-campaign SMS engine | `SmsProvider` + `queueMessage` in `lib/sms.ts` |
| A2P 10DLC registration | Consent fields on `Customer` |
| Treatment/holdout lift experiment | `Customer.cohort`, enforced at the SMS seam |
| Custom domains per tenant | Path-based `/r/[slug]` today |
| Direct image upload | Image URLs today |
| POS integration | Orders land on the owner dashboard — deliberately dumb |

Swapping in a real provider is a one-line change in `setPaymentProvider` /
`setSmsProvider`. No callers change.

---

## Project layout

```
prisma/
  schema.prisma          multi-tenant data model
  migrations/0_init/     initial SQL
  seed.ts                demo tenant + logins
src/
  middleware.ts          route guards for /admin and /dashboard
  lib/
    money.ts             surcharge + totals — single source of truth
    payments.ts          PaymentProvider interface + stub
    sms.ts               SmsProvider + opt-in and holdout enforcement
    auth.ts              sessions, requireAdmin, requireOwner
    consent.ts           the exact opt-in disclosure text
  app/
    login/               sign-in
    admin/               platform surface
    dashboard/           owner surface
    r/[slug]/            customer PWA + manifest + placeOrderAction
  components/
    hearth/ui.tsx        dark operator kit
    customer/            themed customer shell
```

---

## Verification status

Typecheck (`npx tsc --noEmit`) and production build (`next build`, 12 routes)
both pass. Surcharge math and phone normalization are smoke-tested.

**Database round-trips have not been executed** — no Postgres was available in
the environment where this was built. After your first deploy, run the seed and
place one test order end to end before pointing a pilot restaurant at it.

---

## What the pilot has to prove

Two numbers, and only two.

1. **Net account-level lift.** Treatment group vs. holdout, reorder rate. The
   gap is the business. No gap means stop before scaling to paid accounts.
2. **Support hours per account per week**, and whether it trends up or down as
   accounts are added.

Every argument in the pitch holds if the first number is real and is hollow if
it isn't.

## Owner signup & onboarding

Two ways a tenant comes into existence now:

- **Admin-created** (`/admin/restaurants`) — created `ACTIVE` and fully onboarded, as before.
- **Self-serve** (`/signup`) — the owner creates their own account. The restaurant is created
  `PENDING`, which means `/r/[slug]` is reachable but not orderable until they launch.

`/signup` collects restaurant name, desired ordering-page slug, owner name, email and password.
It can only ever create an `OWNER`; there is no path to `ADMIN`. Slug collisions are auto-suffixed
when the slug was derived from the name, and rejected when the owner typed one explicitly.

### The wizard — `/onboarding`

Four steps, tracked on `Restaurant.onboardingStep` (highest step completed):

1. **Your restaurant** — name, tagline, pickup address, city, phone, hours. Address and phone are
   required; a customer can't pick up an order without them.
2. **Look and feel** — accent color, logo URL, hero URL, with a live preview strip.
3. **First menu items** — at least one item before continuing.
4. **Go live** — review, plus a plain-language summary of the disclosed customer surcharge, then
   `Launch`, which flips the tenant to `ACTIVE` and stamps `onboardedAt`.

Owners can step back to any completed step but can't skip ahead. Once `onboardedAt` is set the
wizard redirects to `/dashboard` and is not re-enterable.

Guards: `middleware.ts` requires a session for `/onboarding` and bounces admins to `/admin`; the
dashboard layout redirects owners with no `onboardedAt` into the wizard (admins impersonating a
pending tenant are let through).

### Migration

`prisma/migrations/1_onboarding` adds the `PENDING` enum value plus `onboardingStep` and
`onboardedAt`, and backfills existing restaurants as already-onboarded so nothing in flight breaks.

### Migrations on Railway

`npm start` runs `scripts/migrate.mjs` rather than `prisma migrate deploy` directly. The script
first clears any migration row left unfinished (Prisma's P3009 state — the same thing
`prisma migrate resolve --rolled-back <name>` does), then deploys. Railway gives you no natural
place to run a one-off resolve, and a stuck row otherwise blocks every future deploy forever.

This is safe only because every migration here is idempotent (`IF NOT EXISTS`, guarded `UPDATE`).
Keep it that way when you add new ones.


## Images

Uploads go through `POST /api/upload` (session-guarded, tenant-scoped) and are
served back from `GET /api/media/<key>` with an immutable cache header.

Storage sits behind `StorageProvider` in `src/lib/storage.ts`, matching the
`PaymentProvider` / `SmsProvider` pattern. The V1 driver writes to disk:

- **Local dev** — files land in `./.media` (gitignored). No setup.
- **Railway** — attach a volume mounted at `/data` and set `MEDIA_DIR=/data/media`.
  `railway.json` already declares the mount point.

Cropping, resizing and compression all happen in the browser
(`src/lib/image-client.ts`) before upload, so a 6 MB phone photo arrives as a
~200 KB WebP. The server re-checks size and magic bytes but needs no image
library — there is no `sharp` dependency.

Every upload gets a `MediaAsset` row. Replacing a photo does not delete the old
file; the sweeper marks it orphaned and removes it after a 7-day grace period:

```bash
npm run media:gc          # dry run
npm run media:gc -- --yes # apply
```

Slot specs live in `src/lib/media.ts` (`KIND_SPEC`) — one place to change
aspect ratios or size limits.
