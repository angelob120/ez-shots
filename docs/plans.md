# Pricing plans

Working plan. Read before touching `src/lib/plans.ts`, `src/lib/billing.ts`, or
anything under `src/app/dashboard/(settings)/plan/`.

## Why it exists

`/pricing` has advertised three plans and "switch plans whenever you want"
since launch. The product had no concept of a plan at all: every tenant was on
what is now ZERO, and the surcharge was an admin-only setting. This closes that
gap — owners can now see, compare, switch, and pay for a plan themselves.

## The three plans are the same product

Nothing is feature-gated. What changes is who covers the cost.

| Plan | Monthly | Added to the customer's bill | Taken from the restaurant |
|---|---|---|---|
| `ZERO` | $0 | service fee, disclosed at checkout | nothing |
| `FLAT` | $399 | nothing | nothing |
| `HYBRID` | $149 | nothing | 4% of each order |

## The distinction the whole thing rests on

A **surcharge** is added on top of what the customer pays. A **commission** is
deducted from what the restaurant keeps. Both reach Stripe through
`application_fee_amount` on a direct charge, so they look identical at the API
call and are economically opposite:

- Confuse them one way and a diner is overcharged on a plan whose entire selling
  point is that they aren't.
- Confuse them the other way and a restaurant is underpaid.

`computeSurchargeCts` decides the customer's total. `platformFeeCts` decides our
cut, and only that goes in `application_fee_amount`. On ZERO they are equal — on
HYBRID they are not, and code assuming otherwise charges diners a commission the
pricing page promises they'll never see.

`ChargeInput.surchargeCts` was renamed to `applicationFeeCts` for exactly this
reason. It is named for what it is, not for the one plan where it happens to
equal the surcharge.

**Read the plan through `surchargeConfigFor()`, never off `restaurant.surchargePct`.**
That column is half the answer; the plan is the other half — the same pairing as
`cardPaymentsEnabled` / `cardPaymentsAllowed()`.

## Switching is scheduled, not prorated

A change takes effect at the billing boundary. No proration, nobody pays twice,
nobody chases a partial refund — at the cost of an owner waiting.

**One documented exception:** leaving ZERO has no cycle to wait for, so the
cycle *starts* on the first successful payment and the plan is live immediately.
`planChangeDecision` returns `immediate` only in that case.

Cases that look like edges and are not — owners do all of these:

- Re-picking your current plan is a **no-op** (a double-submit), not a change.
- Re-picking your current plan *while a switch is pending* **cancels the switch**.
  Scheduling a switch to the plan they're already on would bill them for it.
- Switching twice before the first lands **replaces** the pending plan.

## effectivePlan does not trust the cron

`effectivePlan` and `dunningState` apply a scheduled change and a lapse **on
read**, from the clock. `lib/plan-sweep.ts` materialises the row afterwards.

That ordering is deliberate and matters more here than anywhere else in the
repo, because **the Railway cron still does not exist** (`docs/deploy-sweep.md`).
If the truth lived only in the sweep, a restaurant would keep being billed for a
plan they cancelled a month ago and the first anyone would hear of it is a
chargeback.

## Money towards us, not through us

`lib/billing.ts` is the only module where money flows to the platform rather
than through it. Consequences:

- **No `Stripe-Account` header, ever.** Every call is platform-scoped. That
  header would create the customer and subscription on the *restaurant's*
  account, billing their diners and invisible to us.
- `stripeCustomerId` (owner paying us) and `stripeAccountId` (diners paying the
  restaurant) are different objects in different places, in separate columns.
- The card is tokenized on the **platform** account — `PlanPicker` passes
  `stripeAccount: null`, unlike the storefront checkout. A payment method is
  scoped to whichever account tokenized it.
- `assertPriceSanity` refuses to bill when the Stripe Price disagrees with
  `PLAN_SPECS`. The Price is configured out-of-band and can drift; the failure
  is silent and in our favour, which is the worst kind.

## Failed payments drop to ZERO, never to a suspension

14 days of grace, then the tenant moves to the free plan and keeps trading.
Suspending a restaurant that can't hand over food it already made is wildly
disproportionate to an expired card.

**But the consequence is a change to their pricing that they didn't choose** —
their customers start seeing a service fee. That's why the grace banner is the
loudest thing on `/dashboard/plan`, why it counts down in days, and why it names
the date.

`invoice.payment_failed` stamps `planPastDueSince` **only when it's null**.
Stripe retries a failed invoice several times over ~2 weeks and each retry hits
that webhook; resetting the clock each time means the grace period never expires.

## Tests

`scripts/plans.test.ts` — 32 cases, pure. Four groups: the catalog matching what
`/pricing` advertises, surcharge-versus-commission arithmetic (including that
commission is charged on food and not on sales tax), the switching edges above,
and the dunning window.

`lib/billing.ts` and `lib/plan-sweep.ts` are untested — both are Stripe-shaped.
That's the gap below.

## What's left

**Blocking, and neither is code:**

1. **Migration `29_pricing_plans` has never run.** `npx prisma generate && npm
   run db:push`, alongside the other unrun migrations in `CLAUDE.md`.
2. **Stripe Prices don't exist.** Create two recurring monthly prices in the
   Stripe dashboard — $399 and $149 — and set `STRIPE_PRICE_FLAT` and
   `STRIPE_PRICE_HYBRID`. Until then `billingConfigured()` is false, the plan
   page says so, and ZERO works normally. Add `invoice.paid`,
   `invoice.payment_failed` and `customer.subscription.deleted` to the webhook
   endpoint.

**Then, in order:**

3. **Nobody is told when they lapse.** The banner warns for 14 days, but the
   downgrade itself sends nothing. A tenant discovering it from a customer
   complaining about a new fee is the bad version of this feature. `lib/email.ts`
   exists and the send is a few lines. **P1.**
4. **HYBRID's 4% is invisible to the owner.** They see it in the plan comparison
   and nowhere else — not on the order board, not in analytics, not as a monthly
   statement. A commission you can't reconcile is one you stop trusting. **P1.**
5. **No admin view of plans.** `/admin/restaurants/[id]` has a Pricing tab that
   still only shows the surcharge. Admins can't see who's on what, who's in
   grace, or move somebody manually — and "we'll put you on Flat for a month" is
   a thing a founder does on a sales call. **P2.**
6. **`billing.ts` has no tests.** The pure decisions are covered; the Stripe
   calls are not. Same shape as the gap `orders.concurrency.test.ts` closed.
   The 3-D Secure path on a subscription is the least-exercised branch. **P2.**
7. **The plan isn't in the onboarding wizard.** New tenants land on ZERO by
   default, which is right, but they never see the choice. P3.
8. **Annual billing, and a trial.** Neither exists. P3.
