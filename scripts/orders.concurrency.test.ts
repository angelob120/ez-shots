/**
 * Concurrency tests for the order and refund writers.
 *
 * The bugs these cover are the expensive kind: they don't fail a build, they
 * pay a customer twice. Every one of them is a read-then-write gap, where two
 * callers act on a snapshot that stopped being true — two owners on two
 * tablets, or one owner double-tapping a button on a slow connection.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.concurrency.json scripts/orders.concurrency.test.ts
 */

import assert from "node:assert/strict";
import {
  cancelOrder,
  expireStaleOrders,
  flagOverdueOrders,
  issueRefund,
  markNoShow,
  resolveIssue,
  retryFailedRefunds,
  transitionOrder,
  MAX_REFUND_RETRIES,
} from "../src/lib/orders";
import { setPaymentProvider, type PaymentProvider, type RefundInput } from "../src/lib/payments";
import { prisma } from "./test-stubs/prisma-memory";
import { resetMessages, sent } from "./test-stubs/sms";

let passed = 0;
const only = process.argv[2];

async function test(name: string, fn: () => Promise<void>) {
  if (only && !name.includes(only)) return;
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = "rest_1";

/** Records every call so a test can assert on what the provider was asked. */
const calls: RefundInput[] = [];

const okProvider: PaymentProvider = {
  name: "test",
  async charge() {
    return { ok: true, provider: "test", reference: "ch_1", status: "ok" };
  },
  async refund(input) {
    calls.push(input);
    return { ok: true, provider: "test", reference: `re_${calls.length}` };
  },
};

const failingProvider: PaymentProvider = {
  ...okProvider,
  async refund(input) {
    calls.push(input);
    return { ok: false, provider: "test", reference: "", error: "card_declined" };
  },
};

async function seed(overrides: Record<string, unknown> = {}) {
  prisma.reset();
  resetMessages();
  calls.length = 0;
  setPaymentProvider(okProvider);

  await prisma.restaurant.create({
    data: {
      id: RESTAURANT_ID,
      name: "Test Kitchen",
      prepMinutes: 20,
      status: "ACTIVE",
      autoAccept: true,
      autoExpireMins: 10,
    },
  });

  await prisma.customer.create({
    data: { id: "cust_1", restaurantId: RESTAURANT_ID, orderCount: 1, lifetimeCts: 2000, lastOrderAt: new Date() },
  });

  // The fake doesn't resolve `include`, so the relations lib/orders reads are
  // seeded flat onto the row.
  await prisma.order.create({
    data: {
      id: "order_1",
      restaurantId: RESTAURANT_ID,
      customerId: "cust_1",
      number: "A17",
      publicToken: "tok_1",
      status: "ACCEPTED",
      subtotalCts: 1700,
      surchargeCts: 100,
      taxCts: 200,
      totalCts: 2000,
      refundedCts: 0,
      promisedAt: null,
      acceptedAt: new Date(),
      paymentReference: "ch_1",
      restaurant: { name: "Test Kitchen", prepMinutes: 20 },
      items: [],
      ...overrides,
    },
  });
}

const order = async () => (await prisma.order.findUnique({ where: { id: "order_1" } }))!;

async function main() {

  // ---------------------------------------------------------------------------
  // Refunds
  // ---------------------------------------------------------------------------

  await test("two simultaneous full refunds pay out once", async () => {
    await seed();

    const [a, b] = await Promise.all([
      issueRefund({ orderId: "order_1", amountCts: 2000, reason: "KITCHEN_ISSUE", actor: "RESTAURANT" }),
      issueRefund({ orderId: "order_1", amountCts: 2000, reason: "KITCHEN_ISSUE", actor: "RESTAURANT" }),
    ]);

    const o = await order();
    assert.equal(o.refundedCts, 2000, "the order must never be refunded past its total");
    assert.equal([a.ok, b.ok].filter(Boolean).length, 1, "exactly one caller should win");
    assert.equal(calls.length, 1, "the loser must not reach the payment provider");
  });

  await test("a hundred racing refunds still cap at the total", async () => {
    await seed();

    await Promise.all(
      Array.from({ length: 100 }, () =>
        issueRefund({ orderId: "order_1", amountCts: 500, reason: "QUALITY", actor: "RESTAURANT" })
      )
    );

    const o = await order();
    const refunded = o.refundedCts as number;
    const total = o.totalCts as number;
    assert.ok(refunded <= total, `refunded ${refunded} exceeds total ${total}`);
  });

  await test("sequential partial refunds still add up normally", async () => {
    await seed();

    await issueRefund({ orderId: "order_1", amountCts: 500, reason: "QUALITY", actor: "RESTAURANT" });
    await issueRefund({ orderId: "order_1", amountCts: 700, reason: "QUALITY", actor: "RESTAURANT" });

    assert.equal((await order()).refundedCts, 1200, "the lock must not break the ordinary path");
  });

  await test("a provider failure leaves the order un-refunded", async () => {
    await seed();
    setPaymentProvider(failingProvider);

    const res = await issueRefund({
      orderId: "order_1",
      amountCts: 2000,
      reason: "QUALITY",
      actor: "RESTAURANT",
    });

    assert.equal(res.ok, false);
    assert.equal((await order()).refundedCts, 0, "a reservation must be released when the payout fails");

    const refunds = await prisma.refund.findMany({});
    assert.equal(refunds[0].status, "FAILED");
    assert.equal(refunds[0].resolvedAt ?? null, null, "a failed refund stays outstanding until settled");
  });

  await test("the provider gets an idempotency key it can dedupe on", async () => {
    await seed();

    await issueRefund({ orderId: "order_1", amountCts: 500, reason: "QUALITY", actor: "RESTAURANT" });

    const refunds = await prisma.refund.findMany({});
    assert.equal(calls[0].idempotencyKey, refunds[0].id, "the key must be the Refund row id");
  });

  // Charges are direct — they live on the restaurant's connected account, not
  // the platform's. A refund that doesn't carry the tenant gets issued
  // platform-scoped, where Stripe can't see the charge at all: the money never
  // goes back and the failure looks like a declined refund rather than a
  // misrouted one. Cheap to assert, and it fails loudly if someone adds a
  // refund caller and forgets.
  await test("every refund tells the provider whose account to refund on", async () => {
    await seed();

    await issueRefund({ orderId: "order_1", amountCts: 500, reason: "QUALITY", actor: "RESTAURANT" });

    assert.equal(calls[0].restaurantId, RESTAURANT_ID, "issueRefund must pass the tenant");
  });

  await test("a retried refund carries the tenant too", async () => {
    await seed();
    setPaymentProvider(failingProvider);

    await issueRefund({ orderId: "order_1", amountCts: 500, reason: "QUALITY", actor: "RESTAURANT" });
    setPaymentProvider(okProvider);
    await retryFailedRefunds();

    assert.ok(calls.length >= 2, "the retry must have reached the provider");
    assert.equal(
      calls[calls.length - 1].restaurantId,
      RESTAURANT_ID,
      "the retry path resolves the account the same way the first attempt did"
    );
  });

  // ---------------------------------------------------------------------------
  // Status writes
  // ---------------------------------------------------------------------------

  await test("a double-tapped cancel cancels once and texts once", async () => {
    await seed();

    const results = await Promise.all([
      cancelOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, problem: "KITCHEN_ISSUE", actor: "RESTAURANT" }),
      cancelOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, problem: "KITCHEN_ISSUE", actor: "RESTAURANT" }),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1, "only one cancellation should land");

    const o = await order();
    assert.equal(o.status, "CANCELED");
    assert.equal(o.refundedCts, 2000, "the customer is owed the total once, not twice");
    assert.equal(sent.length, 1, "one failure, one apology");
  });

  await test("a double-tapped status change moves the order once", async () => {
    await seed();

    const results = await Promise.all([
      transitionOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, to: "READY", actor: "RESTAURANT" }),
      transitionOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, to: "READY", actor: "RESTAURANT" }),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1, "one of the two must lose the race");
    assert.equal((await order()).status, "READY");

    const events = await prisma.orderEvent.findMany({ where: { kind: "status_changed" } });
    assert.equal(events.length, 1, "the timeline must not show the same move twice");
    assert.equal(sent.length, 1, "and the customer must not be told twice");
  });

  await test("racing transitions to different states can't both apply", async () => {
    await seed();

    const results = await Promise.all([
      transitionOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, to: "READY", actor: "RESTAURANT" }),
      transitionOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, to: "PREPARING", actor: "RESTAURANT" }),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    const o = await order();
    assert.ok(o.status === "READY" || o.status === "PREPARING");
  });

  // ---------------------------------------------------------------------------
  // Customer counters
  // ---------------------------------------------------------------------------

  await test("canceling an order takes it back out of the customer's stats", async () => {
    await seed();

    await cancelOrder({
      orderId: "order_1",
      restaurantId: RESTAURANT_ID,
      problem: "TOO_BUSY",
      actor: "RESTAURANT",
    });

    const c = (await prisma.customer.findUnique({ where: { id: "cust_1" } }))!;
    assert.equal(c.orderCount, 0, "an order the kitchen refused is not a customer relationship");
    assert.equal(c.lifetimeCts, 0, "and the money came back, so it isn't lifetime value either");
    assert.equal(c.lastOrderAt, null, "with no other orders, there is no last order");
  });

  await test("a double-cancel doesn't decrement the customer twice", async () => {
    await seed();

    await Promise.all([
      cancelOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, problem: "TOO_BUSY", actor: "RESTAURANT" }),
      cancelOrder({ orderId: "order_1", restaurantId: RESTAURANT_ID, problem: "TOO_BUSY", actor: "RESTAURANT" }),
    ]);

    const c = (await prisma.customer.findUnique({ where: { id: "cust_1" } }))!;
    assert.equal(c.orderCount, 0, "orderCount must never go negative");
  });

  // -------------------------------------------------------------------------
  // The scheduled sweeps
  // -------------------------------------------------------------------------

  const AGES_AGO = new Date(Date.now() - 60 * 60_000);

  await test("the sweep catches an unattended order on the default config", async () => {
    // autoAccept is on, so the order was created ACCEPTED without a human ever
    // seeing it. This is the case the original sweep missed entirely.
    await seed({ status: "ACCEPTED", createdAt: AGES_AGO });

    const expired = await expireStaleOrders(RESTAURANT_ID);

    assert.equal(expired, 1);
    const o = await order();
    assert.equal(o.status, "CANCELED");
    assert.equal(o.refundedCts, 2000, "the platform refunds on the restaurant's behalf");
  });

  await test("with autoAccept off it's RECEIVED that goes unattended", async () => {
    await seed({ status: "RECEIVED", createdAt: AGES_AGO });
    await prisma.restaurant.update({
      where: { id: RESTAURANT_ID },
      data: { autoAccept: false },
    });

    assert.equal(await expireStaleOrders(RESTAURANT_ID), 1);
    assert.equal((await order()).status, "REJECTED", "untouched orders are rejected, not canceled");
  });

  await test("the sweep leaves food that's actually being cooked alone", async () => {
    await seed({ status: "PREPARING", createdAt: AGES_AGO });

    assert.equal(await expireStaleOrders(RESTAURANT_ID), 0);
    assert.equal((await order()).status, "PREPARING", "someone is standing at a stove");
  });

  await test("a fresh order isn't swept", async () => {
    await seed({ status: "ACCEPTED" });

    assert.equal(await expireStaleOrders(RESTAURANT_ID), 0);
  });

  await test("a badly late order gets one apology, not one per sweep", async () => {
    await seed({ status: "PREPARING", promisedAt: AGES_AGO });

    assert.equal(await flagOverdueOrders({ restaurantId: RESTAURANT_ID }), 1);
    assert.equal(sent.length, 1);

    // The sweep runs every couple of minutes. Texting on each pass would be
    // worse than saying nothing.
    assert.equal(await flagOverdueOrders({ restaurantId: RESTAURANT_ID }), 0);
    assert.equal(sent.length, 1, "the event log is the de-dupe key");
  });

  // -------------------------------------------------------------------------
  // Issue resolution
  // -------------------------------------------------------------------------

  async function seedIssue() {
    await seed({ status: "COMPLETED" });
    const issue = await prisma.orderIssue.create({
      data: {
        orderId: "order_1",
        restaurantId: RESTAURANT_ID,
        kind: "MISSING_ITEM",
        body: "The fries were missing.",
        status: "OPEN",
        acknowledgedAt: null,
      },
    });
    return issue.id as string;
  }

  await test("resolving an issue actually tells the customer", async () => {
    const issueId = await seedIssue();

    const res = await resolveIssue({
      issueId,
      restaurantId: RESTAURANT_ID,
      status: "RESOLVED",
      resolution: "Refunded the fries, sorry about that.",
    });

    assert.equal(res.ok, true);
    assert.equal(sent.length, 1, "the whole point of the item — this used to be silent");
    assert.ok(
      sent[0].body.includes("Refunded the fries"),
      "the owner's own words, not a status name"
    );
  });

  await test("the resolution is on the timeline as well as in the text", async () => {
    const issueId = await seedIssue();

    await resolveIssue({
      issueId,
      restaurantId: RESTAURANT_ID,
      status: "RESOLVED",
      resolution: "Sorted at the counter.",
    });

    const events = await prisma.orderEvent.findMany({ where: { kind: "issue_updated" } });
    assert.equal(events.length, 1);
    assert.equal(events[0].publicNote, "Sorted at the counter.", "the page is the durable copy");
  });

  await test("acknowledging says we're looking, not that it's fixed", async () => {
    const issueId = await seedIssue();

    await resolveIssue({ issueId, restaurantId: RESTAURANT_ID, status: "ACKNOWLEDGED" });

    assert.equal(sent.length, 1);
    assert.ok(sent[0].body.includes("looking into it"));

    const issue = (await prisma.orderIssue.findUnique({ where: { id: issueId } }))!;
    assert.equal(issue.status, "ACKNOWLEDGED");
    assert.equal(issue.resolvedAt, null, "still open — someone owes them an answer");
  });

  await test("an issue from another tenant can't be touched", async () => {
    const issueId = await seedIssue();

    const res = await resolveIssue({
      issueId,
      restaurantId: "rest_someone_else",
      status: "RESOLVED",
    });

    assert.equal(res.ok, false);
    assert.equal(sent.length, 0);
  });

  // -------------------------------------------------------------------------
  // No-shows
  // -------------------------------------------------------------------------

  await test("a no-show closes the order and keeps the charge by default", async () => {
    await seed({ status: "READY", readyAt: AGES_AGO });

    const res = await markNoShow({
      orderId: "order_1",
      restaurantId: RESTAURANT_ID,
      actor: "RESTAURANT",
    });

    assert.equal(res.ok, true);
    const o = await order();
    assert.equal(o.status, "CANCELED");
    assert.equal(o.problem, "NO_SHOW", "the enum value finally has a producer");
    assert.equal(o.refundedCts, 0, "the food was made — the money stays unless asked otherwise");
  });

  await test("a kept no-show still counts as a customer", async () => {
    await seed({ status: "READY", readyAt: AGES_AGO });

    await markNoShow({ orderId: "order_1", restaurantId: RESTAURANT_ID, actor: "RESTAURANT" });

    const c = (await prisma.customer.findUnique({ where: { id: "cust_1" } }))!;
    assert.equal(c.orderCount, 1, "they paid for food that got made — annoying, but real");
    assert.equal(c.lifetimeCts, 2000);
  });

  await test("a refunded no-show stops counting as a customer", async () => {
    await seed({ status: "READY", readyAt: AGES_AGO });

    await markNoShow({
      orderId: "order_1",
      restaurantId: RESTAURANT_ID,
      actor: "RESTAURANT",
      refund: "auto",
    });

    const c = (await prisma.customer.findUnique({ where: { id: "cust_1" } }))!;
    assert.equal(c.orderCount, 0, "paid nothing in the end, so it isn't an order");
    assert.equal((await order()).refundedCts, 2000);
  });

  await test("only a waiting order can be a no-show", async () => {
    await seed({ status: "PREPARING" });

    const res = await markNoShow({
      orderId: "order_1",
      restaurantId: RESTAURANT_ID,
      actor: "RESTAURANT",
    });

    assert.equal(res.ok, false, "you can't be stood up by food that isn't made yet");
    assert.equal((await order()).status, "PREPARING");
  });

  await test("a double-tapped no-show closes out once", async () => {
    await seed({ status: "READY", readyAt: AGES_AGO });

    const results = await Promise.all([
      markNoShow({ orderId: "order_1", restaurantId: RESTAURANT_ID, actor: "RESTAURANT" }),
      markNoShow({ orderId: "order_1", restaurantId: RESTAURANT_ID, actor: "RESTAURANT" }),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(sent.length, 1, "and says so once");
  });

  await test("an order still inside its promise is not called late", async () => {
    await seed({ status: "PREPARING", promisedAt: new Date(Date.now() + 10 * 60_000) });

    assert.equal(await flagOverdueOrders({ restaurantId: RESTAURANT_ID }), 0);
    assert.equal(sent.length, 0);
  });

  // ---------------------------------------------------------------------------
  // The refund retry queue
  // ---------------------------------------------------------------------------

  await test("a failed refund is retried in place and pays out", async () => {
    await seed();
    setPaymentProvider(failingProvider);

    const first = await issueRefund({ orderId: "order_1", amountCts: 2000, reason: "KITCHEN_ISSUE", actor: "RESTAURANT" });
    assert.equal(first.ok, false);
    assert.equal((await order()).refundedCts, 0, "a failed payout leaves nothing reserved");

    const failedRow = (await prisma.refund.findMany({}))[0];
    assert.equal(failedRow.status, "FAILED");

    setPaymentProvider(okProvider);
    const recovered = await retryFailedRefunds();

    assert.equal(recovered, 1);
    assert.equal((await order()).refundedCts, 2000, "the retry actually moves the money");

    const rows = await prisma.refund.findMany({});
    assert.equal(rows.length, 1, "the retry reuses the row rather than minting a new debt");
    assert.equal(rows[0].status, "SUCCEEDED");
    assert.equal(rows[0].attempts, 2, "the attempt counts against the same row");
  });

  await test("every retry carries the same idempotency key", async () => {
    await seed();
    setPaymentProvider(failingProvider);
    await issueRefund({ orderId: "order_1", amountCts: 2000, reason: "QUALITY", actor: "RESTAURANT" });

    const refundId = (await prisma.refund.findMany({}))[0].id;

    setPaymentProvider(okProvider);
    await retryFailedRefunds();

    // The first (failed) call and the retry must hand the provider the same key,
    // so a payout that succeeded but timed out can't be moved twice.
    assert.ok(calls.length >= 2);
    assert.equal(calls[0].idempotencyKey, refundId);
    assert.equal(calls[calls.length - 1].idempotencyKey, refundId, "the retry reuses the row id");
  });

  await test("a refund that keeps failing stops at the cap", async () => {
    await seed();
    setPaymentProvider(failingProvider);
    await issueRefund({ orderId: "order_1", amountCts: 2000, reason: "QUALITY", actor: "RESTAURANT" });

    for (let i = 0; i < MAX_REFUND_RETRIES + 3; i++) await retryFailedRefunds();

    const row = (await prisma.refund.findMany({}))[0];
    assert.equal(row.status, "FAILED");
    assert.equal(row.attempts, MAX_REFUND_RETRIES, "attempts never climbs past the cap");
    assert.equal((await order()).refundedCts, 0, "and nothing is ever reserved on a failing card");
    assert.equal(await retryFailedRefunds(), 0, "past the cap it's left for a human");
  });

  await test("a concurrent_refund failure is never retried", async () => {
    await seed();
    // The lost-race marker, written by hand — retrying it would recompute an
    // empty refundable and fail forever, so the sweep must skip it outright.
    await prisma.refund.create({
      data: {
        orderId: "order_1",
        amountCts: 2000,
        reason: "QUALITY",
        includedSurcharge: true,
        status: "FAILED",
        error: "concurrent_refund",
        attempts: 1,
        issuedBy: "RESTAURANT",
      },
    });

    const recovered = await retryFailedRefunds();

    assert.equal(recovered, 0);
    assert.equal(calls.length, 0, "a lost race is not a debt and never reaches the provider");
  });

  await test("a debt settled another way is closed out, not paid again", async () => {
    await seed();
    setPaymentProvider(failingProvider);
    await issueRefund({ orderId: "order_1", amountCts: 2000, reason: "QUALITY", actor: "RESTAURANT" });

    // Meanwhile the order gets fully refunded by some other path.
    await prisma.order.update({ where: { id: "order_1" }, data: { refundedCts: 2000 } });

    setPaymentProvider(okProvider);
    const callsBefore = calls.length;
    const recovered = await retryFailedRefunds();

    assert.equal(recovered, 0, "there's no balance left to pay");
    assert.equal(calls.length, callsBefore, "so the retry never calls the provider");

    const row = (await prisma.refund.findMany({}))[0];
    assert.ok(row.resolvedAt, "the row stops being outstanding");
    assert.match(row.resolvedNote as string, /settled/, "and says why");
  });

}

main().then(
  () => console.log(`orders.concurrency: ${passed} passed`),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
