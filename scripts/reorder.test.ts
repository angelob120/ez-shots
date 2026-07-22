/**
 * Tests for the done-for-you reordering dial.
 *
 * The properties worth protecting here, in order of how quietly they'd fail:
 *
 *  - **A level always resolves to a defined cadence.** `reorderMode` is a plain
 *    String column, so a typo, a renamed level, or a null must never leave a
 *    tenant with no schedule. `coerceMode` sends anything unknown to the
 *    recommended default.
 *  - **The on/off and the level are independent.** Turning it off must not lose
 *    the tuned level — otherwise "dial down when it's busy, back up when it's
 *    slow" resets them every time.
 *  - **The dial is monotone.** LIGHT waits longest and reaches least; HEAVY the
 *    reverse. If that ordering ever inverts, the labels lie about what they do.
 *
 * Pure — no Prisma. `npx tsx scripts/reorder.test.ts`.
 */

import assert from "node:assert/strict";
import {
  coerceMode,
  reorderConfigFor,
  reorderTemplateSlug,
  isReorderSlug,
  ALL_REORDER_SLUGS,
  REORDER_MODES,
  DEFAULT_REORDER_MODE,
  type ReorderMode,
} from "../src/lib/reorder";

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

// ---------------------------------------------------------------------------
// coerceMode
// ---------------------------------------------------------------------------

test("coerceMode passes through the three known levels", () => {
  for (const m of REORDER_MODES) assert.equal(coerceMode(m), m);
});

test("coerceMode sends anything unknown to the default", () => {
  for (const bad of ["", "light", "AGGRESSIVE", "medium ", "0", "null", "OFF"]) {
    assert.equal(coerceMode(bad), DEFAULT_REORDER_MODE);
  }
});

test("coerceMode handles null and undefined", () => {
  assert.equal(coerceMode(null), DEFAULT_REORDER_MODE);
  assert.equal(coerceMode(undefined), DEFAULT_REORDER_MODE);
});

test("the recommended default is a known level", () => {
  assert.ok(REORDER_MODES.includes(DEFAULT_REORDER_MODE));
});

// ---------------------------------------------------------------------------
// reorderConfigFor — the on/off vs level split
// ---------------------------------------------------------------------------

test("enabled reflects the switch, not the level", () => {
  assert.equal(reorderConfigFor({ reorderCampaigns: true, reorderMode: "HEAVY" }).enabled, true);
  assert.equal(reorderConfigFor({ reorderCampaigns: false, reorderMode: "HEAVY" }).enabled, false);
});

test("the level survives being switched off", () => {
  // The whole "dial down when busy" promise: turning it off must still report
  // the tuned level, so turning it back on restores it rather than resetting.
  const off = reorderConfigFor({ reorderCampaigns: false, reorderMode: "LIGHT" });
  assert.equal(off.enabled, false);
  assert.equal(off.mode, "LIGHT");
  assert.ok(off.lapseDays > 0 && off.minGapDays > 0);
});

test("an unknown stored mode still yields a usable cadence", () => {
  const c = reorderConfigFor({ reorderCampaigns: true, reorderMode: "banana" });
  assert.equal(c.mode, DEFAULT_REORDER_MODE);
  assert.ok(c.lapseDays > 0 && c.minGapDays > 0);
});

// ---------------------------------------------------------------------------
// Monotonicity — the labels have to mean something
// ---------------------------------------------------------------------------

test("higher intensity qualifies sooner and messages more often", () => {
  const cfg = (m: ReorderMode) => reorderConfigFor({ reorderCampaigns: true, reorderMode: m });
  const light = cfg("LIGHT");
  const medium = cfg("MEDIUM");
  const heavy = cfg("HEAVY");

  // A lower lapse threshold means a less-lapsed customer already qualifies —
  // i.e. the audience is broader as intensity rises.
  assert.ok(light.lapseDays > medium.lapseDays);
  assert.ok(medium.lapseDays > heavy.lapseDays);

  // A smaller gap means more frequent contact as intensity rises.
  assert.ok(light.minGapDays > medium.minGapDays);
  assert.ok(medium.minGapDays > heavy.minGapDays);
});

test("every level has strictly positive cadence numbers", () => {
  for (const m of REORDER_MODES) {
    const c = reorderConfigFor({ reorderCampaigns: true, reorderMode: m });
    assert.ok(Number.isInteger(c.lapseDays) && c.lapseDays > 0);
    assert.ok(Number.isInteger(c.minGapDays) && c.minGapDays > 0);
  }
});

// ---------------------------------------------------------------------------
// Template slug mapping — the link between the dial and the journey
// ---------------------------------------------------------------------------

test("every level maps to a distinct reorder- slug", () => {
  const slugs = REORDER_MODES.map(reorderTemplateSlug);
  assert.equal(new Set(slugs).size, slugs.length);
  for (const s of slugs) assert.ok(s.startsWith("reorder-"), s);
});

test("isReorderSlug recognises exactly the mapped slugs", () => {
  for (const m of REORDER_MODES) assert.ok(isReorderSlug(reorderTemplateSlug(m)));
  for (const bad of ["reorder", "winback", "reorder-", "welcome", ""]) {
    assert.equal(isReorderSlug(bad), false);
  }
});

test("ALL_REORDER_SLUGS is the full mapped set", () => {
  assert.deepEqual(
    [...ALL_REORDER_SLUGS].sort(),
    REORDER_MODES.map(reorderTemplateSlug).sort()
  );
});

console.log(`reorder: ${passed} passed`);
