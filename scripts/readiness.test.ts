/**
 * Tests for the setup-readiness derivation.
 *
 * The property that matters here isn't "does it count checks" — it's the
 * blocking/advisory split. `lib/readiness.ts` feeds the admin attention list,
 * and the whole value of that list is that it distinguishes "this tenant cannot
 * take an order" from "this tenant hasn't uploaded a logo". Get that wrong in
 * either direction and the list stops being worth reading: too loud and it gets
 * skimmed, too quiet and a broken tenant sits there for a week.
 *
 * Only the pure half is covered. `attentionList()` queries four tables and
 * belongs with the integration tests this repo still doesn't have.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.invites.json scripts/readiness.test.ts
 */

import assert from "node:assert/strict";
import { readiness, type ReadinessInput } from "../src/lib/readiness";

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

/** A tenant with nothing done — the state right after an admin creates one. */
function blank(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    id: "r1",
    name: "Angelo's Pizza",
    slug: "angelos-pizza",
    status: "PENDING",
    onboardedAt: null,
    onboardingStep: 0,
    hoursJson: {},
    customDomain: null,
    domainVerifiedAt: null,
    logoUrl: null,
    heroUrl: null,
    stripeAccountId: null,
    stripeChargesEnabled: false,
    cardPaymentsEnabled: true,
    _count: { items: 0, orders: 0, users: 0 },
    ...over,
  };
}

/** A tenant that's genuinely trading. */
function ready(over: Partial<ReadinessInput> = {}): ReadinessInput {
  return blank({
    status: "ACTIVE",
    onboardedAt: new Date(),
    onboardingStep: 4,
    hoursJson: { mon: [{ open: "11:00", close: "22:00" }] },
    logoUrl: "https://cdn/logo.png",
    stripeAccountId: "acct_1",
    stripeChargesEnabled: true,
    _count: { items: 12, orders: 40, users: 1 },
    ...over,
  });
}

// --- The split that matters -------------------------------------------------

test("a brand-new tenant is blocked, and says why", () => {
  const state = readiness(blank());
  assert.equal(state.canTrade, false);
  const keys = state.blockers.map((b) => b.key).sort();
  assert.deepEqual(keys, ["launched", "menu", "owner"]);
});

test("a finished tenant is clear", () => {
  const state = readiness(ready());
  assert.equal(state.canTrade, true);
  assert.equal(state.blockers.length, 0);
});

test("no menu items blocks — an empty storefront can't take an order", () => {
  const state = readiness(ready({ _count: { items: 0, orders: 0, users: 1 } }));
  assert.equal(state.canTrade, false);
  assert.ok(state.blockers.some((b) => b.key === "menu"));
});

test("no login blocks — nobody can reach the dashboard", () => {
  const state = readiness(ready({ _count: { items: 5, orders: 0, users: 0 } }));
  assert.equal(state.canTrade, false);
  assert.ok(state.blockers.some((b) => b.key === "owner"));
});

test("no hours does NOT block — lib/hours.ts fails open by design", () => {
  const state = readiness(ready({ hoursJson: {} }));
  assert.equal(state.canTrade, true, "a tenant with no schedule keeps trading; that's deliberate");
  assert.ok(state.outstanding.some((c) => c.key === "hours"), "but it still gets flagged");
});

test("no Stripe does NOT block — pay-at-counter is a real configuration", () => {
  const state = readiness(ready({ stripeAccountId: null, stripeChargesEnabled: false }));
  assert.equal(state.canTrade, true);
  assert.ok(state.outstanding.some((c) => c.key === "payments"));
});

test("no branding does NOT block", () => {
  const state = readiness(ready({ logoUrl: null, heroUrl: null }));
  assert.equal(state.canTrade, true);
  assert.ok(state.outstanding.some((c) => c.key === "branding"));
});

// --- Domain: absence is a settled state, not a task -------------------------

test("no custom domain is DONE, not outstanding", () => {
  // Most restaurants never want one. Listing it as an open task on every tenant
  // forever is how an attention list becomes wallpaper.
  const state = readiness(ready({ customDomain: null }));
  assert.ok(!state.outstanding.some((c) => c.key === "domain"));
});

test("a domain typed but never verified IS outstanding", () => {
  const state = readiness(ready({ customDomain: "order.angelos.com", domainVerifiedAt: null }));
  assert.ok(state.outstanding.some((c) => c.key === "domain"));
  assert.equal(state.canTrade, true, "their links just stay on our host meanwhile");
});

test("a verified domain is done", () => {
  const state = readiness(
    ready({ customDomain: "order.angelos.com", domainVerifiedAt: new Date() })
  );
  assert.ok(!state.outstanding.some((c) => c.key === "domain"));
});

// --- Shape ------------------------------------------------------------------

test("hours is read from hoursJson, not the free-text column", () => {
  // The free-text `hours` field is prose beside the schedule, never a
  // substitute for it — see docs/post-order-gaps.md item 9.
  const withSchedule = readiness(ready({ hoursJson: { fri: [{ open: "17:00", close: "23:00" }] } }));
  assert.ok(!withSchedule.outstanding.some((c) => c.key === "hours"));

  const garbage = readiness(ready({ hoursJson: { mon: "11am til late" } as never }));
  assert.ok(garbage.outstanding.some((c) => c.key === "hours"), "unparseable is not configured");
});

test("progress runs 0..1 and matches the ticks", () => {
  const blankState = readiness(blank());
  const readyState = readiness(ready());
  assert.ok(blankState.progress >= 0 && blankState.progress < 1);
  assert.equal(readyState.progress, 1);
  assert.equal(
    readyState.checks.filter((c) => c.done).length,
    readyState.checks.length
  );
});

test("every outstanding check carries a fix an operator can act on", () => {
  const state = readiness(blank());
  for (const c of state.outstanding) {
    assert.ok(c.fix.trim().length > 10, `${c.key} has no usable fix text`);
  }
});

test("blockers are a subset of outstanding", () => {
  const state = readiness(blank());
  for (const b of state.blockers) {
    assert.ok(state.outstanding.includes(b));
  }
});

console.log(`readiness: ${passed} passed`);
