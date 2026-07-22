/**
 * Tests for the in-memory throttle guarding `/o/[token]` actions.
 *
 * Pure sliding-window logic, no Prisma involved — run with
 * `npx tsx scripts/rate-limit.test.ts`.
 */

import assert from "node:assert/strict";
import { checkRateLimit, _resetRateLimitsForTests } from "../src/lib/rate-limit";

let passed = 0;
function test(name: string, fn: () => void) {
  _resetRateLimitsForTests();
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

test("allows requests under the limit", () => {
  for (let i = 0; i < 3; i++) {
    assert.equal(checkRateLimit("a", 3, 1000).allowed, true);
  }
});

test("blocks the request that exceeds the limit", () => {
  for (let i = 0; i < 3; i++) checkRateLimit("a", 3, 1000);
  const res = checkRateLimit("a", 3, 1000);
  assert.equal(res.allowed, false);
  if (!res.allowed) assert.ok(res.retryAfterMs > 0);
});

test("keys are independent — a burst on one action, or one token, doesn't spend another's budget", () => {
  for (let i = 0; i < 3; i++) checkRateLimit("cancel:tok1", 3, 1000);
  assert.equal(checkRateLimit("cancel:tok1", 3, 1000).allowed, false);
  assert.equal(checkRateLimit("report:tok1", 3, 1000).allowed, true); // same token, other action
  assert.equal(checkRateLimit("cancel:tok2", 3, 1000).allowed, true); // same action, other token
});

test("window resets after it elapses", () => {
  const key = "reset-test";
  const windowMs = 20;
  for (let i = 0; i < 2; i++) checkRateLimit(key, 2, windowMs);
  assert.equal(checkRateLimit(key, 2, windowMs).allowed, false);

  const deadline = Date.now() + 500;
  let recovered = false;
  while (Date.now() < deadline) {
    if (checkRateLimit(key, 2, windowMs).allowed) {
      recovered = true;
      break;
    }
  }
  assert.equal(recovered, true, "expected the window to reset and allow again");
});

test("retryAfterMs never exceeds the window", () => {
  const windowMs = 5000;
  checkRateLimit("b", 1, windowMs);
  const res = checkRateLimit("b", 1, windowMs);
  assert.equal(res.allowed, false);
  if (!res.allowed) {
    assert.ok(res.retryAfterMs <= windowMs);
    assert.ok(res.retryAfterMs > 0);
  }
});

console.log(`rate-limit: ${passed} passed`);
