/**
 * Tests for the order state machine and refund arithmetic.
 *
 * These are the two places where a bug costs real money — an illegal
 * transition resurrects a canceled order, a bad clamp refunds a customer
 * twice. Both are pure functions precisely so they can be checked here.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.test.json scripts/orders.test.ts
 */

import assert from "node:assert/strict";
import {
  canTransition,
  computePartialRefundCts,
  isProbableNoShow,
  isRestaurantFault,
  isTerminal,
  statusHeadline,
  lineFoodCts,
  newOrderToken,
  refundableCts,
} from "../src/lib/orders";

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

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

test("the happy path is walkable end to end", () => {
  assert.ok(canTransition("RECEIVED", "ACCEPTED"));
  assert.ok(canTransition("ACCEPTED", "PREPARING"));
  assert.ok(canTransition("PREPARING", "READY"));
  assert.ok(canTransition("READY", "COMPLETED"));
});

test("terminal states are actually terminal", () => {
  for (const s of ["COMPLETED", "CANCELED", "REJECTED"] as const) {
    assert.ok(isTerminal(s), `${s} should be terminal`);
    assert.equal(canTransition(s, "PREPARING"), false, `${s} must not reopen`);
    assert.equal(canTransition(s, "READY"), false);
  }
});

test("orders cannot travel backwards", () => {
  assert.equal(canTransition("READY", "PREPARING"), false);
  assert.equal(canTransition("PREPARING", "ACCEPTED"), false);
  assert.equal(canTransition("COMPLETED", "READY"), false);
});

test("only an untouched order can be rejected", () => {
  assert.ok(canTransition("RECEIVED", "REJECTED"));
  assert.equal(canTransition("PREPARING", "REJECTED"), false, "food already started is a cancel");
  assert.equal(canTransition("READY", "REJECTED"), false);
});

test("a cooked-but-uncollected order can still be canceled (the no-show)", () => {
  assert.ok(canTransition("READY", "CANCELED"));
});

test("skipping straight to PREPARING is allowed; skipping to COMPLETED is not", () => {
  assert.ok(canTransition("RECEIVED", "PREPARING"));
  assert.equal(canTransition("RECEIVED", "COMPLETED"), false);
  assert.equal(canTransition("ACCEPTED", "COMPLETED"), false);
});

// ---------------------------------------------------------------------------
// Fault attribution
// ---------------------------------------------------------------------------

test("restaurant-caused problems refund the service fee, customer-caused don't", () => {
  assert.ok(isRestaurantFault("OUT_OF_STOCK"));
  assert.ok(isRestaurantFault("KITCHEN_ISSUE"));
  assert.ok(isRestaurantFault("CLOSED"));
  assert.equal(isRestaurantFault("CUSTOMER_REQUEST"), false);
  assert.equal(isRestaurantFault("NO_SHOW"), false);
});

// ---------------------------------------------------------------------------
// Refund arithmetic
// ---------------------------------------------------------------------------

/** $40 of food, $1.40 fee, $2.40 tax. */
const order = {
  subtotalCts: 4000,
  surchargeCts: 140,
  taxCts: 240,
  totalCts: 4380,
  refundedCts: 0,
};

test("refundable is the whole total on an untouched order", () => {
  assert.equal(refundableCts(order), 4380);
});

test("refundable shrinks as refunds are issued, and never goes negative", () => {
  assert.equal(refundableCts({ ...order, refundedCts: 1000 }), 3380);
  assert.equal(refundableCts({ ...order, refundedCts: 4380 }), 0);
  // Belt and braces: even a corrupt over-refund can't produce a negative.
  assert.equal(refundableCts({ ...order, refundedCts: 9999 }), 0);
});

test("a partial refund prorates tax and fee against the food removed", () => {
  // Remove $10 of $40 = a quarter of the basket.
  const amount = computePartialRefundCts(order, 1000, true);
  // 1000 food + 60 tax (240/4) + 35 fee (140/4)
  assert.equal(amount, 1095);
});

test("excluding the fee refunds food and tax only", () => {
  const amount = computePartialRefundCts(order, 1000, false);
  assert.equal(amount, 1060);
});

test("removing everything hands back the entire remaining balance", () => {
  const amount = computePartialRefundCts(order, 4000, true);
  assert.equal(amount, 4380, "no rounding crumbs left stranded on a dead order");
});

test("a partial refund can never exceed what is left to refund", () => {
  const partly = { ...order, refundedCts: 4000 };
  const amount = computePartialRefundCts(partly, 4000, true);
  assert.equal(amount, 380);
});

test("nonsense inputs refund nothing rather than something", () => {
  assert.equal(computePartialRefundCts(order, 0, true), 0);
  assert.equal(computePartialRefundCts(order, -500, true), 0);
  assert.equal(computePartialRefundCts({ ...order, subtotalCts: 0 }, 100, true), 0);
});

test("removing more food than exists is capped at the basket", () => {
  const amount = computePartialRefundCts(order, 999999, true);
  assert.equal(amount, 4380);
});

test("repeated partial refunds never sum past the total", () => {
  let refunded = 0;
  for (let i = 0; i < 10; i++) {
    refunded += computePartialRefundCts({ ...order, refundedCts: refunded }, 1000, true);
  }
  assert.ok(refunded <= order.totalCts, `refunded ${refunded} of ${order.totalCts}`);
  assert.equal(refunded, order.totalCts);
});

test("line totals include modifiers and never go negative", () => {
  assert.equal(lineFoodCts({ unitPriceCts: 1000, modifiersCts: 250, qty: 2 }), 2500);
  // A discount modifier bigger than the item can't make the line owe money.
  assert.equal(lineFoodCts({ unitPriceCts: 100, modifiersCts: -500, qty: 3 }), 0);
});

// ---------------------------------------------------------------------------
// No-shows
// ---------------------------------------------------------------------------

test("an order is only a probable no-show once it's sat ready a while", () => {
  const now = new Date("2026-07-19T19:00:00Z");
  const long = new Date(now.getTime() - 60 * 60_000);
  const brief = new Date(now.getTime() - 5 * 60_000);

  assert.ok(isProbableNoShow({ status: "READY", readyAt: long }, now));
  assert.equal(
    isProbableNoShow({ status: "READY", readyAt: brief }, now),
    false,
    "five minutes late is a customer parking, not a no-show"
  );
});

test("only a waiting order can be a no-show", () => {
  const now = new Date("2026-07-19T19:00:00Z");
  const long = new Date(now.getTime() - 60 * 60_000);

  // Still cooking, or already handed over — neither is being stood up.
  assert.equal(isProbableNoShow({ status: "PREPARING", readyAt: long }, now), false);
  assert.equal(isProbableNoShow({ status: "COMPLETED", readyAt: long }, now), false);
  assert.equal(isProbableNoShow({ status: "READY", readyAt: null }, now), false);
});

test("a no-show is named as one, not reported as a cancellation", () => {
  assert.equal(statusHeadline("CANCELED", "NO_SHOW").title, "Not picked up");
  assert.equal(statusHeadline("CANCELED", "TOO_BUSY").title, "Canceled");
  assert.equal(statusHeadline("CANCELED").title, "Canceled");
});

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

test("order tokens are long, hex, and not repeated", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const t = newOrderToken();
    assert.match(t, /^[0-9a-f]{40}$/);
    assert.equal(seen.has(t), false, "token collision");
    seen.add(t);
  }
});

console.log(`\n  ${passed} passing\n`);
