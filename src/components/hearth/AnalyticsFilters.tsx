/**
 * The filter bar, shared by the owner and admin analytics pages.
 *
 * A plain GET `<form>`, server-rendered, no client JavaScript.
 *
 * That's not minimalism for its own sake. It means every view of this data has
 * a URL: an owner can bookmark "last 90 days, phone traffic only", paste it to
 * a business partner, and hit back to undo a filter. A client-state filter bar
 * has none of those properties, and the first thing anyone asks for after
 * seeing a dashboard is a way to send someone a link to what they're looking
 * at. It also works before hydration, which on a phone behind a counter is the
 * difference between instant and a second of dead controls.
 *
 * Every control is a submit-on-change-free input with one Apply button.
 * Auto-submitting selects sound convenient and aren't: changing three filters
 * would fire three round trips and land you on a page built from the first two.
 *
 * Three additions since, all of which keep the above true because they are
 * links and `<details>` rather than script:
 *
 * - **Preset chips.** The four periods anyone actually uses are one click, not
 *   a select-then-Apply. They're `<a>` elements carrying the rest of the
 *   querystring, so they compose with the filters already set.
 * - **Active-filter chips.** A filtered page and an empty period look identical
 *   when the filter is a select two rows up that you set yesterday and a
 *   bookmark restored this morning. Each chip states the filter and removes it.
 * - **The detailed controls collapse.** `<details>`, open by default only when
 *   something inside is set. Six always-visible inputs above the numbers push
 *   the headline row off a laptop screen, and the common case is changing the
 *   period and nothing else.
 */

import Link from "next/link";
import { cx, inputClass } from "@/components/hearth/ui";
import { RANGE_PRESETS, formatDateInput, type DateRange } from "@/lib/analytics-range";

export type FilterState = {
  range: DateRange;
  q: string;
  source: string;
  device: string;
  includeSimulated: boolean;
  tab: string;
};

const SOURCES = [
  { value: "", label: "All sources" },
  { value: "DIRECT", label: "Direct / app" },
  { value: "QR", label: "QR code" },
  { value: "SEARCH_ENGINE", label: "Search" },
  { value: "MAPS", label: "Maps & listings" },
  { value: "SOCIAL", label: "Social" },
  { value: "SMS", label: "Our texts" },
  { value: "REFERRAL", label: "Other sites" },
  { value: "UNKNOWN", label: "Unknown" },
];

const DEVICES = [
  { value: "", label: "All devices" },
  { value: "MOBILE", label: "Phone" },
  { value: "TABLET", label: "Tablet" },
  { value: "DESKTOP", label: "Desktop" },
];

/** The periods that carry most of the traffic. The rest stay in the select. */
const QUICK_PRESETS = ["today", "7d", "30d", "90d"] as const;

const labelOf = (list: Array<{ value: string; label: string }>, v: string) =>
  list.find((x) => x.value === v)?.label ?? v;

export default function AnalyticsFilters({
  action,
  state,
  timezone,
  /** Extra hidden fields the host page needs preserved across a submit. */
  hidden = {},
  showSimulatedToggle = true,
  searchPlaceholder = "Search items, terms, order numbers",
  /** Rendered beside the preset chips. The export link, in practice. */
  actions,
}: {
  action: string;
  state: FilterState;
  timezone: string;
  hidden?: Record<string, string>;
  showSimulatedToggle?: boolean;
  searchPlaceholder?: string;
  actions?: React.ReactNode;
}) {
  const { range } = state;

  // One place that rebuilds this bar's own querystring, used by both the preset
  // chips and the removal links. Overrides win; a key set to null is dropped,
  // which is what "remove this filter" means.
  const hrefWith = (overrides: Record<string, string | null>) => {
    const sp = new URLSearchParams();
    const base: Record<string, string> = {
      ...hidden,
      range: range.preset,
      q: state.q,
      source: state.source,
      device: state.device,
      tab: state.tab,
      ...(state.includeSimulated ? { sim: "1" } : {}),
      // The dates only mean anything on Custom; carrying them onto a preset
      // chip would make the chip resolve to a range it doesn't name.
      ...(range.preset === "custom"
        ? {
            from: formatDateInput(range.from, timezone),
            to: formatDateInput(new Date(range.to.getTime() - 86400000), timezone),
          }
        : {}),
    };
    for (const [k, v] of Object.entries({ ...base, ...overrides })) {
      if (v) sp.set(k, v);
    }
    return `${action}?${sp.toString()}`;
  };

  const chips: Array<{ key: string; label: string; href: string }> = [];
  if (state.source)
    chips.push({
      key: "source",
      label: `Source: ${labelOf(SOURCES, state.source)}`,
      href: hrefWith({ source: null }),
    });
  if (state.device)
    chips.push({
      key: "device",
      label: `Device: ${labelOf(DEVICES, state.device)}`,
      href: hrefWith({ device: null }),
    });
  if (state.q)
    chips.push({ key: "q", label: `Search: “${state.q}”`, href: hrefWith({ q: null }) });
  if (state.includeSimulated)
    chips.push({
      key: "sim",
      label: "Including seeded traffic",
      href: hrefWith({ sim: null }),
    });

  const detailsOpen = chips.length > 0 || range.preset === "custom";

  return (
    <div className="mb-4 rounded-sm border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {QUICK_PRESETS.map((key) => {
            const preset = RANGE_PRESETS.find((p) => p.key === key)!;
            const on = range.preset === key;
            return (
              <Link
                key={key}
                href={hrefWith({ range: key, from: null, to: null })}
                aria-current={on ? "true" : undefined}
                className={cx(
                  "rounded-xs px-2.5 py-1 text-[12px] transition-colors",
                  on ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2 hover:text-ink"
                )}
              >
                {preset.label.replace("Last ", "")}
              </Link>
            );
          })}
        </div>

        <span className="text-[11.5px] text-mute">
          {range.label} · {formatDateInput(range.from, timezone)} →{" "}
          {formatDateInput(new Date(range.to.getTime() - 86400000), timezone)} ·{" "}
          {timezone.replace(/_/g, " ")}
        </span>

        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
          <span className="text-[11px] text-mute">Filtered by</span>
          {chips.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="group inline-flex items-center gap-1.5 rounded-full border border-line2 px-2 py-0.5 text-[11px] text-dim hover:border-accent hover:text-ink"
              title="Remove this filter"
            >
              {c.label}
              <span className="text-mute group-hover:text-ink" aria-hidden>
                ✕
              </span>
            </Link>
          ))}
          <Link
            href={hrefWith({ source: null, device: null, q: null, sim: null })}
            className="ml-1 text-[11px] text-mute underline underline-offset-2 hover:text-ink"
          >
            Clear all
          </Link>
        </div>
      )}

      <details open={detailsOpen} className="group">
        <summary className="cursor-pointer list-none px-3 py-2 text-[12px] text-dim marker:content-none hover:text-ink">
          <span className="inline-block w-3 transition-transform group-open:rotate-90" aria-hidden>
            ›
          </span>
          Period, source, device and search
        </summary>

        <form method="GET" action={action} className="px-3 pb-3">
          {Object.entries(hidden).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          {/* The active tab rides along so changing a filter doesn't bounce you
              back to Overview from wherever you were reading. */}
          <input type="hidden" name="tab" value={state.tab} />

          <div className="flex flex-wrap items-end gap-3">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-dim">Period</span>
              <select name="range" defaultValue={range.preset} className={cx(inputClass, "w-[160px]")}>
                {RANGE_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {/* Always rendered, not toggled by the preset. A hidden pair of date
                inputs that appear only on "Custom" needs JavaScript to reveal, and
                leaving them visible also shows what the chosen preset resolved to —
                which is the fastest way to catch a timezone surprise. */}
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-dim">From</span>
              <input
                type="date"
                name="from"
                defaultValue={formatDateInput(range.from, timezone)}
                className={cx(inputClass, "w-[150px]")}
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-dim">To</span>
              <input
                type="date"
                name="to"
                // The stored end is exclusive; the input shows the last day the
                // person actually means, which is the day before it.
                defaultValue={formatDateInput(new Date(range.to.getTime() - 86400000), timezone)}
                className={cx(inputClass, "w-[150px]")}
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-dim">Source</span>
              <select name="source" defaultValue={state.source} className={cx(inputClass, "w-[150px]")}>
                {SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[11px] font-medium text-dim">Device</span>
              <select name="device" defaultValue={state.device} className={cx(inputClass, "w-[130px]")}>
                {DEVICES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block min-w-[220px] flex-1">
              <span className="mb-1.5 block text-[11px] font-medium text-dim">Search</span>
              <input
                type="search"
                name="q"
                defaultValue={state.q}
                placeholder={searchPlaceholder}
                className={cx(inputClass, "w-full")}
              />
            </label>

            <button
              type="submit"
              className="h-9 rounded-sm border border-line2 bg-surface2 px-4 text-[13px] text-ink hover:border-accent"
            >
              Apply
            </button>
          </div>

          {showSimulatedToggle && (
            <label className="mt-3 flex items-center gap-2 text-[12px] text-dim">
              <input
                type="checkbox"
                name="sim"
                value="1"
                defaultChecked={state.includeSimulated}
                className="h-3.5 w-3.5 accent-accent"
              />
              {/* Off by default and labelled with the consequence rather than the
                  mechanism. An owner reading "include simulated traffic" without
                  knowing what that means will tick it, and then wonder why their
                  conversion rate moved. */}
              Include seeded test traffic (changes every number on this page)
            </label>
          )}

          {/* Stated rather than inferred. The alternative — quietly switching to
              Custom when the dates don't match the preset — guesses at intent, and
              guesses wrong for the person who nudged a date by accident. */}
          <p className="mt-2 text-[11px] text-mute">
            The dates apply when Period is set to Custom; otherwise they show what the preset
            resolved to.
          </p>
        </form>
      </details>
    </div>
  );
}

/**
 * Re-exported from `lib/analytics-params`, where it moved when the CSV export
 * became a third reader of this querystring. The pages keep importing it from
 * here because that is where the form that writes it lives.
 */
export { readFilterParams } from "@/lib/analytics-params";
