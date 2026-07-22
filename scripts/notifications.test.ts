/**
 * Tests for the pure half of platform notifications (`lib/notification-format`).
 *
 * The sending door itself touches Prisma and the two operator providers and is
 * untested here, the same gap the other `lib/*` writers carry. What this file
 * defends is the part the sender and the browser both depend on and could drift
 * on silently:
 *
 *   1. **Catalog completeness.** Every enum member has a spec and appears in
 *      KIND_ORDER exactly once. A missing entry is a kind whose preferences row
 *      renders blank and whose default channels are `undefined` — the alert
 *      simply never sends, and nothing throws.
 *   2. **Channel resolution.** A saved preference is authoritative even when it
 *      turns a channel *off* that the default turns on — the whole reason the
 *      row exists is to let someone mute an alert. The default is returned only
 *      in the genuine absence of a row.
 *   3. **Severity mapping.** The badge tone and rank a URGENT failed-refund
 *      relies on to sort above a menu submission.
 *
 * Pure — no Prisma, no request context.
 *
 *   npx tsx scripts/notifications.test.ts
 */

import assert from "node:assert/strict";
import {
  NOTIFICATION_CATALOG,
  KIND_ORDER,
  specFor,
  resolveChannels,
  badgeTone,
  severityRank,
} from "../src/lib/notification-format";

// The enum members, hard-coded rather than imported at runtime — the schema
// enum is a type, and this list failing to match the catalog is exactly the
// drift the completeness test is here to catch.
const ALL_KINDS = [
  "ORDER_PLACED",
  "REFUND_FAILED",
  "SUPPORT_TICKET",
  "CONTACT_FORM",
  "BOOKING_CREATED",
  "BOOKING_REMINDER",
  "MENU_SUBMISSION",
  "NEW_OPERATOR",
  "SERVICE_SUSPENDED",
  "PAYMENT_MODE_REVERTED",
  "PLAN_CHANGED",
  "BROADCAST",
  "REMINDER",
] as const;

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
  } catch (err) {
    console.error(`✗ ${name}`);
    throw err;
  }
}

// ── Catalog completeness ────────────────────────────────────────────────────

test("every kind has a catalog spec", () => {
  for (const kind of ALL_KINDS) {
    const spec = specFor(kind as (typeof ALL_KINDS)[number]);
    assert.ok(spec, `no spec for ${kind}`);
    assert.ok(spec.label.length > 0, `empty label for ${kind}`);
    assert.ok(spec.detail.length > 0, `empty detail for ${kind}`);
  }
});

test("catalog has no kind the enum doesn't", () => {
  for (const kind of Object.keys(NOTIFICATION_CATALOG)) {
    assert.ok(
      (ALL_KINDS as readonly string[]).includes(kind),
      `catalog has stray kind ${kind}`
    );
  }
});

test("KIND_ORDER lists every kind exactly once", () => {
  assert.equal(KIND_ORDER.length, ALL_KINDS.length);
  const seen = new Set<string>();
  for (const k of KIND_ORDER) {
    assert.ok(!seen.has(k), `duplicate in KIND_ORDER: ${k}`);
    seen.add(k);
    assert.ok((ALL_KINDS as readonly string[]).includes(k), `unknown kind in order: ${k}`);
  }
});

test("in-app default is on for every kind (the inbox is the floor)", () => {
  for (const kind of ALL_KINDS) {
    assert.equal(specFor(kind as (typeof ALL_KINDS)[number]).defaults.inApp, true);
  }
});

// ── Channel resolution ──────────────────────────────────────────────────────

test("resolveChannels returns the catalog default when no pref exists", () => {
  const ch = resolveChannels("ORDER_PLACED", null);
  assert.deepEqual(ch, NOTIFICATION_CATALOG.ORDER_PLACED.defaults);
});

test("resolveChannels returns the catalog default for undefined pref", () => {
  const ch = resolveChannels("REFUND_FAILED", undefined);
  assert.deepEqual(ch, NOTIFICATION_CATALOG.REFUND_FAILED.defaults);
});

test("a saved pref overrides the default, including turning a channel off", () => {
  // REFUND_FAILED defaults email + sms on; a mute must win.
  const ch = resolveChannels("REFUND_FAILED", { inApp: true, email: false, sms: false });
  assert.deepEqual(ch, { inApp: true, email: false, sms: false });
});

test("a saved pref can turn a channel on that the default leaves off", () => {
  // ORDER_PLACED defaults sms off.
  const ch = resolveChannels("ORDER_PLACED", { inApp: true, email: true, sms: true });
  assert.equal(ch.sms, true);
});

test("resolveChannels returns a copy, not the shared default object", () => {
  const ch = resolveChannels("MENU_SUBMISSION", null);
  ch.email = true;
  // Mutating the result must not corrupt the catalog for the next caller.
  assert.equal(NOTIFICATION_CATALOG.MENU_SUBMISSION.defaults.email, false);
});

// ── Severity ────────────────────────────────────────────────────────────────

test("badgeTone maps severity to a valid Badge tone", () => {
  assert.equal(badgeTone("URGENT"), "bad");
  assert.equal(badgeTone("WARNING"), "warn");
  assert.equal(badgeTone("INFO"), "neutral");
});

test("severityRank orders URGENT > WARNING > INFO", () => {
  assert.ok(severityRank("URGENT") > severityRank("WARNING"));
  assert.ok(severityRank("WARNING") > severityRank("INFO"));
});

test("money-owed and money-arriving kinds default to interruptive channels", () => {
  // A failed refund and an auto-reverted payment mode both leave money exposed
  // — they must reach someone who isn't logged in.
  assert.equal(NOTIFICATION_CATALOG.REFUND_FAILED.defaults.email, true);
  assert.equal(NOTIFICATION_CATALOG.PAYMENT_MODE_REVERTED.defaults.email, true);
});

console.log(`✓ notifications: ${passed} passed`);
