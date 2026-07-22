/**
 * Which times are actually bookable, and when.
 *
 * This module is **pure** — no Prisma, no `server-only` — for the same reason
 * `lib/onboarding.ts` is: every rule that decides whether a stranger can put a
 * call in someone's calendar should be testable without a database, and the
 * browser needs some of it to render a picker without a round trip per day.
 * The callers do the reading and the writing.
 *
 * ─── The two clocks ───────────────────────────────────────────────────────
 *
 * A booking system has two timezones and confusing them is the entire bug
 * surface. Availability windows are wall-clock time in the **host's** zone —
 * "I take calls 9 to 5" means 9 to 5 where the host is, whatever the server
 * thinks. The person booking is somewhere else and must be shown times in
 * **their** zone or they will turn up an hour out.
 *
 * So everything here works the same way `lib/hours.ts` does: windows are
 * `"HH:MM"` strings interpreted in a named zone, converted to absolute instants
 * exactly once, and every comparison after that is instant-to-instant. A slot
 * is a `Date`, which has no timezone; rendering it is the caller's problem and
 * `formatInZone` is here for that.
 *
 * ─── The default is nothing ───────────────────────────────────────────────
 *
 * `lib/hours.ts` fails **open**: a restaurant with no configured schedule keeps
 * trading, because switching off every tenant that never touched the setting is
 * worse than a 3am order. This module fails **closed**: a booking type with no
 * availability offers no slots at all.
 *
 * That inversion is deliberate and worth stating loudly, because the two
 * modules share `WeeklyHours` and it would be easy to assume they share the
 * default. The cost of failing open here is a stranger booking a call at 4am
 * on a Sunday and the host not turning up, which is a worse first impression
 * than an empty picker that says "no times available".
 */

import {
  DAY_KEYS,
  type DayKey,
  type Interval,
  type WeeklyHours,
  toMinutes,
  fromMinutes,
} from "./hours";

// ---------------------------------------------------------------------------
// Zone arithmetic
// ---------------------------------------------------------------------------

type Wall = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function wallPartsIn(at: Date, timezone: string): Wall {
  let parts: Intl.DateTimeFormatPart[];
  const opts: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  };
  try {
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).formatToParts(at);
  } catch {
    // An unknown zone falls back to UTC rather than throwing, matching
    // `localNow` in lib/hours.ts. A calendar that 500s because someone typed a
    // bad zone into a settings field is worse than one an hour out.
    parts = new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).formatToParts(at);
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/**
 * How far ahead of UTC the zone is at a given instant, in milliseconds.
 *
 * Derived by formatting the instant in the zone and reading the result back as
 * if it were UTC. That sounds circular and isn't: the difference between those
 * two numbers *is* the offset, and getting it from `Intl` means daylight saving
 * is handled by the platform's zone database rather than by a table in this
 * repo that goes stale the next time a government moves a clock.
 */
function zoneOffsetMs(at: Date, timezone: string): number {
  const w = wallPartsIn(at, timezone);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asUtc - at.getTime();
}

/**
 * A wall-clock date and time in a zone -> the absolute instant it names.
 *
 * Two passes, and the second one is not defensive padding. Converting requires
 * knowing the offset, and the offset depends on the instant we are trying to
 * find — so the first pass uses the offset at roughly the right time and the
 * second corrects it. They differ only across a daylight-saving boundary,
 * which is exactly the case a single pass gets wrong by an hour.
 *
 * Spring-forward times that do not exist (2:30am on the day the clocks skip
 * 2am) land on the following real instant rather than throwing. A slot that
 * quietly moves is better than a picker that crashes one Sunday a year.
 */
export function wallClockToInstant(
  date: string,
  minutesFromMidnight: number,
  timezone: string,
): Date {
  const [y, m, d] = date.split("-").map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, 0, 0) + minutesFromMidnight * 60_000;

  const firstPass = naive - zoneOffsetMs(new Date(naive), timezone);
  const secondPass = naive - zoneOffsetMs(new Date(firstPass), timezone);

  return new Date(secondPass);
}

/** "YYYY-MM-DD" for an instant, as seen in a zone. */
export function dateInZone(at: Date, timezone: string): string {
  const w = wallPartsIn(at, timezone);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Minutes since local midnight for an instant, as seen in a zone. */
export function minutesInZone(at: Date, timezone: string): number {
  const w = wallPartsIn(at, timezone);
  return w.hour * 60 + w.minute;
}

/** Which day of the week an instant falls on, in a zone. */
export function dayKeyInZone(at: Date, timezone: string): DayKey {
  const [y, m, d] = dateInZone(at, timezone).split("-").map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** "2026-07-19" + 1 -> "2026-07-20". Calendar arithmetic, no zone involved. */
export function addDays(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function dayKeyOfDateString(date: string): DayKey {
  const [y, m, d] = date.split("-").map(Number);
  return DAY_KEYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** "2:30 PM" for an instant, in whatever zone the reader is in. */
export function formatInZone(at: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
  }
}

/** "Tuesday, 21 July at 2:30 PM EDT" — for a confirmation, a banner, an email. */
export function formatFullInZone(at: Date, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = {
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(at);
  }
}

/** "Tuesday, 21 July" — the heading over a day's column of slots. */
export function formatDayInZone(at: Date, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: timezone }).format(at);
  } catch {
    return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: "UTC" }).format(at);
  }
}

/**
 * The visitor's zone, or a sane guess.
 *
 * Client-side only — `Intl` on the server reports the server's zone, which is
 * UTC on Railway and is nobody's actual timezone. A page that renders slots
 * server-side must render them in the *host's* zone and let the browser
 * re-label them, which is what `SlotPicker` does.
 */
export function guessBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

// ---------------------------------------------------------------------------
// Slot generation
// ---------------------------------------------------------------------------

export type BookingRules = {
  /** Wall-clock windows in `timezone`. Undefined or empty means nothing is bookable. */
  availability: WeeklyHours;
  timezone: string;
  durationMins: number;
  /** Dead time after a call before the next may start. */
  bufferMins: number;
  /** How soon from now a slot may be booked. */
  minNoticeMins: number;
  /** How far ahead the picker runs. */
  maxDaysAhead: number;
};

/** An interval already spoken for. Both instants, both absolute. */
export type Busy = { startsAt: Date; endsAt: Date };

export type Slot = {
  startsAt: Date;
  endsAt: Date;
};

export type SlotDay = {
  /** "YYYY-MM-DD" in the host's zone — the key the day is grouped under. */
  date: string;
  slots: Slot[];
};

const MAX_DAYS_CEILING = 120;

/**
 * Expand one day's windows into candidate start times, in local minutes.
 *
 * A window shorter than the call yields nothing rather than one slot that
 * overruns — "9:00 to 9:15" cannot hold a 20 minute call and offering it
 * anyway books a conflict the host discovers on the day.
 *
 * The step is duration **plus buffer**, so a 20 minute call with a 5 minute
 * buffer starts on :00, :25, :50. Stepping by duration alone produces a grid
 * where every slot is legal in isolation and no two adjacent ones can both be
 * taken, which reads to a booker as slots vanishing at random.
 */
function candidateMinutes(intervals: Interval[], durationMins: number, bufferMins: number): number[] {
  const step = Math.max(durationMins + bufferMins, 5);
  const out: number[] = [];

  for (const iv of intervals) {
    const open = toMinutes(iv.open);
    // A window that closes at or before it opens runs past midnight, exactly as
    // in lib/hours.ts. Rare on a calendar and supported anyway, because the
    // shared parser accepts it and silently dropping it would be a schedule an
    // admin set and cannot see.
    const rawClose = toMinutes(iv.close);
    const close = rawClose <= open ? rawClose + 1440 : rawClose;

    for (let t = open; t + durationMins <= close; t += step) {
      out.push(t);
    }
  }

  // Two windows can overlap once an overnight one is unwrapped; the same start
  // offered twice would render as a duplicate button.
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Every bookable slot, grouped by day in the host's zone.
 *
 * Days with nothing available are omitted entirely rather than returned empty,
 * so a picker can render what it is given without deciding which columns are
 * worth drawing.
 */
export function generateSlots(
  rules: BookingRules,
  busy: Busy[],
  now: Date = new Date(),
): SlotDay[] {
  const { availability, timezone, durationMins, bufferMins } = rules;

  // Fail closed. See the header — this is the opposite of lib/hours.ts and it
  // is the single most important line in the file.
  if (!availability || Object.keys(availability).length === 0) return [];
  if (durationMins <= 0) return [];

  const earliest = new Date(now.getTime() + Math.max(rules.minNoticeMins, 0) * 60_000);
  const horizon = Math.min(Math.max(rules.maxDaysAhead, 0), MAX_DAYS_CEILING);

  // Busy intervals get the buffer applied on both sides once, here, so the
  // inner loop is a plain overlap test.
  const blocked = busy.map((b) => ({
    start: b.startsAt.getTime() - bufferMins * 60_000,
    end: b.endsAt.getTime() + bufferMins * 60_000,
  }));

  const startDate = dateInZone(now, timezone);
  const days: SlotDay[] = [];

  for (let i = 0; i <= horizon; i++) {
    const date = addDays(startDate, i);
    const dayKey = dayKeyOfDateString(date);
    const intervals = availability[dayKey];
    if (!intervals || intervals.length === 0) continue;

    const slots: Slot[] = [];

    for (const mins of candidateMinutes(intervals, durationMins, bufferMins)) {
      const startsAt = wallClockToInstant(date, mins, timezone);
      const endsAt = new Date(startsAt.getTime() + durationMins * 60_000);

      // Minimum notice. Also excludes everything in the past, which is why
      // there is no separate check for it.
      if (startsAt.getTime() < earliest.getTime()) continue;

      // An overnight window can push a slot past the horizon date; a booker who
      // asked for three weeks should not be offered day 22.
      if (dateInZone(startsAt, timezone) > addDays(startDate, horizon)) continue;

      const clash = blocked.some((b) => overlaps(startsAt.getTime(), endsAt.getTime(), b.start, b.end));
      if (clash) continue;

      slots.push({ startsAt, endsAt });
    }

    if (slots.length > 0) days.push({ date, slots });
  }

  return days;
}

/**
 * Whether one specific instant is still bookable.
 *
 * The picker's slots go stale — a booker can sit on the page for ten minutes
 * while somebody else takes the 2pm — so the server re-derives this at the
 * moment of booking rather than trusting the value that came back from the
 * form. That check is still racy against a simultaneous insert; the partial
 * unique index in migration 30 is what actually closes it. This is the
 * friendly half, and the index is the correct half.
 */
export function isSlotBookable(
  rules: BookingRules,
  busy: Busy[],
  startsAt: Date,
  now: Date = new Date(),
): boolean {
  const target = startsAt.getTime();
  return generateSlots(rules, busy, now).some((d) =>
    d.slots.some((s) => s.startsAt.getTime() === target),
  );
}

/** Total slots across every day — for "no times available" copy. */
export function countSlots(days: SlotDay[]): number {
  return days.reduce((n, d) => n + d.slots.length, 0);
}

// ---------------------------------------------------------------------------
// Availability form
// ---------------------------------------------------------------------------

/**
 * Parse the admin availability grid.
 *
 * Deliberately not `parseHoursForm` from lib/hours.ts. That one enforces
 * `requireOpenDay` for the onboarding wizard and carries copy about a kitchen
 * being open; reusing it would mean one function answering to two different
 * sets of rules, which is the shape `lib/onboarding.ts` and `lib/readiness.ts`
 * already went out of their way to avoid. The *data* is shared, the validation
 * is not.
 *
 * An empty grid is allowed and means "I am not taking calls" — a legitimate
 * thing to say, and the fail-closed default makes it safe.
 */
export function parseAvailabilityForm(form: {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}): { availability: WeeklyHours; errors: string[] } {
  const availability: WeeklyHours = {};
  const errors: string[] = [];

  for (const day of DAY_KEYS) {
    const enabled = form.get(`${day}_on`) === "on";
    if (!enabled) continue;

    const opens = form.getAll(`${day}_open`).map(String);
    const closes = form.getAll(`${day}_close`).map(String);
    const intervals: Interval[] = [];

    for (let i = 0; i < Math.max(opens.length, closes.length); i++) {
      const open = opens[i]?.trim();
      const close = closes[i]?.trim();
      if (!open && !close) continue;

      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(open ?? "") || !/^([01]\d|2[0-3]):([0-5]\d)$/.test(close ?? "")) {
        errors.push(`${day}: needs both a start and an end time.`);
        continue;
      }
      if (toMinutes(open!) === toMinutes(close!)) {
        errors.push(`${day}: start and end are the same time.`);
        continue;
      }
      intervals.push({ open: open!, close: close! });
    }

    if (intervals.length > 0) availability[day] = intervals;
  }

  return { availability, errors };
}

/** "9:00 AM – 5:00 PM" for one window, for the settings summary. */
export function describeInterval(iv: Interval): string {
  const label = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
  };
  return `${label(iv.open)} – ${label(iv.close)}`;
}

export { fromMinutes };
