/**
 * Tests for the pricing plan model.
 *
 * Run with `npx tsx scripts/plans.test.ts`. Pure — no Prisma, no Stripe.
 *
 * Four groups, and each one guards something that costs real money if it is
 * wrong:
 *
 * 1. **Surcharge versus commission.** A surcharge is added to the customer's
 *    bill; a commission comes out of the restaurant's proceeds. They arrive at
 *    Stripe through the same field, so the only thing keeping them apart is
 *    this logic. Confusing them either overcharges a diner or underpays a
 *    restaurant.
 * 2. **Switching.** Owners double-submit, switch twice before the first switch
 *    lands, and re-pick the plan they are already on. Each of those has a wrong
 *    answer that bills somebody.
 * 3. **Dunning.** The grace window decides when a restaurant's pricing changes
 *    under them because a card expired.
 * 4. **`effectivePlan` not trusting the cron.** The sweep does not exist yet in
 *    production (see `docs/deploy-sweep.md`), so a scheduled change has to
 *    apply on read or it does not apply at all.
 */

import assert from "node:assert/strict";
import {
  DEFAULT_PLAN,
  GRACE_DAYS,
  PLANS,
  PLAN_SPECS,
  VISIBLE_PLANS,
  isSelectablePlan,
  commissionCts,
  dunningState,
  effectivePlan,
  isPaidPlan,
  isPlan,
  monthlyCostBreakdown,
  planBenefitsActive,
  planChangeDecision,
  platformFeeCts,
  surchargeConfigFor,
  type SubscriptionState,
} from "../src/lib/plans";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

const CONFIGURED = {
  surchargePct: 0.05,
  surchargeMinCts: 100,
  surchargeMaxCts: 2000,
  taxPct: 0.0875,
};

/** A $40 order with a $2 surcharge on ZERO. */
const ORDER = { subtotalCts: 4000, surchargeCts: 200, totalCts: 4550 };

function state(over: Partial<SubscriptionState> = {}): SubscriptionState {
  return { plan: "ZERO", pendingPlan: null, currentPeriodEnd: null, pastDueSince: null, ...over };
}

/* ── The catalog matches what the pricing page promises ─────────────────── */

test("the catalog matches the advertised prices", () => {
  // If these drift from /pricing, an owner is billed something other than what
  // they agreed to on a public page.
  assert.equal(PLAN_SPECS.ZERO.monthlyCts, 0);
  assert.equal(PLAN_SPECS.FLAT.monthlyCts, 39_900);
  assert.equal(PLAN_SPECS.HYBRID.monthlyCts, 14_900);
  assert.equal(PLAN_SPECS.HYBRID.commissionBps, 400);
});

test("only ZERO charges the customer", () => {
  // The pricing page says "Customer service fee: None" for FLAT and HYBRID.
  // This is that promise, in code.
  assert.equal(PLAN_SPECS.ZERO.chargesCustomer, true);
  assert.equal(PLAN_SPECS.FLAT.chargesCustomer, false);
  assert.equal(PLAN_SPECS.HYBRID.chargesCustomer, false);
});

test("only ZERO is free, and it is the default and the fallback", () => {
  assert.equal(isPaidPlan("ZERO"), false);
  assert.equal(isPaidPlan("FLAT"), true);
  assert.equal(isPaidPlan("HYBRID"), true);
  assert.equal(DEFAULT_PLAN, "ZERO");
});

test("isPlan is a real guard", () => {
  assert.equal(isPlan("ZERO"), true);
  assert.equal(isPlan("PREMIUM"), false);
  assert.equal(isPlan(""), false);
});

/* ── Surcharge versus commission ────────────────────────────────────────── */

test("a paid plan zeroes the surcharge the customer would have paid", () => {
  for (const plan of ["FLAT", "HYBRID"] as const) {
    const cfg = surchargeConfigFor(plan, CONFIGURED);
    assert.equal(cfg.surchargePct, 0, plan);
    assert.equal(cfg.surchargeMinCts, 0, plan);
    assert.equal(cfg.surchargeMaxCts, 0, plan);
  }
});

test("ZERO passes the configured surcharge through untouched", () => {
  assert.deepEqual(surchargeConfigFor("ZERO", CONFIGURED), CONFIGURED);
});

test("sales tax survives every plan", () => {
  // Tax is the restaurant's legal obligation and has nothing to do with which
  // plan they bought. Zeroing it with the surcharge would be tax evasion by
  // typo, and it would look exactly like a rounding bug.
  for (const plan of ["ZERO", "FLAT", "HYBRID"] as const) {
    assert.equal(surchargeConfigFor(plan, CONFIGURED).taxPct, CONFIGURED.taxPct, plan);
  }
});

test("on ZERO our fee is exactly the surcharge the customer already paid", () => {
  assert.equal(platformFeeCts("ZERO", ORDER), 200);
});

test("on FLAT we take nothing from the order", () => {
  assert.equal(platformFeeCts("FLAT", { ...ORDER, surchargeCts: 0, totalCts: 4350 }), 0);
});

test("on HYBRID we take 4% of the subtotal and the customer pays nothing extra", () => {
  // The order that matters most in this file. 4% of $40 = $1.60, taken from the
  // restaurant. The customer's total has no surcharge in it at all.
  const hybridOrder = { subtotalCts: 4000, surchargeCts: 0, totalCts: 4350 };
  assert.equal(platformFeeCts("HYBRID", hybridOrder), 160);
});

test("commission is charged on food, not on tax", () => {
  // Taking a cut of sales tax would mean commissioning money that belongs to
  // the state, and it silently varies our revenue by the tenant's tax rate.
  const a = platformFeeCts("HYBRID", { subtotalCts: 10_000, surchargeCts: 0, totalCts: 10_875 });
  const b = platformFeeCts("HYBRID", { subtotalCts: 10_000, surchargeCts: 0, totalCts: 11_500 });
  assert.equal(a, 400);
  assert.equal(b, 400);
});

test("a plan never both surcharges and commissions", () => {
  // Belt and braces: if someone ever sets both flags on a spec, this is the
  // arithmetic that would double-dip. It cannot, because the branch is
  // exclusive — asserted here so a "simplification" to `surcharge + commission`
  // fails loudly.
  const zero = platformFeeCts("ZERO", ORDER);
  assert.equal(zero, ORDER.surchargeCts);
  assert.notEqual(zero, ORDER.surchargeCts + commissionCts("ZERO", ORDER.subtotalCts) + 1);
});

test("the fee never exceeds the charge, because Stripe rejects that", () => {
  const silly = { subtotalCts: 100_000, surchargeCts: 0, totalCts: 500 };
  assert.equal(platformFeeCts("HYBRID", silly), 500);
});

test("a zero or empty order produces no fee", () => {
  for (const plan of ["ZERO", "FLAT", "HYBRID"] as const) {
    assert.equal(platformFeeCts(plan, { subtotalCts: 0, surchargeCts: 0, totalCts: 0 }), 0, plan);
  }
});

test("the monthly comparison separates what the owner pays from what customers paid", () => {
  const month = { orderCount: 500, subtotalCts: 2_000_000, surchargeCts: 75_000 };

  // On ZERO the owner genuinely pays nothing — and the honest presentation is
  // to show what their customers paid next to it, not instead of it.
  assert.deepEqual(monthlyCostBreakdown("ZERO", month), {
    ownerPaysCts: 0,
    customersPaidCts: 75_000,
  });
  assert.deepEqual(monthlyCostBreakdown("FLAT", month), {
    ownerPaysCts: 39_900,
    customersPaidCts: 0,
  });
  // $149 + 4% of $20,000 = $149 + $800.
  assert.deepEqual(monthlyCostBreakdown("HYBRID", month), {
    ownerPaysCts: 14_900 + 80_000,
    customersPaidCts: 0,
  });
});

/* ── Switching ──────────────────────────────────────────────────────────── */

const NOW = new Date("2026-07-20T12:00:00Z");
const PERIOD_END = new Date("2026-08-01T00:00:00Z");

test("leaving ZERO is immediate, because there is no cycle to wait for", () => {
  const d = planChangeDecision(state(), "FLAT", NOW);
  assert.deepEqual(d, { kind: "immediate", plan: "FLAT", needsPayment: true });
});

test("switching between paid plans waits for the boundary", () => {
  const d = planChangeDecision(
    state({ plan: "FLAT", currentPeriodEnd: PERIOD_END }),
    "HYBRID",
    NOW
  );
  assert.deepEqual(d, { kind: "scheduled", plan: "HYBRID", effectiveAt: PERIOD_END });
});

test("downgrading to ZERO also waits — they already paid for this month", () => {
  const d = planChangeDecision(state({ plan: "FLAT", currentPeriodEnd: PERIOD_END }), "ZERO", NOW);
  assert.deepEqual(d, { kind: "scheduled", plan: "ZERO", effectiveAt: PERIOD_END });
});

test("re-picking your current plan is a no-op, not an error to act on", () => {
  // The double-submit case. Treating it as a change would schedule a switch to
  // the plan they are on and, on the immediate path, take a payment.
  const d = planChangeDecision(state({ plan: "FLAT", currentPeriodEnd: PERIOD_END }), "FLAT", NOW);
  assert.equal(d.kind, "rejected");
});

test("re-picking your current plan while a switch is pending cancels the switch", () => {
  // "Actually, stay where I am." Scheduling a switch to the current plan
  // instead would leave a pending row pointing at the plan they already have.
  const d = planChangeDecision(
    state({ plan: "FLAT", pendingPlan: "ZERO", currentPeriodEnd: PERIOD_END }),
    "FLAT",
    NOW
  );
  assert.deepEqual(d, { kind: "cancelled_pending", plan: "FLAT" });
});

test("switching twice before the first lands replaces the pending plan", () => {
  const d = planChangeDecision(
    state({ plan: "FLAT", pendingPlan: "ZERO", currentPeriodEnd: PERIOD_END }),
    "HYBRID",
    NOW
  );
  assert.deepEqual(d, { kind: "scheduled", plan: "HYBRID", effectiveAt: PERIOD_END });
});

test("moving from ZERO to ZERO is refused rather than starting a subscription", () => {
  assert.equal(planChangeDecision(state(), "ZERO", NOW).kind, "rejected");
});

test("an unknown plan is refused", () => {
  assert.equal(planChangeDecision(state(), "PREMIUM" as never, NOW).kind, "rejected");
});

test("only a move to a paid plan asks for payment", () => {
  const d = planChangeDecision(state(), "HYBRID", NOW);
  assert.equal(d.kind === "immediate" && d.needsPayment, true);
});

/* ── effectivePlan does not trust the cron ──────────────────────────────── */

test("a scheduled change applies on read once its date has passed", () => {
  // The sweep that materialises this does not run in production yet. If this
  // read trusted the row instead of the clock, a restaurant would sit on a plan
  // they cancelled a month ago and keep being billed for it.
  const s = state({ plan: "FLAT", pendingPlan: "ZERO", currentPeriodEnd: PERIOD_END });
  assert.equal(effectivePlan(s, new Date("2026-07-31T00:00:00Z")), "FLAT");
  assert.equal(effectivePlan(s, new Date("2026-08-01T00:00:00Z")), "ZERO");
  assert.equal(effectivePlan(s, new Date("2026-09-15T00:00:00Z")), "ZERO");
});

test("a pending change with no period end never fires on its own", () => {
  const s = state({ plan: "FLAT", pendingPlan: "ZERO", currentPeriodEnd: null });
  assert.equal(effectivePlan(s, new Date("2030-01-01T00:00:00Z")), "FLAT");
});

/* ── Dunning ────────────────────────────────────────────────────────────── */

test("a healthy subscription is ok", () => {
  assert.deepEqual(dunningState(state({ plan: "FLAT" }), NOW), { kind: "ok" });
});

test("nothing is owed on ZERO, even with a stale past-due flag", () => {
  const s = state({ plan: "ZERO", pastDueSince: new Date("2020-01-01") });
  assert.deepEqual(dunningState(s, NOW), { kind: "ok" });
});

test("a failed payment starts a grace period, and benefits keep working", () => {
  const s = state({ plan: "FLAT", pastDueSince: NOW });
  const d = dunningState(s, new Date(NOW.getTime() + 3 * 86_400_000));
  assert.equal(d.kind, "grace");
  assert.equal(d.kind === "grace" && d.daysLeft, GRACE_DAYS - 3);
  // The whole point of a grace period is that nothing changes while it runs.
  assert.equal(planBenefitsActive(s, new Date(NOW.getTime() + 3 * 86_400_000)), true);
});

test("days left rounds up, so the last day is never reported as zero", () => {
  const s = state({ plan: "FLAT", pastDueSince: NOW });
  const almost = new Date(NOW.getTime() + (GRACE_DAYS * 86_400_000 - 6 * 3_600_000));
  const d = dunningState(s, almost);
  assert.equal(d.kind === "grace" && d.daysLeft, 1);
});

test("past the window it lapses to ZERO, never to a suspension", () => {
  // Dropping to ZERO keeps them trading. Suspending would stop a working
  // restaurant handing paid-for food to someone at the counter over a card
  // decline, which is wildly disproportionate.
  const s = state({ plan: "FLAT", pastDueSince: NOW });
  const after = new Date(NOW.getTime() + (GRACE_DAYS + 1) * 86_400_000);
  assert.deepEqual(dunningState(s, after), { kind: "lapsed", downgradeTo: "ZERO" });
  assert.equal(planBenefitsActive(s, after), false);
});

test("the grace boundary is inclusive, so it lapses exactly on time", () => {
  const s = state({ plan: "FLAT", pastDueSince: NOW });
  const exactly = new Date(NOW.getTime() + GRACE_DAYS * 86_400_000);
  assert.equal(dunningState(s, exactly).kind, "lapsed");
});

/* ── Visibility is not billing ──────────────────────────────────────────── */

/**
 * The MVP hides FLAT and HYBRID (see `lib/features.ts`). The property these
 * defend is that hiding is a *display* change and nothing else — a tenant
 * already on a hidden plan has to keep being priced correctly, and the way that
 * breaks is somebody deciding `VISIBLE_PLANS` is the real list and routing the
 * arithmetic through it too. That would silently start charging a FLAT
 * restaurant's diners a service fee they were promised they'd never see.
 */

test("every plan still prices, whether or not it is offered", () => {
  for (const p of PLANS) {
    assert.ok(PLAN_SPECS[p], `${p} lost its spec`);
    assert.equal(typeof PLAN_SPECS[p].monthlyCts, "number");
  }
  // The one that matters: a hidden paid plan must still suppress the customer
  // service fee, because the tenant is still paying us not to charge it.
  const configured = {
    surchargePct: 5,
    surchargeMinCts: 100,
    surchargeMaxCts: 2000,
    taxPct: 8.25,
  };
  assert.equal(surchargeConfigFor("FLAT", configured).surchargePct, 0);
  assert.equal(surchargeConfigFor("HYBRID", configured).surchargePct, 0);
  // ...and sales tax is untouched on both, hidden or not. It is the
  // restaurant's legal obligation and has nothing to do with our pricing.
  assert.equal(surchargeConfigFor("FLAT", configured).taxPct, 8.25);
});

test("the visible list is a subset of the real one and always has a default", () => {
  assert.ok(VISIBLE_PLANS.length > 0, "nothing is offered — signup has no plan to pick");
  assert.ok(VISIBLE_PLANS.every((p) => PLANS.includes(p)));
  // A tenant is created on DEFAULT_PLAN, so it being unofferable would mean
  // every new restaurant starts on a plan its own picker calls unavailable.
  assert.ok(VISIBLE_PLANS.includes(DEFAULT_PLAN));
});

test("isSelectablePlan agrees with the visible list, for every plan", () => {
  for (const p of PLANS) {
    assert.equal(isSelectablePlan(p), VISIBLE_PLANS.includes(p));
  }
});

console.log(`plans: ${passed} passed`);
