"use client";

/**
 * The interactive half of the charts.
 *
 * `charts.tsx` opens by justifying zero client JavaScript, and that reasoning
 * still holds for the shapes that live there — `Funnel`, `RankedBars`,
 * `Sparkline` and `Metric` are static markup and stay static markup. What
 * changed is the judgement about the two charts where a static reading was
 * genuinely losing information:
 *
 * - **The line chart.** A native `<title>` tooltip needs a hover held for
 *   ~1s, shows one series at a time depending on which element the cursor
 *   found, and never appears at all on a touchscreen. On a 90-day chart the
 *   points are drawn at r=0 precisely because there are too many of them, so
 *   the only remaining hover target was the invisible column band — meaning
 *   the exact numbers were reachable in theory and unreachable in practice.
 * - **The heatmap.** Visits and orders are two different pictures of a week and
 *   the component could only draw one per render, so seeing both meant two
 *   round trips through a page that runs a dozen queries.
 *
 * The cost is bounded on purpose. No charting library — same reasoning as
 * before, and a dependency would be far larger than this file. These two
 * components are the only client components on either analytics page, so the
 * JavaScript ships on `/dashboard/analytics` and `/admin/analytics` and nowhere
 * else. Both render their full markup on the server first: the axes, the lines
 * and every cell are in the initial HTML, and hydration adds the crosshair and
 * the tooltip. A reader who never moves a cursor, or whose JS fails, sees the
 * same chart they saw before this file existed — including the `<title>`
 * elements, which are kept rather than replaced so the screen-reader path is
 * untouched.
 *
 * **Formatters are keys, not functions.** A server component cannot pass a
 * function across the boundary, so `SeriesDef.format` is `"count" | "money" |
 * "pct"` and resolves here. That's the one prop shape that had to change, and
 * it's why the change reached every call site.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { centsToMoney } from "@/lib/money";

// Same literals as charts.tsx. They're duplicated rather than imported because
// importing from a server module into a client one drags the whole module into
// the client bundle; these are seven strings.
const MUTE = "rgb(var(--h-mute))";
const LINE = "rgb(var(--h-line))";
const ACCENT = "rgb(var(--h-accent))";
const ACCENT_DIM = "rgb(var(--h-accent-dim))";
const WARN = "rgb(var(--h-warn))";

export type FormatKey = "count" | "money" | "pct";

export function applyFormat(v: number, key: FormatKey | undefined): string {
  if (key === "money") return centsToMoney(Math.round(v));
  if (key === "pct") return `${(v * 100).toFixed(1)}%`;
  return Math.round(v).toLocaleString();
}

export type ClientSeriesDef = {
  label: string;
  color?: string;
  values: number[];
  /** Renders on the right-hand scale. Used for money beside counts. */
  secondary?: boolean;
  format?: FormatKey;
};

/** The same series over the period immediately before this one. */
export type CompareDef = {
  label: string;
  values: number[];
  color?: string;
  secondary?: boolean;
  format?: FormatKey;
};

// ---------------------------------------------------------------------------
// Line chart
// ---------------------------------------------------------------------------

/**
 * Two independently-scaled series over shared x labels, with a crosshair.
 *
 * Twin axes are usually a way to imply a correlation that isn't there, and
 * they're used deliberately here for the one pairing where the comparison is
 * the point: visits against orders. Those two quantities differ by an order of
 * magnitude at every restaurant, so a single scale flattens orders into the
 * axis and hides the only line an owner cares about.
 *
 * Three interactions, each earning its bytes:
 *
 * - **The crosshair reads a whole column at once.** Every series at that bucket
 *   in one tooltip, which is the comparison the chart exists to support. A
 *   per-element tooltip forces the reader to hover three things and hold the
 *   first two in their head.
 * - **The legend toggles a series off.** Revenue on the right-hand axis is the
 *   line most often in the way; hiding it rescales nothing (the axes are
 *   independent) but uncovers what's underneath.
 * - **Arrow keys move the crosshair.** The chart is focusable and announces the
 *   hovered bucket through a live region, so the numbers are reachable without
 *   a pointer. This is the part that replaces `<title>` rather than duplicating
 *   it — though the `<title>` elements stay for the no-JS case.
 *
 * `compare` draws the previous period dashed and unfilled. It is deliberately
 * aligned by *index* rather than by date: the previous range is the same
 * length by construction (`previousRange`), so bucket 3 against bucket 3 is
 * last Wednesday against this Wednesday. Aligning by timestamp would put them
 * side by side on the x axis instead of on top of each other, which answers a
 * different question.
 */
export function InteractiveLineChart({
  labels,
  series,
  compare,
  height = 240,
  title,
}: {
  labels: string[];
  series: ClientSeriesDef[];
  compare?: CompareDef[];
  height?: number;
  title?: string;
}) {
  const w = 900;
  const h = height;
  const pad = { top: 16, right: 56, bottom: 28, left: 56 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;
  const n = Math.max(labels.length, 1);

  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const visible = series.filter((s) => !hidden[s.label]);

  // Scales use the *visible* series only, so hiding the tall line actually
  // makes the short one readable — the whole point of the toggle. Compare
  // values participate too, or last period's spike would run off the top.
  const { maxPrimary, maxSecondary } = useMemo(() => {
    const pick = (secondary: boolean) => {
      const a = visible.filter((s) => !!s.secondary === secondary).flatMap((s) => s.values);
      const b = (compare ?? [])
        .filter((c) => !!c.secondary === secondary && !hidden[c.label])
        .flatMap((c) => c.values);
      // Never scale to zero: a flat series at 0 would divide by nothing, and a
      // single-point max would draw a line pinned to the ceiling.
      return Math.max(1, ...a, ...b);
    };
    return { maxPrimary: pick(false), maxSecondary: pick(true) };
  }, [visible, compare, hidden]);

  const y = useCallback(
    (v: number, secondary: boolean) =>
      pad.top + plotH - (v / (secondary ? maxSecondary : maxPrimary)) * plotH,
    [maxPrimary, maxSecondary, pad.top, plotH]
  );
  const x = useCallback(
    (i: number) => pad.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW),
    [n, pad.left, plotW]
  );

  const indexFromClientX = useCallback(
    (clientX: number) => {
      const el = svgRef.current;
      if (!el) return null;
      const box = el.getBoundingClientRect();
      if (box.width === 0) return null;
      // The SVG scales to its container, so client pixels have to be pulled
      // back into viewBox units before the x() inverse means anything.
      const userX = ((clientX - box.left) / box.width) * w;
      const t = n === 1 ? 0 : ((userX - pad.left) / plotW) * (n - 1);
      return Math.max(0, Math.min(n - 1, Math.round(t)));
    },
    [n, pad.left, plotW]
  );

  // Escape unpins, matching every other dismissible thing in the product.
  useEffect(() => {
    if (!pinned) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPinned(false);
        setActive(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinned]);

  const empty = !labels.length || series.every((s) => s.values.every((v) => v === 0));
  if (empty) {
    return (
      <div
        className="grid place-items-center rounded-sm border border-dashed border-line text-[12px] text-mute"
        style={{ height }}
      >
        No traffic in this period yet.
      </div>
    );
  }

  // Show at most eight x labels however long the range is. A 90-day chart with
  // every date printed is a grey smear where an axis should be.
  const labelStep = Math.max(1, Math.ceil(n / 8));
  const colorFor = (s: { label: string; color?: string }, i: number) =>
    s.color ?? (i === 0 ? ACCENT : i === 1 ? WARN : ACCENT_DIM);

  const tooltipLeftPct = active == null ? 0 : (x(active) / w) * 100;
  const flip = tooltipLeftPct > 62;

  return (
    <figure className="m-0">
      {title && <figcaption className="mb-2 text-[12px] text-dim">{title}</figcaption>}

      <div ref={wrapRef} className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${w} ${h}`}
          className="w-full touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-accent"
          role="img"
          aria-label={title ?? "Traffic chart"}
          tabIndex={0}
          onPointerMove={(e) => {
            if (pinned) return;
            setActive(indexFromClientX(e.clientX));
          }}
          onPointerLeave={() => {
            if (!pinned) setActive(null);
          }}
          onPointerDown={(e) => {
            // Tap to pin on a touchscreen, where there is no hover at all and
            // a tooltip that vanishes with the finger is unreadable.
            const i = indexFromClientX(e.clientX);
            setActive(i);
            setPinned((p) => !p || i !== active);
          }}
          onFocus={() => setActive((a) => a ?? n - 1)}
          onBlur={() => {
            if (!pinned) setActive(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              const step = e.key === "ArrowRight" ? 1 : -1;
              setActive((a) => Math.max(0, Math.min(n - 1, (a ?? n - 1) + step)));
            } else if (e.key === "Home") {
              e.preventDefault();
              setActive(0);
            } else if (e.key === "End") {
              e.preventDefault();
              setActive(n - 1);
            }
          }}
        >
          <defs>
            {/* A gradient rather than a flat 10% fill. The shape under the line
                is what the eye compares week to week, and a fade keeps it
                legible where it overlaps the gridlines near the axis. */}
            {series.map((s, si) => (
              <linearGradient
                key={s.label}
                id={`fill-${slug(s.label)}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={colorFor(s, si)} stopOpacity={0.28} />
                <stop offset="100%" stopColor={colorFor(s, si)} stopOpacity={0.02} />
              </linearGradient>
            ))}
          </defs>

          {/* Gridlines. Four is enough to read a value off and few enough not to
              compete with the data. */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <line
              key={t}
              x1={pad.left}
              x2={w - pad.right}
              y1={pad.top + plotH * t}
              y2={pad.top + plotH * t}
              stroke={LINE}
              strokeWidth={1}
              strokeDasharray={t === 1 ? undefined : "3 4"}
            />
          ))}

          {[0, 0.5, 1].map((t) => (
            <text
              key={`yl-${t}`}
              x={pad.left - 10}
              y={pad.top + plotH * t + 4}
              textAnchor="end"
              fontSize={10}
              fill={MUTE}
            >
              {niceTick(maxPrimary * (1 - t))}
            </text>
          ))}

          {visible.some((s) => s.secondary) &&
            [0, 0.5, 1].map((t) => {
              const fmt = visible.find((s) => s.secondary)?.format;
              return (
                <text
                  key={`yr-${t}`}
                  x={w - pad.right + 10}
                  y={pad.top + plotH * t + 4}
                  fontSize={10}
                  fill={MUTE}
                >
                  {fmt ? applyFormat(maxSecondary * (1 - t), fmt) : niceTick(maxSecondary * (1 - t))}
                </text>
              );
            })}

          {/* Previous period first, so it sits behind the current one. */}
          {(compare ?? []).map((c, ci) => {
            if (hidden[c.label]) return null;
            const pts = c.values
              .map((v, i) => `${x(i)},${y(v, !!c.secondary)}`)
              .join(" ");
            return (
              <polyline
                key={`cmp-${c.label}`}
                points={pts}
                fill="none"
                stroke={c.color ?? colorFor(c, ci)}
                strokeWidth={1.5}
                strokeDasharray="4 4"
                opacity={0.45}
                strokeLinejoin="round"
              />
            );
          })}

          {series.map((s, si) => {
            if (hidden[s.label]) return null;
            const color = colorFor(s, si);
            const points = s.values.map((v, i) => `${x(i)},${y(v, !!s.secondary)}`).join(" ");
            return (
              <g key={s.label}>
                {!s.secondary && (
                  <polygon
                    points={`${pad.left},${pad.top + plotH} ${points} ${x(s.values.length - 1)},${pad.top + plotH}`}
                    fill={`url(#fill-${slug(s.label)})`}
                  />
                )}
                <polyline
                  points={points}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
                {s.values.map((v, i) => (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(v, !!s.secondary)}
                    r={active === i ? 4 : n > 40 ? 0 : 2.5}
                    fill={color}
                  >
                    {/* Kept for the no-JS and screen-reader paths. */}
                    <title>{`${labels[i]} — ${s.label}: ${applyFormat(v, s.format)}`}</title>
                  </circle>
                ))}
              </g>
            );
          })}

          {active != null && (
            <line
              x1={x(active)}
              x2={x(active)}
              y1={pad.top}
              y2={pad.top + plotH}
              stroke={ACCENT}
              strokeWidth={1}
              opacity={0.5}
            />
          )}

          {labels.map((label, i) =>
            i % labelStep === 0 || i === active ? (
              <text
                key={`x-${i}`}
                x={x(i)}
                y={h - 8}
                textAnchor="middle"
                fontSize={10}
                fill={i === active ? "rgb(var(--h-ink))" : MUTE}
                fontWeight={i === active ? 600 : 400}
              >
                {label}
              </text>
            ) : null
          )}
        </svg>

        {active != null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-[150px] rounded-sm border border-line2 bg-surface px-2.5 py-2 shadow-lg"
            style={
              flip
                ? { right: `${100 - tooltipLeftPct}%`, marginRight: 10 }
                : { left: `${tooltipLeftPct}%`, marginLeft: 10 }
            }
          >
            <div className="mb-1.5 text-[11px] font-medium text-ink">{labels[active]}</div>
            <ul className="m-0 list-none space-y-1 p-0">
              {series.map((s, si) =>
                hidden[s.label] ? null : (
                  <li key={s.label} className="flex items-center gap-2 text-[11.5px]">
                    <span
                      className="inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: colorFor(s, si) }}
                    />
                    <span className="text-dim">{s.label}</span>
                    <span className="ml-auto font-mono tabular-nums text-ink">
                      {applyFormat(s.values[active] ?? 0, s.format)}
                    </span>
                  </li>
                )
              )}
              {(compare ?? []).map((c) =>
                hidden[c.label] ? null : (
                  <li
                    key={`t-${c.label}`}
                    className="flex items-center gap-2 border-t border-line pt-1 text-[11px]"
                  >
                    <span className="inline-block h-0 w-2 shrink-0 border-t border-dashed border-line2" />
                    <span className="text-mute">{c.label}</span>
                    <span className="ml-auto font-mono tabular-nums text-mute">
                      {applyFormat(c.values[active] ?? 0, c.format)}
                    </span>
                  </li>
                )
              )}
            </ul>
            {pinned && <div className="mt-1.5 text-[10px] text-mute">Pinned · Esc to release</div>}
          </div>
        )}
      </div>

      {/* Announces the hovered bucket for a screen reader driving the chart
          with arrow keys. Polite, so it doesn't interrupt on every pixel of a
          pointer sweep. */}
      <p className="sr-only" aria-live="polite">
        {active == null
          ? ""
          : `${labels[active]}: ${series
              .filter((s) => !hidden[s.label])
              .map((s) => `${s.label} ${applyFormat(s.values[active] ?? 0, s.format)}`)
              .join(", ")}`}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {series.map((s, si) => {
          const off = !!hidden[s.label];
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setHidden((prev) => ({ ...prev, [s.label]: !prev[s.label] }))}
              aria-pressed={!off}
              className="flex items-center gap-1.5 rounded-xs px-1.5 py-1 text-[11px] text-dim transition-colors hover:bg-surface2 hover:text-ink"
              title={off ? `Show ${s.label}` : `Hide ${s.label}`}
            >
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ background: colorFor(s, si), opacity: off ? 0.25 : 1 }}
              />
              <span className={off ? "line-through opacity-50" : undefined}>{s.label}</span>
            </button>
          );
        })}
        {compare && compare.length > 0 && (
          <span className="ml-1 flex items-center gap-1.5 text-[11px] text-mute">
            <span className="inline-block h-0 w-3 border-t border-dashed border-line2" />
            previous period
          </span>
        )}
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * Demand by hour of the week, with the metric switchable in place.
 *
 * Scaled against the busiest single cell rather than a fixed ceiling, because
 * the question this answers is relative — "when, compared to the rest of my
 * week" — and an absolute scale would render a quiet restaurant's entire week
 * as one flat colour. The rescale on switching metric is therefore correct and
 * not a bug: the busiest hour for orders is often not the busiest for traffic,
 * and that gap is the finding.
 *
 * Hours with no trade at all are drawn as an empty outline rather than the
 * palest shade of the scale. A restaurant that is shut at 4am and a restaurant
 * that is open and dead at 4am are different facts, and one of them is worth
 * acting on.
 *
 * The metric lives in component state rather than the querystring, unlike every
 * filter on the page. It has to: the cells for both metrics are already in this
 * component's props, so a round trip would re-run a dozen queries to render
 * data the browser is holding.
 */
export function InteractiveHeatmap({
  cells,
  defaultMetric = "visits",
  conversionAvailable = true,
}: {
  cells: Array<{ day: number; hour: number; visits: number; orders: number }>;
  defaultMetric?: "visits" | "orders" | "conversion";
  /** Off for the platform grid, where a cross-tenant rate isn't meaningful. */
  conversionAvailable?: boolean;
}) {
  const [metric, setMetric] = useState<"visits" | "orders" | "conversion">(defaultMetric);
  const [hover, setHover] = useState<{ day: number; hour: number } | null>(null);

  const value = useCallback(
    (c: { visits: number; orders: number }) => {
      if (metric === "orders") return c.orders;
      if (metric === "conversion") return c.visits > 0 ? c.orders / c.visits : 0;
      return c.visits;
    },
    [metric]
  );

  const byKey = useMemo(
    () => new Map(cells.map((c) => [c.day * 24 + c.hour, c])),
    [cells]
  );

  // Conversion is a rate, so a single order against a single visit reads 100%
  // and defines the scale for the whole grid. Cells below a floor of five
  // visits are drawn as "no data" rather than as a colour, for the same reason
  // the product tab drops tenants under twenty visits.
  const MIN_VISITS_FOR_RATE = 5;
  const eligible = (c: { visits: number; orders: number }) =>
    metric !== "conversion" || c.visits >= MIN_VISITS_FOR_RATE;

  const max = Math.max(
    metric === "conversion" ? 0.01 : 1,
    ...cells.filter(eligible).map(value)
  );

  const hovered = hover ? byKey.get(hover.day * 24 + hover.hour) : null;

  const METRICS: Array<{ key: "visits" | "orders" | "conversion"; label: string }> = [
    { key: "visits", label: "Visits" },
    { key: "orders", label: "Orders" },
    ...(conversionAvailable
      ? ([{ key: "conversion" as const, label: "Conversion" }])
      : []),
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex rounded-sm border border-line p-0.5">
          {METRICS.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMetric(m.key)}
              aria-pressed={metric === m.key}
              className={
                metric === m.key
                  ? "rounded-xs bg-surface2 px-2.5 py-1 text-[11.5px] text-ink"
                  : "rounded-xs px-2.5 py-1 text-[11.5px] text-dim hover:text-ink"
              }
            >
              {m.label}
            </button>
          ))}
        </div>

        <div
          className="ml-auto flex items-center gap-1.5 text-[10.5px] text-mute"
          aria-hidden
        >
          quiet
          {[0.12, 0.35, 0.58, 0.8, 1].map((o) => (
            <span
              key={o}
              className="inline-block h-3 w-3 rounded-[2px]"
              style={{ background: ACCENT, opacity: o }}
            />
          ))}
          busy
        </div>
      </div>

      <div className="relative overflow-x-auto">
        <table
          className="border-separate border-spacing-[2px]"
          onPointerLeave={() => setHover(null)}
        >
          <tbody>
            {DOW.map((label, d) => (
              <tr key={label}>
                <th
                  className={
                    hover?.day === d
                      ? "pr-2 text-right align-middle text-[10px] font-normal text-ink"
                      : "pr-2 text-right align-middle text-[10px] font-normal text-mute"
                  }
                >
                  {label}
                </th>
                {Array.from({ length: 24 }, (_, hh) => {
                  const cell = byKey.get(d * 24 + hh);
                  const ok = cell ? eligible(cell) : false;
                  const v = cell && ok ? value(cell) : 0;
                  const intensity = v / max;
                  const isHover = hover?.day === d && hover?.hour === hh;
                  const dim =
                    hover != null && !isHover && hover.day !== d && hover.hour !== hh;
                  return (
                    <td key={hh} className="p-0">
                      <div
                        onPointerEnter={() => setHover({ day: d, hour: hh })}
                        className="h-5 w-5 rounded-[3px] transition-opacity"
                        style={
                          !cell || v === 0
                            ? {
                                border: `1px solid ${LINE}`,
                                opacity: dim ? 0.4 : 1,
                                outline: isHover ? `1px solid ${ACCENT}` : undefined,
                              }
                            : {
                                // Floored at 0.12 so a single visit is visible.
                                // An hour with one order and an hour with none
                                // must not look the same.
                                background: ACCENT,
                                opacity: (0.12 + intensity * 0.88) * (dim ? 0.45 : 1),
                                outline: isHover ? `1px solid ${ACCENT}` : undefined,
                                outlineOffset: isHover ? 1 : undefined,
                              }
                        }
                        title={`${label} ${formatHour(hh)} — ${cell?.visits ?? 0} visits, ${cell?.orders ?? 0} orders`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td />
              {Array.from({ length: 24 }, (_, hh) => (
                <td
                  key={hh}
                  className={
                    hover?.hour === hh
                      ? "pt-1 text-center text-[9px] text-ink"
                      : "pt-1 text-center text-[9px] text-mute"
                  }
                >
                  {hh % 3 === 0 || hover?.hour === hh ? formatHour(hh) : ""}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      {/* Below the grid rather than floating over it. A tooltip that follows
          the cursor across a 24-column table spends half its life covering the
          cells either side of the one being read. */}
      <div className="mt-2 min-h-[18px] text-[11.5px]" aria-live="polite">
        {hover ? (
          <span className="text-dim">
            <strong className="text-ink">
              {DOW[hover.day]} {formatHour(hover.hour)}
            </strong>
            {" · "}
            {(hovered?.visits ?? 0).toLocaleString()} visits
            {" · "}
            {(hovered?.orders ?? 0).toLocaleString()} orders
            {hovered && hovered.visits >= MIN_VISITS_FOR_RATE && (
              <>
                {" · "}
                {((hovered.orders / hovered.visits) * 100).toFixed(1)}% converted
              </>
            )}
          </span>
        ) : (
          <span className="text-mute">
            Hover an hour for its numbers.
            {metric === "conversion" &&
              ` Hours under ${MIN_VISITS_FOR_RATE} visits are left blank — a rate off two visits isn't one.`}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  return h < 12 ? `${h}a` : `${h - 12}p`;
}

/** Axis ticks, shortened. "12.4k" is readable at 10px; "12403" is a smudge. */
function niceTick(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v));
}

/** Series labels become SVG gradient ids, which can't contain spaces. */
function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}
