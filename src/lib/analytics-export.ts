/**
 * Analytics as CSV.
 *
 * The rule this file exists to keep: **an export is the page, not a second
 * query.** Every dataset below calls the same function in `analytics-query.ts`
 * that renders the corresponding table or chart, with the same
 * `AnalyticsFilter` the page built from the same querystring. A hand-written
 * `findMany` here would be a second implementation of "which visits count",
 * and the first anyone would hear of the drift is an owner with a spreadsheet
 * that disagrees with their dashboard — which is exactly the failure
 * `docs/analytics.md` cites for conversion rate.
 *
 * Consequences worth stating:
 *
 * - **Simulated traffic follows the filter, not a default.** If the page you
 *   exported from was including seeded traffic, so is the file. Silently
 *   excluding it would hand someone a file that doesn't match the screen they
 *   clicked from.
 * - **Timestamps are the tenant's local time**, same as everything else here,
 *   and every export carries a header block naming the range and the zone.
 *   A CSV outlives the URL that produced it: without that block, "412 visits"
 *   in a file on someone's desktop next March has no period attached to it.
 * - **Money is a decimal string, not cents.** The rest of the codebase is
 *   integer cents for good reason, but a spreadsheet is the one consumer that
 *   will happily sum a column of cents and call it dollars.
 *
 * Tenant scoping is the caller's job and is not defaulted — `restaurantId` is
 * required for the owner datasets, and only `tenants` reads across the
 * boundary. Same shape as `lib/customers.ts`.
 */

import { toCsvRow } from "@/lib/csv";
import { bucketLabel, formatDuration } from "@/lib/analytics-range";
import {
  bySource,
  byDevice,
  dropOff,
  funnel,
  itemPerformance,
  recentVisits,
  searchTerms,
  series,
  tenantLeaderboard,
  type AnalyticsFilter,
} from "@/lib/analytics-query";

export type OwnerDataset = "items" | "visits" | "series" | "sources" | "funnel" | "searches";
export type AdminDataset = "tenants" | "series";

export const OWNER_DATASETS: Array<{ key: OwnerDataset; label: string }> = [
  { key: "series", label: "Traffic over time" },
  { key: "items", label: "Item performance" },
  { key: "visits", label: "Individual visits" },
  { key: "sources", label: "Sources and devices" },
  { key: "funnel", label: "Funnel and drop-off" },
  { key: "searches", label: "Search terms" },
];

export const ADMIN_DATASETS: Array<{ key: AdminDataset; label: string }> = [
  { key: "tenants", label: "Tenant leaderboard" },
  { key: "series", label: "Platform traffic over time" },
];

const money = (cts: number) => (cts / 100).toFixed(2);
const pct = (r: number) => (r * 100).toFixed(2);

/**
 * The provenance block every file opens with.
 *
 * Two blank-ish comment rows then the real header. Spreadsheets handle this
 * fine, and the alternative — a bare table — is a file nobody can date six
 * months later.
 */
function preamble(title: string, f: AnalyticsFilter, extra: string[] = []): string[] {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: f.timezone });
  return [
    toCsvRow([`# ${title}`]),
    toCsvRow([
      `# ${f.range.label}: ${day(f.range.from)} to ${day(new Date(f.range.to.getTime() - 86400000))} inclusive`,
    ]),
    toCsvRow([`# Times in ${f.timezone}`]),
    ...(f.source ? [toCsvRow([`# Source filter: ${f.source}`])] : []),
    ...(f.device ? [toCsvRow([`# Device filter: ${f.device}`])] : []),
    ...(f.q ? [toCsvRow([`# Search filter: ${f.q}`])] : []),
    toCsvRow([
      f.includeSimulated
        ? "# INCLUDES seeded test traffic — these numbers are not real trade"
        : "# Real traffic only",
    ]),
    ...extra.map((e) => toCsvRow([`# ${e}`])),
    "",
  ];
}

export async function ownerCsv(
  restaurantId: string,
  f: AnalyticsFilter,
  dataset: OwnerDataset
): Promise<{ body: string; filename: string }> {
  const lines: string[] = [];
  const name = (base: string) => `${base}-${stamp(f)}.csv`;

  switch (dataset) {
    case "series": {
      const points = await series(restaurantId, f);
      lines.push(...preamble("Traffic and sales over time", f));
      lines.push(toCsvRow(["Bucket", "Visits", "Orders", "Revenue", "Conversion %"]));
      for (const p of points) {
        lines.push(
          toCsvRow([
            bucketLabel(p.at, f.range.granularity, f.timezone),
            String(p.visits),
            String(p.orders),
            money(p.revenueCts),
            pct(p.conversionRate),
          ])
        );
      }
      return { body: lines.join("\n") + "\n", filename: name("traffic") };
    }

    case "items": {
      // No limit worth applying: a menu is a hundred rows, and the reason to
      // export is precisely to sort by a column the page doesn't sort by.
      const rows = await itemPerformance(restaurantId, f, 1000);
      lines.push(...preamble("Item performance", f));
      lines.push(
        toCsvRow([
          "Item",
          "Category",
          "Views",
          "Added to cart",
          "Units sold",
          "Revenue",
          "View to add %",
          "Add to order %",
        ])
      );
      for (const r of rows) {
        lines.push(
          toCsvRow([
            r.name,
            r.categoryName ?? "",
            String(r.views),
            String(r.adds),
            String(r.units),
            money(r.revenueCts),
            r.views > 0 ? pct(r.viewToAdd) : "",
            r.adds > 0 ? pct(r.addToOrder) : "",
          ])
        );
      }
      return { body: lines.join("\n") + "\n", filename: name("items") };
    }

    case "visits": {
      // Capped, deliberately. A tenant on "all time" would otherwise stream
      // every visit row they have through a request that has to finish, and
      // the honest answer is a truncation the file states rather than a
      // timeout the browser reports as a failed download.
      const CAP = 5000;
      const { rows, total } = await recentVisits(restaurantId, f, { take: CAP });
      lines.push(
        ...preamble(
          "Individual visits",
          f,
          total > rows.length
            ? [`TRUNCATED: ${total.toLocaleString()} visits matched, newest ${rows.length} exported`]
            : []
        )
      );
      lines.push(
        toCsvRow([
          "Started",
          "Source",
          "Device",
          "Time on page",
          "Actions",
          "Ordered",
          "Order number",
          "Order total",
          "Seeded",
        ])
      );
      for (const v of rows) {
        lines.push(
          toCsvRow([
            v.startedAt.toLocaleString("en-CA", { timeZone: f.timezone, hour12: false }),
            v.source,
            v.device,
            formatDuration(v.dwellMs),
            String(v.events),
            v.converted ? "yes" : "no",
            v.orderNumber ?? "",
            v.orderTotalCts != null ? money(v.orderTotalCts) : "",
            v.simulated ? "yes" : "no",
          ])
        );
      }
      return { body: lines.join("\n") + "\n", filename: name("visits") };
    }

    case "sources": {
      const [sources, devices] = await Promise.all([
        bySource(restaurantId, f),
        byDevice(restaurantId, f),
      ]);
      lines.push(...preamble("Sources and devices", f));
      lines.push(toCsvRow(["Dimension", "Value", "Visits", "Orders", "Conversion %"]));
      for (const r of sources) {
        lines.push(
          toCsvRow(["Source", r.label, String(r.visits), String(r.orders), pct(r.conversionRate)])
        );
      }
      for (const r of devices) {
        lines.push(
          toCsvRow(["Device", r.label, String(r.visits), String(r.orders), pct(r.conversionRate)])
        );
      }
      return { body: lines.join("\n") + "\n", filename: name("sources") };
    }

    case "funnel": {
      const [steps, drops] = await Promise.all([
        funnel(restaurantId, f),
        dropOff(restaurantId, f),
      ]);
      lines.push(...preamble("Funnel and drop-off", f));
      lines.push(toCsvRow(["Section", "Step", "Visits", "% of all visits", "% of previous step"]));
      for (const s of steps) {
        lines.push(
          toCsvRow(["Funnel", s.label, String(s.count), pct(s.ofTotal), pct(s.ofPrevious)])
        );
      }
      for (const d of drops) {
        lines.push(toCsvRow(["Last screen before leaving", d.view, String(d.visits), pct(d.share), ""]));
      }
      return { body: lines.join("\n") + "\n", filename: name("funnel") };
    }

    case "searches": {
      const terms = await searchTerms(restaurantId, f);
      lines.push(...preamble("Search terms", f));
      lines.push(toCsvRow(["Term", "Searches", "Visits", "Converted"]));
      for (const t of terms) {
        lines.push(toCsvRow([t.term, String(t.searches), String(t.visits), String(t.converted)]));
      }
      return { body: lines.join("\n") + "\n", filename: name("searches") };
    }
  }
}

/** Admin exports. `tenants` reads across the isolation boundary — see the header. */
export async function adminCsv(
  f: AnalyticsFilter,
  dataset: AdminDataset
): Promise<{ body: string; filename: string }> {
  const lines: string[] = [];

  if (dataset === "tenants") {
    const rows = await tenantLeaderboard(f);
    lines.push(...preamble("Tenant leaderboard", f));
    lines.push(
      toCsvRow([
        "Tenant",
        "Slug",
        "Status",
        "Visits",
        "Orders",
        "Conversion %",
        "Avg visit",
        "Gross volume",
        "Surcharge (ours)",
      ])
    );
    for (const r of rows) {
      lines.push(
        toCsvRow([
          r.name,
          r.slug,
          r.status,
          String(r.visits),
          String(r.orders),
          r.visits > 0 ? pct(r.conversionRate) : "",
          formatDuration(r.avgDwellMs),
          money(r.revenueCts),
          money(r.surchargeCts),
        ])
      );
    }
    return { body: lines.join("\n") + "\n", filename: `tenants-${stamp(f)}.csv` };
  }

  // `series` here is the platform one; the caller passes it in already summed.
  const { platformSeries } = await import("@/lib/analytics-query");
  const points = await platformSeries(f);
  lines.push(...preamble("Platform traffic and surcharge over time", f));
  lines.push(toCsvRow(["Bucket", "Visits", "Orders", "Surcharge", "Conversion %"]));
  for (const p of points) {
    lines.push(
      toCsvRow([
        bucketLabel(p.at, f.range.granularity, f.timezone),
        String(p.visits),
        String(p.orders),
        money(p.revenueCts),
        pct(p.conversionRate),
      ])
    );
  }
  return { body: lines.join("\n") + "\n", filename: `platform-traffic-${stamp(f)}.csv` };
}

/** Dates in the filename, so three downloads don't become `visits (2).csv`. */
function stamp(f: AnalyticsFilter): string {
  const day = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: f.timezone });
  return `${day(f.range.from)}_${day(new Date(f.range.to.getTime() - 86400000))}`;
}
