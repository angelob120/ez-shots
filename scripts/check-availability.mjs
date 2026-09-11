// Checks the calendar rules in server/availability.js against a fixed clock.
//
// Why this exists: the booking page draws whatever the server sends, so if a
// rule here is wrong a customer can book a Sunday, a slot inside the notice
// window, or a sixth shoot on a five shoot day, and nothing on the page would
// look wrong. These are the rules in the plan, in order, each pinned down.
//
// Run: npm test
process.env.TZ = "America/Detroit";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const A = createRequire(import.meta.url)("../server/availability.js");

const day = ["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"];
const base = () => ({
  hours: { start: "8:00 AM", end: "8:00 PM", every: 120 },
  week: { 0: [], 1: day, 2: day, 3: day, 4: day, 5: day, 6: day },
  blocked: { "2026-09-25": "Doctor" },
  overrides: { "2026-09-26": ["8:00 AM", "10:00 AM"], "2026-09-13": ["12:00 PM"] },
  minNoticeHours: 24, maxAdvanceDays: 28, maxPerDay: 5, lookBusy: 0
});
// Friday 11 September 2026, 3:00 PM in Detroit.
const now = new Date(2026, 8, 11, 15, 0, 0);
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log("  ok    " + name); };

ok("8 AM to 8 PM every two hours is seven start times ending at 8:00 PM", () => {
  assert.deepEqual(A.range("8:00 AM", "8:00 PM", 120), day);
});
ok("times are spelled one way whatever was typed", () => {
  assert.equal(A.normalize("9:00am"), "9:00 AM");
  assert.equal(A.normalize(" 12:30 pm "), "12:30 PM");
  assert.equal(A.normalize("13:00"), null);
  assert.deepEqual(A.cleanList(["2:00 PM", "8:00am", "8:00 AM", "junk"]), ["8:00 AM", "2:00 PM"]);
});
ok("a date that does not exist is not a date", () => {
  assert.equal(A.isKey("2026-02-30"), false);
  assert.equal(A.isKey("2026-09-14"), true);
});

const cal = A.calendar(base(), new Map(), now);
ok("the window runs four weeks from today", () => {
  assert.equal(cal.today, "2026-09-11");
  assert.equal(cal.to, "2026-10-09");
  assert.equal(Object.keys(cal.days).some(k => k > "2026-10-09"), false);
});
ok("today is inside the 24 hour notice window, so nothing on it is offered", () => {
  assert.equal(cal.days["2026-09-11"], undefined);
});
ok("tomorrow keeps only the times more than 24 hours away", () => {
  assert.deepEqual(cal.days["2026-09-12"], ["4:00 PM", "6:00 PM", "8:00 PM"]);
});
ok("a closed weekday is not offered, and a one off list opens it", () => {
  assert.equal(cal.days["2026-09-20"], undefined);            // a Sunday
  assert.deepEqual(cal.days["2026-09-13"], ["12:00 PM"]);     // Sunday with an override
});
ok("a blocked date is gone whatever the weekday says", () => {
  assert.equal(cal.days["2026-09-25"], undefined);
});
ok("a one off list replaces the weekday list", () => {
  assert.deepEqual(cal.days["2026-09-26"], ["8:00 AM", "10:00 AM"]);
});
ok("a normal weekday offers all seven", () => {
  assert.deepEqual(cal.days["2026-09-15"], day);
});

ok("held and confirmed slots come out, and five bookings close the day", () => {
  const taken = new Map([["2026-09-15", new Set(["8:00 AM", "2:00 PM"])],
    ["2026-09-16", new Set(["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM", "4:00 PM"])]]);
  const c = A.calendar(base(), taken, now);
  assert.deepEqual(c.days["2026-09-15"], ["10:00 AM", "12:00 PM", "4:00 PM", "6:00 PM", "8:00 PM"]);
  assert.equal(c.days["2026-09-16"], undefined);
});

ok("look busy hides a share of each day, the same share every time, never the whole day", () => {
  const av = Object.assign(base(), { lookBusy: 40 });
  const a = A.calendar(av, new Map(), now), b = A.calendar(av, new Map(), now);
  assert.deepEqual(a.days, b.days);
  assert.equal(a.days["2026-09-15"].length, 5);                // floor(7 * .4) = 2 hidden
  assert.equal(a.days["2026-09-12"].length, 2);                // floor(3 * .4) = 1 hidden
  assert.deepEqual(a.days["2026-09-13"], ["12:00 PM"]);        // one slot, kept
  const thirty = A.calendar(Object.assign(base(), { lookBusy: 30 }), new Map(), now);
  for (const k of Object.keys(a.days)) {
    for (const s of a.days[k]) assert.ok(thirty.days[k].includes(s), "a slot shown at 40% is shown at 30%");
  }
});
ok("look busy comes back off as real bookings fill the day", () => {
  const av = Object.assign(base(), { lookBusy: 40 });
  const taken = new Map([["2026-09-15", new Set(["8:00 AM", "10:00 AM", "12:00 PM", "2:00 PM"])]]);
  const c = A.calendar(av, taken, now);
  assert.equal(c.days["2026-09-15"].length, 2);                // 3 real, floor(1.2) = 1 hidden
});

ok("why() tells a taken slot from a closed one, and ignores look busy", () => {
  const av = Object.assign(base(), { lookBusy: 90 });
  const taken = new Map([["2026-09-15", new Set(["8:00 AM"])]]);
  assert.equal(A.why(av, taken, "2026-09-15", "8:00 AM", now), "taken");
  assert.equal(A.why(av, taken, "2026-09-15", "10:00 AM", now), "ok");
  assert.equal(A.why(av, taken, "2026-09-15", "10:00am", now), "ok");
  assert.equal(A.why(av, taken, "2026-09-15", "9:00 AM", now), "closed");
  assert.equal(A.why(av, taken, "2026-09-11", "8:00 PM", now), "closed");   // inside notice
  assert.equal(A.why(av, taken, "2026-09-20", "8:00 AM", now), "closed");   // Sunday
  assert.equal(A.why(av, taken, "2026-10-10", "8:00 AM", now), "closed");   // past the window
  assert.equal(A.why(av, taken, "2026-09-25", "8:00 AM", now), "closed");   // blocked
  const full = new Map([["2026-09-16", new Set(day.slice(0, 5))]]);
  assert.equal(A.why(av, full, "2026-09-16", "6:00 PM", now), "taken");     // day at its cap
});

ok("a slot is a real instant in Detroit time", () => {
  assert.equal(A.slotAt("2026-09-15", "2:00 PM").toISOString(), "2026-09-15T18:00:00.000Z");
  assert.equal(A.slotAt("2026-12-15", "2:00 PM").toISOString(), "2026-12-15T19:00:00.000Z");
});

console.log(`\n${n} availability checks passed.`);
