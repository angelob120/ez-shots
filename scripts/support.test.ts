/**
 * Tests for the pure half of the support system.
 *
 * Run with `npx tsx --tsconfig scripts/tsconfig.test.json scripts/support.test.ts`.
 * Prisma is the exploding stub, which is the right one here: everything below
 * is a decision, and a test that needed a database to check a decision would be
 * testing the database.
 *
 * What's covered is the part that can silently go wrong:
 *
 *   - The status machine, including the two asymmetric rules — resolved can be
 *     reopened, archived cannot. Get the second one wrong and the bottom of the
 *     queue climbs back out; get the first one wrong and every "that didn't
 *     fix it" becomes a fresh ticket with none of the history.
 *
 *   - The timestamps that hang off a status. These are the ones that produce a
 *     board and a report that disagree, and nobody notices until somebody asks
 *     how long tickets take.
 *
 *   - `isEmailish`, which is the only thing standing between a restaurant and
 *     an unanswerable ticket. It is deliberately permissive, and the tests
 *     record which real addresses would break if somebody "tightens" it.
 *
 * Not covered: everything that writes. `createTicket`, `ownerReply`,
 * `adminReply`, `submitContact` and the two `set*Status` functions all take the
 * optimistic lock and all need a database double to test properly — the same
 * gap `scripts/orders.concurrency.test.ts` exists to close for orders. If you
 * add a writer, that's the file to imitate.
 */

import assert from "node:assert/strict";
import {
  canTransition,
  stampsFor,
  isEmailish,
  LIVE_STATUSES,
  CATEGORIES,
  PRIORITIES,
  CATEGORY_LABELS,
  PRIORITY_LABELS,
  STATUS_LABELS,
} from "../src/lib/support";
import type { SupportStatus } from "@prisma/client";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const ALL: SupportStatus[] = ["OPEN", "WAITING", "RESOLVED", "ARCHIVED"];

// ── The status machine ────────────────────────────────────────────────────

test("a new ticket can be answered, resolved, or archived", () => {
  assert.equal(canTransition("OPEN", "WAITING"), true);
  assert.equal(canTransition("OPEN", "RESOLVED"), true);
  assert.equal(canTransition("OPEN", "ARCHIVED"), true);
});

test("an answered ticket comes back to us when the owner replies", () => {
  assert.equal(canTransition("WAITING", "OPEN"), true);
});

test("a resolved ticket can be reopened", () => {
  // "That didn't fix it" is the most common next message. Forcing a new ticket
  // throws away the history that explains the first one.
  assert.equal(canTransition("RESOLVED", "OPEN"), true);
});

test("a resolved ticket cannot jump straight back to waiting", () => {
  // Waiting means "we answered, it's on them". Landing there from resolved
  // would claim a reply that nobody wrote.
  assert.equal(canTransition("RESOLVED", "WAITING"), false);
});

test("archived is terminal", () => {
  for (const to of ALL) {
    assert.equal(canTransition("ARCHIVED", to), false, `ARCHIVED -> ${to} must be refused`);
  }
});

test("nothing transitions to itself", () => {
  for (const s of ALL) {
    assert.equal(canTransition(s, s), false, `${s} -> ${s} should not be a move`);
  }
});

test("every non-archived status can be archived", () => {
  // Archive is the escape hatch for spam and for tickets that resolve
  // themselves. A status you can't get out of the queue from is a status that
  // makes the queue permanently wrong.
  for (const s of ALL.filter((x) => x !== "ARCHIVED")) {
    assert.equal(canTransition(s, "ARCHIVED"), true, `${s} must be archivable`);
  }
});

test("the live set is exactly the statuses that want a person", () => {
  assert.deepEqual([...LIVE_STATUSES].sort(), ["OPEN", "WAITING"]);
});

// ── Timestamps ────────────────────────────────────────────────────────────

const NOW = new Date("2026-03-14T15:00:00.000Z");

test("resolving stamps resolvedAt", () => {
  assert.deepEqual(stampsFor("RESOLVED", NOW), { resolvedAt: NOW, archivedAt: null });
});

test("archiving stamps archivedAt and leaves resolvedAt alone", () => {
  // A ticket resolved on Monday and archived on Friday keeps both dates —
  // clearing the first would erase when it was actually fixed.
  assert.deepEqual(stampsFor("ARCHIVED", NOW), { archivedAt: NOW });
});

test("reopening clears resolvedAt", () => {
  // Otherwise "how long did this take" answers with the time we *first*
  // declared it fixed, which is the number that flatters us and misleads
  // everyone.
  assert.deepEqual(stampsFor("OPEN", NOW), { resolvedAt: null, archivedAt: null });
  assert.deepEqual(stampsFor("WAITING", NOW), { resolvedAt: null, archivedAt: null });
});

test("resolving un-archives, so the two flags can't both be live", () => {
  const s = stampsFor("RESOLVED", NOW) as { archivedAt: Date | null };
  assert.equal(s.archivedAt, null);
});

// ── Email validation ──────────────────────────────────────────────────────

test("ordinary addresses pass", () => {
  for (const ok of [
    "maria@therestaurant.com",
    "orders+support@sub.domain.co.uk",
    "a@b.co",
    "first.last@example.org",
    "  spaced@example.com  ",
  ]) {
    assert.equal(isEmailish(ok), true, `${ok} should be accepted`);
  }
});

test("things that cannot receive mail are rejected", () => {
  for (const bad of ["", "   ", "maria", "maria@", "@example.com", "maria@example", "a b@c.com", "two@at@example.com"]) {
    assert.equal(isEmailish(bad), false, `${bad} should be rejected`);
  }
});

test("validation is permissive on purpose, and here's what that means", () => {
  // These are wrong-looking but genuinely deliverable shapes. They pass, and
  // that's the intended trade: a false reject here is a restaurant that can't
  // reach us, which costs more than a bounced reply.
  assert.equal(isEmailish("UPPER@EXAMPLE.COM"), true);
  assert.equal(isEmailish("x@y.z"), true);
});

// ── Labels ────────────────────────────────────────────────────────────────

test("every enum value has a label", () => {
  // A missing entry renders as `undefined` in a dropdown, which is the kind of
  // thing that only shows up after somebody adds a category.
  for (const c of CATEGORIES) assert.ok(CATEGORY_LABELS[c], `no label for category ${c}`);
  for (const p of PRIORITIES) assert.ok(PRIORITY_LABELS[p], `no label for priority ${p}`);
  for (const s of ALL) assert.ok(STATUS_LABELS[s], `no label for status ${s}`);
});

test("priority labels describe consequences, not severities", () => {
  // The owner picking this is the person losing the money. "High" means
  // nothing to them; "costing me orders" is a question they can answer, which
  // is what makes the field worth sorting on.
  assert.match(PRIORITY_LABELS.URGENT, /can't take orders/i);
  assert.match(PRIORITY_LABELS.HIGH, /orders/i);
});

console.log(`support: ${passed} passed`);
