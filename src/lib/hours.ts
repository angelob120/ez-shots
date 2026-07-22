/**
 * When a restaurant is actually open, and whether it can take an order right
 * now.
 *
 * The `hours` string on Restaurant is prose for the website. It is never
 * consulted here, because "Mon-Fri 11-9, weekends til late" is not a decision
 * procedure. This module works off `hoursJson` instead.
 *
 * Two rules shape everything below:
 *
 *   1. Every judgement is made in the restaurant's local time. A kitchen in
 *      Denver closing at 9pm closes at 9pm there, whatever the server or the
 *      customer's phone thinks.
 *
 *   2. A tenant that has never configured hours keeps trading. Failing closed
 *      would silently switch off ordering for every restaurant on the platform
 *      the moment this shipped — a worse outcome than the 3am order it
 *      prevents. Absence of a schedule means "no schedule", not "closed".
 */

export const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type DayKey = (typeof DAY_KEYS)[number];

export const DAY_LABELS: Record<DayKey, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};

/**
 * One service window, as local wall-clock "HH:MM".
 *
 * When `close` is less than or equal to `open` the window runs past midnight:
 * `{ open: "17:00", close: "02:00" }` is a bar that shuts at 2am the next day.
 * That case is handled everywhere rather than rejected, because late-night is
 * exactly the trade where a wrong answer costs the most.
 */
export type Interval = { open: string; close: string };

/** A day may have several windows — the classic lunch/dinner split. */
export type WeeklyHours = Partial<Record<DayKey, Interval[]>>;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(s: unknown): s is string {
  return typeof s === "string" && TIME_RE.test(s);
}

/** "HH:MM" -> minutes since local midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/** minutes since local midnight -> "HH:MM", wrapping past a day. */
export function fromMinutes(mins: number): string {
  const m = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "17:30" -> "5:30 PM". Customer-facing; never used for arithmetic. */
export function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

/**
 * Coerce whatever is in the Json column into a shape the rest of the module
 * can trust. Anything malformed is dropped rather than thrown on — a typo in
 * one day's hours must not take down the ordering page.
 */
export function parseWeeklyHours(input: unknown): WeeklyHours {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const out: WeeklyHours = {};

  for (const day of DAY_KEYS) {
    const val = raw[day];
    if (!Array.isArray(val)) continue;

    const intervals: Interval[] = [];
    for (const entry of val) {
      if (!entry || typeof entry !== "object") continue;
      const { open, close } = entry as Record<string, unknown>;
      if (!isValidTime(open) || !isValidTime(close)) continue;
      // A zero-length window is a data-entry mistake, not a 24-hour day.
      if (open === close) continue;
      intervals.push({ open, close });
    }

    if (intervals.length) {
      out[day] = intervals.sort((a, b) => toMinutes(a.open) - toMinutes(b.open));
    }
  }

  return out;
}

export function hasSchedule(hours: WeeklyHours): boolean {
  return DAY_KEYS.some((d) => (hours[d]?.length ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Local time
// ---------------------------------------------------------------------------

export type LocalNow = {
  /** "YYYY-MM-DD" in the restaurant's zone. */
  date: string;
  day: DayKey;
  /** Minutes since local midnight. */
  minutes: number;
};

/**
 * Where the restaurant is in its own day. Intl does the zone maths — including
 * daylight saving, which is the part hand-rolled offsets always get wrong.
 * An unknown zone falls back to UTC rather than throwing.
 */
export function localNow(now: Date, timezone: string): LocalNow {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      weekday: "short",
    }).formatToParts(now);
  }

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = get("weekday").toLowerCase().slice(0, 3) as DayKey;

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    day: DAY_KEYS.includes(weekday) ? weekday : "sun",
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  };
}

function shiftDay(day: DayKey, delta: number): DayKey {
  const i = DAY_KEYS.indexOf(day);
  return DAY_KEYS[(i + delta + 7 * 10) % 7];
}

/** "2026-07-19" + 1 -> "2026-07-20". Calendar arithmetic, no zone involved. */
function shiftDateString(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Open / closed
// ---------------------------------------------------------------------------

/**
 * The window currently being served, and how long is left in it.
 *
 * Checks yesterday's schedule too, so at 00:30 a "17:00-02:00" Friday window
 * still counts as open on Saturday morning.
 */
export function activeInterval(
  hours: WeeklyHours,
  at: LocalNow
): { interval: Interval; minutesLeft: number } | null {
  const candidates: Array<{ interval: Interval; startedYesterday: boolean }> = [
    ...(hours[at.day] ?? []).map((interval) => ({ interval, startedYesterday: false })),
    ...(hours[shiftDay(at.day, -1)] ?? []).map((interval) => ({ interval, startedYesterday: true })),
  ];

  for (const { interval, startedYesterday } of candidates) {
    const open = toMinutes(interval.open);
    const close = toMinutes(interval.close);
    const overnight = close <= open;

    if (startedYesterday) {
      // Only the tail of an overnight window can reach into today.
      if (overnight && at.minutes < close) {
        return { interval, minutesLeft: close - at.minutes };
      }
      continue;
    }

    if (overnight) {
      if (at.minutes >= open) {
        return { interval, minutesLeft: 1440 - at.minutes + close };
      }
    } else if (at.minutes >= open && at.minutes < close) {
      return { interval, minutesLeft: close - at.minutes };
    }
  }

  return null;
}

export function isOpenAt(hours: WeeklyHours, at: LocalNow): boolean {
  return activeInterval(hours, at) !== null;
}

/**
 * The next time the doors open, as customer-facing copy — "today at 5 PM",
 * "Monday at 11 AM". Deliberately a label rather than a Date: turning a local
 * wall-clock time in an arbitrary zone back into a UTC instant is fiddly and
 * error-prone, and nothing downstream needs the instant.
 *
 * `closedDates` are skipped entirely, so a holiday doesn't produce a promise
 * the kitchen can't keep.
 */
export function describeNextOpen(
  hours: WeeklyHours,
  at: LocalNow,
  closedDates: (date: string) => boolean = () => false
): string | null {
  if (!hasSchedule(hours)) return null;

  for (let offset = 0; offset < 14; offset++) {
    const date = shiftDateString(at.date, offset);
    if (closedDates(date)) continue;

    const day = shiftDay(at.day, offset);
    for (const interval of hours[day] ?? []) {
      // Today only counts if the opening is still ahead of us.
      if (offset === 0 && toMinutes(interval.open) <= at.minutes) continue;

      const when = formatTime(interval.open);
      if (offset === 0) return `today at ${when}`;
      if (offset === 1) return `tomorrow at ${when}`;
      return `${DAY_LABELS[day]} at ${when}`;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// The decision
// ---------------------------------------------------------------------------

export type AvailabilityInput = {
  status: string;
  hoursJson: unknown;
  timezone: string;
  pausedUntil: Date | null;
  pauseReason: string | null;
  lastCallMins: number;
  prepMinutes: number;
  closures: Array<{ startDate: string; endDate: string; reason: string | null }>;
};

export type UnavailableCode = "SUSPENDED" | "PAUSED" | "HOLIDAY" | "CLOSED" | "LAST_CALL";

export type Availability =
  | { ok: true; minutesLeft: number | null; promiseMinutes: number }
  | { ok: false; code: UnavailableCode; message: string; reopens: string | null };

/**
 * The one function the ordering path asks. Everything that could make an order
 * a bad idea before it is placed is checked here, in the order a customer
 * would find least surprising to be told about.
 */
export function checkAvailability(r: AvailabilityInput, now: Date = new Date()): Availability {
  if (r.status !== "ACTIVE") {
    return {
      ok: false,
      code: "SUSPENDED",
      message: "This restaurant isn't taking online orders right now.",
      reopens: null,
    };
  }

  const hours = parseWeeklyHours(r.hoursJson);
  const at = localNow(now, r.timezone);
  const isClosedDate = (date: string) =>
    r.closures.some((c) => date >= c.startDate && date <= c.endDate);

  // A manual pause outranks the schedule: if the kitchen says stop, it stops,
  // even mid-service. This is the button for a fryer fire.
  if (r.pausedUntil && r.pausedUntil > now) {
    return {
      ok: false,
      code: "PAUSED",
      message: r.pauseReason?.trim()
        ? `Orders are paused: ${r.pauseReason.trim()}`
        : "The kitchen has paused new orders for a few minutes.",
      reopens: `around ${formatTime(fromMinutes(at.minutes + Math.ceil((r.pausedUntil.getTime() - now.getTime()) / 60000)))}`,
    };
  }

  const holiday = r.closures.find((c) => at.date >= c.startDate && at.date <= c.endDate);
  if (holiday) {
    return {
      ok: false,
      code: "HOLIDAY",
      message: holiday.reason?.trim()
        ? `Closed today — ${holiday.reason.trim()}.`
        : "Closed today.",
      reopens: describeNextOpen(hours, at, isClosedDate),
    };
  }

  // No schedule configured: fail open. See the header note.
  if (!hasSchedule(hours)) {
    return { ok: true, minutesLeft: null, promiseMinutes: r.prepMinutes };
  }

  const active = activeInterval(hours, at);
  if (!active) {
    return {
      ok: false,
      code: "CLOSED",
      message: "The kitchen is closed right now.",
      reopens: describeNextOpen(hours, at, isClosedDate),
    };
  }

  // Last call. An order that lands with less cooking time than the food needs
  // is a cancellation waiting to happen, so refuse it while the customer is
  // still in a position to go somewhere else.
  const cutoff = Math.max(r.lastCallMins, 0);
  if (active.minutesLeft <= cutoff) {
    return {
      ok: false,
      code: "LAST_CALL",
      message: `The kitchen stops taking orders ${cutoff} minutes before close, and it's ${formatTime(active.interval.close)} closing tonight.`,
      reopens: describeNextOpen(hours, at, isClosedDate),
    };
  }

  return {
    ok: true,
    minutesLeft: active.minutesLeft,
    // Never promise a pickup time past closing.
    promiseMinutes: Math.min(r.prepMinutes, Math.max(5, active.minutesLeft - 5)),
  };
}

/** Renders the weekly schedule as lines for the website and the dashboard. */
export function describeWeek(hours: WeeklyHours): Array<{ day: DayKey; label: string; text: string }> {
  return DAY_KEYS.map((day) => {
    const intervals = hours[day] ?? [];
    return {
      day,
      label: DAY_LABELS[day],
      text: intervals.length
        ? intervals.map((i) => `${formatTime(i.open)} – ${formatTime(i.close)}`).join(", ")
        : "Closed",
    };
  });
}

/**
 * Parse the day-grid form both the dashboard and the onboarding wizard post.
 *
 * Pure, and living here rather than in either actions file, because two copies
 * of "what counts as a valid week" is how the wizard accepts a schedule the
 * dashboard would reject — or worse, the reverse. Actions files are
 * `"use server"`, so every export in them must be a server action; a shared
 * parser has nowhere else to go.
 *
 * `requireOpenDay` is the one behavioural difference between the callers, and
 * it is not a style choice. An established tenant clearing every day is a
 * legitimate act — `checkAvailability` fails open, they keep trading, and
 * that's the documented default. A tenant doing it *during onboarding* has
 * simply not answered the question yet, and letting it through is how you get
 * a brand-new restaurant taking orders at 3am on its first night.
 */
export function parseHoursForm(
  get: (key: string) => string | null | undefined,
  opts: { requireOpenDay?: boolean } = {}
): { hours: WeeklyHours; error?: string } {
  const hours: WeeklyHours = {};

  for (const day of DAY_KEYS) {
    if (!get(`on_${day}`)) continue;
    const open = String(get(`open_${day}`) ?? "");
    const close = String(get(`close_${day}`) ?? "");
    if (!isValidTime(open) || !isValidTime(close) || open === close) {
      return { hours: {}, error: `Check the times for ${DAY_LABELS[day]}.` };
    }
    hours[day] = [{ open, close }];
  }

  if (opts.requireOpenDay && !hasSchedule(hours)) {
    return {
      hours: {},
      error: "Tick at least one day you're open. Ordering closes itself outside these hours.",
    };
  }

  return { hours };
}

