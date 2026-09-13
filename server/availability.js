// The one place that decides what can be booked.
//
// The rules run in the order the plan sets out, and the browser never runs
// them: book.html asks GET /api/availability and paints what it is given. A
// customer cannot tell a slot hidden by a real booking from one hidden because
// the owner blocked the day or because look busy took it, and that is the
// point.
//
//   1. Is the date blocked?
//   2. Is there a one off list for the date?
//   3. Otherwise the weekday default.
//   4. Take out slots already held or confirmed.
//   5. Minimum notice.
//   6. Maximum advance.
//   7. Daily capacity.
//   8. Look busy, which is cosmetic and is the only rule canBook() skips.
//
// Dates are "YYYY-MM-DD" and slots are "1:00 PM" throughout, in the business
// timezone. server.js sets TZ before anything here runs, so a plain local Date
// is Detroit time even on a Railway box that thinks it is in UTC.
"use strict";

const SLOT = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

// "1:00 PM" to minutes since midnight, or null if it is not a time.
function minutesOf(slot) {
  const m = SLOT.exec(String(slot || "").trim());
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 1 || h > 12 || min > 59) return null;
  h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  return h * 60 + min;
}

function labelOf(mins) {
  const h24 = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return (h24 % 12 || 12) + ":" + (m < 10 ? "0" + m : m) + " " + (h24 < 12 ? "AM" : "PM");
}

// One spelling, "9:00 AM", so "9:00am" typed into admin and "9:00 AM" on a
// booking compare equal. Null for anything that is not a time.
function normalize(slot) {
  const m = minutesOf(slot);
  return m === null ? null : labelOf(m);
}

// A clean, sorted, de-duplicated list of slots out of whatever was typed.
function cleanList(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map(normalize)
    .filter(s => s && !seen.has(s) && seen.add(s))
    .sort((a, b) => minutesOf(a) - minutesOf(b));
}

// Every start time between two clock times, a fixed number of minutes apart.
// This is what "8:00 AM to 8:00 PM, every 2 hours" turns into.
function range(start, end, every) {
  const a = minutesOf(start), b = minutesOf(end);
  const step = Math.max(15, Math.min(480, Number(every) || 120));
  if (a === null || b === null || b < a) return [];
  const out = [];
  for (let t = a; t <= b; t += step) out.push(labelOf(t));
  return out;
}

function pad(n) { return n < 10 ? "0" + n : String(n); }
function keyOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
function dateOf(key) {
  const p = String(key).split("-").map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}
function isKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key)) && keyOf(dateOf(key)) === key;
}
function slotAt(key, slot) {
  const d = dateOf(key);
  const mins = minutesOf(slot);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(mins / 60), mins % 60, 0, 0);
}

// FNV-1a. Not security, just a stable way to pick the same slots every time.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

// Rules 1 to 3: what the schedule says about a date, before bookings and the
// clock have their say.
function scheduled(av, key) {
  if (av.blocked && Object.prototype.hasOwnProperty.call(av.blocked, key)) return [];
  const ov = av.overrides && av.overrides[key];
  const list = Array.isArray(ov) ? ov : (av.week && av.week[String(dateOf(key).getDay())]) || [];
  return cleanList(list);
}

// Rules 4 to 7. `taken` is the Set of slots already held or confirmed on that
// date and `count` is how many bookings the day already has.
function open(av, key, taken, count, now) {
  const today = keyOf(now);
  if (key < today) return [];
  const last = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (av.maxAdvanceDays || 28));
  if (key > keyOf(last)) return [];
  if (count >= (av.maxPerDay || 5)) return [];
  const cutoff = now.getTime() + (av.minNoticeHours || 0) * 3600 * 1000;
  return scheduled(av, key).filter(s => !taken.has(s) && slotAt(key, s).getTime() > cutoff);
}

// Rule 8. Hide a share of what is genuinely open so the calendar reads as in
// demand rather than wide open. The choice is by hash of date and slot, so the
// same slots stay hidden on every reload and for every visitor, the hidden set
// only grows as the percentage goes up, and a day is never emptied by it: the
// count hidden is rounded down and a day with one slot keeps it. As real
// bookings take slots the day's list shrinks and fewer are hidden, so a
// pretend busy slot quietly comes back when it is needed.
function lookBusy(av, key, slots) {
  const pct = Math.min(90, Math.max(0, Number(av.lookBusy) || 0));
  const hide = Math.floor(slots.length * pct / 100);
  if (!hide) return slots;
  const ranked = slots.slice().sort((a, b) => hash(key + "|" + a) - hash(key + "|" + b));
  const hidden = new Set(ranked.slice(0, hide));
  return slots.filter(s => !hidden.has(s));
}

// What the booking page shows: every open slot for every day in the window,
// with look busy applied. `taken` is the Map the database gives back, date to
// Set of slots, for confirmed bookings and live holds. Days with nothing open
// are left out. `honest` skips look busy: it is for the owner's own pickers,
// which must never hide a time that is really free from the one person who
// knows the calendar is pretending.
function calendar(av, taken, now = new Date(), honest = false) {
  const days = {};
  const max = av.maxAdvanceDays || 28;
  for (let i = 0; i <= max; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = keyOf(d);
    const t = taken.get(key) || new Set();
    const real = open(av, key, t, t.size, now);
    const slots = honest ? real : lookBusy(av, key, real);
    if (slots.length) days[key] = slots;
  }
  return { today: keyOf(now), to: keyOf(window(av, now)), days };
}

// The last day of the booking window.
function window(av, now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + (av.maxAdvanceDays || 28));
}

// The check before a hold is taken. Everything the calendar applies except
// look busy: a slot that is only hidden for show is still a real, free slot.
// Answers "ok", "taken" (someone holds it) or "closed" (the schedule or the
// clock says no), so the customer is told the true reason.
function why(av, taken, key, slot, now = new Date()) {
  const s = normalize(slot);
  if (!s || !isKey(key)) return "closed";
  const t = taken.get(key) || new Set();
  if (open(av, key, t, t.size, now).indexOf(s) !== -1) return "ok";
  if (t.has(s)) return "taken";
  // Nothing holds the slot, so either it was never offered, the notice window
  // has closed over it, or the day has hit its cap.
  return open(av, key, new Set(), 0, now).indexOf(s) !== -1 ? "taken" : "closed";
}

function canBook(av, taken, key, slot, now = new Date()) {
  return why(av, taken, key, slot, now) === "ok";
}

module.exports = { minutesOf, labelOf, normalize, cleanList, range, keyOf, dateOf, isKey, slotAt, window, calendar, canBook, why };
