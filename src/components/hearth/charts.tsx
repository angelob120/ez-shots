/**
 * Charts, hand-rolled in SVG.
 *
 * No charting library, for three reasons that all point the same way. It would
 * be the largest dependency in a repo whose whole `package.json` is a dozen
 * lines; it would ship a client bundle to a dashboard an owner opens on a phone
 * behind the counter; and the charts this product needs are five specific
 * shapes, not a general grammar of graphics. That decision stands.
 *
 * What changed is narrower than it looks. Everything in *this* file is still
 * server-rendered static markup with zero JavaScript — `Funnel`, `RankedBars`,
 * `Sparkline`, `Metric`, `DeltaChip`. The two charts where a static reading was
 * actually losing information moved to `charts.client.tsx`: the line chart,
 * whose `<title>` tooltips required a held hover, showed one series at a time,
 * and never appeared on a touchscreen at all; and the heatmap, which could only
 * draw one metric per render. They are re-exported here under their original
 * names so every call site keeps importing from one place, and they render
 * their full markup on the server — hydration adds the crosshair, not the
 * chart. See that file's header for the reasoning in full.
 *
 * **One prop shape had to change.** A server component cannot pass a function
 * to a client one, so `SeriesDef.format` is now a key (`"count" | "money" |
 * "pct"`) rather than a formatter. `chartFormatters` remains for the static
 * components here, which take real functions and always could.
 *
 * Colours are literals rather than Tailwind classes because SVG `fill` and
 * `stroke` can't read a Tailwind class. They must stay `rgb(var(--x))` and not
 * the bare triplet: Tailwind's `<alpha-value>` shorthand is a build-time
 * substitution and means nothing to an inline attribute. They're the same
 * tokens as `globals.css`, so the charts follow the operator theme without a
 * re-render.
 */

import { centsToMoney } from "@/lib/money";

export {
  InteractiveLineChart as LineChart,
  InteractiveHeatmap as Heatmap,
  applyFormat,
  type ClientSeriesDef as SeriesDef,
  type CompareDef,
  type FormatKey,
} from "@/components/hearth/charts.client";

const INK = "rgb(var(--h-ink))";
const DIM = "rgb(var(--h-dim))";
const MUTE = "rgb(var(--h-mute))";
const LINE = "rgb(var(--h-line))";
const ACCENT = "rgb(var(--h-accent))";
const ACCENT_DIM = "rgb(var(--h-accent-dim))";
const WARN = "rgb(var(--h-warn))";

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

/**
 * The conversion funnel as stacked bars.
 *
 * Each row shows two percentages, and the second is the one that's actually
 * actionable: share of the *previous* step, which is where the drop happened.
 * "18% of visitors reach checkout" doesn't say where they went; "of the people
 * who added something to a cart, 34% never opened checkout" points at a
 * specific screen.
 *
 * The worst step is called out rather than left to be spotted. A funnel is read
 * top to bottom and the eye stops at the first big number, which is almost
 * always the first step — the largest *proportional* loss is usually further
 * down and is the one worth a Monday morning.
 */
export function Funnel({
  steps,
}: {
  steps: Array<{ key: string; label: string; count: number; ofTotal: number; ofPrevious: number }>;
}) {
  const top = Math.max(1, steps[0]?.count ?? 1);

  // Only steps after the first can have a "drop", and a step reached by nobody
  // isn't a leak worth flagging — it's a step with no traffic above it.
  const worst = steps
    .slice(1)
    .filter((s, i) => steps[i].count > 0)
    .reduce<{ key: string; lost: number } | null>((acc, s, i) => {
      const lost = steps[i].count - s.count;
      return !acc || lost > acc.lost ? { key: s.key, lost } : acc;
    }, null);

  return (
    <ol className="m-0 list-none space-y-2.5 p-0">
      {steps.map((s, i) => {
        const width = Math.max(1.5, (s.count / top) * 100);
        const lost = i > 0 ? steps[i - 1].count - s.count : 0;
        const isWorst = worst?.key === s.key && lost > 0;
        return (
          <li key={s.key} className="group">
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="flex items-center gap-2 text-dim">
                {s.label}
                {isWorst && (
                  <span className="rounded-xs bg-surface2 px-1.5 py-0.5 text-[10px] text-warn">
                    biggest drop
                  </span>
                )}
              </span>
              <span className="font-mono tabular-nums text-ink">
                {s.count.toLocaleString()}
                <span className="ml-2 text-mute">{(s.ofTotal * 100).toFixed(1)}%</span>
              </span>
            </div>
            <div className="relative mt-1 h-7 w-full overflow-hidden rounded-xs bg-surface2">
              {/* The lost slice is drawn as a ghost behind the bar, so the gap
                  between one row and the next is visible as an area rather
                  than needing two numbers subtracted. */}
              {i > 0 && (
                <div
                  className="absolute inset-y-0 left-0 rounded-xs"
                  style={{ width: `${(steps[i - 1].count / top) * 100}%`, background: LINE }}
                />
              )}
              <div
                className="absolute inset-y-0 left-0 rounded-xs transition-[width]"
                style={{
                  width: `${width}%`,
                  background: i === steps.length - 1 ? ACCENT : ACCENT_DIM,
                  opacity: 1 - i * 0.06,
                }}
                title={`${s.label}: ${s.count.toLocaleString()} (${(s.ofTotal * 100).toFixed(1)}% of all visits)`}
              />
            </div>
            {i > 0 && (
              <p className="mt-1 text-[11px] text-mute">
                {(s.ofPrevious * 100).toFixed(0)}% carried through
                {lost > 0 && (
                  <span className={isWorst ? "text-warn" : undefined}>
                    {" · "}
                    {lost.toLocaleString()} dropped here
                  </span>
                )}
              </p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Horizontal breakdown
// ---------------------------------------------------------------------------

/**
 * A ranked breakdown with a secondary rate column.
 *
 * The rate column is what makes this more than a bar chart. Volume alone says a
 * QR code is the smallest source of traffic; volume beside conversion says it's
 * the smallest source and the best one, which is the version that changes what
 * an owner does on Monday.
 *
 * The bar carries a second, brighter segment sized by conversion rate. Reading
 * the rate off the number requires arithmetic against the row above it; reading
 * it off a filled proportion of the same bar does not, and the two encodings
 * agree because they're drawn from the same pair of figures.
 */
export function RankedBars({
  rows,
  valueLabel = "visits",
  rateLabel = "converts",
}: {
  rows: Array<{ key: string; label: string; visits: number; orders: number; conversionRate: number }>;
  valueLabel?: string;
  rateLabel?: string;
}) {
  if (!rows.length) return <p className="text-[12px] text-mute">Nothing recorded yet.</p>;
  const max = Math.max(1, ...rows.map((r) => r.visits));
  const bestRate = Math.max(...rows.map((r) => r.conversionRate));

  return (
    <ul className="m-0 list-none space-y-2.5 p-0">
      {rows.map((r) => {
        // Flagged only when it's both the best rate and not the biggest
        // source — "the biggest source converts best" is the expected case and
        // labelling it teaches people to ignore the label.
        const standout =
          r.conversionRate === bestRate && bestRate > 0 && r.visits < max && rows.length > 1;
        return (
          <li key={r.key}>
            <div className="flex items-baseline justify-between gap-3 text-[12px]">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate text-ink">{r.label}</span>
                {standout && (
                  <span className="shrink-0 rounded-xs bg-surface2 px-1.5 py-0.5 text-[10px] text-accent">
                    best rate
                  </span>
                )}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-dim">
                {r.visits.toLocaleString()} {valueLabel}
                <span className="ml-2 text-mute">
                  {(r.conversionRate * 100).toFixed(1)}% {rateLabel}
                </span>
              </span>
            </div>
            <div
              className="relative mt-1 h-2 w-full overflow-hidden rounded-full bg-surface2"
              title={`${r.label}: ${r.visits} ${valueLabel}, ${r.orders} orders (${(r.conversionRate * 100).toFixed(1)}%)`}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${(r.visits / max) * 100}%`, background: ACCENT_DIM, opacity: 0.55 }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${(r.visits / max) * r.conversionRate * 100}%`,
                  background: ACCENT,
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

/** Trend shape for a stat card. No axes on purpose — this is a glance, not a read. */
export function Sparkline({
  values,
  color = ACCENT,
  height = 28,
}: {
  values: number[];
  color?: string;
  height?: number;
}) {
  if (values.length < 2) return null;
  const w = 120;
  const max = Math.max(1, ...values);
  const y = (v: number) => height - (v / max) * (height - 3) - 1.5;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${y(v)}`).join(" ");
  const id = `spark-${Math.abs(hashOf(pts))}`;
  const last = values[values.length - 1];

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <polygon points={`0,${height} ${pts} ${w},${height}`} fill={`url(#${id})`} />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
      {/* The most recent point marked, because "where did it end up" is the
          only specific question anyone asks of a sparkline. */}
      <circle cx={w} cy={y(last)} r={1.8} fill={color} />
    </svg>
  );
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

// ---------------------------------------------------------------------------
// Delta chip
// ---------------------------------------------------------------------------

/**
 * Period-over-period change.
 *
 * "new" rather than a percentage when the previous period was zero — see
 * `delta()` in lib/analytics-range.ts for why a percentage of nothing is a lie
 * that costs the honest numbers beside it their credibility.
 *
 * `goodWhenDown` exists because direction and desirability aren't the same
 * thing: refunds falling is good news, and a chart that paints every decrease
 * red teaches people to ignore the colour.
 */
export function DeltaChip({
  delta,
  goodWhenDown = false,
}: {
  delta: { pct: number | null; direction: "up" | "down" | "flat" | "new" | "none" };
  goodWhenDown?: boolean;
}) {
  if (delta.direction === "none") return null;
  if (delta.direction === "new") {
    return (
      <span
        className="rounded-xs bg-surface2 px-1.5 py-0.5 text-[11px] text-dim"
        title="Nothing to compare against — the previous period had none of this."
      >
        new
      </span>
    );
  }
  if (delta.direction === "flat") {
    return <span className="text-[11px] text-mute">no change</span>;
  }

  const up = delta.direction === "up";
  const good = goodWhenDown ? !up : up;
  return (
    <span
      className="inline-flex items-center gap-0.5 rounded-xs px-1 py-0.5 text-[11px] font-medium tabular-nums"
      style={{
        color: good ? "rgb(var(--h-good))" : "rgb(var(--h-bad))",
        background: good ? "rgb(var(--h-good) / 0.1)" : "rgb(var(--h-bad) / 0.1)",
      }}
      title="Compared with the period immediately before this one, of the same length."
    >
      {up ? "▲" : "▼"} {Math.abs((delta.pct ?? 0) * 100).toFixed(1)}%
    </span>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/**
 * A headline number with its change and its trend.
 *
 * Distinct from `Stat` in ui.tsx, which takes a plain string and is right for
 * the places a number stands alone. A number on an analytics page never stands
 * alone: without the comparison beside it, "412 visits" is unreadable — the
 * reader has no idea whether that's a good week — and the first thing anyone
 * does is go looking for last week's figure to divide by.
 *
 * `previousValue` puts that figure in the card's tooltip. The delta chip says
 * "▼ 12.4%", which is the right thing to show and the wrong thing to quote in a
 * meeting; the number it was measured against should be one hover away rather
 * than a filter change away.
 */
export function Metric({
  label,
  value,
  hint,
  delta,
  goodWhenDown,
  spark,
  previousValue,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: { pct: number | null; direction: "up" | "down" | "flat" | "new" | "none" };
  goodWhenDown?: boolean;
  spark?: number[];
  previousValue?: string;
  tone?: "default" | "accent";
}) {
  return (
    <div
      className="rounded-md border border-line bg-surface p-4 transition-colors hover:border-line2"
      title={previousValue ? `Previous period: ${previousValue}` : undefined}
    >
      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">{label}</div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
        <span
          className="font-mono text-[24px] font-semibold tabular-nums"
          style={{ color: tone === "accent" ? ACCENT : INK }}
        >
          {value}
        </span>
        {delta && <DeltaChip delta={delta} goodWhenDown={goodWhenDown} />}
      </div>
      {hint && <div className="mt-1 text-[11.5px] text-dim">{hint}</div>}
      {previousValue && (
        <div className="mt-0.5 text-[11px] text-mute">was {previousValue}</div>
      )}
      {spark && spark.length > 1 && (
        <div className="mt-2">
          <Sparkline values={spark} color={tone === "accent" ? ACCENT : ACCENT_DIM} />
        </div>
      )}
    </div>
  );
}

export const chartFormatters = {
  money: (v: number) => centsToMoney(Math.round(v)),
  count: (v: number) => Math.round(v).toLocaleString(),
  pct: (v: number) => `${(v * 100).toFixed(1)}%`,
};

export { INK, DIM, MUTE, LINE, ACCENT, ACCENT_DIM, WARN };
