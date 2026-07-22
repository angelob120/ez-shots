/**
 * In-memory request throttling for the token-only `/o/[token]` actions.
 *
 * There's no account behind a pickup order — the URL token is the entire
 * auth story — so nothing stops the same link being replayed as fast as a
 * script can post to it. This isn't about the 160-bit token being guessable
 * (it isn't, and enumeration is a non-issue); it's about one link being
 * hammered by whoever holds it, deliberately or by a stuck retry loop.
 *
 * This is a single-process sliding window, not a distributed one: state
 * lives in memory and resets on deploy, and running more than one web
 * instance would give each its own counter. That's an acceptable trade for
 * a customer-facing safety net where under-limiting costs an owner a
 * duplicate text or a confused customer clicking twice, not a security
 * boundary — the token remains the actual boundary. If this repo ever runs
 * more than one instance, this needs to move to a shared store (a Postgres
 * row, Redis) instead of a module-level Map.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

// Buckets are cheap, but a long-running process shouldn't accumulate one
// per token forever. Sweep expired entries opportunistically on write
// rather than running a timer nothing else in this file needs.
const MAX_BUCKETS = 10_000;

export type RateLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterMs: number };

export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    if (buckets.size > MAX_BUCKETS) sweep(now);
    return { allowed: true };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true };
}

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Test-only escape hatch — clears all state between cases. */
export function _resetRateLimitsForTests() {
  buckets.clear();
}
