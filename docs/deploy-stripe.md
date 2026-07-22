# Stripe payments — setup, modes, and go-live

Payments sit behind the seam in `src/lib/payments.ts`. The active mode is
**chosen in the admin dashboard** (`/admin`), stored in the database
(`PlatformSetting`), and applies to every restaurant instantly with no redeploy.

Three modes:

- **Stub** — takes nothing, reports success. No Stripe call. The default.
- **Stripe test** — real PaymentIntents against your **test** keys. Charges show
  in the Stripe test dashboard, are refundable, and move no real money.
- **Live** — real money against your **live** keys.

Because the mode is in the database, you can keep the live keys installed in
production and still run safe test buys by flipping the toggle to Stripe-test or
Stub. Every order records the mode it was charged in, so refunds always reach
the same key set even after you flip.

---

## Environment variables

Both key sets can live side by side. `PAYMENT_MODE` is only the *default* used
until an admin picks a mode in `/admin`.

| Var | What | Notes |
|---|---|---|
| `PAYMENT_MODE` | `STUB` \| `TEST` \| `LIVE` | Default mode only; admin toggle overrides it |
| `STRIPE_SECRET_KEY_TEST` | `sk_test_...` | Server only |
| `STRIPE_PUBLISHABLE_KEY_TEST` | `pk_test_...` | Mounts the card field in test mode |
| `STRIPE_SECRET_KEY_LIVE` | `sk_live_...` | Server only; add when going live |
| `STRIPE_PUBLISHABLE_KEY_LIVE` | `pk_live_...` | Mounts the card field in live mode |
| `STRIPE_CURRENCY` | `usd` (default) | |

Back-compat: a single `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
is still honoured for whichever mode its key prefix matches, so an older
single-key deploy keeps working.

`scripts/config-check.mjs` runs at boot. It errors only on a key sitting in the
wrong slot (a `sk_live_` in a test var, etc.); a missing key set is reported but
not fatal, since the admin can pick a different mode.

## Getting test keys (free, 5 min)

Stripe dashboard → toggle **Test mode** on → Developers → API keys. Copy the
`sk_test_` (secret) and `pk_test_` (publishable) keys into the `_TEST` vars.

## Running a test buy

Set `PAYMENT_MODE=TEST` (or leave it and flip to Stripe-test in `/admin`), then
place an order. With the publishable key set, checkout shows a real card field —
use Stripe's test cards:

| Card number | Behaviour |
|---|---|
| `4242 4242 4242 4242` | Succeeds, no authentication |
| `4000 0025 0000 3155` | Requires 3-D Secure (tests the challenge path) |
| `4000 0000 0000 9995` | Declined |

Any future expiry, any CVC, any ZIP. Without a publishable key, test mode still
charges server-side using Stripe's own test card, so checkout works with no
field. Charges appear under Payments in the **test** dashboard and refund from
the order board.

## The admin toggle

`/admin` → Payments card. Three buttons: Stub / Stripe test / Live. A mode whose
secret key isn't configured is disabled with a reason. The current mode shows as
a badge, and a warning appears if the chosen mode has no publishable key (card
field won't mount, though server-side charging still works).

---

## Going live

1. Finish Stripe business verification, add `STRIPE_SECRET_KEY_LIVE` /
   `STRIPE_PUBLISHABLE_KEY_LIVE`.
2. In `/admin`, switch the toggle to **Live**. (No redeploy, no env change.)
3. **Connect onboarding per restaurant.** Charges are **direct** — created on
   the restaurant's connected account — and the surcharge comes back as an
   `application_fee_amount`. That shape is what puts Stripe's processing fee on
   the restaurant's balance instead of ours, and keeps the owner's payout
   untouched. Each restaurant needs a `stripeAccountId` (`acct_...`) from
   completing Stripe onboarding. Owners do this themselves from the **Payments
   tab** in their dashboard ("Connect with Stripe" → Stripe-hosted Express
   onboarding → back to the tab), and admins can view status or paste an account
   id per account under Admin → Restaurants. Requires **Connect enabled** on the
   platform Stripe account (Settings → Connect). In test mode a missing account
   is harmless (charge lands on the platform); **live without it routes the whole
   customer bill to the platform.**
4. A webhook (`payment_intent.succeeded`, `charge.refunded`, `account.updated`)
   to reconcile out-of-band status changes is still to build — for now the owner
   refreshes Connect status with a button. Doesn't block test buys.

## Webhooks (auto-updating status)

Without a webhook, Connect status and payment state only update when someone
clicks Refresh. To make them update on their own:

1. Stripe dashboard → Developers → Webhooks → Add endpoint.
2. URL: `https://<your-app>/api/stripe/webhook`
3. Events: `account.updated`, `payment_intent.succeeded`,
   `payment_intent.payment_failed`.
4. **Check "Listen to events on connected accounts."** This is easy to miss and
   fails quietly. Because charges are direct, every `payment_intent.*` event
   fires on the *restaurant's* account, not the platform's — a platform-only
   endpoint receives `account.updated` and nothing else, so payment status stops
   updating while the webhook still looks healthy.
5. Copy the signing secret (`whsec_...`) into Railway. Use the mode-specific
   name so test and live can both run:
   - `STRIPE_WEBHOOK_SECRET_TEST=whsec_...` (from the test-mode endpoint)
   - `STRIPE_WEBHOOK_SECRET_LIVE=whsec_...` (from the live-mode endpoint)

The endpoint verifies every request's signature and tries each configured
secret, so one URL serves both modes. It only writes the Connect readiness
mirror and the payment-status string — never order status or refund totals,
which keep their single writer in `lib/orders.ts`. (External dashboard refunds
therefore aren't yet synced into `refundedCts`; that's follow-up work.)

## Refunds

Owners and admins can both issue full or partial refunds on **any** order for
any reason:

- **Owner → dashboard → History tab:** search any past order by number or phone
  and refund. (The order board also still has its inline refund controls.)
- **Admin → Orders:** the same, across every account.

Both go through the one refund path (`issueRefund` in `lib/orders.ts`), which
clamps to the un-refunded balance, records the event, and texts the customer.

## Owner & admin payment settings (in-app, no code)

- **Owner dashboard → Payments tab:** connect their Stripe account for payouts
  and see readiness, turn card payments on/off (off = pay-at-counter, fee
  waived), edit the service-fee label and their sales-tax rate, and view the
  platform's fee formula read-only.
- **Admin → dashboard overview:** the platform payment-mode toggle (Stub /
  Stripe test / Live).
- **Admin → Restaurants:** per account — surcharge %/min/max and tax, plus the
  Connect account id and a card-payments override.
