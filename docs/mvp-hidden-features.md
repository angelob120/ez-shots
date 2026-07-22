# Features hidden for the MVP

**Read this before concluding a feature is missing, broken, or worth
rebuilding.** Three finished features are switched off in the first version.
None of them was deleted. All of the code, all of the tests and all of the
database schema are still here.

The switches are compile-time constants in `src/lib/features.ts`. Turning one
back on is a `false → true` edit plus the checklist in this document.

| Feature | Flag | Code deleted? | Schema touched? |
|---|---|---|---|
| Google / Apple sign-in | `FEATURES.oauthSignIn` | No | No |
| Customer accounts | `FEATURES.customerAccounts` | No | No |
| FLAT and HYBRID plans | `FEATURES.multiplePlans` | No | No |

---

## Why flags rather than deletion

Deleting would have meant dropping `OAuthIdentity` and `CustomerAccount`,
writing migrations to remove them, and rewriting `lib/plans.ts` around a single
plan. Re-adding in v2 would then be a rebuild rather than a revert, and the
reasoning in the comments — which is the expensive part, not the code — would
be gone with it.

Two rules keep that decision honest:

**Each flag is enforced at a choke point, not sprinkled through the pages.**
One function in one module that every surface already calls. That is what keeps
re-enabling to a one-line change, and it is also what prevents a half-hidden
feature: a page nobody remembered to gate still goes through the same function.

**Nothing here is per-tenant or runtime-configurable, deliberately.** No
environment variable and no `PlatformSetting`. An env var means the answer to
"is customer sign-in on?" depends on which machine you ask; a constant means
the answer is readable in the diff. `src/lib/features.ts` must not grow into a
feature-flag system.

---

## 1. Google / Apple sign-in

### Choke points

- `providerConfigured()` in `src/lib/oauth.ts` returns `false`.
- `providerButtons()` in the same file returns `[]`.

The second is **not** redundant. The preview placeholder ("coming soon")
renders precisely *because* a provider is unconfigured, so without its own
check the login page and every storefront would still draw two dead buttons.

With those two returning false and empty, everything downstream follows on its
own: `providerConfig()` returns null, both `/api/auth/[provider]` routes
redirect to `/login?oauth=unavailable`, and `OAuthButtons` renders `null`. Those
are the paths a deployment with no credentials always took, so nothing new had
to be made correct.

### Surfaces that also changed

| File | Change |
|---|---|
| `src/app/dashboard/(settings)/SettingsTabs.tsx` | The "Sign-in" tab is conditional. |
| `src/app/dashboard/(settings)/sign-in/page.tsx` | `notFound()` when the flag is off — a bookmarked URL would otherwise render an empty settings page. |

`src/app/login/page.tsx` needed no change: `OAuthButtons` returns null on an
empty button list, and the `?oauth=` error banner is unreachable because nothing
can start a flow.

### To restore

1. Set `oauthSignIn: true` in `src/lib/features.ts`.
2. Run `npx prisma generate && npm run db:push` on a real machine — migration
   `27_oauth_accounts` **has still never run**. This was true before the flag
   existed and the flag did not change it.
3. Create the Google OAuth client and the Apple Services ID by hand in both
   consoles, and set `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`,
   `APPLE_OAUTH_CLIENT_ID`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`,
   `APPLE_PRIVATE_KEY`. See `docs/SETUP-your-turn.md`.
4. Set `OAUTH_PREVIEW_BUTTONS=0` in production before diners see a storefront.
5. `npm test` — six skipped cases in `scripts/oauth.test.ts` come back
   automatically, because they are gated on the same flag rather than deleted.

### What the flag does *not* do

`staffLinkDecision` is untouched, and `scripts/oauth.test.ts` asserts that
directly. **An OAuth sign-in still cannot create an operator account**, and it
must never be the case that hiding the buttons is what enforces that — if it
were, un-hiding them would be a security change rather than a UI one.

---

## 2. Customer accounts

### Choke point

`getCustomerSession()` in `src/lib/customer-session.ts` returns `null`.

Returning null means "nobody is signed in", which is the ordinary case on a
storefront — an account was always a convenience layered on an ordering flow
that never required one — so every caller already handles it.

Gated on the **read** rather than the write on purpose: a diner who signed in
before the flag went on is simply signed out, not shown a half-working page
against a stale cookie.

### Surfaces that also changed

| File | Change |
|---|---|
| `src/app/r/[slug]/account/page.tsx` | `notFound()`. A redirect to the storefront would imply signing in first would have worked, and nothing can sign them in. |

`StoreApp.tsx` needed no change: `StorefrontAccount` already returns null when
the provider list is empty, which it is because OAuth is off.

### To restore

1. Set `customerAccounts: true` **and** `oauthSignIn: true`.
   **They are not independent.** OAuth is the only way a customer account is
   ever created; turning this one on alone produces a page nobody can reach.
2. Complete the OAuth checklist above, including migration `27_oauth_accounts`.

### What the flag does *not* do

Nothing about consent. `Customer.optInStatus` is written at checkout and
nowhere else, and a customer account was never consent — see the rule in
`CLAUDE.md`. Hiding this does not weaken the SMS gate and restoring it does not
strengthen it. `placeOrderAction` is still the only place `customerId` is
linked, because a `Customer` is keyed by phone and a sign-in supplies an email.

---

## 3. FLAT and HYBRID plans

The MVP sells **ZERO** — the disclosed customer surcharge, which `CLAUDE.md`
calls the entire revenue model and which is the only plan needing no recurring
billing to work on day one.

### Choke point

`VISIBLE_PLANS` in `src/lib/plans.ts`.

**This hides plans from the pickers, not from the arithmetic, and the two lists
must never be merged.** `PLANS`, `PLAN_SPECS`, `surchargeConfigFor`,
`platformFeeCts` and `effectivePlan` all still know about all three, and they
have to: a tenant already sitting on FLAT must keep being billed correctly
while the card offering it is hidden, and `effectivePlan` reads their row from
the database rather than from a display list.

Route the arithmetic through `VISIBLE_PLANS` and a FLAT restaurant's diners
start being charged a service fee the pricing page promised them they would
never see. `scripts/plans.test.ts` asserts against exactly that.

### Surfaces that also changed

| File | Change |
|---|---|
| `src/app/(site)/pricing/page.tsx` | `ALL_PLANS` filtered by `VISIBLE_PLANS`; `SINGLE_PLAN` swaps the headline, the sub-head and the grid to a one-card layout. The cards were filtered rather than edited down, so restoring is a flag flip and not a copywriting job — `Plan.id` matching the lower-cased union is what makes the filter work, so keep that correspondence. |
| `src/app/dashboard/(settings)/plan/PlanPicker.tsx` | Imports `VISIBLE_PLANS as PLANS`. |
| `src/app/dashboard/(settings)/plan/actions.ts` | `isSelectablePlan` re-checked server-side. Hiding a control is a courtesy, not enforcement — and this path ends in a Stripe subscription on the platform account. |
| `src/app/dashboard/(settings)/SettingsTabs.tsx` | The "Plan" tab is conditional. |

**`/dashboard/plan` is deliberately still reachable**, just unlinked. It is
where a tenant on a paid plan would go to end it, and 404ing somebody's billing
page to tidy up a nav strip is the wrong trade. Revisit if a paid tenant ever
exists in production.

### To restore

1. Set `multiplePlans: true`.
2. Check `src/lib/billing.ts` against a real Stripe account — subscriptions are
   on the **platform** account and nothing in that file may send a
   `Stripe-Account` header. That has never been exercised against live Stripe.
3. Re-read the copy on `/pricing`: the single-plan strings claim we're "working
   on" a plan where the owner covers the software. Once FLAT is back, that
   sentence is false.

---

## Marketing copy that assumes one plan

Three strings on `/pricing` were rewritten for the single-plan world and will
be wrong the moment `multiplePlans` goes true. All are inside the `SINGLE_PLAN`
branches or immediately adjacent to them:

- the hero: "No monthly bill." (was "Three ways to pay for it.")
- the sub-head, which now describes the surcharge rather than comparing plans
- the fee-table footnote, which says we're working on a plan where you cover the
  software yourself — that plan is FLAT, and it exists

The page `<title>` and meta description were changed too.

---

## Tests

`npm test` is green with the flags off.

- `scripts/oauth.test.ts` — six credential-reading cases are **skipped**, not
  deleted, gated on `FEATURES.oauthSignIn`. Two new cases assert the kill
  switch directly: that a *fully* configured environment still draws no
  buttons (so "hidden by flag" cannot be confused with "hidden because nothing
  is set up"), and that the invite-only rule is independent of visibility.
- `scripts/plans.test.ts` — three new cases: every plan still prices whether or
  not it is offered, the visible list is a non-empty subset containing
  `DEFAULT_PLAN`, and `isSelectablePlan` agrees with it.
