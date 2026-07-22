/**
 * Tests for the pure half of storefront analytics.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.test.json scripts/analytics.test.ts
 *
 * Two modules are covered and they fail in different ways, which is why both
 * are here rather than only the interesting-looking one.
 *
 * `lib/analytics-range.ts` is date arithmetic in a restaurant's own timezone.
 * Its failure mode is quiet: an off-by-one boundary or a DST slip doesn't throw
 * anything, it just moves a few orders into the wrong day and makes every
 * period-over-period comparison subtly wrong. Nobody notices until an owner
 * insists their Tuesday was better than we say it was, and by then there's no
 * way to tell which number was wrong.
 *
 * `lib/analytics.ts` is the ingest door. Its pure parts are the ones that
 * decide what gets stored at all — the label allowlist, the dwell clamp, the
 * timestamp sanity check, the funnel milestone mapping. Every one of those is a
 * rule that only holds because there's one place enforcing it, and a rule with
 * no test is a rule the next refactor gets to quietly drop.
 *
 * Nothing here touches Prisma; the stub explodes if anything tries.
 */

import assert from "node:assert/strict";
import {
  addDays,
  bucketLabel,
  bucketsFor,
  delta,
  formatDateInput,
  formatDuration,
  fromLocal,
  granularityFor,
  parseDateInput,
  previousRange,
  rate,
  resolveRange,
  startOfLocalDay,
  toLocal,
  truncateLocal,
  tzOffsetMinutes,
} from "../src/lib/analytics-range";
import {
  MAX_DWELL_MS,
  MAX_EVENT_DWELL_MS,
  classifySource,
  isValidAnonId,
  milestonesFrom,
  normalizeDevice,
  resolveAt,
} from "../src/lib/analytics";

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

const NY = "America/New_York";
const PHX = "America/Phoenix"; // no daylight saving — the control case
const TOK = "Asia/Tokyo";

// ---------------------------------------------------------------------------
// Timezone primitives
// ---------------------------------------------------------------------------

test("tzOffsetMinutes reports standard time", () => {
  // 15 Jan 2026, deep in EST (UTC-5).
  assert.equal(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), NY), -300);
});

test("tzOffsetMinutes reports daylight time", () => {
  // 15 Jul 2026, EDT (UTC-4). If this ever equals -300 the whole module is
  // reading a fixed offset table rather than the actual rules.
  assert.equal(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), NY), -240);
});

test("tzOffsetMinutes handles a zone that never shifts", () => {
  assert.equal(tzOffsetMinutes(new Date("2026-01-15T12:00:00Z"), PHX), -420);
  assert.equal(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), PHX), -420);
});

test("tzOffsetMinutes handles a positive offset", () => {
  assert.equal(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), TOK), 540);
});

test("an unknown timezone degrades to UTC rather than throwing", () => {
  // A blank dashboard is a worse failure than one that's a few hours off, and
  // a tenant with a typo'd timezone must not be able to 500 their own page.
  assert.equal(tzOffsetMinutes(new Date("2026-07-15T12:00:00Z"), "Mars/Olympus"), 0);
});

test("toLocal and fromLocal round-trip", () => {
  const at = new Date("2026-07-15T16:30:00Z");
  assert.equal(fromLocal(toLocal(at, NY), NY).getTime(), at.getTime());
});

test("toLocal and fromLocal round-trip across a DST boundary", () => {
  // 1 Nov 2026 is the US fall-back. This is the case a naive single-pass
  // inverse gets wrong by an hour.
  const at = new Date("2026-11-01T05:30:00Z");
  assert.equal(fromLocal(toLocal(at, NY), NY).getTime(), at.getTime());
});

test("startOfLocalDay lands on local midnight, not UTC midnight", () => {
  // 03:00Z on the 16th is 11pm on the 15th in New York, so the day it belongs
  // to began at 04:00Z on the 15th — midnight EDT. A UTC-based truncation
  // would file this order under the 16th and move a late dinner rush a day.
  const start = startOfLocalDay(new Date("2026-07-16T03:00:00Z"), NY);
  assert.equal(start.toISOString(), "2026-07-15T04:00:00.000Z");
});

test("startOfLocalDay is idempotent", () => {
  const once = startOfLocalDay(new Date("2026-07-16T18:00:00Z"), NY);
  assert.equal(startOfLocalDay(once, NY).getTime(), once.getTime());
});

// ---------------------------------------------------------------------------
// Granularity
// ---------------------------------------------------------------------------

test("granularity is chosen from the span", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  assert.equal(granularityFor(from, addDays(from, 1)), "hour");
  assert.equal(granularityFor(from, addDays(from, 30)), "day");
  assert.equal(granularityFor(from, addDays(from, 180)), "week");
  assert.equal(granularityFor(from, addDays(from, 800)), "month");
});

test("a fortnight buckets daily, not hourly", () => {
  // Both are defensible; daily wins because it's the one an owner can compare
  // against the fortnight before. 336 hourly columns is not a chart.
  const from = new Date("2026-01-01T00:00:00Z");
  assert.equal(granularityFor(from, addDays(from, 14)), "day");
});

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

const NOW = new Date("2026-07-15T18:00:00Z"); // 2pm EDT, a Wednesday

test("today resolves to the local day, exclusive of tomorrow", () => {
  const r = resolveRange({ preset: "today", timezone: NY, now: NOW });
  assert.equal(r.from.toISOString(), "2026-07-15T04:00:00.000Z");
  assert.equal(r.to.toISOString(), "2026-07-16T04:00:00.000Z");
});

test("yesterday is the day before, and does not overlap today", () => {
  const today = resolveRange({ preset: "today", timezone: NY, now: NOW });
  const yday = resolveRange({ preset: "yesterday", timezone: NY, now: NOW });
  // The half-open contract: yesterday's exclusive end is today's inclusive
  // start. With an inclusive end, an order at midnight lands in both.
  assert.equal(yday.to.getTime(), today.from.getTime());
});

test("last 7 days includes today", () => {
  const r = resolveRange({ preset: "7d", timezone: NY, now: NOW });
  const days = (r.to.getTime() - r.from.getTime()) / 86400000;
  assert.equal(days, 7);
});

test("30d is the default for an unrecognised preset", () => {
  const r = resolveRange({ preset: "nonsense", timezone: NY, now: NOW });
  assert.equal(r.preset, "30d");
});

test("month to date starts on the first of the local month", () => {
  const r = resolveRange({ preset: "mtd", timezone: NY, now: NOW });
  assert.equal(formatDateInput(r.from, NY), "2026-07-01");
});

test("year to date starts on 1 January, local", () => {
  const r = resolveRange({ preset: "ytd", timezone: NY, now: NOW });
  assert.equal(formatDateInput(r.from, NY), "2026-01-01");
});

test("all time uses the earliest activity when there is some", () => {
  const since = new Date("2025-03-09T15:00:00Z");
  const r = resolveRange({ preset: "all", timezone: NY, now: NOW, since });
  assert.equal(formatDateInput(r.from, NY), "2025-03-09");
});

test("all time falls back to a year when a tenant has no history", () => {
  const r = resolveRange({ preset: "all", timezone: NY, now: NOW, since: null });
  const days = Math.round((r.to.getTime() - r.from.getTime()) / 86400000);
  assert.equal(days, 365);
});

test("a custom range includes the end day the person named", () => {
  const r = resolveRange({
    preset: "custom",
    from: "2026-03-01",
    to: "2026-03-31",
    timezone: NY,
    now: NOW,
  });
  // 31 days inclusive means the exclusive bound is 1 April.
  assert.equal(formatDateInput(r.from, NY), "2026-03-01");
  assert.equal(formatDateInput(new Date(r.to.getTime() - 1), NY), "2026-03-31");
});

test("a custom range spanning a DST change is still whole days", () => {
  // 8 March 2026 is the US spring-forward. That day is 23 hours long, so a
  // range measured in fixed 86400000ms chunks would drift by an hour and put
  // the boundary in the middle of the 15th.
  const r = resolveRange({
    preset: "custom",
    from: "2026-03-01",
    to: "2026-03-15",
    timezone: NY,
    now: NOW,
  });
  assert.equal(formatDateInput(r.from, NY), "2026-03-01");
  assert.equal(formatDateInput(new Date(r.to.getTime() - 1), NY), "2026-03-15");
});

test("a backwards custom range does not produce a negative period", () => {
  const r = resolveRange({
    preset: "custom",
    from: "2026-03-31",
    to: "2026-03-01",
    timezone: NY,
    now: NOW,
  });
  assert.ok(r.to > r.from, "end must follow start however the inputs were given");
});

test("a malformed custom date falls back rather than throwing", () => {
  const r = resolveRange({ preset: "custom", from: "yesterday", to: "", timezone: NY, now: NOW });
  assert.equal(r.preset, "30d");
});

test("parseDateInput rejects anything that isn't YYYY-MM-DD", () => {
  assert.equal(parseDateInput("2026-3-1", NY), null);
  assert.equal(parseDateInput("03/01/2026", NY), null);
  assert.equal(parseDateInput("2026-13-01", NY), null);
  assert.equal(parseDateInput(null, NY), null);
});

test("parseDateInput and formatDateInput round-trip", () => {
  const parsed = parseDateInput("2026-11-01", NY);
  assert.ok(parsed);
  assert.equal(formatDateInput(parsed, NY), "2026-11-01");
});

test("the comparison period is the same length and immediately before", () => {
  const r = resolveRange({ preset: "30d", timezone: NY, now: NOW });
  const prev = previousRange(r);
  assert.equal(prev.to.getTime(), r.from.getTime(), "no gap and no overlap");
  assert.equal(
    prev.to.getTime() - prev.from.getTime(),
    r.to.getTime() - r.from.getTime(),
    "equal spans, so the comparison is honest"
  );
});

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

test("daily buckets cover every day in the range, including empty ones", () => {
  const r = resolveRange({ preset: "7d", timezone: NY, now: NOW });
  assert.equal(bucketsFor(r, NY).length, 7);
});

test("hourly buckets cover a single day", () => {
  const r = resolveRange({ preset: "today", timezone: NY, now: NOW });
  assert.equal(bucketsFor(r, NY).length, 24);
});

test("buckets are strictly increasing and inside the range", () => {
  const r = resolveRange({ preset: "30d", timezone: NY, now: NOW });
  const buckets = bucketsFor(r, NY);
  for (let i = 1; i < buckets.length; i++) {
    assert.ok(buckets[i] > buckets[i - 1], "buckets must ascend");
  }
  assert.ok(buckets[buckets.length - 1] < r.to);
});

test("a spring-forward day still produces exactly one daily bucket", () => {
  // The 23-hour day. Advancing by a fixed 24h would skip or duplicate it.
  const r = resolveRange({
    preset: "custom",
    from: "2026-03-07",
    to: "2026-03-09",
    timezone: NY,
    now: NOW,
  });
  const labels = bucketsFor(r, NY).map((b) => formatDateInput(b, NY));
  assert.deepEqual(labels, ["2026-03-07", "2026-03-08", "2026-03-09"]);
});

test("a fall-back day still produces exactly one daily bucket", () => {
  // The 25-hour day, and the one where a naive inverse yields two 1am buckets.
  const r = resolveRange({
    preset: "custom",
    from: "2026-10-31",
    to: "2026-11-02",
    timezone: NY,
    now: NOW,
  });
  const labels = bucketsFor(r, NY).map((b) => formatDateInput(b, NY));
  assert.deepEqual(labels, ["2026-10-31", "2026-11-01", "2026-11-02"]);
});

test("weeks start on Monday", () => {
  // Restaurants think in weekends. A week that splits Saturday from Sunday
  // cuts the busiest two days of trade in half.
  const wednesday = new Date("2026-07-15T18:00:00Z");
  const start = truncateLocal(wednesday, "week", NY);
  assert.equal(formatDateInput(start, NY), "2026-07-13"); // the Monday
});

test("truncateLocal to month lands on the first", () => {
  const start = truncateLocal(new Date("2026-07-15T18:00:00Z"), "month", NY);
  assert.equal(formatDateInput(start, NY), "2026-07-01");
});

test("truncateLocal is idempotent at every granularity", () => {
  const at = new Date("2026-07-15T18:34:12Z");
  for (const g of ["hour", "day", "week", "month"] as const) {
    const once = truncateLocal(at, g, NY);
    assert.equal(truncateLocal(once, g, NY).getTime(), once.getTime(), `idempotent at ${g}`);
  }
});

test("bucket labels render without throwing on a bad timezone", () => {
  assert.ok(bucketLabel(new Date("2026-07-15T18:00:00Z"), "day", "Mars/Olympus").length > 0);
});

// ---------------------------------------------------------------------------
// Deltas and rates
// ---------------------------------------------------------------------------

test("growth from zero is 'new', never a percentage", () => {
  // The rule this protects: a percentage of nothing has no meaning, and
  // printing "+100%" where a real number belongs teaches an owner to discount
  // the honest percentages beside it.
  const d = delta(40, 0);
  assert.equal(d.direction, "new");
  assert.equal(d.pct, null);
});

test("zero to zero is 'none', not a change", () => {
  const d = delta(0, 0);
  assert.equal(d.direction, "none");
  assert.equal(d.pct, null);
});

test("a rise and a fall are signed correctly", () => {
  assert.equal(delta(120, 100).direction, "up");
  assert.equal(delta(80, 100).direction, "down");
  assert.equal(delta(120, 100).pct, 0.2);
});

test("a change under half a percent reads as flat", () => {
  // Noise dressed as a trend is worse than no trend: it trains people to react
  // to nothing.
  assert.equal(delta(1002, 1000).direction, "flat");
});

test("a drop to zero is still a real percentage", () => {
  const d = delta(0, 50);
  assert.equal(d.direction, "down");
  assert.equal(d.pct, -1);
});

test("rate returns zero rather than NaN on an empty denominator", () => {
  // A NaN reaches the page as "NaN%", which is the fastest way to make an
  // owner stop believing every other number on it.
  assert.equal(rate(5, 0), 0);
  assert.equal(rate(0, 0), 0);
  assert.equal(rate(1, 4), 0.25);
});

test("durations read as time, not milliseconds", () => {
  assert.equal(formatDuration(0), "0s");
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(45_000), "45s");
  assert.equal(formatDuration(90_000), "1m 30s");
  assert.equal(formatDuration(120_000), "2m");
  assert.equal(formatDuration(3_900_000), "1h 5m");
});

// ---------------------------------------------------------------------------
// Ingest: identity
// ---------------------------------------------------------------------------

test("anon ids must be opaque and bounded", () => {
  assert.ok(isValidAnonId("abcdefghijkl"));
  assert.ok(isValidAnonId("sim-abc_123XYZ0099"));
  assert.ok(!isValidAnonId("short"));
  assert.ok(!isValidAnonId("x".repeat(65)));
  assert.ok(!isValidAnonId(""));
  assert.ok(!isValidAnonId(null));
  assert.ok(!isValidAnonId(12345678901234));
});

test("an anon id cannot smuggle punctuation", () => {
  // The pattern is an allowlist rather than a denylist, so a phone number, an
  // email, or anything with a separator in it is rejected on shape alone —
  // before it can reach a column somebody later browses.
  assert.ok(!isValidAnonId("+15555550123"));
  assert.ok(!isValidAnonId("someone@example.com"));
  assert.ok(!isValidAnonId("../../etc/passwd"));
});

// ---------------------------------------------------------------------------
// Ingest: classification
// ---------------------------------------------------------------------------

test("an explicit src tag beats the referrer", () => {
  // The tag is what we print on QR codes and put in texts, and it's the only
  // signal that survives a PWA launch, where there is no referrer at all.
  const r = classifySource("qr", "https://www.google.com/search?q=pizza");
  assert.equal(r.source, "QR");
});

test("search engines, social, and maps are told apart", () => {
  assert.equal(classifySource(null, "https://www.google.com/search?q=x").source, "SEARCH_ENGINE");
  assert.equal(classifySource(null, "https://maps.google.com/place").source, "MAPS");
  assert.equal(classifySource(null, "https://www.instagram.com/p/abc").source, "SOCIAL");
  assert.equal(classifySource(null, "https://www.yelp.com/biz/x").source, "MAPS");
  assert.equal(classifySource(null, "https://someblog.example/post").source, "REFERRAL");
});

test("no referrer means direct", () => {
  assert.equal(classifySource(null, null).source, "DIRECT");
  assert.equal(classifySource(null, "").source, "DIRECT");
});

test("a malformed referrer does not throw", () => {
  const r = classifySource(null, "not a url at all");
  assert.equal(r.source, "DIRECT");
  assert.equal(r.referrerHost, null);
});

test("only the referring host is kept, never the full URL", () => {
  // A complete referring URL carries query strings — a tracking surface we
  // have no use for and would rather not hold in a backup.
  const r = classifySource(null, "https://www.google.com/search?q=secret+thing&uid=12345");
  assert.equal(r.referrerHost, "www.google.com");
  assert.ok(!JSON.stringify(r).includes("secret"));
});

test("devices are classified from the user agent, phones first", () => {
  assert.equal(normalizeDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148"), "MOBILE");
  assert.equal(normalizeDevice("Mozilla/5.0 (iPad; CPU OS 17_0) Mobile/15E148"), "TABLET");
  assert.equal(normalizeDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"), "DESKTOP");
  assert.equal(normalizeDevice(null), "UNKNOWN");
});

test("an Android tablet is not filed as a phone", () => {
  // Android tablets omit "Mobile"; that absence is the only tell.
  assert.equal(
    normalizeDevice("Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36"),
    "TABLET"
  );
  assert.equal(
    normalizeDevice("Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 Mobile"),
    "MOBILE"
  );
});

// ---------------------------------------------------------------------------
// Ingest: timestamps
// ---------------------------------------------------------------------------

const T = new Date("2026-07-15T18:00:00Z").getTime();

test("a believable client timestamp is trusted", () => {
  // Batched beacons need their relative ordering preserved, or a funnel loses
  // its sequence and becomes a bag of events.
  const at = resolveAt(T - 30_000, T);
  assert.equal(at.getTime(), T - 30_000);
});

test("a future client timestamp is clamped to now", () => {
  // A device set to next year would otherwise put events in a tenant's future
  // and silently break every date range they look at.
  assert.equal(resolveAt(T + 60_000, T).getTime(), T);
});

test("a wildly skewed client timestamp is discarded", () => {
  assert.equal(resolveAt(T - 400 * 24 * 3600 * 1000, T).getTime(), T);
});

test("a missing or non-numeric timestamp falls back to server time", () => {
  assert.equal(resolveAt(undefined, T).getTime(), T);
  assert.equal(resolveAt(NaN, T).getTime(), T);
  assert.equal(resolveAt(Infinity, T).getTime(), T);
});

test("the dwell ceilings are sane relative to each other", () => {
  // One screen can't have been visited for longer than the whole visit lasted.
  assert.ok(MAX_EVENT_DWELL_MS <= MAX_DWELL_MS);
  assert.ok(MAX_DWELL_MS < 4 * 3600 * 1000, "a visit is not half a working day");
});

// ---------------------------------------------------------------------------
// Ingest: funnel milestones
// ---------------------------------------------------------------------------

test("an add implies a look, and a look implies a browse", () => {
  // A quick-add from the menu never opens an item sheet. Without the implication
  // this reports "added to cart but never viewed the menu", which isn't a
  // surprising insight — it's a broken funnel.
  const m = milestonesFrom(["ITEM_ADD"]);
  assert.equal(m.addedToCart, true);
  assert.equal(m.viewedItem, true);
  assert.equal(m.viewedMenu, true);
  assert.equal(m.startedCheckout, false);
});

test("checkout implies everything above it", () => {
  const m = milestonesFrom(["CHECKOUT_START"]);
  assert.equal(m.startedCheckout, true);
  assert.equal(m.viewedMenu, true);
});

test("a bounce reaches no milestone at all", () => {
  const m = milestonesFrom(["PAGE_VIEW", "HEARTBEAT"]);
  assert.deepEqual(m, {
    viewedMenu: false,
    viewedItem: false,
    addedToCart: false,
    startedCheckout: false,
  });
});

test("searching counts as browsing the menu", () => {
  assert.equal(milestonesFrom(["SEARCH"]).viewedMenu, true);
});

test("milestones are monotonic, so the funnel can never widen", () => {
  // The property the funnel chart depends on: no step may exceed the one above
  // it. A funnel that can widen is a funnel nobody trusts.
  const cases: Array<Parameters<typeof milestonesFrom>[0]> = [
    ["PAGE_VIEW"],
    ["VIEW_CHANGE"],
    ["ITEM_VIEW"],
    ["ITEM_ADD"],
    ["CHECKOUT_START"],
    ["ORDER_PLACED"],
    ["ITEM_REMOVE", "SEARCH", "CART_VIEW"],
  ];
  for (const kinds of cases) {
    const m = milestonesFrom(kinds);
    if (m.startedCheckout) assert.ok(m.viewedMenu, `checkout implies menu for ${kinds}`);
    if (m.addedToCart) assert.ok(m.viewedItem, `add implies item view for ${kinds}`);
    if (m.viewedItem) assert.ok(m.viewedMenu, `item view implies menu for ${kinds}`);
  }
});

test("an order placed on its own still marks checkout", () => {
  // Attribution writes ORDER_PLACED server-side without a preceding
  // CHECKOUT_START when the beacon was blocked. That order must not report as
  // a conversion that skipped checkout.
  const m = milestonesFrom(["ORDER_PLACED"]);
  assert.equal(m.startedCheckout, true);
  assert.equal(m.viewedMenu, true);
});

console.log(`analytics: ${passed} cases passed`);
