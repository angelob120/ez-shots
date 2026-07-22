# Context for Claude

Read this first. It covers what the project is, the rules that aren't obvious
from the code, and what's currently half-finished.

Product docs live in `README.md`. This file is orientation for working on it.

**Working plans live in `docs/`, and you keep them current.** Two are active:

| Plan | Covers |
|---|---|
| `docs/admin-roadmap.md` | The admin console — domains, links, permissions, support, refund troubleshooting. **Read before touching `src/app/admin/`.** |
| `docs/post-order-gaps.md` | The post-order system. Mostly done; the remainder is listed there. |
| `docs/analytics.md` | Storefront analytics — the event pipeline and both reporting surfaces. **Read before touching `src/lib/analytics*.ts` or either analytics page.** |
| `docs/theming.md` | The operator light/dark theme. **Read before touching `src/lib/theme.ts`, the `--h-*` tokens, or the palette in `tailwind.config.ts`.** |
| `docs/onboarding.md` | The owner setup wizard and the completion gate. **Read before touching `src/lib/onboarding.ts` or `src/app/onboarding/`.** |
| `docs/storefront-customization.md` | Storefront theme presets and the live editor. **Read before touching `src/lib/store-theme.ts`, `src/lib/store-preview.ts`, `StorefrontEditor.tsx`, or the `.store[data-preset]` blocks.** |
| `docs/customer-import.md` | The customer database — import, search, filters, tags, segments, notes. **Read before touching `src/lib/customer-import.ts` or `src/lib/customers.ts`.** |
| `docs/legal-pages.md` | Terms, privacy, refunds, messaging and the rest. **Read before touching `src/lib/legal*.ts` or `src/content/legal/`.** |
| `docs/menu-link-import.md` | Importing a menu from a DoorDash/Uber Eats/Toast link. **Read before touching `src/lib/menu-scrape.ts` or `src/lib/menu-fetch.ts`.** |
| `docs/oauth.md` | Sign in with Google and Apple, for operators and for diners. **Read before touching `src/lib/oauth*.ts` or `src/app/api/auth/`.** |
| `docs/plans.md` | Pricing plans — choosing, swapping, and paying for one. **Read before touching `src/lib/plans.ts`, `src/lib/billing.ts`, or the charge math.** |
| `docs/marketing.md` | Owner-composed SMS and email campaigns. **Read before touching `src/lib/campaigns.ts`, `src/lib/campaign-format.ts`, `src/lib/email*.ts`, or `src/app/dashboard/marketing/`.** |
| `docs/automations.md` | The visual journey builder and its templates. **Read before touching `src/lib/automation*.ts`, `src/app/dashboard/marketing/automations/`, or `src/app/admin/templates/`.** |
| `docs/booking.md` | The booking calendar — onboarding calls and intro calls. **Read before touching `src/lib/booking-slots.ts`, `src/lib/bookings.ts`, or `src/app/(site)/book/`.** |
| `docs/reorder-dfy.md` | Done-for-you reordering — the one onboarding question, the Light/Medium/Heavy dial, and how it enrolls. **Read before touching `src/lib/reorder.ts`, the reordering onboarding step, or reordering enrollment.** |
| `docs/mvp-hidden-features.md` | Three finished features switched off for v1, and exactly how to switch each back on. **Read before concluding OAuth, customer accounts, or the FLAT/HYBRID plans are missing or broken.** |
| `docs/help-center.md` | Owner help articles and the search over them. **Read before touching `src/lib/help-articles.ts` or `src/app/dashboard/support/help/`.** |
| `docs/notifications.md` | The admin notifications centre — inbox, per-kind preferences, broadcasts, reminders, and the alert pipeline. **Read before touching `src/lib/notifications.ts`, `src/lib/notification-format.ts`, or `src/app/admin/notifications/`.** |

`docs/SETUP-your-turn.md` is not a plan — it is the running list of things only
a human with credentials can do, in the order that unblocks the most. Check it
before assuming a feature is broken.

Read the relevant one before starting, and **update it when you finish** — mark
the item done in place, say what actually landed, and record anything the next
session would otherwise rediscover the hard way. This file is the only channel
between sessions; the reasoning behind a decision is lost the moment the session
that made it ends.

---

## What this is

**EZ Orders** (package name `hearth`) — multi-tenant pickup ordering for
independent restaurants. Next.js 14 App Router, Prisma + Postgres, deployed on
Railway.

The ordering flow is not the product. It's the capture point: a customer orders
through a per-tenant PWA and hands over a phone number and messaging consent on
the way through. The asset being built is the restaurant's owned customer list.
Revenue is a per-order surcharge on the **customer's** bill, never the owner's.

Three surfaces:

| Route | Who | Notes |
|---|---|---|
| `/r/[slug]` | Customers | The PWA storefront. Own design tokens (`s-*`), not the dashboard's. |
| `/o/[token]` | Customers | Order status page. No login — the token is the auth. |
| `/dashboard` | Owners | Order board, menu, hours, branding, analytics. Tailwind + `components/hearth/ui`. |
| `/admin` | Us | Tenant management, impersonation, support-hours logging, platform analytics. |

---

## Rules that will bite you

**Tenant isolation.** Every owner query filters by the `restaurantId` returned
from `requireOwner()`. Nothing accepts a `restaurantId` from the client. This is
the only thing standing between tenants.

**Orders have one door.** `src/lib/orders.ts` is the only module that writes
`Order.status`. It enforces a state machine (`canTransition`), appends an
`OrderEvent` for every change, and clamps refunds. Do not update `status`,
`refundedCts`, or `fulfilledQty` directly from a route — go through
`transitionOrder` / `cancelOrder` / `issueRefund` / `markItemsUnavailable`.
The invariants only hold because there's one entry point.

**Availability has one door too.** `src/lib/hours.ts` decides whether ordering is
open. `Restaurant.hours` is a free-text string for display and is never consulted
for decisions — `hoursJson` is. Every judgement is made in the restaurant's own
timezone. A tenant with no configured schedule **fails open** and keeps trading;
failing closed would silently switch off every restaurant that never touched the
setting.

**Money is integer cents, everywhere.** All arithmetic lives in `src/lib/money.ts`
(totals, surcharge) and `src/lib/orders.ts` (refunds). The surcharge is the
business model — it's computed in one place and always rendered as its own
disclosed line.

**Migrations must be idempotent.** `scripts/migrate.mjs` clears failed migration
rows and re-runs `migrate deploy` on every boot, so every migration has to be
safe to apply twice. Use `IF NOT EXISTS` and `DO $$ ... EXCEPTION WHEN
duplicate_object $$`. See `prisma/migrations/13_post_order_support/` for the
pattern.

**Payments default to a stub, and Stripe sits behind the same seam.**
`StubPaymentProvider` returns success without charging or refunding; the mode
(`LIVE` / `TEST` / `STUB`) lives in `PlatformSetting` so admins can flip it
without a redeploy. Swaps out via `setPaymentProvider` with no caller changes.

**A non-LIVE mode is time-boxed, and the timer is enforced at the one door.**
TEST and STUB both let a customer check out, the kitchen cook, and no money
arrive — STUB worse, since Stripe has no record at all. Left on by accident that
is a restaurant giving away dinners. So leaving LIVE always sets an expiry
(`PlatformSetting.modeExpiresAt`), and `resolveModeState()` in `lib/payments.ts`
applies it — not the admin page. Every charge and refund reads through it, so a
lapsed window is over on the next order whether or not anyone is watching; the
sweep and every admin page load also trip it, which covers a quiet platform.

**Reverting never claims LIVE it can't deliver.** `safeRevertTarget()` falls to
STUB when `STRIPE_SECRET_KEY_LIVE` is missing, because `paymentProviderForMode`
would otherwise quietly use the stub while the console says real money is
moving — relabelling the exact failure the timer exists to prevent.

**`testModeEnabled` is a separate switch, deliberately.** It shows the demo
scaffolding (signup/onboarding autofill, tenant seeding, sample CSV). Tying it
to `paymentMode` would mean exercising a real Stripe test charge also puts an
autofill button on `/signup` — a **public page** — in front of every owner who
signs up that afternoon. Client components read it via `TestModeProvider`;
`seedTestRestaurantAction` and `seedFullMenuAction` re-check it server-side,
because hiding a control is a courtesy and not enforcement.

**Charges are direct, not destination — and that is a business decision, not a
style one.** The PaymentIntent is created *on* the restaurant's connected
account via the `Stripe-Account` header, and the surcharge comes back to us as
`application_fee_amount`. This is the only shape where Stripe's processing fee
is deducted from the restaurant's balance rather than ours.

On a destination charge the platform is merchant of record and Stripe debits
*our* account for fees, refunds, and chargebacks. At a $1–2 surcharge against a
~$1.20 Stripe fee on a normal ticket, that loses money on every order — the
surcharge is the entire revenue model, so the wrong charge shape doesn't shave
the margin, it deletes it. **Do not reintroduce `transfer_data[destination]`.**

Consequences that are easy to miss:

- Every call touching a charge needs the same `Stripe-Account` scoping — create,
  the 3-D Secure re-read, and refunds. A platform-scoped call cannot see a
  charge that lives on a connected account.
- The storefront mounts Stripe.js with `{ stripeAccount }` for the same reason:
  a `pm_...` is scoped to whichever account tokenized it.
- The Stripe webhook endpoint must have **"Listen to events on connected
  accounts"** enabled, or payment status silently stops updating.
- On a refund, `refund_application_fee` decides *who funds the service fee* —
  left false, the restaurant refunds only the food and we keep our cut. That's
  what `RefundInput.includeSurcharge` maps to.

**A plan decides who pays, and a surcharge is not a commission.** `src/lib/plans.ts`
is the one place that turns `Restaurant.plan` into money. Three plans, one
product: ZERO puts a disclosed service fee on the *customer's* ticket, FLAT
($399) and HYBRID ($149 + 4%) put nothing there — HYBRID's 4% comes out of the
*restaurant's* proceeds instead.

Both a surcharge and a commission reach Stripe as `application_fee_amount` on a
direct charge, which makes them look identical at the call site and they are
economically opposite: get the first wrong and a diner is overcharged on a plan
sold on not charging them; get the second wrong and a restaurant is underpaid.
So `computeSurchargeCts` decides the customer's total, `platformFeeCts` decides
our cut, and only the second is the application fee. `ChargeInput` names the
field `applicationFeeCts` for exactly that reason.

**Read the plan through `surchargeConfigFor()`, never off `restaurant.surchargePct`** —
that column is half the answer and the plan is the other half, the same pairing
as `cardPaymentsEnabled` / `cardPaymentsAllowed()`.

**A plan change is scheduled for the billing boundary, and applied on read.**
`effectivePlan` and `dunningState` work off the clock rather than trusting the
sweep to have materialised the row — which is what keeps this correct while the
Railway cron still doesn't exist. A failed payment drops a tenant to ZERO after
14 days rather than suspending them: a restaurant that can't hand over food it
already made is a disproportionate answer to an expired card. But the
consequence is their customers suddenly seeing a fee the owner didn't choose,
which is why the grace banner names a date and counts down.

**`src/lib/billing.ts` is the only module where money moves *towards* us.**
Everywhere else a charge is created on the tenant's connected account and we
take a slice. Subscriptions are on the **platform** account, so nothing in that
file may send a `Stripe-Account` header — doing so would put the tenant's
software bill on the account their diners pay, where it bills them and is
invisible to us. `stripeCustomerId` and `stripeAccountId` are separate columns
for the same reason.

**Service suspension is ours, and owners must never be able to lift it.**
`src/lib/entitlements.ts` is the only module that reads or writes
`ServiceSuspension`, which records the platform withdrawing PAYMENTS, SMS,
EMAIL, or DELIVERY from one tenant. Two rules make it worth anything:

- The owner's own switches and ours are different things.
  `Restaurant.cardPaymentsEnabled` is a preference the owner sets;
  a PAYMENTS suspension is not. Read `cardPaymentsAllowed()`, never
  `cardPaymentsEnabled` on its own — that column is half the answer, and the
  storefront, checkout, and dashboard each need both halves. Same pairing for
  `deliveryEnabled` / `deliveryAllowed()`.
- No owner-reachable path writes that table. Every mutation goes through
  `suspendService`/`restoreService` behind `requireAdmin()`, and
  `setCardPaymentsAction` refuses to switch cards back on while suspended even
  though the UI already hides the control. A suspension the suspended party can
  undo is not a suspension.

Rows are append-only in spirit — lifting sets `liftedAt` rather than deleting,
because "when did we cut them off and why" is what answers the billing dispute
later. A partial unique index (in the migration, not the schema — Prisma can't
express it) keeps at most one live row per tenant per service.

**Generated URLs have one door.** `canonicalOrigin(restaurant)` in
`src/lib/domains.ts` decides which host a tenant's links carry: their verified
custom domain when they have one, ours otherwise. A verified domain is the
tenant's **canonical origin, not an alias** — the owner bought it so their
customers would see it, and a status link printing our host makes their receipts
advertise us. `orderUrl(token, restaurant)` requires the restaurant on purpose;
don't make it optional.

Three origins exist and they don't collapse into each other:
`canonicalOrigin(r)` for anything a customer sees, `platformOrigin()` for things
that must stay ours (Stripe return URLs, Twilio webhooks, the dashboard), and
`fallbackOrigin()` in `lib/cloudflare.ts` purely as a CNAME target. The last one
must never reach a customer.

Note `/o/[token]` is served **unrewritten** on a custom domain — there's no
`/r/[slug]/o/[token]` route and there shouldn't be, since the token already
resolves the order and its restaurant.

**An apex domain gets a `www` twin registered with it.** Routing already
tolerates www (`customDomainFromHost` strips it), but Cloudflare issues a
certificate *per hostname* — so without a second registration, a customer typing
`www.theirplace.com` gets a browser security warning on the restaurant's own
domain, which is worse than them never having bought one. `domainVariants()`
decides; subdomains get no twin, because nobody types
`www.order.theirplace.com` and each registration is billable. The www hostname
never gates `domainVerifiedAt` — a serving apex shouldn't wait on a convenience
host still issuing a cert.

**Invites have one door, and the token is never stored.** `src/lib/invites.ts`
provisions owner logins. The token is 160 bits, we keep only its SHA-256, and
the raw value is returned exactly once at creation — so a database backup holds
no usable invites and the UI's "generate a new one" is the only recovery. No
`User` row exists until redemption; redemption is single-use via an optimistic
lock wrapped in a transaction with the user creation, because a consumed invite
with no account behind it strands the recipient. **Never add a second path that
creates an owner login with a password somebody typed.**

**Sign-in with Google or Apple can never create an operator account.** This
is the invite rule above, restated for the door most likely to breach it.
`staffLinkDecision` in `src/lib/oauth.ts` is where it is decided and the only
place it may be decided: an unknown verified identity is a *failed login with a
helpful message*, never a signup. It is pure so every branch is tested, because
every branch that returns `allow` is a way into an owner's dashboard. If you
find yourself adding a code path that ends in `setSession`, it belongs in that
function.

Two consequences that look like details:

- **First-time linking requires a *verified* email.** An unverified claim is a
  string the user typed into a profile, and honouring one means anybody who
  sets their provider email to an owner's address gets that owner's tenant.
- **After the first link the email is irrelevant** — the provider's `subject` is
  the identity. People change the address on a Google account and it is still
  the same account.

**A customer account is not a `Customer`, and is not consent.** `CustomerAccount`
is a storefront login scoped to **one** tenant, with its own cookie
(`hearth_customer`, see `src/lib/customer-session.ts`) that no dashboard guard
ever reads. `customerId` stays null until a phone number arrives at checkout,
because `Customer.phone` is the dedupe key for the tenant's list and an email
address cannot stand in for it. Signing in with Apple grants a view of past
orders and nothing else; `lib/sms.ts` still reads `optInStatus` and nothing
else. Two tables rather than one nullable-owner identity table, for the same
reason as `SupportNote`/`SupportMessage`.

**A scraped menu is a proposal, never a write.** `src/lib/menu-scrape.ts` is
pure and produces *candidates*; nothing reaches the database until an owner has
seen them in the review table and pressed Import. Two of the judgements it
makes cannot be made reliably by a machine — cents versus dollars (`1200` is
$12.00 or $1,200.00 and the document does not say which), and whether an
item-shaped object is a dish or a modifier option — so the review step is the
feature rather than a confirmation dialog. Both the link importer and the CSV
upload commit through `importMenuRows`, the one committer. The scale is decided
for the **whole menu at once**, deliberately: a menu where half the prices are
100x the others is much harder to spot than one that is uniformly wrong.

`src/lib/menu-fetch.ts` is the only module that fetches a page on an owner's
behalf, and it is the SSRF fence — public addresses only, re-resolved on every
redirect hop, byte cap enforced while streaming, wall-clock timeout. None of
those limits are reachable from a request. The paste-the-page fallback is a
first-class path, not a consolation prize: these platforms block datacentre
traffic routinely, and pasting involves no request from us at all.

**Policy pages are data, and there is one list of them.** `src/lib/legal.ts`
holds the registry; `src/content/legal/*.ts` hold the documents as structured
sections rather than JSX, so a policy can be rendered, exported to plain text
for a dispute, and — most importantly — cannot exist while being linked from
nowhere. `legal-base.ts` is split out because the registry imports every
document and every document needs `COMPANY`; merging them back produces a
temporal-dead-zone crash on every policy page. `LEGAL_REVIEW_REQUIRED` puts a
draft banner on all of them and is deliberately awkward to remove.

**Domain operations have one door too.** `src/lib/domain-ops.ts` owns
`saveDomain` / `recheckDomain` / `clearDomain` / `domainView`. Owner routes and
admin routes are thin wrappers that supply the auth scope — `requireOwner()`
scoped to their tenant, `requireAdmin()` unscoped. Two copies of "is this domain
live" is how the console reports Verified while the owner's page reports
Pending. Note "verified with us" and "active at the edge" are genuinely
different failures with the same symptom; both are shown.

**SMS has one door, and consent is enforced there.** `src/lib/sms.ts` is the
only module that sends. Every message passes `queueMessage`, which resolves the
destination, applies the consent rules and writes a `Message` row either way —
`SKIPPED` with a reason when it declines. Do not call a provider directly; the
rules are only rules because there is one place to enforce them.

A customer who replied STOP is blocked for **every** kind, transactional
included. That is not a marketing preference — a sender that ignores STOP gets
carrier-filtered, and it takes the tenant's whole list down with it.

**Email has its own door, and email consent is opt-out where SMS is opt-in.**
`src/lib/email.ts` is the only module that sends email, and it mirrors
`lib/sms.ts` deliberately — one door, consent enforced at it, a `Message` row
written either way. What it does **not** mirror is the consent model, and that
asymmetry is the thing most likely to be "tidied up" into either a useless
feature or an illegal one:

- **SMS is opt-in.** `optInStatus` starts UNKNOWN, only checkout may move it,
  and a STOP blocks every kind including transactional — because a sender that
  ignores STOP gets carrier-filtered and the tenant's order notifications go
  down with it.
- **Email is opt-out.** A single `Customer.emailOptOutAt` timestamp; null means
  "may be emailed". CAN-SPAM requires honest headers, a physical postal address
  and a working unsubscribe honoured promptly — not prior consent. A restaurant
  emailing its own list is the ordinary legal case, and requiring an opt-in
  nobody ever collected would make the channel useless for exactly the tenants
  with the biggest lists.

Unifying them is wrong in both directions. Note also that an email unsubscribe
deliberately does not touch `optInStatus`: killing someone's order-ready texts
because they didn't want a newsletter is worse than the thing they asked to
avoid. `SendGridEmailProvider` sits behind the seam, off unless
`EMAIL_PROVIDER=sendgrid`.

**Campaigns are the audience-builder's send button, and the consent gate is
still the gate.** `src/lib/campaigns.ts` owns owner-composed marketing. A
recipient is a `Message` row with a `campaignId` — there is no
`CampaignRecipient` table, because a parallel recipient table is a second
sending path and a second sending path is a second place for the consent rules
to be almost right. The audience decides who is *considered*; `lib/sms.ts` and
`lib/email.ts` decide who is *contacted*. A campaign aimed at 400 people
routinely reaches 90, and the results page explains each skipped person in a
sentence rather than hiding the gap. Do not close it by loosening the gate.

**An automation is a standing instruction, and it still doesn't send.**
`src/lib/automations.ts` runs owner-drawn journeys — when this happens to a
customer, wait, check something, then message them. Every SEND block ends in
`queueMessage` or `queueEmail`, which re-run the consent gate at the instant of
the send. That indirection matters more here than for campaigns and the
difference is elapsed time: a campaign is composed and sent the same afternoon
by someone who just looked at their audience, where an automation queues a
message *weeks* after the owner drew the box — long after a STOP may have
arrived. There is no version of "check consent when the automation is saved"
that is correct.

Three more that are easy to undo:

- **An enrollment runs the graph version it entered on.** `AutomationVersion`
  snapshots the whole graph and `Enrollment.versionId` pins it. Everyone
  jumping to the newest graph sounds tidier and is incoherent — a customer
  sitting at node 7 of a graph whose node 7 no longer exists has to go
  somewhere, and every answer is wrong.
- **The re-entry guard is a partial unique index**, in migration 31 rather than
  the schema, on `(automationId, customerId) WHERE status IN ('ACTIVE','WAITING')`.
  `enroll`'s check is the courtesy that produces a readable message; the index
  is what survives two order events a second apart. It has to stay *partial*,
  or somebody who finished a journey in March can never enter it again.
- **Quiet hours are enforced at the send, in the restaurant's timezone.** A
  campaign goes out when a human presses a button, so a human is implicitly
  vetting the hour; an automation's wait can land at 3am, which is a TCPA
  problem and a complaint generator. Deferred, never dropped.

The pure half — node vocabulary, validator, condition evaluation, quiet-hours
arithmetic, split assignment — is `src/lib/automation-flow.ts`, with no
`server-only`, because the canvas imports it in the browser to flag a broken
graph as it is drawn. **The canvas is hand-rolled** (no `react-flow`): it
renders and drags, and every *decision* about the graph comes from the pure
module, so the picture and the runtime cannot disagree.

**Templates are ours and adoption is theirs.** `src/lib/automation-templates.ts`
answers "I fixed a typo in a template forty restaurants are running — what
happens to them", and it has three answers set per template: `ALWAYS` (they all
move, and the copy is read-only), `AUTO_UNLESS_CUSTOMIZED` (the default;
untouched copies move, edited ones forked and told), `OPT_IN` (nobody moves
without pressing a button). Under every policy a sync **never touches an
in-flight enrollment** and **never activates anything** — an owner who paused a
journey has made a decision, and overriding it is us sending messages from an
account whose owner switched them off. Adoption lands as a **draft**, because a
journey that starts texting the moment somebody clicks "Use this" is one nobody
read first. See `docs/automations.md`.

Sending is queued and drained in bounded batches by the sweep — a 2,000-person
list is 2,000 provider calls and a server action does not have minutes — so
**it is inert until the Railway cron exists**, same as everything else in that
queue. The pure half (status machine, segment arithmetic, merge fields,
validator) lives in `src/lib/campaign-format.ts` with no `server-only`, because
the composer imports it in the browser to show the SMS segment count as the
owner types. An SMS cost revealed after sending is not a cost anybody can act
on. See `docs/marketing.md`.

`TwilioSmsProvider` exists and is off by default. `SMS_PROVIDER=twilio` plus
`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` turns it on; anything else gets the
stub, which writes a `Message` row and sends nothing. **Sending is still gated
on A2P 10DLC registration**, which is paperwork with a weeks-long lead time, so
in practice every "we'll text you" is still false in production.

**The booking calendar fails closed, where hours fails open.** `src/lib/booking-slots.ts`
is pure and decides which times exist; `src/lib/bookings.ts` is the one door
that writes a `Booking`. The slot engine shares `WeeklyHours` and its parser
with `lib/hours.ts`, which makes the *opposite* defaults look like an
oversight: a restaurant with no schedule keeps trading, a calendar with no
availability offers nothing. Unifying them means a stranger booking 4am on a
Sunday and nobody turning up.

Three more that are easy to undo:

- **A call never blocks launch.** `lib/onboarding.ts` does not know bookings
  exist, deliberately. Every other required step is something an owner can
  finish alone at 11pm; a call needs us, and gating a restaurant's opening on
  our calendar puts the cost of the gate on the wrong person. The dashboard
  banner nags until a call is **attended** — not until one is booked, because a
  no-show has onboarded nobody.
- **The double-book race is closed by the database.** The partial unique index
  on `(typeId, startsAt) WHERE status = 'SCHEDULED'` in migration 30 is the
  enforcement; `isSlotBookable` is the courtesy that produces a good error
  message. Don't drop the index because the check looks sufficient — that read
  is stale the moment it returns, same as everything in `lib/orders.ts`. It has
  to stay *partial*, or one cancellation burns that slot forever.
- **`restaurantId` comes from the session, never the form.** The booking page
  is public and unauthenticated by design. The hidden field exists so the
  markup matches in both places and is ignored server-side; honouring it would
  attach a stranger's name, email and phone to another owner's dashboard.

**Simulated data has one door and one marker.** `src/lib/simulator.ts` is the
only module that invents customers and orders, and `wipeSimulatedData` is its
exact inverse. Every simulated customer's phone is in the unroutable `+1555017`
block and every simulated order carries `paymentProvider: "sim"` — those two
markers are the *only* thing that makes a wipe safe to run against a tenant that
also has real trade, so a generator that forgets to stamp one leaves rows nobody
can ever clean up. The phone block is not cosmetic either: the paths being
exercised are the ones that send things, and 555-01xx cannot reach a handset
even if `SMS_PROVIDER=twilio` gets set by accident.

The simulator uses the real doors for everything except creation — seeding
writes `status` directly because creating an order *in* a status is a create,
not a transition, but every subsequent move goes through `lib/orders.ts`. A
simulator that bypassed the state machine would be testing a system nobody
ships. The single exception is the injected failed refund, which writes a
`Refund` row directly because the stub provider cannot be asked to fail; it
leaves `refundedCts` at zero, exactly as `issueRefund` does on a failure.

**Analytics has two doors, and the client never names the tenant.**
`src/lib/analytics.ts` is the only module that writes `Visit` or `VisitEvent`;
`src/lib/analytics-query.ts` is the only one that reads them. The beacon at
`/api/track` is public and unauthenticated — the thing it measures is a stranger
browsing a menu — so it carries a **slug**, resolved server-side through
`tenantWhere`. Accepting a `restaurantId` there would let anyone write rows into
any tenant's numbers.

Three consequences that look like details and aren't:

- **There is no `meta` JSON bag, deliberately.** Events carry fixed typed
  columns plus a `label` only two kinds may populate. An open JSON field on a
  public endpoint is how a phone number ends up in an analytics table, and once
  it's there it's in every backup. Don't add one for debugging.
- **`Visit.converted` is written in exactly one place** — `attachOrderToVisit`,
  after `placeOrderAction` commits. Deriving it from an `ORDER_PLACED` event
  would make every tenant's conversion rate a number the beacon can inflate.
- **`anonId` is not a fingerprint.** Random, browser-minted, per tenant, never
  joined to `Customer`. It separates "one person, four visits" from "four
  people" and does nothing else.

Simulated visits carry `Visit.simulated` — the same contract as the `+1555017`
phone block and `paymentProvider: "sim"`, and the only thing that makes
`wipeSimulatedAnalytics` safe against a tenant with real trade. Analytics is
excluded from it by default everywhere it's read.

Dwell time and timestamps are clamped **at write** (`MAX_DWELL_MS`), and date
ranges are half-open and reckoned in the restaurant's own timezone, exactly as
`lib/hours.ts` does. See `docs/analytics.md` for the reasoning on each.

**Support has one door, and internal notes are a different table.**
`src/lib/support.ts` owns tickets, contact enquiries, and every status change on
either. Status moves through `canTransition` and the timestamps that hang off a
status are written by the same call, so a resolved ticket with no resolution
time can't exist. Every mover takes the optimistic lock.

The rule worth stating loudest: **`SupportMessage` is the shared thread and
`SupportNote` is ours, and they are separate tables rather than one table with
an `internal` flag.** A visibility boolean puts a candid note one forgotten
`where` clause away from the restaurant reading it, and that clause would have
to be correct in every query written from now on. Two tables make the mistake
unavailable rather than discouraged. Nothing under `src/app/dashboard/` may
select from `SupportNote`.

`ContactSubmission` is likewise not a ticket with a null tenant. It's the only
unauthenticated writer in the product, so it carries its own throttle, its own
honeypot, and the rule that nothing in it names a tenant —
`matchedRestaurantId` is a hint for whoever reads it, has no foreign key, and is
never an auth decision, because that email address was never verified.

**An import can never grant messaging consent.** `src/lib/customer-import.ts`
is the only module that ingests a customer list, and every row it writes lands
as `optInStatus: UNKNOWN`. There is no column, flag or checkbox that changes
that, and adding one is not a small change. Consent has to be *provable* — who
agreed, to what wording, when — which is why `Customer` carries `optInAt`,
`optInSource` and `optInText` rather than a boolean, and a spreadsheet supplies
none of it. The cost of getting this wrong isn't a fine, it's the tenant's
sending number: a cold list produces spam reports, carriers filter the number,
and every legitimate order notification stops arriving. Only checkout writes
consent. See `docs/customer-import.md`.

**A tag, a segment and a filter are not consent either, and that's the same
rule.** `src/lib/customers.ts` owns querying, filtering, tagging and segments
for both the owner's list and the admin's. The audience-builder is where the
consent rule is most tempting to break — tag a group, text the group — so state
it again: `lib/sms.ts` reads `optInStatus` and `optOutAt` and nothing else, and
no output of `customers.ts` may ever become an input to a send decision.

Three structural rules there:

- **Tenant scoping is an explicit parameter with no default.** `restaurantId:
  string | null`, where null means cross-tenant and is only reachable behind
  `requireAdmin()`. A new caller has to say which it is.
- **Filters compose into an `AND` array, never a spread.** Two filters can
  constrain the same column, and a spread lets the second silently overwrite
  the first — which answers a different question rather than returning nothing.
- **`CustomerAdminNote` is ours and `CustomerNote` is the tenant's, in two
  tables.** Exactly the `SupportNote`/`SupportMessage` split and for the same
  reason. Nothing under `src/app/dashboard/` may select from `CustomerAdminNote`.
  Admins are read-only on everything else about a customer: an admin editing an
  opt-in status destroys the audit trail `lib/sms.ts` depends on, invisibly to
  the tenant.

**An import is undoable, and `Customer.importJobId` is the marker that makes it
safe.** Written only on create, never on a merge — so "rows this file invented"
is an exact set, the same contract the simulator's `+1555017` block carries.
Undo deletes only those rows and only where `orderCount` is 0, re-checked in
the `deleteMany` rather than trusted from the read. Anyone who has ordered
since is kept: deleting them would take an `Order.customerId` with it and put a
hole in the tenant's own history.

**Onboarding is a gate before launch and a nag after it, and the asymmetry is
deliberate.** `src/lib/onboarding.ts` decides whether a tenant may open —
basics, menu and hours are required; branding is skippable. It's pure, so it's
tested without a database. But `gateFor` only returns `blocked` when
`onboardedAt` is null: `/dashboard` is the live order board, and blocking an
established restaurant mid-service to demand a form would stop them handing
paid-for food to customers at the counter. A launched tenant that clears its
hours gets a banner, never a redirect. Don't "fix" that inconsistency. Note it
overlaps `lib/readiness.ts` and deliberately disagrees with it about hours;
both files carry a note saying so. See `docs/onboarding.md`.

**A storefront theme preset moves the surface, never the skeleton.** Every
tenant's website is one structure wearing one of five presets
(`src/lib/store-theme.ts`). A preset changes the neutral palette, the corner
radius and the display weight — not spacing, not section order, not which
sections exist. The fastest way to hand an owner a broken storefront is to let
them move the parts holding the page together.

The token *values* live in the `.store[data-preset="…"]` blocks in
`globals.css`, not in the module, and that is not organisational tidiness. An
inline `style` beats any stylesheet rule including one in a media query, and
SYSTEM — the default — follows the device through `prefers-color-scheme`. A
preset emitting `--s-bg` inline would pin every SYSTEM tenant to their light
palette forever, on a phone in dark mode, with nothing in the code looking
wrong. The accent is the one exception and *must* be inline: per tenant, from
the database, not enumerable in CSS. `scripts/store-theme.test.ts` parses the
real stylesheet and fails on a missing block, a missing dark twin, a lying
picker swatch, or a token under WCAG AA — it found `--s-mute` live at 3.07:1.

Mount a store root through `storeRootProps()`, never by hand: four pages do it,
and before it existed the account page set the accent and forgot the theme
attribute entirely. `themePreset` is a String, not an enum, so an unknown value
coerces to Classic — the storefront must never be the thing that discovers a
preset went away. See `docs/storefront-customization.md`.

**The branding preview is the real storefront, and it stores nothing.** The
editor frames `/r/[slug]?preview=1` and posts unsaved edits in over
`postMessage`; a mock storefront inside the editor would be a second
implementation of "what the site looks like", which drifts, and the first
anyone hears of it is an owner saying the preview lied. A draft lives in the
iframe's React state and dies with the tab, so there is no preview token to
leak a half-finished redesign to a customer.

Four guards, and none of them is redundant: the listener only mounts under
`?preview=1`; messages must be same-origin (the editor always frames
`platformOrigin()`, never the tenant's domain, precisely so this stays an
equality check); the merge takes an explicit allowlist rather than
`Partial<RestaurantDTO>`, which also carries surcharge rates and the Stripe
publishable key; and the bypass that lets a **PENDING** tenant preview during
onboarding is gated server-side on session ownership, or seven characters would
expose a suspended tenant's menu.

Preview also switches off analytics and checkout. An owner redecorating is not
a visit — left on, fifteen minutes in the editor wrecks the conversion rate on
their own analytics page — and checkout is the one control there that takes a
real card and puts a real ticket on their board.

**The operator theme and the storefront theme are different things.**
`hearth_theme` (a cookie, via `src/lib/theme.ts`) is a display preference
belonging to whoever is at the keyboard. `Restaurant.theme` is the owner's
branding decision about what their *customers* see on `/r/[slug]`. An owner
switching their order board to light has not chosen anything about their
storefront. Do not unify them.

The operator palette is `--h-*` CSS variables consumed through Tailwind as
`rgb(var(--h-x) / <alpha-value>)`. **New colour tokens go in both the light
and dark blocks in `globals.css`** — a token defined in one renders as an
empty `var()` in the other, which is transparent, which is text that vanishes
on exactly one theme. `scripts/theme.test.ts` parses the real stylesheet and
enforces both that and WCAG AA contrast; it is the reason two live dark-mode
contrast failures got found. See `docs/theming.md`.

**Three finished features are switched off, and none of them was deleted.**
`src/lib/features.ts` holds compile-time constants hiding Google/Apple sign-in,
customer accounts, and the FLAT and HYBRID plans for the MVP. Before deciding
one of them is missing, broken, or worth rebuilding, read
`docs/mvp-hidden-features.md` — the code, the tests and the schema are all
still here and restoring is a `false → true` plus a checklist.

Two rules make that safe and both are easy to undo:

- **Each flag is enforced at a choke point**, one function every surface
  already calls, rather than sprinkled through the pages. `providerConfigured`
  and `providerButtons` for OAuth, `getCustomerSession` for accounts,
  `VISIBLE_PLANS` for plans. That is what keeps re-enabling to one line, and
  what stops a half-hidden feature: a page nobody remembered to gate still goes
  through the same function. **If you add a surface for a hidden feature, route
  it through the choke point rather than reading the flag directly.**
- **Hiding is a display change and never a billing or security one.**
  `VISIBLE_PLANS` decides what a picker draws; `PLAN_SPECS`,
  `surchargeConfigFor` and `effectivePlan` still know all three plans and must,
  or a tenant already on FLAT starts charging their diners a service fee the
  pricing page promised them they'd never see. Likewise `staffLinkDecision` is
  untouched: an OAuth sign-in still cannot create an operator account, and it
  must never be the buttons being hidden that enforces that.

Nothing there is per-tenant or runtime-configurable, deliberately — no env var,
no `PlatformSetting`. An env var means the answer depends on which machine you
ask. **`src/lib/features.ts` must not grow into a feature-flag system.**

**Help articles are data, and the search is the only signal they're working.**
`src/lib/help-articles.ts` is the registry behind `/dashboard/support/help`,
structured like `lib/legal.ts` and for the same reason: an agent has to be able
to paste the canonical answer into a ticket reply rather than write a worse one
from memory. Every failure mode here looks like a working page — a duplicate
slug hides an article, a search that misses looks like a product with no
refunds — and nobody ever files a ticket saying the help search is bad. They
file the ticket the article was supposed to prevent. See `docs/help-center.md`.

**Notifications have one door, and preferences are enforced there.**
`src/lib/notifications.ts` is the only module that writes a `Notification`,
sends an operator alert, or resolves a recipient's channel preference — the same
argument as `lib/sms.ts` and `lib/email.ts`, because delivery is governed by a
saved preference and a second path is a second place for it to be almost right.
A `notify()` call fans out to one row per recipient (read state is a column the
reader owns, not a join table), is best-effort and swallows its own errors, and
resolves channels through the pure `lib/notification-format.ts` so the browser
and the sender agree. `lib/orders.ts` reaches it through a **lazy** `import()`,
mirroring `fireTrigger`, so the server-only chain doesn't reach the pure order
tests. Operator alerts go out through `lib/operator-email.ts` /
`lib/operator-sms.ts` — never the customer doors — because an operator alerted
about their own platform is transactional and must never touch the consent
gate. An absent `NotificationPref` row means "catalog default"; a saved row
wins even when it mutes a channel the default turns on. See `docs/notifications.md`.

**Comments explain why, not what.** The existing codebase justifies non-obvious
decisions and trade-offs in prose. Match that. Don't narrate the code.

**Commit messages are always detailed.** Never commit with a bare one-liner.
Every commit has a concise imperative subject (roughly 50 chars, no trailing
period) and a body that explains *why* the change was made and what it affects —
the same standard as the code comments above. The body should cover: the problem
or motivation, the approach taken, and anything a future reader would otherwise
rediscover the hard way (migrations that must run, invariants preserved, follow-
ups deferred). Reference the file or module touched when it isn't obvious from
the diff. Wrap the body at ~72 characters and separate it from the subject with
a blank line. A commit that only a human watching this session could understand
is a commit message that failed — this file is the only channel between
sessions, and so is the git log.

Example shape:

```
Add operator login history and admin activity view

Records every operator sign-in (LoginEvent) and authenticated page
load (ActivityEvent) through one door, lib/activity.ts, wired into the
four session doors and the requireAdmin/requireOwner guards. Adds an
admin-only /admin/activity page plus per-user and per-tenant views.

Migration 35_login_history must run on a real machine (npx prisma
generate && npm run db:push) before anything is recorded — until then
the writes swallow the "table missing" error and the pages stay empty.
```

---

## Environment gotchas

**`npx prisma generate` fails in the Claude sandbox** — `binaries.prisma.sh`
returns 403. The generated client in `node_modules/.prisma/client` is therefore
stale and missing anything added recently.

Consequence: **`npx tsc --noEmit` reports ~200 errors that are not real.** They
look like `has no exported member 'OrderStatus'`, `implicitly has an 'any' type`,
`Property 'x' does not exist on type '{}'`, or — since the analytics query layer
introduced the repo's first raw SQL — `Property 'sql' / 'raw' / 'empty' does not
exist on type 'typeof Prisma'`. That last group is the same root cause: the stub
at `node_modules/.prisma/client/index.d.ts` is 4KB and exports almost nothing,
so every member of the `Prisma` namespace reads as missing. To find genuine
errors, filter:

```bash
npx tsc --noEmit 2>&1 | grep -vE "implicitly has an 'any' type|has no exported member|of type '\{\}'|on type '\{\}'|does not exist on type 'typeof Prisma'"
```

Run `npx prisma generate` on a real machine and they disappear. Don't "fix" them.
In particular, don't replace `Prisma.sql` with string concatenation to silence
it — that turns a parameterised query into an injection.

**The dangerous half of that is the errors you *don't* get.** Because the stub
exports nothing, `tsc` also cannot tell you a `select` names a column that does
not exist — it typechecks fine here and fails the Railway build, where
`prisma generate` runs for real. That has cost a red deploy already:
`Order.token` does not exist, the field is `publicToken`, and the build said so
several minutes later in a file nobody was looking at.

`npm run check:prisma-fields` (also an early step of `npm test`) closes it. It
parses `schema.prisma` and checks the top-level keys of every `select:` block
against the model. **Verify a field name against the schema before writing a
query** — the checker is a backstop, not a substitute for looking.

It is deliberately narrow: only keys whose value is a boolean literal, only at
the top level of a select, skipping every nested relation block. An earlier
version followed relations and produced twenty false positives against correct
code, which is how a check gets ignored and then deleted. It gives up early on
purpose.

**A client component importing a `server-only` module fails only in the
production build**, and it fails several minutes later in a file nobody
touched. This has cost a red deploy: `lib/orders.ts` grew an import of
`lib/automations.ts`, and `/o/[token]/OrderClient.tsx` — a client component
that wanted eight label strings — took the whole build down with it. `tsc` says
nothing; it is a bundler rule.

Two things follow. `npm run check:server-only` (the first step of `npm test`)
walks value imports from every `"use client"` file and refuses any path into a
`server-only` module — note a dynamic `import()` **is** such a path, because it
defers execution, not bundling. And the fix when it fires is to split the pure
part out, not to drop the `server-only` marker: that is why
`lib/order-labels.ts`, `lib/campaign-format.ts` and `lib/automation-flow.ts`
exist. A module the browser needs must not be able to reach a database.

**The same trap points the other way, and that one reaches production.** A
server component importing a plain **value** from a `"use client"` module
typechecks, builds green, and dies at request time:

```
Error: Could not find the module
".../FlowCanvas.tsx#TRIGGER_LABELS#FIRST_ORDER" in the React Client Manifest.
```

What crosses the boundary is not the object — it's a **client reference
proxy**, the marker the RSC serializer turns back into a component on the
browser side. For a React component that is the entire mechanism. For an
object, array, string or function it is nonsense, and `JSON.stringify` throws
when the page renders. This has already taken `/dashboard/marketing/automations`,
its detail page and `/admin/templates` down in production: `FlowCanvas.tsx` is
a client component that also exported `TRIGGER_LABELS`, and three server
components imported it to label a table cell.

`npm run check:client-values` (the second step of `npm test`) refuses any
non-component, non-type import from a client module into a server one. The
heuristic is "starts uppercase, contains a lowercase letter, no underscore" —
note `TRIGGER_LABELS` passes a naive `/^[A-Z]/`, which is exactly how the first
version of the checker waved through the import it was written to catch.

**The fix is always to move the value, never to add `"use client"` to the
page.** A value both sides need lives in a pure module and neither side owns
it — that is why `lib/order-labels.ts`, `lib/campaign-format.ts` and
`lib/automation-flow.ts` exist, and `TRIGGER_LABELS` now lives in the last of
those.

**A stale `.git/index.lock` may exist** and the sandbox can't delete it (mount
permissions). Git reads work; writes fail. Fix from a real terminal:
`rm -f .git/index.lock`.

---

## Running things

```bash
npm run dev            # Next dev server
npm test               # unit tests — see below
npm run db:push        # schema to dev database
npm run db:seed        # demo restaurant + logins
```

Tests are plain `node:assert` under `scripts/`, no framework:

- `scripts/hours.test.ts` — 22 cases. Timezones, overnight windows, last call,
  closure ranges, fail-open behaviour.
- `scripts/orders.test.ts` — 18 cases. State machine edges, refund arithmetic,
  token generation. Runs against a stubbed Prisma (`scripts/test-stubs/prisma.ts`
  + `scripts/tsconfig.test.json`) so pure logic can be tested without a database.
- `scripts/orders.concurrency.test.ts` — 32 cases. Racing refunds, double-tapped
  cancels and transitions, counter reversal. Runs against an in-memory Prisma
  double (`scripts/test-stubs/prisma-memory.ts` + `tsconfig.concurrency.json`)
  whose `updateMany` is atomic, which is the one property the optimistic locks
  in `lib/orders.ts` depend on.
- `scripts/sms.test.ts` — 26 cases. Consent gates, destination resolution,
  failure recording, opt-out bookkeeping, webhook signature verification, and
  the SMS service-suspension gate. Runs
  against `scripts/test-stubs/prisma-sms.ts` + `tsconfig.sms.json`, which unlike
  the concurrency config does *not* alias `@/lib/sms` — these test that module
  rather than mocking it out.
- `scripts/entitlements.test.ts` — 13 cases. The two-switch rule (owner's
  preference vs our suspension), isolation between services and tenants,
  idempotent suspend, and restore. Reuses `prisma-sms.ts` + `tsconfig.sms.json`,
  which already carries the suspension table.

- `scripts/simulator.test.ts` — 27 cases. The pure half of the order simulator:
  the cleanup marker (a predicate that mistakes a real number for a simulated
  one is a wipe that deletes a tenant's customer list), determinism under a
  seed, profile weighting, and timestamp/event coherence — including that no
  generated timeline walks an edge `canTransition` forbids. Pure, no Prisma.

- `scripts/domains.test.ts` — 14 cases. The canonical-origin resolver: a
  verified custom domain wins, an unverified one doesn't, env precedence for the
  platform fallback, and that the Cloudflare fallback origin never leaks into a
  customer-facing URL. Pure, no Prisma.

- `scripts/invites.test.ts` — 25 cases. The security properties of invite links:
  the token is never stored, redemption is single-use (including under a
  simulated race), expiry and revocation are enforced at redemption rather than
  only in the UI, and a failure partway through rolls the claim back. Runs
  against `test-stubs/prisma-invites.ts` + `tsconfig.invites.json`, whose
  `$transaction` really does roll back and really does serialize — a stub that
  can't fail can't test the case that matters.
- `scripts/readiness.test.ts` — 14 cases. The blocking/advisory split in
  `lib/readiness.ts`. Pure; `attentionList()` queries four tables and is not
  covered.
- `scripts/payment-mode.test.ts` — 18 cases. The auto-revert timer: expiry is
  applied at `resolveModeState` rather than on a page, LIVE is never subject to
  a stale timer, reverting without a live key lands on STUB, and a failed
  write-back still returns the corrected mode. Runs against
  `test-stubs/prisma-settings.ts` + `tsconfig.settings.json`. It logs loudly —
  that's the module doing its job, not test noise.

- `scripts/analytics.test.ts` — 62 cases. The pure half of storefront
  analytics: timezone-correct date ranges and buckets (including both DST
  boundaries, where a naive inverse silently produces two 1am buckets and no
  2am), the half-open range contract, growth-from-zero, and the ingest door's
  validation — the anon-id allowlist, the dwell clamp, client-clock skew, and
  the funnel milestone mapping every conversion number on both dashboards rests
  on. Runs against `test-stubs/prisma.ts` + `tsconfig.test.json`; it only
  exercises pure functions, so the exploding stub is the right one.

- `scripts/support.test.ts` — 17 cases. The pure half of support: the status
  machine including both asymmetries (resolved reopens, archived is terminal),
  the timestamp rules that decide whether the board and the report agree, and
  the deliberately-permissive email check — with the accepted-but-odd addresses
  written down, so the next person to "tighten" it sees what breaks. Runs
  against `test-stubs/prisma.ts` + `tsconfig.support.json`. Every writer in
  `lib/support.ts` is uncovered and takes a lock; that's the same gap
  `orders.concurrency.test.ts` closed for orders.

- `scripts/onboarding.test.ts` — 28 cases. The completion gate. Mostly one
  property: a tenant that hasn't launched is blocked, a tenant that has is only
  nagged — asserted with two snapshots identical but for `onboardedAt`, because
  that asymmetry looks like an inconsistency and is the thing most likely to be
  "tidied up" into an outage. Also covers URL-hacking past the gate. Pure.

- `scripts/customer-import.test.ts` — 59 cases. The CSV mapper, the search
  predicate, the filter `where`, tag slugs and the segment round trip. Phone
  normalisation is treated as a dedupe key (every accepted format must
  converge, or an import silently splits somebody's order history in two), the
  mapper is asserted to emit no consent field at all, and the phone-search
  clauses are checked because a search that can't match a formatted number
  reads as "that customer doesn't exist". The filter cases exist for one
  failure mode: a filter that matches nothing looks exactly like a tenant that
  has nobody, so the AND-composition, the tag-narrowing and the NULL semantics
  of "lapsed" are each asserted. Tag slugs get the same treatment as phone
  numbers, for the same reason. Runs against `tsconfig.customers.json`.

- `scripts/campaigns.test.ts` — 42 cases. The pure half of marketing
  campaigns. Four groups, each guarding real money or a sending reputation: the
  status machine's *absent* edges (there is no `SENDING → DRAFT`, because a
  campaign whose messages are on the wire cannot go back to being a draft
  somebody edits); SMS segment arithmetic including the extended-GSM double
  cost and the curly apostrophe that silently forces UCS-2 and triples a bill;
  the `{{name}}` fallback, which is the common path rather than an edge since
  most customers have no name on file; and every branch of the validator, each
  of which is a message going out under a restaurant's name to its whole list.
  Pure, no Prisma.

- `scripts/theme.test.ts` — 62 cases. The operator light/dark theme. The
  SYSTEM contract (SYSTEM is the *absence* of `data-h-theme`, which is what
  makes the feature flash-free without an inline script), and WCAG AA
  contrast for every text token against every surface on both palettes —
  parsed out of the real `globals.css`, not a copy of the numbers, so a
  drifted token fails here. It found two contrast failures that were already
  live in dark mode. Pure, no Prisma.

- `scripts/plans.test.ts` — 32 cases. The pricing plans. Four groups, each
  guarding money: the catalog matching what `/pricing` publicly advertises (a
  drift there bills an owner something they never agreed to), the
  surcharge-versus-commission arithmetic including that commission is charged on
  food and never on sales tax, the switching edges owners actually hit
  (double-submit, switching twice before the first lands, re-picking the current
  plan to cancel a pending one), and the dunning window. Pure.

- `scripts/menu-scrape.test.ts` — 23 cases. The delivery-platform menu
  scraper. Deliberately does *not* assert that DoorDash's markup matches the
  fixtures, because it will not next month; it asserts the properties that have
  to hold whatever the markup is — the price scale is decided for the whole menu
  rather than per item, modifier options are not imported as dishes, fee rows
  are filtered, duplicates collapse keeping the richer copy, a cyclic Apollo
  cache does not hang the walker, and no input throws. Pure.

- `scripts/net-guard.test.ts` — 20 cases. The SSRF fence, which is the only
  place a user-supplied string becomes a request originating inside our own
  network. Covers every private v4 range and its public neighbours, the IPv6
  forms, the `::ffff:10.0.0.1` mapped bypass, and the decimal/octal/hex host
  encodings (`2130706433`, `0177.0.0.1`, `127.1`) that `isIP` returns 0 for —
  leaving those to the resolver makes the security boundary a property of the
  platform's DNS stack. Pure.

- `scripts/oauth.test.ts` — 24 cases. The pure half of Google/Apple sign-in,
  and mostly one property: **an OAuth sign-in can never create an operator
  account.** Also the unverified-email link attempt (set your provider email to
  an owner's address and sign in), the subject-not-email identity rule, Apple's
  one-time name, and `safeNextPath`'s scheme-relative bypass. Pure.

- `scripts/booking-slots.test.ts` — 44 cases. The pure half of the booking
  calendar. Three groups: the **fail-closed default** (asserted directly,
  because this module shares `WeeklyHours` with `lib/hours.ts` and inverting
  its default is exactly what a later reader "tidies up"), the two-clock
  arithmetic across both DST boundaries — a single-pass offset conversion is
  right 363 days a year and an hour out on the other two, which surfaces as one
  person turning up to an empty room twice a year and nobody reproducing it —
  and collision handling, including that the buffer applies on both sides of an
  existing booking. Pure, no Prisma.

- `scripts/automation-flow.test.ts` — 51 cases. The pure half of the journey
  builder. Five groups, each guarding something that fails quietly: the
  validator's absent-graph cases (a cycle is an infinite loop that sends a
  message every time round; an unbounded `WAIT_UNTIL` is an enrollment that
  never leaves the database; an unreachable node is a follow-up the owner
  believes they are sending — none of the three is visible in the drawing),
  condition NULL semantics (a customer who never ordered must not match "hasn't
  ordered in 60 days", and the empty-condition default is asserted directly
  because inverting it texts everybody), quiet hours across **both** DST
  boundaries, deterministic split assignment, and the tolerant graph parser.
  Pure, no Prisma.

- `scripts/store-theme.test.ts` — 90 cases. The storefront theme presets, and
  mostly one property: the module and the stylesheet cannot drift apart without
  failing here. A preset with no CSS block renders as Classic (the owner picks
  "Bold", saves, and nothing changes — no error anywhere); a preset with no
  `prefers-color-scheme` twin renders a white page on a dark phone, which the
  owner never sees because they built the site on a laptop. Also every text
  token against every surface on every palette at AA, which found `--s-mute`
  live at 3.07:1 on every storefront. Pure, no Prisma.

Two static checks run before any of them: `check:server-only` (a client
component must not reach a `server-only` module) and `check:client-values` (a
server component must not import a value from a `"use client"` module). Both
guard bundler rules `tsc` cannot see, and both exist because the failure they
catch already shipped.

- `scripts/help-articles.test.ts` — 15 cases. The owner help centre. Defends
  the fact that **every failure mode here looks like a working page**: a
  duplicate slug renders one article and silently hides another, a broken
  related link 404s an owner already having a bad day, and a search that finds
  nothing for "refund" looks exactly like a product with no refunds. The
  search cases assert the phrases owners actually type — "money back",
  "where's my money", "locked out" — none of which appear in a title, which is
  the whole reason `keywords` exists. Pure, no Prisma.

761 cases total, all green (6 of them skipped while `FEATURES.oauthSignIn` is
off — see `docs/mvp-hidden-features.md`), plus the schema field check above.

Everything else that writes to the database is still untested.

---

## Current state: post-order support

Recently built — the system for handling orders that go wrong. Two halves:

**Prevention** (`src/lib/hours.ts`): machine-readable weekly hours, holiday
closures (`Closure`), a time-boxed pause switch, last-call cutoff, and a promised
pickup time that never runs past closing. Checked in `placeOrderAction`.

**Recovery** (`src/lib/orders.ts`): state machine with `REJECTED` split from
`CANCELED`, append-only `OrderEvent` timeline, full and partial refunds,
per-line `fulfilledQty` for out-of-stock items, and `OrderIssue` for problems
reported after pickup. Customer-facing at `/o/[token]`; owner-facing on the
dashboard board (`OrderTrouble.tsx`, `PauseControl.tsx`) and `/dashboard/hours`.

### What to do next

**`docs/post-order-gaps.md` is the working plan.** Read it before starting.

Items 1–4 in it — the read-then-write bugs on money and counters — are **fixed**.
Every writer of `Order.status` or `refundedCts` now takes an optimistic lock:
the value that was read goes in the WHERE of an `updateMany`, and a zero-row
result means someone else got there first. Refunds reserve the amount before
calling the provider and release it on failure, and carry the `Refund` row id
as an idempotency key. Failed refunds are outstanding until settled and shout
about it from the top of the dashboard (`FailedRefunds.tsx`).

Those paths are covered by `scripts/orders.concurrency.test.ts`, which runs
against an in-memory Prisma double rather than the exploding stub the pure
tests use. **If you add a writer to `lib/orders.ts`, it takes the lock and it
gets a test there.** The whole bug class came from assuming a read stays true.

Item 5 is fixed in code: `expireStaleOrders` now sweeps whichever status is
genuinely unattended for that tenant (`ACCEPTED` when `autoAccept` is on,
`RECEIVED` when it isn't), `flagOverdueOrders` apologises once for food that's
badly late without canceling it, and both run from `scripts/sweep.ts` rather
than dashboard load.

**It still needs a cron created by hand in Railway** — a second service off this
repo, pointed at the `railway.sweep.json` config that's already in the repo, on
a `*/2 * * * *` schedule. The config file and step-by-step are done
(`docs/deploy-sweep.md`); what's left is the dashboard clicks, which a coding
session can't do. Until that service exists, the sweep is correct code that
never runs.

Items 8 and 9 are also done. The storefront now asks `checkAvailability`
itself — a closed kitchen is announced under the banner and the cart bar goes
inert, rather than the customer finding out at checkout — and the page's hours
are derived from `hoursJson` (`StoreInfo.hours` is a `StoreHours` object), with
the free-text `Restaurant.hours` column demoted to a note printed underneath.
**Do not reintroduce a second source for hours.** That column is prose beside
the schedule, never a substitute for it.

Item 6 is done too: `markNoShow` closes out food that was made and never
collected, prompted on the board once an order has sat `READY` for 45 minutes
(`isProbableNoShow`). Owner-initiated, never automatic — whether to refund
someone who didn't turn up is a judgement call about a regular versus a
first-timer, and the code shouldn't make it.

That work also corrected the counter rule from item 4: `cancelOrder` reverses a
customer's `orderCount` only when they ended up **paying nothing**, not on
every cancellation. A no-show where the owner keeps the charge is a real
transaction and stays counted.

Item 10 is done as well: `resolveIssue` moved out of the dashboard action into
`lib/orders.ts` and now texts the customer — the owner's own words when they
wrote any, a plain statement of where things stand when they didn't.

Items 11 and 7 are done in code. `TwilioSmsProvider` sits behind the seam,
off unless `SMS_PROVIDER=twilio`, and `scripts/config-check.mjs` refuses to boot
on the two configurations that fail silently — a missing `APP_URL` once SMS is
live, and `SMS_PROVIDER=twilio` with no credentials.

The email fallback on `Customer.email` was considered and rejected: the column
is never captured anywhere in `src/app/r/`, so it is null for every customer
that exists. See item 11 in the gaps doc for the reasoning; don't re-propose it
without reading that first.

**What's left is mostly not code, and that's the thing to notice.** Two deploy
tasks now block more than the features that produced them:

1. **The Railway cron still doesn't exist.** Five things queue behind it — the
   automation drain is the newest, and it is the one where "correct code that
   never runs" is least visible: an automation enrolls people the moment it is
   switched on and then never advances them, so the owner sees a journey that
   looks alive with nobody moving through it. The rest are
   written and tested — the sweeps from item 5, refund retry
   (`retryFailedRefunds`), and send retry (`retryFailedMessages`, which finally
   consumes `SendResult.retryable`). Both retry queues run in place on the same
   row and are bounded by an attempts cap; see `docs/post-order-gaps.md` items 3
   and 11. All of it is inert until a second Railway service runs `npm run sweep`
   — config and setup steps are ready in `docs/deploy-sweep.md`, the service
   itself still has to be created by hand.
2. **A2P 10DLC registration** gates delivery to every US carrier. Weeks of lead
   time, and no amount of code shortens it.

Both have the same failure mode: correct code that never runs, which reads as
finished everywhere except `docs/post-order-gaps.md`. **If you're picking up
this project and something looks done, check whether the thing that runs it
exists.**

Code that's genuinely left is all P3: deriving the customer counters instead of
caching them (item 4), the best-effort parse of free-text hours (item 9), a
shared-store rate limiter, the `smsFrom` admin UI, and integration tests for the
database-writing paths. Everything higher-priority is either done or waiting on
the cron.

---

## Current state: the admin console

Recently built — per-tenant service suspension and the admin structure to
operate it.

`src/lib/entitlements.ts` records the platform withdrawing PAYMENTS, SMS, EMAIL,
or DELIVERY from one tenant; see the rule above for why owners can never lift
one. `/admin/restaurants` is now a read-only index and every control that
changes a tenant lives on `/admin/restaurants/[id]`, behind URL-driven tabs
(Overview, Services, Pricing, Payments, Danger zone). Owner-facing settings were
split the same way: `/dashboard/branding` and `/dashboard/payments` sit under a
shared Settings tab strip, and the surcharge — rate, clamps, and receipt label —
is admin-only, with owners keeping just their sales-tax rate. The fee modelling
tool moved to `/admin/fees`.

### What to do next

**`docs/admin-roadmap.md` is the working plan.** Read it before starting, and
update it as you go.

**Items 1–5 are done.** Item 1 was the custom-domain link defect plus the
middleware prerequisite it turned out to have (`/o/[token]` 404'd on a tenant's
own domain). Items 2–5 landed together as an admin-console pass: a Domain tab
over `lib/domain-ops.ts`, a Links tab with a server-rendered QR, invite links
replacing typed passwords, an attention-first `/admin` home, and grouped nav.
Admin-driven Stripe Connect and a rework of the owner wizard came with them.

A testing workbench landed alongside them at `/admin/tools` — order simulation,
one-click failure injection, on-demand sweeps, and the message outbox (the only
place in the product where you can watch the consent gate decline to send).
Behind `requireAdmin()` and the `testModeEnabled()` switch; see the roadmap for
the three decisions worth not re-litigating. The sweep buttons there are **not**
the Railway cron, and their existence must not make the cron look optional.

**Item 7 is now mostly done.** Support tickets, a public contact form, and the
admin queue behind them landed as `src/lib/support.ts` plus three tabs on
`/admin/support` (Tickets, Contact form, and the pre-existing Support load).
Owners file from `/dashboard/support`; strangers use `/contact` on the marketing
site; `SupportInboxCard` puts the queue on the admin home. The roadmap item was
written "articles first, tickets only if articles don't absorb it" and was
deliberately built the other way — see it for why, and for the decisions not to
re-open. Help articles are the remaining half, and the ticket category
distribution is the input for writing them.

**The articles are now built** — `src/lib/help-articles.ts` and
`/dashboard/support/help`, thirteen of them with a search box, plus a "book a
call" card that reads the existing booking types rather than adding a second
calendar. See `docs/help-center.md`. The set was guessed from this codebase's
own known failure modes rather than from real ticket volume, which is the next
thing to fix once there is a category distribution worth reading.

**What's left is items 6 and 8**: customer-shaped refund troubleshooting, and
employee accounts with permissions.

**Migration `25_support_tickets` has never run.** Same as the two below — no
support page works until `npx prisma generate && npm run db:push` happens on a
real machine.

Two decisions are already settled and recorded there, so don't re-open them
mid-build: permissions are **named roles plus per-user overrides**, checked
server-side in one module the way `lib/entitlements.ts` is; and a verified
custom domain is the tenant's **canonical origin**, not an alias.

`/admin/test-mode` is **gone** — merged into `/admin/tools` as its first tab,
with the old route left as a redirect because it's in bookmarks and in a few
error strings. They were one question ("is what I'm looking at real?") asked on
two pages, and the split had a concrete cost: the switch that arms the testing
tools lived somewhere other than the tools, so a fresh environment greeted you
with an error telling you to navigate away and come back. Mode is also the only
tab that renders when `testModeEnabled` is off, so the fix is now where the
problem is.

**Before running anything**, note migrations `22_tenant_invites`,
`24_storefront_analytics`, `25_support_tickets`, `26_customer_crm`,
`27_oauth_accounts`, `28_campaigns_and_email`, `30_booking_calendar`,
`31_automations` and `32_store_theme_presets` all need
`npx prisma generate && npm run db:push` on a real machine — the sandbox can't generate, so `prisma.invite`, `prisma.visit`,
`prisma.visitEvent`, `prisma.customerTag`, `prisma.customerSegment`,
`prisma.customerNote`, `prisma.customerAdminNote`,
`prisma.customerImportJob`, `prisma.oAuthIdentity`, `prisma.campaign`,
`prisma.customerAccount`, `prisma.booking`, `prisma.bookingType`,
`prisma.automation`, `prisma.automationVersion`,
`prisma.automationEnrollment`, `prisma.automationStep`,
`prisma.automationTemplate` and `prisma.automationTemplateVersion` are missing
from the client until you do. **`30_booking_calendar` has the widest blast
radius of the lot** — the setup-call banner query runs in the dashboard
*layout*, so until it runs every owner page throws, not just the calendar. **Note
`26_customer_crm` breaks both customer pages until it runs**, not just the new
features — the list query includes tags now.

---

## Current state: storefront analytics

Just built. **`docs/analytics.md` is the working plan** — read it before
touching `src/lib/analytics*.ts` or either analytics page.

Behavioural instrumentation on `/r/[slug]` feeding two reporting surfaces:
`/dashboard/analytics` for owners (overview, traffic, items, behaviour, and a
per-visit timeline) and `/admin/analytics` for us (platform totals, a tenant
leaderboard ranked by **surcharge** rather than gross, a per-tenant drilldown,
and a cross-tenant product view). The drilldown deliberately renders the same
components against the same query functions as the owner's page — two
implementations of "conversion rate" is how the console tells us 4.1% while the
owner's page tells them 3.8%, and there is no way to win the support call that
follows.

Charts are hand-rolled SVG with no charting dependency. The static shapes
(`components/hearth/charts.tsx` — funnel, ranked bars, sparkline, metric cards)
are server-rendered with zero JavaScript. The line chart and heatmap moved to
`charts.client.tsx` when it became clear `<title>` tooltips were not the
substitute the original decision claimed: they need a held hover, show one
series at a time, and never fire on a touchscreen. **The bound on that reversal
is the part to preserve** — those two components only, on those two pages only,
still hand-rolled, still fully server-rendered with hydration adding the
crosshair rather than the chart, and the `<title>` elements kept rather than
replaced. One prop shape changed as a consequence: `SeriesDef.format` is a key
(`"count" | "money" | "pct"`), because a server component cannot pass a function
across the client boundary.

The filter bar is a plain GET form, so every view has a URL that can be
bookmarked and pasted; the preset chips, active-filter chips and export menu are
links and `<details>` for the same reason.

**An export is the page, not a second query.** `lib/analytics-export.ts` builds
every CSV from the same query functions the page renders from, with the filter
resolved by the same `resolveAnalyticsFilter` in `lib/analytics-params.ts` —
which exists precisely because there are now three readers of that querystring.
A hand-written query there would be a second implementation of "which visits
count", and the first anyone hears of the drift is a spreadsheet that disagrees
with a dashboard. `/api/analytics/csv` takes the tenant from the **session**;
the one exception is an admin passing `restaurant=<id>`, reachable only after
the role check.

### What to do next

**Two things block everything else, and both are the familiar shape:**

1. **`npx prisma generate && npm run db:push` on a real machine.** Migration
   `24_storefront_analytics` is written and idempotent and has never run.
   Neither analytics page works until it does.
2. **The raw SQL has never executed.** `series`, `heatmap`, `dropOff`,
   `platformSeries` and `platformHeatmap` are the first `$queryRaw` in this
   repo. The risky part is `bucketExpr`, which truncates in the tenant's
   timezone and shifts back, and has to agree exactly with `truncateLocal` in
   JavaScript. The JS side is covered on both DST boundaries by
   `scripts/analytics.test.ts`; the SQL side is unverified.

Everything else is P2 or below and listed in `docs/analytics.md`: retention
(`pruneAnalytics` exists and nothing calls it — it wants the Railway cron that
still doesn't exist), an index review against real volume, CSV export, and
moving `searchTerms` from an in-memory aggregate to a `GROUP BY`.

**The same warning as the post-order work applies here.** The ingest path,
the beacon, the queries and both pages are written and typecheck; none of it has
touched a database. If something looks done, check whether the thing that runs
it exists.


---

## Current state: legal pages, menu link import, OAuth

Just built, and all three have the failure mode this file keeps warning about:
**code that is written, typechecked and tested, and that nothing has yet run.**

**Legal pages** (`docs/legal-pages.md`) are the most complete — ten policies at
`/legal/*`, static, linked from both footers, with short-URL redirects for the
forms that get typed into carrier and app-store registration fields. What is
left is not code: a lawyer has to read them, the entity in `COMPANY` does not
exist yet, and `privacy@` / `legal@` / `abuse@` are printed on public pages and
route nowhere. A privacy request that bounces is a compliance problem rather
than an inbox problem — that one is P1.

**Menu link import** (`docs/menu-link-import.md`) works end to end and is now
the default tab in both the wizard and the dashboard. The SSRF fence moved to
`src/lib/net-guard.ts` — pure, no `server-only`, 20 tests — because a security
predicate that cannot be tested because of where it lives is the worst of both.
`hostnameIsBlocked` is the call to make: it rejects every encoding of a private
address *before* DNS is consulted, which is where the check belongs.

**OAuth** (`docs/oauth.md`) is the one most likely to look finished and not be.
`configuredProviders()` returns `[]` without credentials, so **no button
renders anywhere** and every surface looks normal. Two things block it, neither
of which a coding session can do: migration `27_oauth_accounts` has never run,
and the Google OAuth client and Apple Services ID both have to be created by
hand in consoles. Customer accounts are now wired end to end: `/r/[slug]/account` lists past
orders, checkout prefills the name, and `placeOrderAction` links `customerId`
on the first order — **the only place that link is made**, because a `Customer`
is keyed by phone and a sign-in supplies an email address. Operators can
connect and disconnect providers at `/dashboard/sign-in`; there is deliberately
no "connect" *action*, only a link into the normal sign-in flow, since a code
path that writes an `OAuthIdentity` without the provider vouching for it in the
same request is a way to attach an arbitrary subject to an account.

Same instruction as everywhere else in this file: **if something looks done,
check whether the thing that runs it exists.**
