/**
 * MVP feature visibility — **the one place that hides a finished feature.**
 *
 * Pure: no database, no `server-only`, no environment variables. Client
 * components import it, which is why it cannot reach a database, and the flags
 * are compile-time constants rather than env vars on purpose. An env var means
 * the answer to "is customer sign-in on?" depends on which machine you ask, and
 * the whole point of this file is that the answer is readable in the diff.
 *
 * ## What this is not
 *
 * This is not a feature-flag system and must not grow into one. Nothing here is
 * per-tenant, nothing is toggled at runtime, and nothing is read from a
 * `PlatformSetting`. Every flag below is a **temporary** `false` covering code
 * that is written, tested and deliberately not shipped in the first version.
 *
 * ## The rule that makes this safe to reverse
 *
 * Each flag is enforced at a **choke point** — one function in one module that
 * every surface already calls — rather than by sprinkling `if` statements
 * through the pages. That is what keeps re-enabling a feature to a one-line
 * change here, and it is also what stops a half-hidden feature: a page nobody
 * remembered to gate still goes through the same function.
 *
 * The choke points are named against each flag. **If you add a surface for a
 * hidden feature, route it through the existing choke point rather than reading
 * the flag directly** — a second reader is a second place for the two to
 * disagree, which is how a feature comes back on for one page only.
 *
 * `docs/mvp-hidden-features.md` has the full restore procedure for each.
 */

export const FEATURES = {
  /**
   * Sign in with Google and Apple, for operators and for diners.
   *
   * Choke points: `providerConfigured()` and `providerButtons()` in
   * `lib/oauth.ts`. With those returning false and `[]`, every button
   * disappears, `providerConfig()` returns null, and both `/api/auth/[provider]`
   * routes bounce to `/login?oauth=unavailable` — the path they already took on
   * a deployment with no credentials, so nothing new has to be correct.
   *
   * Off because it is the one feature in the product that cannot be finished by
   * writing code: it needs a Google OAuth client and an Apple Services ID
   * created by hand in two consoles, plus migration `27_oauth_accounts`.
   */
  oauthSignIn: false,

  /**
   * Customer accounts on the storefront — `/r/[slug]/account`, the past-orders
   * list, and the prefilled name at checkout.
   *
   * Choke point: `getCustomerSession()` in `lib/customer-session.ts`, which
   * returns null. Every reader already handles a signed-out diner, because
   * signed-out is the ordinary case on a storefront — an account was always a
   * convenience layered on top of an ordering flow that never required one.
   *
   * Off with `oauthSignIn`, and not independent of it: OAuth is the only way a
   * customer account is ever created. Turning this on alone produces a page
   * nobody can reach.
   *
   * **This changes nothing about consent.** `Customer.optInStatus` is written
   * at checkout and nowhere else, and a customer account was never consent —
   * see the rule in `CLAUDE.md`. Hiding it does not weaken the gate and turning
   * it back on does not strengthen it.
   */
  customerAccounts: false,

  /**
   * The FLAT ($399) and HYBRID ($149 + 4%) plans.
   *
   * Choke point: `VISIBLE_PLANS` in `lib/plans.ts`. Note this hides them from
   * the **pickers**, not from the arithmetic: `PLAN_SPECS`, `surchargeConfigFor`
   * and `platformFeeCts` still know all three, and they have to. A tenant
   * already sitting on FLAT must keep being billed correctly while the card
   * offering it is hidden, and `effectivePlan` reads from the database rather
   * than from this list.
   *
   * Off because a paid plan is a subscription on the platform Stripe account
   * (`lib/billing.ts`), and the MVP sells the surcharge — which is the entire
   * revenue model per `CLAUDE.md`, and the only plan that needs no recurring
   * billing to work on day one.
   */
  multiplePlans: false,
} as const;
