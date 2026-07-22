/**
 * Tests for the onboarding gate.
 *
 * The property this file exists to protect is the asymmetry, and it is the
 * one a future change is most likely to "tidy up": **a tenant that hasn't
 * launched is blocked; a tenant that has launched is never blocked, only
 * nagged.** `/dashboard` is the live order board, and a gate that fires on an
 * established restaurant during service stops them handing food to customers
 * who have already paid. Everything else here is arithmetic.
 *
 * Pure — no Prisma, no request context. `npx tsx scripts/onboarding.test.ts`.
 */

import assert from "node:assert/strict";
import {
  blockingSteps,
  canLaunch,
  gateFor,
  nextStep,
  onboardingSteps,
  progress,
  resolveStep,
  type OnboardingSnapshot,
} from "../src/lib/onboarding";

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

/** A tenant with everything required done, but not yet launched. */
function ready(over: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return {
    onboardedAt: null,
    onboardingStep: 5,
    name: "Pat's Pizza",
    phone: "+15550101234",
    address: "12 High Street",
    hasSchedule: true,
    itemCount: 3,
    menuSubmitted: false,
    // Booking is a required step now; a "ready to launch" tenant has booked.
    callBooked: true,
    // The reordering choice is required-to-answer but not launch-gating, so a
    // "ready" tenant has answered it — though canLaunch does not depend on it.
    reorderChosen: true,
    logoUrl: null,
    heroUrl: null,
    ...over,
  };
}

/** A brand-new signup that has done nothing. */
function fresh(over: Partial<OnboardingSnapshot> = {}): OnboardingSnapshot {
  return ready({
    onboardingStep: 0,
    phone: null,
    address: null,
    hasSchedule: false,
    itemCount: 0,
    menuSubmitted: false,
    callBooked: false,
    reorderChosen: false,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// What blocks
// ---------------------------------------------------------------------------

test("a fresh signup is blocked on basics, menu, hours and booking", () => {
  const keys = blockingSteps(fresh()).map((s) => s.key);
  assert.deepEqual(keys, ["basics", "menu", "hours", "booking"]);
});

test("a menu submission satisfies the menu step in place of items", () => {
  // An owner who chose "have us build it" has no items yet but isn't blocked.
  assert.equal(canLaunch(ready({ itemCount: 0, menuSubmitted: true })), true);
  assert.equal(canLaunch(ready({ itemCount: 0, menuSubmitted: false })), false);
});

test("booking is required and blocks launch", () => {
  assert.equal(canLaunch(ready({ callBooked: false })), false);
  const blocked = blockingSteps(ready({ callBooked: false }));
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].key, "booking");
});

test("branding never blocks", () => {
  // The deliberate exception. An owner without their logo file to hand at 11pm
  // should still be able to open tomorrow.
  const s = ready({ logoUrl: null, heroUrl: null });
  assert.equal(canLaunch(s), true);
  assert.equal(
    blockingSteps(s).some((x) => x.key === "branding"),
    false
  );
});

test("either a logo or a hero counts as branding done", () => {
  assert.equal(onboardingSteps(ready({ logoUrl: "/l.png" }))[1].done, true);
  assert.equal(onboardingSteps(ready({ heroUrl: "/h.jpg" }))[1].done, true);
  assert.equal(onboardingSteps(ready())[1].done, false);
});

test("basics needs all three of name, phone and address", () => {
  assert.equal(canLaunch(ready({ phone: null })), false);
  assert.equal(canLaunch(ready({ address: null })), false);
  assert.equal(canLaunch(ready({ name: "" })), false);
  assert.equal(canLaunch(ready()), true);
});

test("whitespace doesn't satisfy basics", () => {
  // A form that trims on display but not on save is how "   " ends up in a
  // required column looking, to the eye, exactly like a real value.
  assert.equal(canLaunch(ready({ phone: "   " })), false);
  assert.equal(canLaunch(ready({ address: "\t" })), false);
  assert.equal(canLaunch(ready({ name: "  " })), false);
});

test("one menu item is enough, zero is not", () => {
  assert.equal(canLaunch(ready({ itemCount: 0 })), false);
  assert.equal(canLaunch(ready({ itemCount: 1 })), true);
});

test("hours block launch", () => {
  // The regression that motivated the whole step: availability fails open, so
  // a tenant launched with no schedule takes orders at 3am on night one.
  assert.equal(canLaunch(ready({ hasSchedule: false })), false);
  const blocked = blockingSteps(ready({ hasSchedule: false }));
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0].key, "hours");
});

test("launch itself is never listed as a thing blocking launch", () => {
  for (const s of [fresh(), ready(), ready({ itemCount: 0 })]) {
    assert.equal(
      blockingSteps(s).some((x) => x.key === "launch"),
      false
    );
  }
});

test("every blocking step carries an actionable todo", () => {
  // "Opening hours: incomplete" tells an owner nothing. The banner prints
  // these verbatim, so an empty or terse one is a user-visible defect.
  for (const step of blockingSteps(fresh())) {
    assert.ok(step.todo.length > 30, `${step.key} has no useful todo`);
    assert.ok(/[a-z]/.test(step.todo));
  }
});

// ---------------------------------------------------------------------------
// The asymmetry — the point of the file
// ---------------------------------------------------------------------------

test("an un-launched tenant with gaps is blocked", () => {
  const g = gateFor(fresh());
  assert.equal(g.state, "blocked");
});

test("a LAUNCHED tenant with the same gaps is nagged, never blocked", () => {
  // Identical data, one field different. This is the whole rule.
  const g = gateFor(fresh({ onboardedAt: new Date("2025-01-01") }));
  assert.equal(g.state, "gaps");
});

test("a launched tenant that clears its hours is not locked out", () => {
  const g = gateFor(ready({ onboardedAt: new Date(), hasSchedule: false }));
  assert.equal(g.state, "gaps");
  assert.notEqual(g.state, "blocked");
});

test("a launched tenant that deletes every menu item is not locked out", () => {
  // Mid-menu-rebuild. Annoying to be told; catastrophic to be locked out of
  // the order board over.
  const g = gateFor(ready({ onboardedAt: new Date(), itemCount: 0 }));
  assert.equal(g.state, "gaps");
});

test("a launched, complete tenant sees nothing at all", () => {
  const g = gateFor(ready({ onboardedAt: new Date() }));
  assert.equal(g.state, "complete");
  // "Never visible again after onboarding completes" — there is no payload to
  // render, so there is nothing for a caller to accidentally show.
  assert.equal("steps" in g, false);
});

test("an un-launched tenant with nothing outstanding is still 'blocked', pointing at launch", () => {
  // Because they haven't launched yet: the wizard is still where they belong,
  // it just has nothing left to demand.
  const g = gateFor(ready());
  assert.equal(g.state, "blocked");
  if (g.state === "blocked") {
    assert.equal(g.steps.length, 0);
    assert.equal(g.next, 7);
  }
});

// ---------------------------------------------------------------------------
// Step resolution
// ---------------------------------------------------------------------------

test("nextStep points at the first thing outstanding", () => {
  assert.equal(nextStep(fresh()), 1);
  assert.equal(nextStep(fresh({ phone: "+1", address: "x" })), 3);
  assert.equal(nextStep(ready({ hasSchedule: false })), 4);
  assert.equal(nextStep(ready({ callBooked: false })), 5);
  // reorder (step 6) is not launch-gating, so nothing outstanding points
  // straight at launch (step 7), skipping it — the nag handles it later.
  assert.equal(nextStep(ready()), 7);
});

test("nextStep skips branding even when it's the earliest unfinished step", () => {
  // Branding is step 2 and not done, but menu (3) is what's actually blocking.
  const s = ready({ logoUrl: null, heroUrl: null, itemCount: 0 });
  assert.equal(nextStep(s), 3);
});

test("you cannot URL-hack your way to the launch step", () => {
  // The whole gate would be decorative if `?step=7` worked.
  const s = fresh();
  assert.notEqual(resolveStep(s, 7), 7);
  assert.equal(resolveStep(s, 7), nextStep(s));
});

test("launch is reachable once nothing blocks", () => {
  assert.equal(resolveStep(ready(), 7), 7);
});

test("a completed step can be revisited", () => {
  const s = ready({ onboardingStep: 4 });
  assert.equal(resolveStep(s, 1), 1);
  assert.equal(resolveStep(s, 2), 2);
});

test("out-of-range requests are clamped, not crashed", () => {
  const s = ready();
  assert.ok(resolveStep(s, 0) >= 1);
  assert.ok(resolveStep(s, 99) <= 7);
  assert.ok(resolveStep(s, -4) >= 1);
});

test("a null request lands on the first outstanding step", () => {
  assert.equal(resolveStep(fresh(), null), 1);
  assert.equal(resolveStep(ready({ hasSchedule: false }), null), 4);
});

test("resolveStep never returns a step that doesn't exist", () => {
  const cases = [fresh(), ready(), ready({ itemCount: 0 }), ready({ onboardingStep: 99 })];
  for (const s of cases) {
    for (const req of [null, 0, 1, 2, 3, 4, 5, 6, 7, 8, 100, -1]) {
      const n = resolveStep(s, req);
      assert.ok(n >= 1 && n <= 7, `resolveStep returned ${n}`);
      assert.ok(Number.isInteger(n));
    }
  }
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

test("progress counts required steps only, launch excluded", () => {
  // basics, menu, hours, booking — four. Branding isn't required; launch isn't
  // a task.
  assert.equal(progress(fresh()).total, 4);
});

test("progress runs 0 to 100", () => {
  assert.equal(progress(fresh()).pct, 0);
  assert.equal(progress(fresh()).done, 0);
  assert.equal(progress(ready()).pct, 100);
  assert.equal(progress(ready()).done, 4);
});

test("progress is monotonic as steps are completed", () => {
  const stages: OnboardingSnapshot[] = [
    fresh(),
    fresh({ phone: "+1", address: "x" }),
    fresh({ phone: "+1", address: "x", itemCount: 2 }),
    fresh({ phone: "+1", address: "x", itemCount: 2, hasSchedule: true }),
    fresh({ phone: "+1", address: "x", itemCount: 2, hasSchedule: true, callBooked: true }),
  ];
  let last = -1;
  for (const s of stages) {
    const p = progress(s).pct;
    assert.ok(p > last, `progress went ${last} -> ${p}`);
    last = p;
  }
  assert.equal(last, 100);
});

test("the step list is stable and correctly numbered", () => {
  const steps = onboardingSteps(fresh());
  assert.deepEqual(
    steps.map((s) => s.key),
    ["basics", "branding", "menu", "hours", "booking", "reorder", "launch"]
  );
  steps.forEach((s, i) => assert.equal(s.n, i + 1));
});

test("launch is 'done' only once the tenant has actually launched", () => {
  assert.equal(onboardingSteps(ready()).at(-1)!.done, false);
  assert.equal(onboardingSteps(ready({ onboardedAt: new Date() })).at(-1)!.done, true);
});

console.log(`onboarding: ${passed} passed`);
