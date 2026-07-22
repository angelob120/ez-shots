/**
 * Tests for the payment-mode guards.
 *
 * The thing being guarded against is boring and expensive: somebody flips the
 * platform to TEST or STUB to check something, gets distracted, and a
 * restaurant spends a day taking orders that collect no money. Nobody notices
 * until a payout doesn't arrive.
 *
 * So the properties here are about *not trusting anyone to remember*:
 *
 *   - Expiry is applied at `resolveModeState`, which every charge and refund
 *     reads. A guard that only runs when an admin loads a page is not a guard.
 *   - Reverting never claims LIVE it can't deliver. Without a live secret key,
 *     `paymentProviderForMode` silently falls back to the stub — so a revert to
 *     LIVE in that state would relabel the exact failure it exists to prevent.
 *   - A failed write-back doesn't break checkout.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.settings.json scripts/payment-mode.test.ts
 */

import assert from "node:assert/strict";
import {
  resolveModeState,
  resolvePaymentMode,
  safeRevertTarget,
  testModeEnabled,
  MAX_TEST_WINDOW_HOURS,
  DEFAULT_TEST_WINDOW_HOURS,
} from "../src/lib/payments";
import { reset, seedSetting, currentSetting, setFailUpdates } from "./test-stubs/prisma-settings";

let passed = 0;
const only = process.argv[2];

const KEYS = [
  "STRIPE_SECRET_KEY_LIVE",
  "STRIPE_SECRET_KEY_TEST",
  "STRIPE_SECRET_KEY",
  "PAYMENT_MODE",
] as const;

async function test(
  name: string,
  env: Partial<Record<(typeof KEYS)[number], string>>,
  fn: () => Promise<void>
) {
  if (only && !name.includes(only)) return;
  reset();
  const saved = KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Both key sets present — the normal production shape, per the deploy logs. */
const BOTH = {
  STRIPE_SECRET_KEY_LIVE: "sk_live_x",
  STRIPE_SECRET_KEY_TEST: "sk_test_x",
};

const ago = (h: number) => new Date(Date.now() - h * 3600_000);
const ahead = (h: number) => new Date(Date.now() + h * 3600_000);

async function main() {
  // --- The window ---------------------------------------------------------

  await test("an unexpired TEST window is left alone", BOTH, async () => {
    seedSetting({ paymentMode: "TEST", modeExpiresAt: ahead(3), modeRevertTo: "LIVE" });
    const state = await resolveModeState();
    assert.equal(state.mode, "TEST");
    assert.notEqual(state.expiresAt, null);
  });

  await test("an expired TEST window reverts to LIVE", BOTH, async () => {
    seedSetting({ paymentMode: "TEST", modeExpiresAt: ago(1), modeRevertTo: "LIVE" });
    assert.equal(await resolvePaymentMode(), "LIVE");
  });

  await test("an expired STUB window reverts too — stub is the worse of the two", BOTH, async () => {
    // STUB reports success and charges nothing, and Stripe has no record at
    // all. If it's the thing you might forget, it needs the timer most.
    seedSetting({ paymentMode: "STUB", modeExpiresAt: ago(2), modeRevertTo: "LIVE" });
    assert.equal(await resolvePaymentMode(), "LIVE");
  });

  await test("the revert is persisted, not just returned", BOTH, async () => {
    seedSetting({ paymentMode: "TEST", modeExpiresAt: ago(1), modeRevertTo: "LIVE" });
    await resolveModeState();
    const row = currentSetting()!;
    assert.equal(row.paymentMode, "LIVE");
    assert.equal(row.modeExpiresAt, null);
    assert.notEqual(row.modeRevertedAt, null, "the banner needs to say it reverted on its own");
  });

  await test("a mode with no expiry never reverts", BOTH, async () => {
    seedSetting({ paymentMode: "TEST", modeExpiresAt: null });
    assert.equal(await resolvePaymentMode(), "TEST");
  });

  await test("LIVE is never subject to a timer", BOTH, async () => {
    // A stale expiry left on the row must not knock a live platform out of live.
    seedSetting({ paymentMode: "LIVE", modeExpiresAt: ago(100), modeRevertTo: "STUB" });
    assert.equal(await resolvePaymentMode(), "LIVE");
  });

  // --- The revert target guard --------------------------------------------

  await test("without a live key, reverting lands on STUB — not a false LIVE", BOTH, async () => {
    delete process.env.STRIPE_SECRET_KEY_LIVE;
    seedSetting({ paymentMode: "TEST", modeExpiresAt: ago(1), modeRevertTo: "LIVE" });
    // Claiming LIVE here would mean paymentProviderForMode quietly using the
    // stub while the console says real money is moving.
    assert.equal(await resolvePaymentMode(), "STUB");
  });

  await test("safeRevertTarget: LIVE when the live key exists", BOTH, async () => {
    assert.equal(safeRevertTarget("LIVE"), "LIVE");
    assert.equal(safeRevertTarget(null), "LIVE", "unset means LIVE");
    assert.equal(safeRevertTarget(undefined), "LIVE");
  });

  await test("safeRevertTarget: STUB when the live key is missing", {}, async () => {
    assert.equal(safeRevertTarget("LIVE"), "STUB");
  });

  await test("safeRevertTarget: TEST degrades to STUB without a test key", {
    STRIPE_SECRET_KEY_LIVE: "sk_live_x",
  }, async () => {
    assert.equal(safeRevertTarget("TEST"), "STUB");
  });

  await test("a null revert target still means LIVE", BOTH, async () => {
    seedSetting({ paymentMode: "STUB", modeExpiresAt: ago(1), modeRevertTo: null });
    assert.equal(await resolvePaymentMode(), "LIVE");
  });

  // --- Resilience ----------------------------------------------------------

  await test("a failed write-back still returns the reverted mode", BOTH, async () => {
    seedSetting({ paymentMode: "TEST", modeExpiresAt: ago(1), modeRevertTo: "LIVE" });
    setFailUpdates(true);
    // Checkout must not fall over because the settings row couldn't be written.
    assert.equal(await resolvePaymentMode(), "LIVE");
  });

  await test("no settings row falls back to the env default", { PAYMENT_MODE: "TEST", ...BOTH }, async () => {
    assert.equal(await resolvePaymentMode(), "TEST");
  });

  await test("no settings row and no env default is STUB", {}, async () => {
    // The safe direction for a fresh deploy: stub can only ever under-charge.
    assert.equal(await resolvePaymentMode(), "STUB");
  });

  // --- Test tooling flag ---------------------------------------------------

  await test("test tools default to off", BOTH, async () => {
    seedSetting({ paymentMode: "LIVE" });
    assert.equal(await testModeEnabled(), false);
  });

  await test("test tools are independent of payment mode", BOTH, async () => {
    // Turning on a real Stripe test charge must not put an autofill button in
    // front of an owner signing up that afternoon.
    seedSetting({ paymentMode: "TEST", modeExpiresAt: ahead(1), testModeEnabled: false });
    assert.equal(await testModeEnabled(), false);

    seedSetting({ paymentMode: "LIVE", testModeEnabled: true });
    const state = await resolveModeState();
    assert.equal(state.mode, "LIVE");
    assert.equal(state.testModeEnabled, true);
  });

  await test("the flag survives an auto-revert", BOTH, async () => {
    seedSetting({
      paymentMode: "TEST",
      modeExpiresAt: ago(1),
      modeRevertTo: "LIVE",
      testModeEnabled: true,
    });
    const state = await resolveModeState();
    assert.equal(state.mode, "LIVE");
    assert.equal(state.testModeEnabled, true, "the two switches are unrelated");
  });

  // --- Constants -----------------------------------------------------------

  await test("the window bounds are sane", BOTH, async () => {
    assert.ok(DEFAULT_TEST_WINDOW_HOURS > 0);
    assert.ok(MAX_TEST_WINDOW_HOURS >= DEFAULT_TEST_WINDOW_HOURS);
    assert.equal(DEFAULT_TEST_WINDOW_HOURS, 24, "the documented default is a day");
  });
}

main().then(
  () => console.log(`payment-mode: ${passed} passed`),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
