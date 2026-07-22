/**
 * Date ranges, buckets, and deltas for the analytics pages.
 *
 * Pure on purpose — no Prisma, no `new Date()` without an argument passed in.
 * Every number an owner sees is this arithmetic applied to a row count, so the
 * arithmetic is the part worth testing exhaustively, and it can't be tested at
 * all if it needs a database and a wall clock to run.
 *
 * The whole file works in the **restaurant's** timezone rather than the
 * viewer's. An owner in Phoenix looking at their Denver location's Tuesday
 * wants the Tuesday the kitchen worked, not the one their laptop is in — and
 * "yesterday" that silently shifts by an hour twice a year is how a dashboard
 * loses an owner's trust for good.
 */

export type Granularity = "hour" | "day" | "week" | "month";

/** The presets the filter bar offers, plus a custom escape hatch. */
export type RangePreset =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "90d"
  | "12m"
  | "mtd"
  | "ytd"
  | "all"
  | "custom";

export const RANGE_PRESETS: Array<{ key: RangePreset; label: string }> = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "Month to date" },
  { key: "ytd", label: "Year to date" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
  { key: "custom", label: "Custom" },
];

export type DateRange = {
  from: Date;
  to: Date;
  preset: RangePreset;
  granularity: Granularity;
  label: string;
};

// ---------------------------------------------------------------------------
// Timezone helpers
// ---------------------------------------------------------------------------

/**
 * The offset, in minutes, between UTC and `timezone` at `at`.
 *
 * Uses `Intl` rather than a table because the table would be wrong the first
 * time a jurisdiction changed its mind about daylight saving, and this codebase
 * already decided (see `lib/hours.ts`) that every judgement is made in the
 * restaurant's own timezone.
 */
export function tzOffsetMinutes(at: Date, timezone: string): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      // Intl renders midnight as hour 24 in some ICU versions.
      Number(parts.hour) % 24,
      Number(parts.minute),
      Number(parts.second)
    );
    return Math.round((asUtc - at.getTime()) / 60000);
  } catch {
    // An unknown timezone must not blank the dashboard. UTC is wrong by hours;
    // a thrown error is wrong by the whole page.
    return 0;
  }
}

/** The same instant, expressed as a Date whose UTC fields read as local wall time. */
export function toLocal(at: Date, timezone: string): Date {
  return new Date(at.getTime() + tzOffsetMinutes(at, timezone) * 60000);
}

/** Inverse of `toLocal`: a local wall time back to the instant it names. */
export function fromLocal(local: Date, timezone: string): Date {
  // Two passes. The offset depends on the instant, and the instant is what we
  // are solving for, so the first pass gets us close enough that the second
  // lands on the right side of any DST boundary.
  const guess = new Date(local.getTime() - tzOffsetMinutes(local, timezone) * 60000);
  return new Date(local.getTime() - tzOffsetMinutes(guess, timezone) * 60000);
}

/** Midnight at the start of the local day containing `at`, as a UTC instant. */
export function startOfLocalDay(at: Date, timezone: string): Date {
  const l = toLocal(at, timezone);
  const midnight = new Date(
    Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate(), 0, 0, 0, 0)
  );
  return fromLocal(midnight, timezone);
}

export function addDays(at: Date, days: number): Date {
  return new Date(at.getTime() + days * 86400000);
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/**
 * Bucket width for a range.
 *
 * Chosen from the span rather than offered as a control, because the only
 * reason to pick it by hand is to make a chart that misleads: hourly buckets
 * over ninety days is 2,160 columns of noise, and monthly buckets over a week
 * is one column. The one place granularity is genuinely a question — a
 * fortnight, where both daily and hourly are defensible — daily wins, because
 * it is the one an owner can compare to last fortnight.
 */
export function granularityFor(from: Date, to: Date): Granularity {
  const days = (to.getTime() - from.getTime()) / 86400000;
  if (days <= 2) return "hour";
  if (days <= 70) return "day";
  if (days <= 400) return "week";
  return "month";
}

/**
 * Resolve a preset (or a custom pair) into a concrete range.
 *
 * `to` is always **exclusive**. Half-open ranges are the only way the boundary
 * between two adjacent periods stays honest: with an inclusive end, an order
 * placed at midnight is counted in both the day that ended and the day that
 * began, and every period-over-period comparison inherits the double count.
 */
export function resolveRange(args: {
  preset?: string | null;
  from?: string | null;
  to?: string | null;
  timezone: string;
  now: Date;
  /** Oldest data that exists, for "all time". Falls back to a year. */
  since?: Date | null;
}): DateRange {
  const { timezone, now } = args;
  const todayStart = startOfLocalDay(now, timezone);
  const tomorrow = addDays(todayStart, 1);

  const preset = (RANGE_PRESETS.find((p) => p.key === args.preset)?.key ?? "30d") as RangePreset;

  const build = (from: Date, to: Date, p: RangePreset, label: string): DateRange => ({
    from,
    to,
    preset: p,
    granularity: granularityFor(from, to),
    label,
  });

  switch (preset) {
    case "today":
      return build(todayStart, tomorrow, "today", "Today");
    case "yesterday":
      return build(addDays(todayStart, -1), todayStart, "yesterday", "Yesterday");
    case "7d":
      return build(addDays(todayStart, -6), tomorrow, "7d", "Last 7 days");
    case "90d":
      return build(addDays(todayStart, -89), tomorrow, "90d", "Last 90 days");
    case "mtd": {
      const l = toLocal(now, timezone);
      const first = fromLocal(new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1)), timezone);
      return build(first, tomorrow, "mtd", "Month to date");
    }
    case "ytd": {
      const l = toLocal(now, timezone);
      const first = fromLocal(new Date(Date.UTC(l.getUTCFullYear(), 0, 1)), timezone);
      return build(first, tomorrow, "ytd", "Year to date");
    }
    case "12m": {
      const l = toLocal(now, timezone);
      const first = fromLocal(
        new Date(Date.UTC(l.getUTCFullYear() - 1, l.getUTCMonth(), l.getUTCDate())),
        timezone
      );
      return build(first, tomorrow, "12m", "Last 12 months");
    }
    case "all": {
      const first = args.since ? startOfLocalDay(args.since, timezone) : addDays(todayStart, -364);
      return build(first, tomorrow, "all", "All time");
    }
    case "custom": {
      const from = parseDateInput(args.from, timezone);
      const to = parseDateInput(args.to, timezone);
      if (!from || !to) return build(addDays(todayStart, -29), tomorrow, "30d", "Last 30 days");
      // A custom range names two days, both of which the person means to see —
      // so the end day is included by pushing the exclusive bound past it.
      const end = addDays(to, 1);
      if (end <= from) return build(from, addDays(from, 1), "custom", "Custom");
      return build(from, end, "custom", "Custom");
    }
    case "30d":
    default:
      return build(addDays(todayStart, -29), tomorrow, "30d", "Last 30 days");
  }
}

/** `YYYY-MM-DD` in the restaurant's timezone, to the instant that day begins. */
export function parseDateInput(value: string | null | undefined, timezone: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return fromLocal(new Date(Date.UTC(y, m - 1, d)), timezone);
}

/** The inverse, for round-tripping a range back into the filter bar's inputs. */
export function formatDateInput(at: Date, timezone: string): string {
  const l = toLocal(at, timezone);
  return `${l.getUTCFullYear()}-${String(l.getUTCMonth() + 1).padStart(2, "0")}-${String(
    l.getUTCDate()
  ).padStart(2, "0")}`;
}

/**
 * The period immediately before this one, of the same length.
 *
 * Same length rather than "same period last month", because an owner's question
 * is "am I doing better than I was", and a 31-day month compared against a
 * 28-day one answers a different question badly. Month-over-month lives in the
 * monthly chart, where the buckets make the unequal lengths visible.
 */
export function previousRange(range: DateRange): { from: Date; to: Date } {
  const span = range.to.getTime() - range.from.getTime();
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) };
}

// ---------------------------------------------------------------------------
// Buckets
// ---------------------------------------------------------------------------

/**
 * Every bucket in the range, including the empty ones.
 *
 * The empty ones are the point. A line chart drawn only from days that had
 * orders connects Monday straight to Friday and shows a business that traded
 * steadily through a week it was shut — the gap is the information.
 */
export function bucketsFor(range: DateRange, timezone: string): Date[] {
  const out: Date[] = [];
  let cursor = truncateLocal(range.from, range.granularity, timezone);
  let guard = 0;
  while (cursor < range.to && guard++ < 2000) {
    out.push(cursor);
    cursor = advance(cursor, range.granularity, timezone);
  }
  return out;
}

export function truncateLocal(at: Date, g: Granularity, timezone: string): Date {
  const l = toLocal(at, timezone);
  const y = l.getUTCFullYear();
  const m = l.getUTCMonth();
  const d = l.getUTCDate();

  switch (g) {
    case "hour":
      return fromLocal(new Date(Date.UTC(y, m, d, l.getUTCHours())), timezone);
    case "day":
      return fromLocal(new Date(Date.UTC(y, m, d)), timezone);
    case "week": {
      // Weeks start Monday. Restaurants think in weekends, and a week that
      // splits Saturday from Sunday cuts the busiest two days of trade in half.
      const dow = (l.getUTCDay() + 6) % 7;
      return fromLocal(new Date(Date.UTC(y, m, d - dow)), timezone);
    }
    case "month":
      return fromLocal(new Date(Date.UTC(y, m, 1)), timezone);
  }
}

function advance(at: Date, g: Granularity, timezone: string): Date {
  const l = toLocal(at, timezone);
  switch (g) {
    case "hour":
      return new Date(at.getTime() + 3600000);
    case "day":
      return fromLocal(
        new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + 1)),
        timezone
      );
    case "week":
      return fromLocal(
        new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate() + 7)),
        timezone
      );
    case "month":
      return fromLocal(new Date(Date.UTC(l.getUTCFullYear(), l.getUTCMonth() + 1, 1)), timezone);
  }
}

export function bucketLabel(at: Date, g: Granularity, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions =
    g === "hour"
      ? { hour: "numeric", timeZone: timezone }
      : g === "month"
        ? { month: "short", year: "2-digit", timeZone: timezone }
        : { month: "short", day: "numeric", timeZone: timezone };
  try {
    return new Intl.DateTimeFormat("en-US", opts).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Deltas
// ---------------------------------------------------------------------------

export type Delta = {
  current: number;
  previous: number;
  /** Fractional change. Null when there's no honest way to express one. */
  pct: number | null;
  direction: "up" | "down" | "flat" | "new" | "none";
};

/**
 * Compare two periods.
 *
 * The awkward case is growth from zero. Every dashboard that reports it as
 * "+100%" or "+∞" is lying about the same thing: a percentage of nothing has no
 * meaning, and printing one where a real number belongs teaches an owner to
 * discount the honest percentages next to it. So zero-to-something is `"new"`
 * with a null percentage, and the UI says "new" rather than a number.
 */
export function delta(current: number, previous: number): Delta {
  if (previous === 0 && current === 0) return { current, previous, pct: null, direction: "none" };
  if (previous === 0) return { current, previous, pct: null, direction: "new" };
  const pct = (current - previous) / previous;
  const direction = Math.abs(pct) < 0.005 ? "flat" : pct > 0 ? "up" : "down";
  return { current, previous, pct, direction };
}

/** Safe division for rates. Returns 0 rather than NaN on an empty denominator. */
export function rate(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

export function formatPct(v: number, digits = 1): string {
  return `${(v * 100).toFixed(digits)}%`;
}

/** Dwell time as something a person reads at a glance, not milliseconds. */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${rem}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
