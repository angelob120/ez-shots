import { centsToMoney } from "@/lib/money";
import { bucketLabel, delta, formatDuration, formatPct, previousRange } from "@/lib/analytics-range";
import {
  bySource,
  funnel,
  headline,
  heatmap,
  itemPerformance,
  series,
  type AnalyticsFilter,
} from "@/lib/analytics-query";
import { Card } from "@/components/hearth/ui";
import { Funnel, Heatmap, LineChart, Metric, RankedBars } from "@/components/hearth/charts";

/**
 * One tenant's analytics, rendered identically wherever it appears.
 *
 * This body used to live inline inside `/admin/analytics`. It now has three
 * callers — that page's tenant drilldown, the Analytics tab on a tenant's
 * admin page, and (by sharing the same query functions) the owner's own
 * dashboard — which is precisely why it had to stop being inline.
 *
 * `docs/analytics.md` states the rule this enforces: **two implementations of
 * "conversion rate" is how the console tells us 4.1% while the owner's page
 * tells them 3.8%, and there is no way to win the support call that follows.**
 * A component is a weaker guarantee than a shared query function, but it stops
 * the second-order version of the same drift — same numbers, different
 * rounding, different period boundaries, different idea of which visits count.
 *
 * The timezone is resolved by the caller and passed in, because it must be the
 * *tenant's*. Reading their Tuesday in ours is how support ends up disagreeing
 * with an owner about which day was busy.
 */
export default async function TenantAnalytics({
  restaurantId,
  timezone,
  filter,
  showTimezoneNote = true,
}: {
  restaurantId: string;
  timezone: string;
  /** Must already carry the tenant's timezone — see the note above. */
  filter: AnalyticsFilter;
  showTimezoneNote?: boolean;
}) {
  // The previous period is fetched for the overlay and for the headline
  // comparisons. Support looking at this component is usually mid-call about a
  // number that moved, and "moved compared with what" was previously a
  // question they had to answer by changing the filter and losing their place.
  const prev = previousRange(filter.range);
  const prevFilter: AnalyticsFilter = {
    ...filter,
    range: { ...filter.range, from: prev.from, to: prev.to },
  };

  const [head, points, steps, sources, cells, items, prevHead, prevPoints] = await Promise.all([
    headline(restaurantId, filter),
    series(restaurantId, filter),
    funnel(restaurantId, filter),
    bySource(restaurantId, filter),
    heatmap(restaurantId, filter),
    itemPerformance(restaurantId, filter, 10),
    headline(restaurantId, prevFilter),
    series(restaurantId, prevFilter),
  ]);

  const labels = points.map((p) => bucketLabel(p.at, filter.range.granularity, timezone));

  return (
    <>
      {showTimezoneNote && (
        <p className="mb-3 text-[11.5px] text-mute">
          Reckoned in {timezone.replace(/_/g, " ")} — the kitchen&apos;s own clock, which is what the
          owner&apos;s dashboard uses.
        </p>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Visits"
          value={head.visits.toLocaleString()}
          hint={`${head.visitors} devices`}
          delta={delta(head.visits, prevHead.visits)}
          previousValue={prevHead.visits.toLocaleString()}
        />
        <Metric
          label="Orders"
          value={head.orders.toLocaleString()}
          delta={delta(head.orders, prevHead.orders)}
          previousValue={prevHead.orders.toLocaleString()}
        />
        <Metric
          label="Conversion"
          value={formatPct(head.conversionRate)}
          delta={delta(head.conversionRate, prevHead.conversionRate)}
          previousValue={formatPct(prevHead.conversionRate)}
        />
        <Metric
          label="Revenue"
          value={centsToMoney(head.revenueCts)}
          tone="accent"
          delta={delta(head.revenueCts, prevHead.revenueCts)}
          previousValue={centsToMoney(prevHead.revenueCts)}
        />
        <Metric
          label="Avg ticket"
          value={centsToMoney(head.aovCts)}
          delta={delta(head.aovCts, prevHead.aovCts)}
          previousValue={centsToMoney(prevHead.aovCts)}
        />
        <Metric
          label="Time on page"
          value={formatDuration(head.avgDwellMs)}
          delta={delta(head.avgDwellMs, prevHead.avgDwellMs)}
          previousValue={formatDuration(prevHead.avgDwellMs)}
        />
      </div>

      <Card className="mb-4">
        <LineChart
          labels={labels}
          series={[
            { label: "Visits", values: points.map((p) => p.visits), format: "count" },
            { label: "Orders", values: points.map((p) => p.orders), format: "count" },
            {
              label: "Revenue",
              values: points.map((p) => p.revenueCts),
              secondary: true,
              // Themed, not a literal — this renders on a light background too
              // now. See docs/theming.md.
              color: "rgb(var(--h-good))",
              format: "money",
            },
          ]}
          compare={[
            { label: "Visits", values: prevPoints.map((p) => p.visits), format: "count" },
            { label: "Orders", values: prevPoints.map((p) => p.orders), format: "count" },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[13px] font-medium text-ink">Funnel</h2>
          <Funnel steps={steps} />
        </Card>
        <Card>
          <h2 className="mb-3 text-[13px] font-medium text-ink">Sources</h2>
          <RankedBars rows={sources} />
        </Card>
      </div>

      <Card className="mt-4">
        <h2 className="mb-3 text-[13px] font-medium text-ink">Demand by hour</h2>
        <Heatmap cells={cells} />
      </Card>

      <Card className="mt-4">
        <h2 className="mb-3 text-[13px] font-medium text-ink">Top items</h2>
        {items.length === 0 ? (
          <p className="text-[12px] text-mute">Nothing sold in this period.</p>
        ) : (
          <ul className="m-0 list-none space-y-2 p-0 text-[12.5px]">
            {items.map((i) => (
              <li key={i.itemId} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-ink">{i.name}</span>
                <span className="shrink-0 font-mono text-dim">
                  {i.views} views · {i.units} sold · {centsToMoney(i.revenueCts)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
