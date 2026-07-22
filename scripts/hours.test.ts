/**
 * Tests for the availability engine.
 *
 * This is the part of post-order support that has no UI to catch a mistake:
 * a wrong answer here either takes orders a kitchen can't cook, or silently
 * stops a restaurant trading. Run with `npx tsx scripts/hours.test.ts`.
 */

import assert from "node:assert/strict";
import {
  activeInterval,
  checkAvailability,
  describeNextOpen,
  localNow,
  parseWeeklyHours,
  type AvailabilityInput,
} from "../src/lib/hours";

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

const WEEKDAY = { open: "11:00", close: "21:00" };
const NIGHT = { open: "17:00", close: "02:00" }; // overnight

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

test("drops malformed entries instead of throwing", () => {
  const h = parseWeeklyHours({
    mon: [{ open: "11:00", close: "21:00" }],
    tue: [{ open: "25:00", close: "21:00" }], // bad hour
    wed: [{ open: "11:00", close: "11:00" }], // zero length
    thu: "nonsense",
    xxx: [{ open: "11:00", close: "12:00" }], // not a day
  });
  assert.deepEqual(Object.keys(h), ["mon"]);
});

test("non-object input yields an empty schedule", () => {
  assert.deepEqual(parseWeeklyHours(null), {});
  assert.deepEqual(parseWeeklyHours("mon 9-5"), {});
});

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

test("reads the local day and clock in the restaurant's zone", () => {
  // 2026-07-19T03:30Z is still Saturday evening in Los Angeles.
  const at = localNow(new Date("2026-07-19T03:30:00Z"), "America/Los_Angeles");
  assert.equal(at.date, "2026-07-18");
  assert.equal(at.day, "sat");
  assert.equal(at.minutes, 20 * 60 + 30);
});

test("an unknown timezone falls back to UTC rather than throwing", () => {
  const at = localNow(new Date("2026-07-19T12:00:00Z"), "Mars/Olympus");
  assert.equal(at.minutes, 12 * 60);
});

// ---------------------------------------------------------------------------
// Open / closed
// ---------------------------------------------------------------------------

test("inside a normal window is open; outside is closed", () => {
  const h = { sun: [WEEKDAY] };
  assert.ok(activeInterval(h, { date: "2026-07-19", day: "sun", minutes: 12 * 60 }));
  assert.equal(activeInterval(h, { date: "2026-07-19", day: "sun", minutes: 10 * 60 }), null);
  // Closing time itself is closed — 21:00 is not "still 9pm service".
  assert.equal(activeInterval(h, { date: "2026-07-19", day: "sun", minutes: 21 * 60 }), null);
});

test("an overnight window stays open past midnight into the next day", () => {
  const h = { sat: [NIGHT] };
  // Saturday 11:30pm — inside the window that started Saturday.
  assert.ok(activeInterval(h, { date: "2026-07-18", day: "sat", minutes: 23 * 60 + 30 }));
  // Sunday 00:30am — still the tail of Saturday's window.
  const early = activeInterval(h, { date: "2026-07-19", day: "sun", minutes: 30 });
  assert.ok(early, "should still be open at 00:30 Sunday");
  assert.equal(early!.minutesLeft, 90); // until 02:00
  // Sunday 03:00am — the window is over and Sunday has none of its own.
  assert.equal(activeInterval(h, { date: "2026-07-19", day: "sun", minutes: 3 * 60 }), null);
});

test("minutesLeft counts down to close", () => {
  const h = { sun: [WEEKDAY] };
  const a = activeInterval(h, { date: "2026-07-19", day: "sun", minutes: 20 * 60 });
  assert.equal(a!.minutesLeft, 60);
});

// ---------------------------------------------------------------------------
// Next opening
// ---------------------------------------------------------------------------

test("describes the next opening, skipping closed days", () => {
  const h = parseWeeklyHours({ mon: [WEEKDAY], tue: [WEEKDAY] });
  // Sunday morning -> next open is Monday.
  const next = describeNextOpen(h, { date: "2026-07-19", day: "sun", minutes: 9 * 60 });
  assert.equal(next, "tomorrow at 11 AM");
});

test("skips dates covered by a closure", () => {
  const h = parseWeeklyHours({ mon: [WEEKDAY], tue: [WEEKDAY] });
  const closed = (d: string) => d === "2026-07-20"; // the Monday
  const next = describeNextOpen(h, { date: "2026-07-19", day: "sun", minutes: 9 * 60 }, closed);
  assert.equal(next, "Tuesday at 11 AM");
});

test("returns null when there is no schedule at all", () => {
  assert.equal(describeNextOpen({}, { date: "2026-07-19", day: "sun", minutes: 600 }), null);
});

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

function restaurant(over: Partial<AvailabilityInput> = {}): AvailabilityInput {
  return {
    status: "ACTIVE",
    hoursJson: { sun: [WEEKDAY], mon: [WEEKDAY] },
    timezone: "UTC",
    pausedUntil: null,
    pauseReason: null,
    lastCallMins: 20,
    prepMinutes: 20,
    closures: [],
    ...over,
  };
}

// 2026-07-19 is a Sunday.
const noon = new Date("2026-07-19T12:00:00Z");

test("open during service", () => {
  const a = checkAvailability(restaurant(), noon);
  assert.equal(a.ok, true);
});

test("a restaurant that never set hours keeps trading (fails open)", () => {
  const a = checkAvailability(restaurant({ hoursJson: {} }), new Date("2026-07-19T03:00:00Z"));
  assert.equal(a.ok, true, "no schedule must not mean closed");
});

test("suspended tenants take nothing", () => {
  const a = checkAvailability(restaurant({ status: "SUSPENDED" }), noon);
  assert.equal(a.ok, false);
  assert.equal(a.ok === false && a.code, "SUSPENDED");
});

test("closed outside hours, and says when it's back", () => {
  const a = checkAvailability(restaurant(), new Date("2026-07-19T03:00:00Z"));
  assert.equal(a.ok, false);
  assert.equal(a.ok === false && a.code, "CLOSED");
  assert.ok(a.ok === false && a.reopens?.includes("11 AM"));
});

test("a pause beats being open", () => {
  const a = checkAvailability(
    restaurant({ pausedUntil: new Date("2026-07-19T12:30:00Z"), pauseReason: "Fryer down" }),
    noon
  );
  assert.equal(a.ok, false);
  assert.equal(a.ok === false && a.code, "PAUSED");
  assert.ok(a.ok === false && a.message.includes("Fryer down"));
});

test("an expired pause is ignored", () => {
  const a = checkAvailability(restaurant({ pausedUntil: new Date("2026-07-19T11:00:00Z") }), noon);
  assert.equal(a.ok, true);
});

test("a closure closes the day even mid-service", () => {
  const a = checkAvailability(
    restaurant({ closures: [{ startDate: "2026-07-19", endDate: "2026-07-19", reason: "Holiday" }] }),
    noon
  );
  assert.equal(a.ok, false);
  assert.equal(a.ok === false && a.code, "HOLIDAY");
});

test("a closure range covers its middle days", () => {
  const a = checkAvailability(
    restaurant({ closures: [{ startDate: "2026-07-18", endDate: "2026-07-22", reason: null }] }),
    noon
  );
  assert.equal(a.ok === false && a.code, "HOLIDAY");
});

test("last call blocks orders that land too near closing", () => {
  // 20:50 UTC, closing 21:00, 20-minute cutoff.
  const a = checkAvailability(restaurant(), new Date("2026-07-19T20:50:00Z"));
  assert.equal(a.ok, false);
  assert.equal(a.ok === false && a.code, "LAST_CALL");
});

test("just before last call is still open", () => {
  const a = checkAvailability(restaurant(), new Date("2026-07-19T20:30:00Z"));
  assert.equal(a.ok, true);
});

test("the promised time never runs past closing", () => {
  // 20:35, closes 21:00 => 25 minutes left, prep is 20.
  const a = checkAvailability(restaurant({ lastCallMins: 5, prepMinutes: 60 }), new Date("2026-07-19T20:35:00Z"));
  assert.equal(a.ok, true);
  assert.ok(a.ok && a.promiseMinutes <= 25, `promised ${a.ok && a.promiseMinutes} min with 25 left`);
});

test("timezone actually shifts the decision", () => {
  // 12:00 UTC is 05:00 in Los Angeles — closed there, open in UTC.
  const utc = checkAvailability(restaurant(), noon);
  const la = checkAvailability(restaurant({ timezone: "America/Los_Angeles" }), noon);
  assert.equal(utc.ok, true);
  assert.equal(la.ok, false);
});

console.log(`\n  ${passed} passing\n`);
