/**
 * Tests for service suspension.
 *
 * The property under test is an asymmetry, not a calculation: the owner's own
 * switch and the platform's suspension are different things, and the platform's
 * always wins. Every case below is a way that could quietly stop being true —
 * a caller reading `cardPaymentsEnabled` directly, a restore that misses a row,
 * a second suspension stacking on the first so lifting it once does nothing.
 *
 * Reuses the SMS stub's database double, which already carries the suspension
 * table. Run with:
 *   npx tsx --tsconfig scripts/tsconfig.sms.json scripts/entitlements.test.ts
 */

import assert from "node:assert/strict";
import {
  SERVICES,
  cardPaymentsAllowed,
  deliveryAllowed,
  isSuspended,
  restoreService,
  serviceStates,
  suspendService,
} from "../src/lib/entitlements";
import { reset, seedSuspension } from "./test-stubs/prisma-sms";

let passed = 0;
const only = process.argv[2];

async function test(name: string, fn: () => Promise<void>) {
  if (only && !name.includes(only)) return;
  reset();
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

const R = "rest_fixed";

async function main() {
  // -------------------------------------------------------------------------
  // The two switches
  // -------------------------------------------------------------------------

  await test("cards allowed when the owner is on and we haven't suspended", async () => {
    assert.equal(await cardPaymentsAllowed({ id: R, cardPaymentsEnabled: true }), true);
  });

  await test("owner's own switch off is enough to block", async () => {
    assert.equal(await cardPaymentsAllowed({ id: R, cardPaymentsEnabled: false }), false);
  });

  await test("suspension beats the owner's switch being on", async () => {
    seedSuspension({ restaurantId: R, service: "PAYMENTS" });
    assert.equal(await cardPaymentsAllowed({ id: R, cardPaymentsEnabled: true }), false);
  });

  await test("a lifted suspension stops blocking", async () => {
    seedSuspension({ restaurantId: R, service: "PAYMENTS" });
    await restoreService(R, "PAYMENTS");
    assert.equal(await cardPaymentsAllowed({ id: R, cardPaymentsEnabled: true }), true);
  });

  await test("delivery follows the same two-switch rule", async () => {
    assert.equal(await deliveryAllowed({ id: R, deliveryEnabled: false }), false, "off by default");
    assert.equal(await deliveryAllowed({ id: R, deliveryEnabled: true }), true);

    seedSuspension({ restaurantId: R, service: "DELIVERY" });
    assert.equal(await deliveryAllowed({ id: R, deliveryEnabled: true }), false);
  });

  // -------------------------------------------------------------------------
  // Isolation between services and tenants
  // -------------------------------------------------------------------------

  await test("suspending one service leaves the others alone", async () => {
    await suspendService({ restaurantId: R, service: "SMS" });

    assert.equal(await isSuspended(R, "SMS"), true);
    assert.equal(await isSuspended(R, "PAYMENTS"), false);
    assert.equal(await isSuspended(R, "DELIVERY"), false);
    assert.equal(await isSuspended(R, "EMAIL"), false);
  });

  await test("a suspension on one tenant doesn't reach another", async () => {
    await suspendService({ restaurantId: R, service: "PAYMENTS" });
    assert.equal(await isSuspended("rest_other", "PAYMENTS"), false);
  });

  // -------------------------------------------------------------------------
  // Idempotence — the property the partial unique index buys
  // -------------------------------------------------------------------------

  await test("suspending twice doesn't stack", async () => {
    await suspendService({ restaurantId: R, service: "PAYMENTS", reason: "first" });
    await suspendService({ restaurantId: R, service: "PAYMENTS", reason: "second" });

    // One restore has to be enough. If the second call had stacked a row, this
    // would leave the tenant suspended by an invisible second suspension.
    await restoreService(R, "PAYMENTS");
    assert.equal(await isSuspended(R, "PAYMENTS"), false);
  });

  await test("the second suspend keeps the first reason", async () => {
    await suspendService({ restaurantId: R, service: "PAYMENTS", reason: "first" });
    await suspendService({ restaurantId: R, service: "PAYMENTS", reason: "second" });

    const states = await serviceStates(R);
    assert.equal(states.PAYMENTS.reason, "first", "the live row is not overwritten");
  });

  await test("restoring something that was never suspended is harmless", async () => {
    const res = await restoreService(R, "EMAIL");
    assert.ok(res.ok, "reports rather than throws");
    assert.equal(await isSuspended(R, "EMAIL"), false);
  });

  // -------------------------------------------------------------------------
  // Shape
  // -------------------------------------------------------------------------

  await test("serviceStates answers for every service", async () => {
    const states = await serviceStates(R);
    for (const s of SERVICES) {
      assert.equal(states[s].suspended, false, `${s} defaults to active`);
    }
  });

  await test("serviceStates carries the reason and the internal note apart", async () => {
    await suspendService({
      restaurantId: R,
      service: "SMS",
      reason: "carrier complaint",
      internalNote: "third strike",
    });

    const states = await serviceStates(R);
    assert.equal(states.SMS.suspended, true);
    assert.equal(states.SMS.reason, "carrier complaint");
    assert.equal(states.SMS.internalNote, "third strike");
  });

  await test("blank reasons are stored as null, not empty strings", async () => {
    await suspendService({ restaurantId: R, service: "SMS", reason: "   " });
    const states = await serviceStates(R);
    assert.equal(states.SMS.reason, null);
  });
}

main().then(
  () => console.log(`entitlements: ${passed} passed`),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
