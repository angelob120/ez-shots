/**
 * The export dropdown.
 *
 * A `<details>` element, not a client component. It carries the page's entire
 * filter querystring into each link, so the file you get is the view you were
 * looking at — which is the only version of an export anyone wants, and the
 * reason `lib/analytics-export.ts` calls the same query functions the page
 * does.
 *
 * `<details>` is the right primitive here for the same reason the filter bar is
 * a GET form: it opens before hydration, it closes on Escape, and it is
 * keyboard-operable without a line of script. The one thing it doesn't do is
 * close when you click elsewhere on the page. That's an acceptable trade for a
 * menu whose every item navigates away.
 */

import Link from "next/link";

export default function ExportMenu({
  href,
  datasets,
  params,
  label = "Export CSV",
}: {
  /** The endpoint. `dataset` is appended per item. */
  href: string;
  datasets: Array<{ key: string; label: string }>;
  /** The filter querystring to carry, already stringified without `dataset`. */
  params: string;
  label?: string;
}) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim marker:content-none hover:border-accent hover:text-ink">
        {label} ▾
      </summary>
      <div className="absolute right-0 z-20 mt-1 min-w-[220px] rounded-sm border border-line2 bg-surface p-1 shadow-lg">
        {datasets.map((d) => (
          <Link
            key={d.key}
            href={`${href}?${params}${params ? "&" : ""}dataset=${d.key}`}
            prefetch={false}
            className="block rounded-xs px-2.5 py-1.5 text-[12px] text-dim hover:bg-surface2 hover:text-ink"
          >
            {d.label}
          </Link>
        ))}
        <p className="mt-1 border-t border-line px-2.5 pb-1 pt-1.5 text-[10.5px] text-mute">
          Files carry the filters and period shown above.
        </p>
      </div>
    </details>
  );
}

/** The filter querystring, minus anything the export endpoint decides itself. */
export function exportParams(
  params: {
    range: string | null;
    from: string | null;
    to: string | null;
    q: string;
    source: string;
    device: string;
    includeSimulated: boolean;
  },
  extra: Record<string, string> = {}
): string {
  const sp = new URLSearchParams();
  if (params.range) sp.set("range", params.range);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.q) sp.set("q", params.q);
  if (params.source) sp.set("source", params.source);
  if (params.device) sp.set("device", params.device);
  if (params.includeSimulated) sp.set("sim", "1");
  for (const [k, v] of Object.entries(extra)) if (v) sp.set(k, v);
  return sp.toString();
}
