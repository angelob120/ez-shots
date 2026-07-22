# Admin tooling: the working plan

The admin surface was built to get pilots running, not to operate a platform.
It shows. This file is the plan for making it a real operations console, and it
is the thing to read before touching anything under `src/app/admin/`.

**Keep it current.** When you finish an item, mark it DONE in place, say what
actually landed, and note anything the next session would otherwise have to
rediscover. When you find a new gap, add it with a priority. A stale roadmap is
worse than none — the last session's Claude is the only one who knows why a
decision was made, and this file is where that knowledge goes.

Ordered by what it unblocks, not by effort.

---

## Design decisions already made

Settled, so nobody re-litigates them mid-build.

**Permissions are roles plus overrides.** A small set of named roles carries the
defaults; individual capabilities can be toggled per person on top. Pure roles
can't express "this manager can do everything except refunds," which is the
first thing a real restaurant asks for. Pure capability checklists make every
new hire a configuration exercise and drift into inconsistency across a tenant.
Roles are what people *say*; overrides are what they *mean*.

**Capabilities are checked server-side, in one place.** The pattern that already
holds for orders, hours, SMS, and entitlements applies here too: one module owns
the question "may this user do this," every route guard calls it, and the UI
hiding a control is a courtesy rather than the enforcement. A permission system
enforced in JSX is not a permission system.

**A verified custom domain is the tenant's canonical origin.** Not an alias.
Once `domainVerifiedAt` is set, every URL we generate or print uses it. Item 1
implemented this as `canonicalOrigin()`; that resolver is the decision, so a new
surface that needs a URL calls it rather than reading `customDomain` itself.

---

## P1 — Wrong today, and customers can see it

*Nothing here. Item 1 is done; the section is kept so the next defect has a home.*

### 1. A verified custom domain doesn't become the canonical link — **defect, DONE**

`Restaurant.customDomain` routes correctly once verified, but the URLs the
system *generates* still point at the platform host. Order status links in
texts, the share/QR links on the branding page, and anything else built from
`orderUrl`/`origin` keep emitting `ezorders.app/r/slug` after the owner has
pointed `order.theirplace.com` at us and watched it go green.

The owner paid for a domain and still sees ours on their customers' receipts.

**Fix.** One resolver — `canonicalOrigin(restaurant)` — that returns the
verified custom domain when there is one and the platform host otherwise. Every
generated URL goes through it: `lib/orders.ts` (`orderUrl`, `orderPath`), the
branding Links panel, QR generation, and anything printed on a card.

Check `src/lib/domains.ts` for what exists — `fallbackOrigin()` and
`PRIMARY_DOMAIN` handling already live there and this belongs beside them, not
in a new module.

**Watch out:** the fallback origin (Cloudflare for SaaS) and the marketing host
are already two different things for two different reasons. Read the comments in
`branding/page.tsx` before adding a third concept.

**Fixed, as described — plus a prerequisite that wasn't in the write-up above.**

`canonicalOrigin(restaurant)` and `platformOrigin()` live in `lib/domains.ts`
beside `normalizeHost`, with `canonicalUrl(restaurant, path)` as the form
callers actually want. Verification is the gate rather than presence: an
unverified domain is a hostname somebody typed into a form, and emitting links
to it sends customers somewhere that doesn't resolve — a worse failure than
printing our host.

`orderUrl(token, restaurant)` now **requires** the restaurant. That's the whole
fix: it printed our host on every tenant's receipt for exactly as long as it
could be called without one, and an optional parameter would let the same bug
back in the next time somebody adds a caller. `ORDER_WITH_CONTEXT` carries
`customDomain`/`domainVerifiedAt` so `notify()` has them, and `notify` now takes
the restaurant rather than its name — name and origin travel together because
every message needs both.

**The prerequisite: `/o/[token]` did not work on a custom domain at all.**
Middleware rewrites every custom-domain path onto `/r/<domain>`, and there is no
`/r/[slug]/o/[token]` route — so a status link on the owner's own domain was a
404. Emitting canonical links without fixing that would have turned a cosmetic
defect into a broken one. `/o/*` is now served unrewritten with `DOMAIN_HEADER`
set, and the status page links back to `/` instead of `/r/<slug>` when that
header is present. **Don't add a tenant-scoped copy of the order route** — the
token already resolves the order and its restaurant, so the page needs no slug.

**Three origins, not two, and they don't collapse.** Worth stating since the
warning above only names two:

| Origin | Who reads it | Where |
|---|---|---|
| `canonicalOrigin(r)` | The tenant's customers | Order links, share/QR URLs |
| `platformOrigin()` | Us | Stripe return URLs, Twilio webhooks, the dashboard |
| `fallbackOrigin()` | The tenant's DNS registrar | CNAME target only |

Stripe and Twilio callbacks deliberately stay on `platformOrigin()`: `/api/*` is
ours, and pinning a webhook to a hostname the owner can retire at any moment is
a slow-motion outage. `fallbackOrigin()` must never reach a customer — it's a
routing detail wearing a hostname.

The duplicated env ladders in `dashboard/actions.ts` (`appOrigin`),
`branding/page.tsx` and `sms-twilio.ts` all now call `platformOrigin()`, so
precedence is defined once. `APP_URL` leads it, because that's the value an
operator sets deliberately and the one `scripts/config-check.mjs` already
grades.

Covered by `scripts/domains.test.ts` — 14 cases, wired into `npm test`.

**Still on our host, and correctly so:** `LinksPanel` already preferred the
verified domain before this change, so the owner's own Links tab was never
wrong; it was every generated link *except* that panel.

---

## P2 — Admin can't do the job without leaving the app

*Items 2–5 are all DONE. Kept in place with what landed, because the reasoning
is what the next session needs.*

### 2. Domain management is owner-only — **DONE**

Admins can't see which tenants have custom domains, what state verification is
in, or unstick one that's half-configured. Today that means asking the owner to
read their own settings page aloud, or impersonating them to look.

**Build.** A domains view — either a column on the tenant detail page or its own
section under `/admin`. Needs: current domain, verification state and timestamp,
the challenge token, a re-check button, and the ability to clear a domain that
was typed wrong. Cloudflare custom-hostname state belongs here too (see
`lib/cloudflare.ts`), because "verified with us" and "active at the edge" are
different failures with the same symptom.

**Done — as a Domain tab on the tenant page, and the logic moved.**
`lib/domain-ops.ts` is now the one door for `saveDomain` / `recheckDomain` /
`clearDomain` / `domainView`. Those bodies used to live in
`dashboard/actions.ts`; both the owner's page and `/admin` are now thin
auth-scoped wrappers over the same module. Two copies of "is this domain live"
is exactly how you get a console reporting Verified while the owner's page
reports Pending, and a support call neither screen can settle.

The panel shows **both** statuses as separate badges, per the warning above.
It also prints the exact record the tenant needs at their registrar with copy
buttons, because most stuck domains are a record added at the apex instead of
the subdomain and the fix is reading it out verbatim.

### 3. No links view — **DONE**

The owner has a Links panel; admins have nothing. Support calls start with "send
me your ordering link" — which we should already have.

**Build.** Per tenant: storefront URL (canonical, per item 1), custom domain
URL, QR code, and the onboarding link from item 5. Copy buttons on each. Cheap
to build, disproportionately useful on a support call.

**Done**, as the Links tab. `CopyField` (`components/hearth/CopyField.tsx`) is
shared by every screen whose next action is "paste this into a message".

**The QR is the one place this repo took a dependency** (`qrcode`), and that's
deliberate. `ui.tsx` hand-rolls its bar and donut charts happily, because a
chart a few pixels off looks slightly wrong. A QR code with a bad Reed-Solomon
block looks completely fine and doesn't scan — and the place it fails is a
sticker already laminated and stuck to a counter. Correctness there isn't
verifiable by looking at it. Rendered server-side as inline SVG at error
correction M, so it survives scuffing and scales for print.

### 4. Admin home is a metrics page, not an operations page — **DONE**

`/admin` shows 30-day aggregates and recent orders. Nothing surfaces what needs
attention: tenants stuck mid-onboarding, failed refunds across accounts, live
service suspensions, domains stuck unverified, tenants with zero orders in a
week that used to have some.

Navigation is a flat strip that has grown to six items and will keep growing.

**Build.** Rework the overview into "what needs attention" first, metrics
second. Group the nav — Tenants / Operations / Platform — once there are more
than a handful of destinations. The tab pattern from
`/admin/restaurants/[id]` (URL-driven, linkable) is the one to reuse.

**Done.** `/admin` opens with failed refunds (loudest — it's money we owe),
then the attention list, then live suspensions; the 30-day metrics moved below.
Nav is grouped in `AdminNav.tsx` and matches active state on prefix, so a tenant
detail page still highlights Restaurants.

**The ranking is the feature, and it's in `lib/readiness.ts`.** One module
derives what a tenant is missing and splits it **blocking** (can't take an
order) from **advisory** (no logo). Everything reads from it — the attention
list, the tenant checklist, the tab badges, and the row state on the index. The
rule worth keeping: an attention list that mixes "no orders this week" in with
"we owe this customer $40" gets skimmed, and a list that gets skimmed is worse
than no list because it looks like coverage.

Nothing is cached on the Restaurant row. `docs/post-order-gaps.md` item 4 is the
standing reminder of what a counter that disagrees with its source costs.

### 5. No onboarding link generation — **DONE**

Creating a tenant means creating a user with a password and telling them the
password. That's a bad look and a bad practice.

**Build.** A single-use, expiring token that lands the recipient on the
onboarding wizard with their account already provisioned. Needs a token table
(or a signed token with an expiry claim), a redemption route, and a "copy
invite link" button on tenant creation and on the tenant detail page.

**Watch out:** this is an unauthenticated route that creates a session. It needs
the same care as the order token — single use, short expiry, and no way to
enumerate. `lib/orders.ts` `newOrderToken` is the precedent for token shape.

**Done.** `lib/invites.ts` is the one door; migration `22_tenant_invites`;
redemption at `/invite/[token]`. Every part of the "watch out" is implemented
and tested (`scripts/invites.test.ts`, 25 cases):

- 160-bit CSPRNG token, per the `newOrderToken` precedent. This one creates a
  *session*, so it gets at least what an order token gets.
- **We store SHA-256 of it and return the raw token exactly once.** A database
  backup contains no usable invites, and there's no prefix to enumerate — the
  lookup is a single hash equality. This is why the UI treats the link as
  unrecoverable and offers "generate a new one" rather than "show it again".
- **No `User` row exists until redemption.** An unredeemed invite leaves nothing
  to brute-force.
- Single-use via the same optimistic lock every writer in `lib/orders.ts` takes,
  wrapped in a transaction with the user creation so a failure at either end
  rolls back both. A consumed invite with no account behind it strands the
  recipient with a dead link — worse than either clean outcome.
- Redeeming replaces `redeemedAt`; revoking sets `revokedAt`. Rows are never
  deleted, because "who did we invite, when, and did they ever accept" is what
  answers a stalled onboarding two weeks later.
- Redemption is throttled per token (`lib/rate-limit.ts`), same as the `/o/`
  actions and for the same reason: the secret is the boundary, the throttle is
  the safety net.

**Two behaviour changes fell out of this, worth knowing:**

1. `createRestaurantAction` no longer takes a password. It also creates the
   tenant as `PENDING` rather than pre-marking it onboarded — the old version
   claimed admin-created restaurants were fully set up, but nothing on that form
   collects a menu or hours, so it produced tenants that reported Active with an
   empty storefront.
2. Success is a *state*, not a toast. The invite link is shown once, so a green
   flash that disappears on the next render would lose it.

---

## Also done, and not previously on this list

### The manual onboarding checklist

An operator-followed checklist for taking a tenant live, on its own **Onboarding**
tab on `/admin/restaurants/[id]`. Distinct from `lib/readiness.ts` on purpose:
readiness *derives* facts the DB knows (has a menu, has hours); this records the
steps that happen on a phone call and leave no row — "tested a live order",
"walked the owner through the board", "call attended". Those can't be derived, so
they're stored and persist until ticked.

`src/lib/onboarding-checklist.ts` is the one door. Three decisions worth not
re-litigating:

- **The step catalog is code, the tick state is a table.** Same split as
  `lib/legal.ts` / `lib/help-articles.ts`: `ONBOARDING_SECTIONS` defines the
  steps (keys, order, deep links); `OnboardingTask` stores only per-tenant
  completion. A step `key` is permanent once shipped — renaming one orphans its
  saved ticks. Adding/removing a step is still a code change.
- **The wording is editable without a deploy.** Label and detail overrides live
  in `PlatformSetting.onboardingStepOverrides` (`{ [key]: { label, detail } }`),
  applied over the code catalog. Because it's one master template driving every
  tenant, it's edited on its own platform page — **`/admin/onboarding`** (Platform
  nav), not on any restaurant's tab; the tenant Onboarding tab just links to it.
  Blank-and-save resets a string to its code default. The catalog still owns
  *structure*; overrides only touch the two strings a human reads.
- **Notes are ours, in two streams on their own tabs.** `OnboardingNote` is an
  admin-only table (the same rule `CustomerAdminNote` / `SupportNote` carry —
  nothing under `src/app/dashboard/` reads it). It carries a `kind`
  discriminator: **Onboarding notes** (working notes while getting a tenant
  live) and **Account notes** (ongoing notes once they're trading), each on its
  own tab via the shared `NotesPanel`. One table with a `kind`, not two tables,
  because unlike the `CustomerNote`/`CustomerAdminNote` split these two don't
  differ in *who may read them* — only in topic — so a discriminator is the
  honest shape.

The Onboarding tab carries a badge of remaining steps. It does **not** yet feed
`attentionList()` on the admin home — that query would throw for every tenant
until migration 34 runs (it reads `prisma.onboardingTask`), and the setup-call
banner precedent shows how wide that blast radius is. Wire it in after the
migration has run.


### Payment mode can no longer be left on by accident

The failure this closes: an admin flips to TEST or STUB to check something, gets
distracted, and a restaurant spends a day taking orders that collect nothing.
Nobody finds out until a payout doesn't arrive — and the person who pays for it
is the owner, not us.

Four things, and the ordering matters:

1. **Leaving LIVE always sets an expiry.** Not optional, not settable to
   "never". Default 24h, max 7 days. Making the dangerous option the one with
   fewer clicks is how this happens in the first place.
2. **The timer is enforced in `resolveModeState()`**, which every charge and
   every refund reads — not on the admin page. A guard that only runs when
   somebody loads a screen is not a guard. The sweep and every admin page load
   also trip it, which covers a platform quiet enough that neither happens.
3. **Reverting never claims LIVE it can't deliver.** `safeRevertTarget()` drops
   to STUB when the live secret key is missing, because `paymentProviderForMode`
   would otherwise use the stub while the console reads LIVE — the same silent
   failure wearing a better label.
4. **A banner that can't be dismissed or navigated away from**, in the admin
   *layout*, counting down live. Owners get their own wording on the dashboard
   when they'd otherwise expect money — they're the ones cooking.

`/admin/test-mode` owns all of it. Payment mode used to be a card below the
metrics on the admin home, which made the most consequential switch in the
product something you scrolled past.

**`testModeEnabled` is a separate switch on purpose.** It governs the demo
scaffolding, and the bug it fixes is real: the "Fill test data" button was
sitting unconditionally on `/signup`, a **public page**, behind a comment saying
"remove before launch". Tying it to `paymentMode` would mean a real Stripe test
charge also exposes autofill to every owner signing up that afternoon. The seed
actions re-check it server-side — hiding a control is a courtesy, not
enforcement.

Covered by `scripts/payment-mode.test.ts`, 18 cases.

### www is covered alongside the apex

Entering `theirplace.com` now registers `www.theirplace.com` with it. Routing
already stripped www, so this looked done — but Cloudflare issues a certificate
per hostname, so a customer typing www was getting a browser security warning on
the restaurant's own domain. Worse than never having bought one.

Only apexes get the twin (`domainVariants()`); `isApexDomain` counts labels and
is knowingly wrong for `theirplace.co.uk`, where the cost is a missing
convenience rather than a broken domain. The twin is best-effort at save time
and self-heals on re-check, and it never gates `domainVerifiedAt` — a serving
apex shouldn't wait on a convenience host still issuing a cert.


### Stripe Connect, driven from our side

An admin can now create a tenant's connected account and mint an onboarding
link from `/admin/restaurants/[id]?tab=payments`, plus refresh charge/payout
readiness. Same `ensureConnectAccount` / `createOnboardingLink` pair the owner's
own button uses — **there is deliberately no second path to a Connect account**,
because a duplicate one is unrecoverable without Stripe support.

The link is *shown*, never followed. An admin who fills in Stripe's identity
form is entering the restaurant's legal details from memory, which is how an
account ends up unverifiable. Both `refresh_url` and `return_url` come back to
the admin tenant page — we generated it, so we should see whether it landed.

Note returning from Stripe doesn't mean charges are enabled; the panel says so
and points at Refresh status, because `charges_enabled` is the only flag that
decides whether a live direct charge clears.

### The owner-facing wizard

`StepRail.tsx` replaced a row of pills that looked identical whether done,
current, or unreachable — so it read as navigation the owner had failed to use
rather than progress they were making. Only completed steps link now; a step you
can't reach that looks clickable is a broken promise on the screen where the
product is asking to be trusted with someone's business.

The launch step leads with the ordering link and a copy button, and ends with
the three things that actually bring people to it. Previously it ended at
"Launch" with no answer to "now what".

---

## P3 — Real features, larger than they look

### 6. Refund and partial-refund troubleshooting is order-shaped, not customer-shaped

`adminRefundAction` exists and works, and `FailedRefunds` surfaces stuck payouts
on the owner's dashboard. What's missing is the view a support conversation
actually needs: *this customer*, everything they've ordered, what was refunded,
what's still outstanding, and what we told them.

A support call is "I ordered twice last week and only got money back once." That
question is currently answered by scrolling an order list per tenant.

**Build.** A customer-centric admin view: order history, refund history with
amounts and reasons, `OrderIssue` rows, and the `Message` log for what actually
reached them (including the SKIPPED rows — "we never texted them" is usually the
answer). Refund actions available inline, going through `issueRefund` as always.

**Don't** add a second refund path. `lib/orders.ts` is the only door; this is a
view onto it with buttons.

### 7. No support tickets or articles — **TICKETS DONE, ARTICLES NOT**

This item said to build articles first and tickets "only if articles don't
absorb it". It was built the other way round, deliberately, and the reasoning
should be recorded rather than silently reversed: article deflection is a bet
on knowing which eight questions get asked, and with the pilot at its current
size nobody knows that yet. Tickets are the instrument that finds out. The
`SupportCategory` distribution on `/admin/support?tab=tickets` is the input to
writing articles that deflect anything — **read it before starting item 7's
remaining half.**

**What landed.**

`src/lib/support.ts` is the one door, in the same sense as `lib/orders.ts`. Four
tables, and the shapes of them carry most of the decisions:

- `SupportTicket` + `SupportMessage` — an owner-filed problem and its thread.
  Both parties see every message row.
- `SupportNote` — admin-only working notes. **A separate table, not an
  `internal` boolean on `SupportMessage`.** A shared table with a visibility
  flag puts a candid internal note one forgotten `where` clause away from the
  customer reading it, and that clause would have to be right in every query
  anyone writes from now on. Two tables make the mistake unavailable instead of
  merely discouraged. Don't merge them.
- `ContactSubmission` — the public form. Also deliberately not a ticket with a
  null tenant: it is the one place in the product where an unauthenticated
  stranger writes a row, so it inherits spam, rate limiting, and the rule that
  nothing in it may ever be trusted to name a tenant. `matchedRestaurantId` is
  advisory, has no foreign key, and must never become an auth decision — the
  address behind it was never verified.

Surfaces: `/dashboard/support` (list, file, thread) for owners, `/contact` on
the marketing site for everyone else, and `/admin/support` with three URL-driven
tabs — Tickets, Contact form, and the pre-existing Support load, which moved
into `LoadTab.tsx` unchanged. `SupportInboxCard` on `/admin` surfaces the queue,
and renders nothing when it's empty rather than showing a zero nobody reads.

**Things worth not re-litigating:**

- **Status is a state machine with two asymmetries.** Resolved can be reopened
  (an owner replying "that didn't fix it" shouldn't lose the history); archived
  cannot (a queue whose bottom climbs back out has to be re-read). Every mover
  takes the optimistic lock — read status goes in the `WHERE` of an
  `updateMany` — for the reason `docs/post-order-gaps.md` items 1–4 exist.
- **An admin reply moves the ticket to WAITING, not RESOLVED.** An answered
  ticket left OPEN makes the open count report a backlog that isn't there, and a
  count nobody believes is a count nobody reads.
- **Ticket numbers come from a Postgres sequence**, not `max(number) + 1`. Gaps
  are fine; a collision on the unique index when two owners file in the same
  second is not.
- **`oldestUnansweredHours`, not the count, is the number on the home widget.**
  Four tickets filed this morning is a Tuesday; one filed nine days ago is a
  restaurant deciding we don't answer, and a bare count can't tell them apart.
- **There is no reply box on a contact enquiry**, only status and notes. The
  sender has no account and nowhere to read an answer, so we reply by email; a
  reply form there would imply a thread that doesn't exist.

**What's left of this item:** the help articles, now with real data to write
them from. Also unbuilt, and both are P3: linking a ticket to a specific order
(the owner types the number today, which is nearly as good and cost nothing),
and reusing `SupportLog` for automatic time accounting rather than the manual
weekly entry.

### 8. Employee accounts and permissions

Today `Role` is `ADMIN | OWNER` and a restaurant has exactly one kind of user.
Real restaurants have a manager who does the schedule, staff who work the board,
and an owner who wants the refund button kept away from both.

**Build**, per the design decision above:

- Extend `Role` with `MANAGER` and `STAFF` (keep `OWNER` as the tenant
  superuser, `ADMIN` as us).
- A capability list — something like `orders:refund`, `menu:edit`,
  `customers:view`, `hours:edit`, `payments:manage`, `staff:manage` — with a
  default set per role and per-user overrides stored alongside the `User` row.
- **One module owns the check.** `lib/permissions.ts`, mirroring
  `lib/entitlements.ts`: `can(user, capability)`, called by every dashboard
  route guard. `requireOwner()` grows a capability argument or gains a sibling.
- Owner-facing staff management under `/dashboard`, and an admin view that can
  see and edit the same thing across tenants.

**Watch out:**

- Tenant isolation still comes first. A capability never widens
  `restaurantId` scope — a MANAGER with `customers:view` sees *their* customers.
- Every existing `/dashboard` route currently assumes the caller is the owner.
  Auditing those guards is most of this work; the model itself is small.
- Don't let a STAFF account reach anything that writes money or lifts a
  suspension. Refunds and payment settings default to OWNER-only.

### The testing workbench — **DONE**

`/admin/tools`. What existed before was one button that created a demo tenant
with a menu and nothing else, which meant every question past "does the
storefront render" was answered by editing rows by hand. Two costs to that: it
is slow, and it produces order shapes the real checkout cannot produce, so
whatever you concluded from them was about a system nobody ships.

Five panels, one tenant at a time, all behind `requireAdmin()` and the
`testModeEnabled()` switch:

- **Simulate** — seeds customers and orders against the tenant's real menu with
  real surcharge and tax arithmetic, in one of four profiles (busy shift, quiet
  service, past trade, bad day). Also drives the shift forward through
  `transitionOrder`, closes a no-show through `markNoShow`, and clears the board
  through `cancelOrder`.
- **Trouble** — eight one-click broken states: unattended ticket, late order,
  no-show, out-of-stock, customer complaint, failed refund, failed text,
  opted-out customer. Each names the code path it exercises.
- **Sweeps** — runs `expireStaleOrders`, `flagOverdueOrders`,
  `retryFailedRefunds`, `retryFailedMessages` and `resolveModeState` on demand,
  scoped to the tenant by default.
- **Outbox** — the `Message` log, including SKIPPED rows and their reason. Until
  today there was nowhere in the product to watch the consent gate work, which
  for a system whose whole asset is a messaging list is a strange gap.
- **Cleanup** — removes only simulated rows, slug-confirmed.

Three decisions worth not re-litigating:

**Simulated data is identified by a reserved phone block**
(`+1555017xxxx`), not a schema column. 555-01xx is unroutable by construction,
so a stray send against simulated data cannot reach a real handset even if the
Twilio provider gets switched on by accident — which matters, because the paths
being exercised are the ones that send things. It also avoids a migration, and
`prisma generate` can't run in the sandbox. Orders carry a second marker,
`paymentProvider: "sim"`, which `modeFromTag` reads as STUB — so a simulated
refund never reaches for a Stripe charge that doesn't exist, even on a LIVE
platform.

**The simulator uses the real doors for everything except creation.** Seeding
writes `status` directly because creating an order *in* a status is a create,
not a transition; every subsequent move goes through `lib/orders.ts` like
anything else. The one deliberate exception is the injected failed refund, which
writes a `Refund` row directly — the stub provider always succeeds, so a
provider failure cannot be requested. It leaves `Order.refundedCts` at zero,
which is exactly what `issueRefund` does on a failure (it reserves and
releases), so the invariant holds.

**The sweep buttons are not the cron, and the panel says so.** They exist
because the Railway service still doesn't, and four finished features are
otherwise undemonstrable. Do not let their existence make the cron look optional
— a sweep that only runs when somebody is watching is the exact inverse of what
these sweeps are for.

`scripts/simulator.test.ts` — 27 cases, pure. Covers the cleanup marker (a
predicate that mistakes a real number for a simulated one is a wipe that deletes
a tenant's customer list), determinism under a seed, input clamping, profile
weighting, and timestamp/event coherence — including an assertion that no
generated timeline walks an edge `canTransition` forbids. Everything that writes
is untested, like everything else that writes.

---

## Known-inert things, so nobody "finishes" them twice

Correct code that never runs is the recurring failure mode in this project.
Current inventory:

- **The Railway sweep cron still doesn't exist.** Expiry, overdue flags, refund
  retry, and send retry are all written, tested, and dormant. See
  `docs/deploy-sweep.md`.
- **A2P 10DLC registration** gates every real SMS. Weeks of lead time.
- **EMAIL suspension** is modelled and switchable but nothing sends email.
- **DELIVERY** has both switches — owner preference and platform suspension —
  and no delivery in the ordering flow. `deliveryAllowed()` is the read to use
  when that changes.

If something in the admin looks done, check whether the thing that runs it
exists.

**Migration `34_onboarding_checklist`** adds `OnboardingTask`, `OnboardingNote`,
and a `PlatformSetting.onboardingStepOverrides` column. Written idempotently,
**and never run** — so `prisma.onboardingTask` / `prisma.onboardingNote` don't
exist on the generated client, and the tenant page's Onboarding tab throws,
until `npx prisma generate && npm run db:push` on a real machine. The rest of
the tenant page is unaffected (the reads are on that tab's own `Promise.all`,
which runs on every load — so in practice run the migration before relying on
the page at all).

**Migration `25_support_tickets`** adds `SupportTicket`, `SupportMessage`,
`SupportNote`, and `ContactSubmission`. Written, idempotent, **and never run** —
so `prisma.supportTicket` and friends don't exist on the generated client until
someone runs `npx prisma generate && npm run db:push` on a real machine. Until
then no support page loads and the typecheck reports the usual phantom errors
(see CLAUDE.md).

Two specific things in that migration have **never executed against Postgres**
and are worth watching the first time it runs:

- the `SupportNote_one_parent` check constraint —
  `("ticketId" IS NULL) <> ("contactId" IS NULL)`, which Prisma can't express;
- the sequence default on `SupportTicket.number`, which has to survive
  `db:push` agreeing with `@default(autoincrement())` in the schema.

Notifications are **in-app only**, and that is the honest choice rather than a
missing feature. SMS is gated on A2P 10DLC and nothing in this repo sends email,
so an email notification would have been one more piece of correct code that
never runs — the exact pattern this section exists to track. The `/admin` widget
is the notification.

**Migration `23_mode_guards_and_www`** adds the payment-window columns and the
www hostname columns. Same drill as below — `npx prisma generate` locally before
the client knows about them.

**Migration `22_tenant_invites`** adds the `Invite` table. `npx prisma generate` fails in the
Claude sandbox (see CLAUDE.md), so the generated client has no `prisma.invite`
until someone runs it locally. Everything invite-shaped is written and unit
tested against a double, and none of it runs against a real database until:

```bash
npx prisma generate && npm run db:push   # or: npm run db:migrate
```

**Invites are also generated but never *sent*.** The admin copies the link and
delivers it however they like. That's honest for now — nothing in this repo
sends email, and the EMAIL suspension above is modelled against a sender that
doesn't exist. Wiring one is the obvious next step and is not a code problem
this session could have solved.


---

## Item 7, second half: help articles — done

Built as `src/lib/help-articles.ts` plus `/dashboard/support/help`. Thirteen
articles, a client-side search over them, and a "book a call" card that reads
the existing `BookingType` rows rather than standing up a second calendar.

The item was written "articles first, tickets only if articles don't absorb
it" and was built the other way round. That ordering was right and is worth
not re-litigating: you cannot write a useful article before you know what
people ask, and the ticket `category` distribution is the input. This is the
second half, now that there is something to write from.

Three decisions recorded so they don't get re-opened:

- **Articles are data, not JSX**, so the same source renders as a page and as
  the plain text an agent pastes into a ticket reply. Same reasoning as
  `lib/legal.ts`.
- **Search is client-side and substring-AND**, departing from the GET-form
  convention the analytics filter bar uses. An analytics view is something you
  paste to a colleague; a help search is something you abandon after two words.
  On thirteen articles an OR search returns most of the list for most queries,
  which reads as broken.
- **`BookACall` renders nothing when no active booking type exists.** A button
  leading to a calendar with no availability is precisely the "looks finished,
  isn't" failure this project keeps hitting.

Remaining: point the ticket form's category selector at the matching articles
(the categories already line up), and rewrite the set against real ticket
volume once there is some. See `docs/help-center.md`.
