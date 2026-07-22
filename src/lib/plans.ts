/**
 * Pricing plans — **the one place that decides who pays for the software.**
 *
 * Pure: no database, no Stripe, no `server-only`. Everything here is arithmetic
 * and state transitions, which is deliberate, because every function in this
 * file either moves money or decides whether a restaurant keeps trading.
 *
 * ## The three plans are the same product
 *
 * Nothing is feature-gated. What changes is *who covers the cost*, and there
 * are only two levers:
 *
 * | Plan   | Monthly | Added to the customer's bill | Taken from the restaurant |
 * |--------|---------|------------------------------|---------------------------|
 * | ZERO   | $0      | service fee, disclosed       | nothing                   |
 * | FLAT   | $399    | nothing                      | nothing                   |
 * | HYBRID | $149    | nothing                      | 4% of the order           |
 *
 * ## The distinction that the whole file exists to keep straight
 *
 * A **surcharge** is added on top of what the customer pays. A **commission**
 * is deducted from what the restaurant keeps. Both arrive at Stripe as
 * `application_fee_amount` on a direct charge, which makes them look identical
 * at the point of the API call and they are not:
 *
 * - Get a surcharge wrong and a customer is overcharged.
 * - Get a commission wrong and a restaurant is underpaid.
 *
 * So `computeSurchargeCts` decides the customer's total and
 * `platformFeeCts` decides our cut, and only the second one is what goes in
 * `application_fee_amount`. On ZERO they happen to be equal. On HYBRID they are
 * not, and code that assumes they are will silently charge diners a commission
 * the pricing page promises them they will never see.
 *
 * ## Switching is scheduled, not immediate
 *
 * A plan change takes effect at the next billing boundary. That avoids
 * proration entirely — nobody pays twice for a month and nobody has to chase a
 * partial refund — at the cost of an owner waiting. One exception, in
 * `changeTakesEffectAt`: moving off ZERO has no cycle to wait for, so the cycle
 * *starts* on the first successful payment and the plan is live from then.
 */

import { FEATURES } from "@/lib/features";

export type Plan = "ZERO" | "FLAT" | "HYBRID";

export const PLANS: Plan[] = ["ZERO", "FLAT", "HYBRID"];

/**
 * The plans a human may **choose**, as opposed to the plans that exist.
 *
 * The distinction is the whole point and the two lists must not be merged. A
 * tenant already on FLAT keeps being billed by `PLAN_SPECS` and
 * `surchargeConfigFor` whether or not FLAT appears here, because `effectivePlan`
 * reads their row from the database — hiding a card must never change what
 * somebody is charged. This list only decides what the pricing page and the
 * plan picker draw.
 *
 * MVP: ZERO only. See `lib/features.ts` and `docs/mvp-hidden-features.md`.
 */
export const VISIBLE_PLANS: Plan[] = FEATURES.multiplePlans ? PLANS : ["ZERO"];

/** Whether a plan may still be selected. Never a billing question. */
export function isSelectablePlan(plan: Plan): boolean {
  return VISIBLE_PLANS.includes(plan);
}

export function isPlan(v: string): v is Plan {
  return v === "ZERO" || v === "FLAT" || v === "HYBRID";
}

export type PlanSpec = {
  id: Plan;
  name: string;
  /** Monthly price in integer cents, charged to the owner. 0 for ZERO. */
  monthlyCts: number;
  /**
   * Commission on each order, in basis points, deducted from the restaurant's
   * proceeds. 400 = 4%. Never added to the customer's bill.
   */
  commissionBps: number;
  /**
   * Whether a service fee is added to the customer's bill. True only on ZERO —
   * this is the flag that keeps a diner from being charged for a plan the
   * restaurant chose to pay for itself.
   */
  chargesCustomer: boolean;
  /** One line, for the plan cards. */
  pitch: string;
};

export const PLAN_SPECS: Record<Plan, PlanSpec> = {
  ZERO: {
    id: "ZERO",
    name: "Zero Monthly",
    monthlyCts: 0,
    commissionBps: 0,
    chargesCustomer: true,
    pitch:
      "A small service fee rides on the customer's ticket, disclosed before they pay. Nothing leaves your account.",
  },
  FLAT: {
    id: "FLAT",
    name: "Flat Subscription",
    monthlyCts: 39_900,
    commissionBps: 0,
    chargesCustomer: false,
    pitch: "You cover the software yourself so nothing shows up on the customer's ticket.",
  },
  HYBRID: {
    id: "HYBRID",
    name: "Subscription + Commission",
    monthlyCts: 14_900,
    commissionBps: 400,
    chargesCustomer: false,
    pitch: "A lower monthly in exchange for four percent of every order that comes through.",
  },
};

/** The plan every tenant starts on, and the one they fall back to. */
export const DEFAULT_PLAN: Plan = "ZERO";

export function planSpec(plan: Plan): PlanSpec {
  return PLAN_SPECS[plan];
}

export function isPaidPlan(plan: Plan): boolean {
  return PLAN_SPECS[plan].monthlyCts > 0;
}

/* ── What a plan does to an order ───────────────────────────────────────── */

export type SurchargeConfig = {
  surchargePct: number;
  surchargeMinCts: number;
  surchargeMaxCts: number;
  taxPct: number;
};

/**
 * The surcharge config to actually use, given the plan.
 *
 * On a paid plan every surcharge field is forced to zero rather than merely
 * ignored downstream. The tenant's configured rate is left untouched in the
 * database so that dropping back to ZERO restores what they had — but nothing
 * reading this function can accidentally apply it.
 *
 * **Call this instead of reading `restaurant.surchargePct` directly.** That
 * column is half the answer; the plan is the other half. Exactly the same
 * pairing as `cardPaymentsEnabled` / `cardPaymentsAllowed()` in
 * `lib/entitlements.ts`, and for the same reason.
 */
export function surchargeConfigFor(plan: Plan, configured: SurchargeConfig): SurchargeConfig {
  if (PLAN_SPECS[plan].chargesCustomer) return configured;
  return {
    surchargePct: 0,
    surchargeMinCts: 0,
    surchargeMaxCts: 0,
    // Sales tax is the restaurant's legal obligation and has nothing to do with
    // which plan they bought. Zeroing it here would be tax evasion by typo.
    taxPct: configured.taxPct,
  };
}

/**
 * What we take from a single order, as `application_fee_amount`.
 *
 * On ZERO this is the surcharge the customer already paid — money that arrived
 * *because* of us and passes straight through. On HYBRID it is a slice of the
 * restaurant's own revenue. On FLAT it is nothing.
 *
 * Clamped to the charge amount because Stripe rejects an application fee larger
 * than the charge, and a 4% commission on a subtotal cannot exceed a total that
 * includes tax — so the clamp is a guard against a bad config, not a live
 * concern.
 */
export function platformFeeCts(
  plan: Plan,
  amounts: { subtotalCts: number; surchargeCts: number; totalCts: number }
): number {
  const spec = PLAN_SPECS[plan];

  // Never both. A plan that charged the customer a fee *and* took a commission
  // would be double-dipping, and no plan in the catalog does it — but the
  // arithmetic below would happily produce it if the flags were ever both set.
  const fee = spec.chargesCustomer
    ? amounts.surchargeCts
    : Math.round((amounts.subtotalCts * spec.commissionBps) / 10_000);

  return Math.max(0, Math.min(fee, amounts.totalCts));
}

/**
 * The commission alone, for showing an owner what a plan costs them.
 * Not used to move money — `platformFeeCts` is the one that does that.
 */
export function commissionCts(plan: Plan, subtotalCts: number): number {
  return Math.round((subtotalCts * PLAN_SPECS[plan].commissionBps) / 10_000);
}

/**
 * What a month on each plan would have cost, given a month of trade.
 *
 * The comparison an owner actually wants and cannot easily do in their head,
 * because the plans are denominated in different things. Note the customer-paid
 * column: on ZERO the owner's cost is genuinely zero, and the honest way to
 * present that is alongside what their customers paid rather than instead of
 * it.
 */
export function monthlyCostBreakdown(
  plan: Plan,
  month: { orderCount: number; subtotalCts: number; surchargeCts: number }
): { ownerPaysCts: number; customersPaidCts: number } {
  const spec = PLAN_SPECS[plan];
  return {
    ownerPaysCts: spec.monthlyCts + commissionCts(plan, month.subtotalCts),
    customersPaidCts: spec.chargesCustomer ? month.surchargeCts : 0,
  };
}

/* ── Switching ──────────────────────────────────────────────────────────── */

export type SubscriptionState = {
  plan: Plan;
  /** Scheduled switch, if the owner has asked for one. */
  pendingPlan: Plan | null;
  /** End of the paid period. Null on ZERO, which has no billing period. */
  currentPeriodEnd: Date | null;
  /** Set when a payment has failed and the grace clock is running. */
  pastDueSince: Date | null;
};

export type ChangeDecision =
  | { kind: "rejected"; reason: string }
  /** Live now. Only when there is no period to wait for — i.e. leaving ZERO. */
  | { kind: "immediate"; plan: Plan; needsPayment: boolean }
  /** Takes effect at the period boundary. */
  | { kind: "scheduled"; plan: Plan; effectiveAt: Date }
  /** Undoing a scheduled change that has not happened yet. */
  | { kind: "cancelled_pending"; plan: Plan };

/**
 * Whether an owner may switch, and when it lands.
 *
 * Pure so the awkward cases are testable without a Stripe account, and there
 * are more of them than the feature suggests: switching to the plan you are
 * already on, switching twice before the first switch lands, and switching
 * while a payment is failing are all things owners do.
 */
export function planChangeDecision(
  state: SubscriptionState,
  target: Plan,
  now: Date
): ChangeDecision {
  if (!isPlan(target)) return { kind: "rejected", reason: "That isn't a plan we offer." };

  // Asking for the plan you already have, with nothing scheduled, is a no-op
  // rather than an error — usually a double-submit.
  if (target === state.plan && !state.pendingPlan) {
    return { kind: "rejected", reason: `You're already on ${PLAN_SPECS[target].name}.` };
  }

  // Choosing your current plan again while a switch is pending means "actually,
  // stay where I am". That is a cancel, not a change, and it must not be
  // treated as a new scheduled switch — doing so would leave a pending row
  // pointing at the plan they are already on and bill them for it.
  if (target === state.plan && state.pendingPlan) {
    return { kind: "cancelled_pending", plan: state.plan };
  }

  // Leaving the free plan starts a billing cycle rather than waiting for one,
  // so there is nothing to schedule against. This is the documented exception
  // to "changes take effect next cycle": the next cycle is the first cycle, and
  // it begins the moment they pay.
  if (!isPaidPlan(state.plan)) {
    return { kind: "immediate", plan: target, needsPayment: isPaidPlan(target) };
  }

  // Already paid for this month, so the switch waits for the boundary. Nobody
  // pays twice and nobody has to chase a partial refund.
  const effectiveAt = state.currentPeriodEnd ?? now;
  return { kind: "scheduled", plan: target, effectiveAt };
}

/**
 * The plan actually in force right now.
 *
 * Reads `pendingPlan` only once its effective date has passed, so a scheduled
 * switch applies on its own even if the sweep that was supposed to materialise
 * it has not run. The sweep writing the row is the tidy-up; this is the truth.
 * The alternative — trusting a cron to have run — is how a restaurant ends up
 * on a plan they cancelled a month ago.
 */
export function effectivePlan(state: SubscriptionState, now: Date): Plan {
  if (state.pendingPlan && state.currentPeriodEnd && now >= state.currentPeriodEnd) {
    return state.pendingPlan;
  }
  return state.plan;
}

/* ── Dunning ────────────────────────────────────────────────────────────── */

/**
 * How long a failed payment is tolerated before the plan drops to ZERO.
 *
 * Fourteen days because that is long enough to cover an expired card, a
 * holiday, and an owner who only reads email on Sundays. The cost of being
 * generous here is a fortnight of unpaid software; the cost of being strict is
 * a restaurant's pricing changing under them over a card decline.
 */
export const GRACE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type DunningState =
  | { kind: "ok" }
  | { kind: "grace"; daysLeft: number; downgradesAt: Date }
  | { kind: "lapsed"; downgradeTo: Plan };

/**
 * What to do about a subscription whose payment failed.
 *
 * The downgrade target is always ZERO, never "suspend". A suspended restaurant
 * cannot hand paid-for food to a customer standing at the counter, and that is
 * a disproportionate response to a card decline. Dropping to ZERO keeps them
 * trading.
 *
 * **The consequence has to be shouted about before it happens**, and that is
 * why this returns `daysLeft` rather than a boolean: on ZERO their customers
 * start seeing a service fee, which is a change to their pricing that the owner
 * did not consciously choose. An owner who is surprised by that is entitled to
 * be angry. See the banner on `/dashboard/plan`.
 */
export function dunningState(state: SubscriptionState, now: Date): DunningState {
  if (!state.pastDueSince) return { kind: "ok" };
  if (!isPaidPlan(state.plan)) return { kind: "ok" }; // nothing owed on ZERO

  const downgradesAt = new Date(state.pastDueSince.getTime() + GRACE_DAYS * DAY_MS);
  if (now >= downgradesAt) return { kind: "lapsed", downgradeTo: DEFAULT_PLAN };

  return {
    kind: "grace",
    // Ceiling: with 6 hours left an owner should be told "1 day", not "0 days".
    daysLeft: Math.max(1, Math.ceil((downgradesAt.getTime() - now.getTime()) / DAY_MS)),
    downgradesAt,
  };
}

/**
 * Whether a tenant may keep using paid-plan behaviour right now.
 *
 * True throughout the grace period — the point of a grace period is that
 * nothing changes while it runs. Only a lapse flips it.
 */
export function planBenefitsActive(state: SubscriptionState, now: Date): boolean {
  return dunningState(state, now).kind !== "lapsed";
}
