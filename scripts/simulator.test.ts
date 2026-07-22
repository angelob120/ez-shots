/**
 * Tests for the pure half of the order simulator.
 *
 * The writing half needs a database and is untested like everything else that
 * writes. What's covered here is the part that can silently produce garbage:
 * the cleanup marker (get this wrong and a wipe touches real customers), and
 * the timestamp/event derivation (get this wrong and the simulator seeds order
 * shapes the real checkout can never produce, so every downstream thing that
 * reasons about them is being tested against fiction).
 *
 * Pure — no Prisma, so it runs under the plain tsconfig like domains.test.ts.
 */

import assert from "node:assert";
import type { OrderStatus } from "@prisma/client";
import {
  SIM_PHONE_PREFIX,
  SIM_PROFILES,
  clampInt,
  eventsFor,
  isLiveSimStatus,
  isSimulatedPhone,
  makeRng,
  pickStatus,
  placedAgoMs,
  randInt,
  simPhone,
  timestampsFor,
  LIVE_WITHIN_MINS,
  type SimProfileKey,
} from "../src/lib/simulator-data";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// --- The cleanup marker ----------------------------------------------------

test("simulated phones sit in the reserved 555-01xx block", () => {
  assert.equal(SIM_PHONE_PREFIX, "+1555017");
  assert.equal(simPhone(0), "+15550170000");
  assert.equal(simPhone(42), "+15550170042");
  assert.equal(simPhone(9999), "+15550179999");
});

test("simPhone stays inside the block however it's called", () => {
  for (const n of [-1, 10000, 123456, 0.5]) {
    const phone = simPhone(n);
    assert.ok(isSimulatedPhone(phone), `${n} produced ${phone}`);
    assert.equal(phone.length, 12, phone);
  }
});

test("a real number is never mistaken for a simulated one", () => {
  // The whole safety of `wipeSimulatedData` rests on this predicate.
  assert.equal(isSimulatedPhone("+15550171234"), true);
  assert.equal(isSimulatedPhone("+12125550199"), false);
  assert.equal(isSimulatedPhone("+15550161234"), false);
  assert.equal(isSimulatedPhone("+1555017"), true); // prefix itself, defensively
  assert.equal(isSimulatedPhone(""), false);
  assert.equal(isSimulatedPhone(null), false);
  assert.equal(isSimulatedPhone(undefined), false);
});

// --- Determinism -----------------------------------------------------------

test("the same seed reproduces the same run", () => {
  const a = Array.from({ length: 20 }, (_, i) => randInt(makeRng(7), 0, 1000) + i);
  const b = Array.from({ length: 20 }, (_, i) => randInt(makeRng(7), 0, 1000) + i);
  assert.deepEqual(a, b);
});

test("different seeds diverge", () => {
  const rngA = makeRng(1);
  const rngB = makeRng(2);
  const a = Array.from({ length: 10 }, () => rngA());
  const b = Array.from({ length: 10 }, () => rngB());
  assert.notDeepEqual(a, b);
});

test("rng stays in [0,1)", () => {
  const rng = makeRng(99);
  for (let i = 0; i < 500; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test("randInt covers its bounds inclusively and never exceeds them", () => {
  const rng = makeRng(3);
  let sawLo = false;
  let sawHi = false;
  for (let i = 0; i < 400; i++) {
    const v = randInt(rng, 1, 3);
    assert.ok(v >= 1 && v <= 3, String(v));
    if (v === 1) sawLo = true;
    if (v === 3) sawHi = true;
  }
  assert.ok(sawLo && sawHi);
});

// --- Input clamping --------------------------------------------------------

test("clampInt takes the fallback for junk and clamps the rest", () => {
  assert.equal(clampInt(undefined, 1, 250, 20), 20);
  assert.equal(clampInt("", 1, 250, 20), 20);
  assert.equal(clampInt("abc", 1, 250, 20), 20);
  assert.equal(clampInt(NaN, 1, 250, 20), 20);
  assert.equal(clampInt(1000, 1, 250, 20), 250);
  assert.equal(clampInt(-5, 1, 250, 20), 1);
  assert.equal(clampInt("30", 1, 250, 20), 30);
  assert.equal(clampInt(30.7, 1, 250, 20), 31);
});

// --- Profiles --------------------------------------------------------------

test("every profile only ever draws statuses it declares", () => {
  const rng = makeRng(11);
  for (const key of Object.keys(SIM_PROFILES) as SimProfileKey[]) {
    const profile = SIM_PROFILES[key];
    const allowed = new Set(Object.keys(profile.weights));
    for (let i = 0; i < 300; i++) {
      assert.ok(allowed.has(pickStatus(rng, profile)), `${key} drew an undeclared status`);
    }
  }
});

test("a profile with no weight at all still returns a usable status", () => {
  assert.equal(pickStatus(makeRng(1), { label: "", description: "", weights: {} }), "COMPLETED");
  assert.equal(
    pickStatus(makeRng(1), { label: "", description: "", weights: { READY: 0 } }),
    "COMPLETED"
  );
});

test("weights actually bias the draw", () => {
  const rng = makeRng(5);
  const profile = { label: "", description: "", weights: { COMPLETED: 99, RECEIVED: 1 } };
  let completed = 0;
  for (let i = 0; i < 1000; i++) if (pickStatus(rng, profile) === "COMPLETED") completed++;
  assert.ok(completed > 900, `expected a heavy skew, got ${completed}/1000`);
});

test("the history profile is overwhelmingly terminal", () => {
  const rng = makeRng(13);
  let live = 0;
  for (let i = 0; i < 500; i++) if (isLiveSimStatus(pickStatus(rng, SIM_PROFILES.history))) live++;
  assert.equal(live, 0, "past trade should never leave tickets on the board");
});

// --- Age -------------------------------------------------------------------

test("live tickets are always young enough to survive the expiry sweep", () => {
  // A RECEIVED order backdated past the tenant's autoExpireMins gets cancelled
  // by expireStaleOrders within minutes, and the operator concludes the
  // simulator is broken. This is the guard against that.
  const rng = makeRng(17);
  for (const status of ["RECEIVED", "ACCEPTED", "PREPARING", "READY"] as OrderStatus[]) {
    for (let i = 0; i < 200; i++) {
      const ms = placedAgoMs(rng, status, 90);
      assert.ok(ms <= LIVE_WITHIN_MINS * 60_000, `${status} backdated ${ms}ms`);
      assert.ok(ms > 0);
    }
  }
});

test("terminal orders spread across the requested window and never into the future", () => {
  const rng = makeRng(19);
  let sawOld = false;
  for (let i = 0; i < 300; i++) {
    const ms = placedAgoMs(rng, "COMPLETED", 30);
    assert.ok(ms >= 0);
    assert.ok(ms <= 30 * 86_400_000);
    if (ms > 20 * 86_400_000) sawOld = true;
  }
  assert.ok(sawOld, "a 30-day window should reach back most of 30 days");
});

test("a zero-day window still produces something placed in the past", () => {
  const rng = makeRng(23);
  const ms = placedAgoMs(rng, "COMPLETED", 0);
  assert.ok(ms >= 0 && ms <= 86_400_000);
});

// --- Timestamp coherence ---------------------------------------------------

const PLACED = new Date("2026-03-04T12:00:00.000Z");

test("every status gets a promise, and it's after placement", () => {
  for (const s of ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELED", "REJECTED"] as OrderStatus[]) {
    const ts = timestampsFor(s, PLACED, 20);
    assert.equal(ts.createdAt.getTime(), PLACED.getTime());
    assert.ok(ts.promisedAt > ts.createdAt, s);
  }
});

test("a completed order carries the full chain of stamps", () => {
  const ts = timestampsFor("COMPLETED", PLACED, 20);
  assert.ok(ts.acceptedAt && ts.readyAt && ts.completedAt);
  assert.ok(ts.canceledAt === null);
  // Monotonic — a completedAt before its readyAt is a shape the real flow
  // cannot produce, and anything measuring lateness would quietly get it.
  assert.ok(ts.createdAt <= ts.acceptedAt!);
  assert.ok(ts.acceptedAt! <= ts.readyAt!);
  assert.ok(ts.readyAt! <= ts.completedAt!);
});

test("a received order has nothing but a promise", () => {
  const ts = timestampsFor("RECEIVED", PLACED, 20);
  assert.equal(ts.acceptedAt, null);
  assert.equal(ts.readyAt, null);
  assert.equal(ts.completedAt, null);
  assert.equal(ts.canceledAt, null);
});

test("a ready order was accepted but not completed", () => {
  const ts = timestampsFor("READY", PLACED, 20);
  assert.ok(ts.acceptedAt);
  assert.ok(ts.readyAt);
  assert.equal(ts.completedAt, null);
});

test("rejected means never accepted — that is the whole distinction from canceled", () => {
  const rejected = timestampsFor("REJECTED", PLACED, 20);
  assert.equal(rejected.acceptedAt, null);
  assert.ok(rejected.canceledAt);

  const canceled = timestampsFor("CANCELED", PLACED, 20);
  assert.ok(canceled.acceptedAt, "a cancellation happened after the kitchen took it on");
  assert.ok(canceled.canceledAt);
});

test("a short prep time is floored rather than promising the impossible", () => {
  const ts = timestampsFor("READY", PLACED, 0);
  assert.ok(ts.promisedAt.getTime() - PLACED.getTime() >= 5 * 60_000);
});

// --- Event timelines -------------------------------------------------------

test("every order starts with a placed event", () => {
  for (const s of ["RECEIVED", "COMPLETED", "REJECTED"] as OrderStatus[]) {
    const events = eventsFor(s, timestampsFor(s, PLACED, 20));
    assert.equal(events[0].kind, "order_placed");
    assert.equal(events[0].actor, "CUSTOMER");
  }
});

test("timelines are chronological", () => {
  for (const s of ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELED", "REJECTED"] as OrderStatus[]) {
    const events = eventsFor(s, timestampsFor(s, PLACED, 20));
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        events[i].at.getTime() >= events[i - 1].at.getTime(),
        `${s}: ${events[i].kind} precedes ${events[i - 1].kind}`
      );
    }
  }
});

test("a completed order has a timeline worth reading", () => {
  const events = eventsFor("COMPLETED", timestampsFor("COMPLETED", PLACED, 20));
  const kinds = events.map((e) => e.toStatus ?? e.kind);
  assert.deepEqual(kinds, ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "COMPLETED"]);
});

test("an ended order records the refund alongside the ending", () => {
  for (const s of ["CANCELED", "REJECTED"] as OrderStatus[]) {
    const events = eventsFor(s, timestampsFor(s, PLACED, 20));
    assert.ok(events.some((e) => e.kind === "refund_issued"), s);
    assert.ok(events.some((e) => e.toStatus === s), s);
  }
});

test("a preparing order shows it was accepted first", () => {
  const events = eventsFor("PREPARING", timestampsFor("PREPARING", PLACED, 20));
  const toStatuses = events.map((e) => e.toStatus);
  assert.deepEqual(toStatuses, ["RECEIVED", "ACCEPTED", "PREPARING"]);
});

test("no simulated timeline claims a transition the state machine forbids", () => {
  // Mirrors canTransition in lib/orders.ts. A simulated timeline that walks an
  // illegal edge is a timeline the real app could never have written.
  const legal: Record<string, string[]> = {
    RECEIVED: ["ACCEPTED", "PREPARING", "CANCELED", "REJECTED"],
    ACCEPTED: ["PREPARING", "READY", "CANCELED"],
    PREPARING: ["READY", "CANCELED"],
    READY: ["COMPLETED", "CANCELED"],
  };
  for (const s of ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELED", "REJECTED"] as OrderStatus[]) {
    for (const e of eventsFor(s, timestampsFor(s, PLACED, 20))) {
      if (!e.fromStatus || !e.toStatus) continue;
      assert.ok(
        legal[e.fromStatus]?.includes(e.toStatus),
        `${s}: illegal edge ${e.fromStatus} → ${e.toStatus}`
      );
    }
  }
});

console.log(`simulator: ${passed} cases passed`);
