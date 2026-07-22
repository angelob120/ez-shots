/**
 * The pure half of the booking calendar.
 *
 * Every case here guards one of three things, and it's worth saying which
 * because the file otherwise reads as arithmetic trivia:
 *
 *  1. **The fail-closed default.** This module shares `WeeklyHours` with
 *     `lib/hours.ts`, which fails *open* — a restaurant with no schedule keeps
 *     trading. Inverting that here is the single most important line in
 *     `booking-slots.ts`, and it is exactly the kind of thing a later reader
 *     "makes consistent". If these cases go green after someone unifies the
 *     defaults, the calendar is handing out 4am Sundays.
 *
 *  2. **The two clocks.** Availability is wall-clock in the host's zone and the
 *     booker is somewhere else. Both DST boundaries are covered, because a
 *     single-pass offset conversion is correct 363 days a year and an hour out
 *     on the other two — which surfaces as one person turning up to an empty
 *     room, twice a year, and nobody being able to reproduce it.
 *
 *  3. **Collisions.** A slot offered on top of an existing booking is the host
 *     double-booked. The database index is what actually prevents it; this is
 *     what stops the picker offering it in the first place.
 *
 * Pure — no Prisma, no database.
 */

import assert from "node:assert";
import {
  addDays,
  countSlots,
  dateInZone,
  dayKeyInZone,
  formatInZone,
  generateSlots,
  isSlotBookable,
  minutesInZone,
  parseAvailabilityForm,
  wallClockToInstant,
  type BookingRules,
  type Busy,
} from "../src/lib/booking-slots";

let passed = 0;
function t(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

const NY = "America/New_York";
const LA = "America/Los_Angeles";

function rules(over: Partial<BookingRules> = {}): BookingRules {
  return {
    availability: { mon: [{ open: "09:00", close: "12:00" }] },
    timezone: NY,
    durationMins: 20,
    bufferMins: 5,
    minNoticeMins: 0,
    maxDaysAhead: 14,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Zone arithmetic
// ---------------------------------------------------------------------------

t("wallClockToInstant: 9am New York in winter is 14:00 UTC", () => {
  const d = wallClockToInstant("2026-01-12", 9 * 60, NY);
  assert.equal(d.toISOString(), "2026-01-12T14:00:00.000Z");
});

t("wallClockToInstant: 9am New York in summer is 13:00 UTC", () => {
  const d = wallClockToInstant("2026-07-13", 9 * 60, NY);
  assert.equal(d.toISOString(), "2026-07-13T13:00:00.000Z");
});

// The two-pass conversion exists for these. A single pass uses the offset from
// the wrong side of the boundary and lands an hour out.
t("wallClockToInstant: the morning the clocks go forward", () => {
  // 2026-03-08 is US spring-forward. 9am EDT = 13:00Z, not 14:00Z.
  const d = wallClockToInstant("2026-03-08", 9 * 60, NY);
  assert.equal(d.toISOString(), "2026-03-08T13:00:00.000Z");
});

t("wallClockToInstant: the morning the clocks go back", () => {
  // 2026-11-01 is US fall-back. 9am EST = 14:00Z.
  const d = wallClockToInstant("2026-11-01", 9 * 60, NY);
  assert.equal(d.toISOString(), "2026-11-01T14:00:00.000Z");
});

t("wallClockToInstant: a time that does not exist lands on a real instant", () => {
  // 2:30am on spring-forward morning is skipped by the clock. It must not
  // throw and must not produce an invalid date.
  const d = wallClockToInstant("2026-03-08", 2 * 60 + 30, NY);
  assert.ok(!Number.isNaN(d.getTime()));
});

t("wallClockToInstant: an unknown zone falls back to UTC rather than throwing", () => {
  const d = wallClockToInstant("2026-07-13", 9 * 60, "Mars/Olympus_Mons");
  assert.equal(d.toISOString(), "2026-07-13T09:00:00.000Z");
});

t("dateInZone: an instant can be two different dates in two zones", () => {
  const at = new Date("2026-07-14T02:00:00.000Z");
  assert.equal(dateInZone(at, NY), "2026-07-13");
  assert.equal(dateInZone(at, "Pacific/Auckland"), "2026-07-14");
});

t("minutesInZone: reads local wall-clock minutes", () => {
  const at = new Date("2026-07-13T13:00:00.000Z");
  assert.equal(minutesInZone(at, NY), 9 * 60);
  assert.equal(minutesInZone(at, LA), 6 * 60);
});

t("dayKeyInZone: a Monday in one zone is a Sunday in another", () => {
  const at = new Date("2026-07-13T02:00:00.000Z"); // Mon 02:00 UTC
  assert.equal(dayKeyInZone(at, NY), "sun"); // Sunday 10pm in New York
  assert.equal(dayKeyInZone(at, "UTC"), "mon");
});

t("addDays: crosses a month boundary", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

t("formatInZone: renders the same instant differently either side of the country", () => {
  const at = new Date("2026-07-13T17:00:00.000Z");
  assert.equal(formatInZone(at, NY), "1:00 PM");
  assert.equal(formatInZone(at, LA), "10:00 AM");
});

// ---------------------------------------------------------------------------
// Fail closed
// ---------------------------------------------------------------------------

t("no availability means no slots — the opposite of lib/hours.ts", () => {
  const days = generateSlots(rules({ availability: {} }), [], new Date("2026-07-13T08:00:00Z"));
  assert.equal(days.length, 0);
});

t("an availability of undefined means no slots", () => {
  const days = generateSlots(
    rules({ availability: undefined as never }),
    [],
    new Date("2026-07-13T08:00:00Z"),
  );
  assert.equal(days.length, 0);
});

t("a zero-minute duration yields nothing rather than infinite slots", () => {
  const days = generateSlots(rules({ durationMins: 0 }), [], new Date("2026-07-13T08:00:00Z"));
  assert.equal(days.length, 0);
});

t("a day with no window is omitted entirely, not returned empty", () => {
  const days = generateSlots(
    rules({ availability: { mon: [{ open: "09:00", close: "12:00" }] }, maxDaysAhead: 6 }),
    [],
    new Date("2026-07-14T08:00:00Z"), // a Tuesday
  );
  assert.equal(days.length, 1);
  assert.equal(days[0].date, "2026-07-20");
});

// ---------------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------------

t("slots step by duration plus buffer", () => {
  // Mon 2026-07-13, 09:00-12:00 NY, 20min call + 5min gap -> 09:00, 09:25, ...
  const days = generateSlots(rules(), [], new Date("2026-07-13T12:00:00Z"));
  const mon = days.find((d) => d.date === "2026-07-13");
  assert.ok(mon);
  assert.equal(formatInZone(mon!.slots[0].startsAt, NY), "9:00 AM");
  assert.equal(formatInZone(mon!.slots[1].startsAt, NY), "9:25 AM");
  assert.equal(formatInZone(mon!.slots[2].startsAt, NY), "9:50 AM");
});

t("the last slot fits inside the window rather than overrunning it", () => {
  const days = generateSlots(rules(), [], new Date("2026-07-13T12:00:00Z"));
  const mon = days.find((d) => d.date === "2026-07-13")!;
  const last = mon.slots[mon.slots.length - 1];
  // 12:00 close, 20 minute call — nothing may end after noon.
  assert.ok(minutesInZone(last.endsAt, NY) <= 12 * 60);
});

t("a window shorter than the call yields nothing", () => {
  const days = generateSlots(
    rules({ availability: { mon: [{ open: "09:00", close: "09:15" }] } }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  assert.equal(countSlots(days), 0);
});

t("two windows in a day both produce slots", () => {
  const days = generateSlots(
    rules({
      availability: { mon: [{ open: "09:00", close: "10:00" }, { open: "14:00", close: "15:00" }] },
      maxDaysAhead: 1,
    }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  const mon = days.find((d) => d.date === "2026-07-13")!;
  const labels = mon.slots.map((s) => formatInZone(s.startsAt, NY));
  assert.ok(labels.includes("9:00 AM"));
  assert.ok(labels.includes("2:00 PM"));
});

t("overlapping windows do not produce duplicate start times", () => {
  const days = generateSlots(
    rules({
      availability: { mon: [{ open: "09:00", close: "11:00" }, { open: "09:00", close: "10:00" }] },
      maxDaysAhead: 1,
    }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  const mon = days.find((d) => d.date === "2026-07-13")!;
  const times = mon.slots.map((s) => s.startsAt.getTime());
  assert.equal(new Set(times).size, times.length);
});

t("slots are generated in the host's zone regardless of the caller's clock", () => {
  // Two "now" instants an hour apart on the same host day produce the same
  // grid. The server's own clock must not shift where the windows land.
  const a = generateSlots(rules({ maxDaysAhead: 1 }), [], new Date("2026-07-13T11:00:00Z"));
  const b = generateSlots(rules({ maxDaysAhead: 1 }), [], new Date("2026-07-13T12:00:00Z"));
  assert.equal(
    a[0].slots[0].startsAt.toISOString(),
    b[0].slots[0].startsAt.toISOString(),
  );
});

t("summer and winter windows both land on 9am local, not on a fixed UTC hour", () => {
  const summer = generateSlots(
    rules({ maxDaysAhead: 1 }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  const winter = generateSlots(
    rules({ maxDaysAhead: 1 }),
    [],
    new Date("2026-01-12T13:00:00Z"),
  );
  assert.equal(formatInZone(summer[0].slots[0].startsAt, NY), "9:00 AM");
  assert.equal(formatInZone(winter[0].slots[0].startsAt, NY), "9:00 AM");
  // ...and they are genuinely different UTC hours, which is the point.
  assert.notEqual(
    summer[0].slots[0].startsAt.toISOString().slice(11, 13),
    winter[0].slots[0].startsAt.toISOString().slice(11, 13),
  );
});

// ---------------------------------------------------------------------------
// Minimum notice
// ---------------------------------------------------------------------------

t("minimum notice excludes slots too soon from now", () => {
  const now = new Date("2026-07-13T13:00:00Z"); // 9am NY
  const days = generateSlots(rules({ minNoticeMins: 120, maxDaysAhead: 0 }), [], now);
  const mon = days.find((d) => d.date === "2026-07-13");
  // 9:00, 9:25, 9:50, 10:15, 10:40 are all inside two hours; 11:05 is not.
  assert.ok(mon);
  assert.equal(formatInZone(mon!.slots[0].startsAt, NY), "11:05 AM");
});

t("everything in the past is excluded without a separate check", () => {
  const now = new Date("2026-07-13T15:00:00Z"); // 11am NY
  const days = generateSlots(rules({ minNoticeMins: 0, maxDaysAhead: 0 }), [], now);
  for (const d of days) {
    for (const s of d.slots) assert.ok(s.startsAt.getTime() >= now.getTime());
  }
});

t("zero notice still excludes the slot currently in progress", () => {
  const now = new Date("2026-07-13T13:10:00Z"); // 9:10am NY, mid-9:00 slot
  const days = generateSlots(rules({ minNoticeMins: 0, maxDaysAhead: 0 }), [], now);
  const first = days[0].slots[0];
  assert.equal(formatInZone(first.startsAt, NY), "9:25 AM");
});

// ---------------------------------------------------------------------------
// Horizon
// ---------------------------------------------------------------------------

t("maxDaysAhead bounds the picker", () => {
  const days = generateSlots(
    rules({
      availability: {
        mon: [{ open: "09:00", close: "10:00" }],
        tue: [{ open: "09:00", close: "10:00" }],
        wed: [{ open: "09:00", close: "10:00" }],
      },
      maxDaysAhead: 2,
    }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  assert.deepEqual(days.map((d) => d.date), ["2026-07-13", "2026-07-14", "2026-07-15"]);
});

t("maxDaysAhead of zero offers today only", () => {
  const days = generateSlots(rules({ maxDaysAhead: 0 }), [], new Date("2026-07-13T12:00:00Z"));
  assert.deepEqual(days.map((d) => d.date), ["2026-07-13"]);
});

t("an absurd horizon is clamped rather than looping for a year", () => {
  const days = generateSlots(
    rules({ availability: { mon: [{ open: "09:00", close: "10:00" }] }, maxDaysAhead: 100_000 }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  assert.ok(days.length <= 20);
});

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

function busyAt(iso: string, mins: number): Busy {
  const startsAt = new Date(iso);
  return { startsAt, endsAt: new Date(startsAt.getTime() + mins * 60_000) };
}

t("an existing booking removes its own slot", () => {
  const busy = [busyAt("2026-07-13T13:00:00Z", 20)]; // 9:00 NY
  const days = generateSlots(rules({ maxDaysAhead: 0 }), busy, new Date("2026-07-13T12:00:00Z"));
  const labels = days[0].slots.map((s) => formatInZone(s.startsAt, NY));
  assert.ok(!labels.includes("9:00 AM"));
  assert.ok(labels.includes("9:25 AM"));
});

t("the buffer is applied around an existing booking, not just its duration", () => {
  // A booking 09:10–09:30 leaves 09:00 unbookable (it would run into it) and,
  // with a 5 minute buffer either side, 09:25 too.
  const busy = [busyAt("2026-07-13T13:10:00Z", 20)];
  const days = generateSlots(rules({ maxDaysAhead: 0 }), busy, new Date("2026-07-13T12:00:00Z"));
  const labels = days[0].slots.map((s) => formatInZone(s.startsAt, NY));
  assert.ok(!labels.includes("9:00 AM"));
  assert.ok(!labels.includes("9:25 AM"));
  assert.ok(labels.includes("9:50 AM"));
});

t("a booking outside every window changes nothing", () => {
  const clean = generateSlots(rules({ maxDaysAhead: 0 }), [], new Date("2026-07-13T12:00:00Z"));
  const withBusy = generateSlots(
    rules({ maxDaysAhead: 0 }),
    [busyAt("2026-07-13T23:00:00Z", 20)],
    new Date("2026-07-13T12:00:00Z"),
  );
  assert.equal(countSlots(clean), countSlots(withBusy));
});

t("a day fully booked out is omitted rather than returned empty", () => {
  const busy = [busyAt("2026-07-13T13:00:00Z", 180)]; // 9am–12pm NY
  const days = generateSlots(rules({ maxDaysAhead: 0 }), busy, new Date("2026-07-13T12:00:00Z"));
  assert.equal(days.length, 0);
});

// ---------------------------------------------------------------------------
// isSlotBookable
// ---------------------------------------------------------------------------

t("isSlotBookable agrees with generateSlots", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const days = generateSlots(rules({ maxDaysAhead: 0 }), [], now);
  for (const s of days[0].slots) {
    assert.ok(isSlotBookable(rules({ maxDaysAhead: 0 }), [], s.startsAt, now));
  }
});

t("isSlotBookable rejects a time that was never on the grid", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  // 9:07am NY — inside the window, not on the step.
  const off = wallClockToInstant("2026-07-13", 9 * 60 + 7, NY);
  assert.equal(isSlotBookable(rules({ maxDaysAhead: 0 }), [], off, now), false);
});

t("isSlotBookable rejects a slot that has just been taken", () => {
  const now = new Date("2026-07-13T12:00:00Z");
  const at = wallClockToInstant("2026-07-13", 9 * 60, NY);
  assert.equal(isSlotBookable(rules({ maxDaysAhead: 0 }), [], at, now), true);
  assert.equal(
    isSlotBookable(rules({ maxDaysAhead: 0 }), [{ startsAt: at, endsAt: new Date(at.getTime() + 1_200_000) }], at, now),
    false,
  );
});

t("isSlotBookable rejects a time inside the notice window", () => {
  const now = new Date("2026-07-13T13:00:00Z");
  const at = wallClockToInstant("2026-07-13", 9 * 60 + 25, NY);
  assert.equal(isSlotBookable(rules({ minNoticeMins: 120, maxDaysAhead: 0 }), [], at, now), false);
});

// ---------------------------------------------------------------------------
// The availability form
// ---------------------------------------------------------------------------

function form(entries: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    if (Array.isArray(v)) v.forEach((x) => fd.append(k, x));
    else fd.set(k, v);
  }
  return fd;
}

t("parseAvailabilityForm reads an enabled day", () => {
  const { availability, errors } = parseAvailabilityForm(
    form({ mon_on: "on", mon_open: "09:00", mon_close: "17:00" }),
  );
  assert.deepEqual(availability, { mon: [{ open: "09:00", close: "17:00" }] });
  assert.equal(errors.length, 0);
});

t("a day left unticked is absent even with times filled in", () => {
  const { availability } = parseAvailabilityForm(
    form({ mon_open: "09:00", mon_close: "17:00" }),
  );
  assert.deepEqual(availability, {});
});

t("an empty grid is allowed and means not taking calls", () => {
  const { availability, errors } = parseAvailabilityForm(form({}));
  assert.deepEqual(availability, {});
  assert.equal(errors.length, 0);
});

t("a malformed time is an error rather than a silently dropped day", () => {
  const { availability, errors } = parseAvailabilityForm(
    form({ mon_on: "on", mon_open: "9am", mon_close: "17:00" }),
  );
  assert.deepEqual(availability, {});
  assert.equal(errors.length, 1);
});

t("identical open and close is rejected", () => {
  const { errors } = parseAvailabilityForm(
    form({ tue_on: "on", tue_open: "09:00", tue_close: "09:00" }),
  );
  assert.equal(errors.length, 1);
});

t("several days round-trip", () => {
  const { availability } = parseAvailabilityForm(
    form({
      mon_on: "on", mon_open: "09:00", mon_close: "12:00",
      wed_on: "on", wed_open: "13:00", wed_close: "17:00",
      fri_on: "on", fri_open: "10:00", fri_close: "11:00",
    }),
  );
  assert.deepEqual(Object.keys(availability).sort(), ["fri", "mon", "wed"]);
});

t("an overnight window is honoured rather than dropped", () => {
  const days = generateSlots(
    rules({ availability: { mon: [{ open: "22:00", close: "01:00" }] }, maxDaysAhead: 0 }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  assert.ok(countSlots(days) > 0);
});

t("countSlots totals across days", () => {
  const days = generateSlots(
    rules({
      availability: {
        mon: [{ open: "09:00", close: "10:00" }],
        tue: [{ open: "09:00", close: "10:00" }],
      },
      maxDaysAhead: 1,
    }),
    [],
    new Date("2026-07-13T12:00:00Z"),
  );
  assert.equal(countSlots(days), days.reduce((n, d) => n + d.slots.length, 0));
});

console.log(`booking-slots: ${passed} cases passed`);
