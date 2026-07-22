import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { centsToMoney } from "@/lib/money";
import {
  bucketLabel,
  delta,
  formatDuration,
  formatPct,
  previousRange,
  resolveRange,
} from "@/lib/analytics-range";
import {
  PLATFORM_TZ,
  earliestActivity,
  platformHeadline,
  platformHeatmap,
  platformSeries,
  tenantLeaderboard,
  type AnalyticsFilter,
} from "@/lib/analytics-query";
import { prisma } from "@/lib/prisma";
import type { VisitDevice, VisitSource } from "@prisma/client";
import { Badge, Card, Empty, SectionTitle, Table, Td, Th, cx, inputClass } from "@/components/hearth/ui";
import { Heatmap, LineChart, Metric } from "@/components/hearth/charts";
import AnalyticsFilters, { readFilterParams } from "@/components/hearth/AnalyticsFilters";
import TenantAnalytics from "@/components/hearth/TenantAnalytics";
import ExportMenu, { exportParams } from "@/components/hearth/ExportMenu";
import { ADMIN_DATASETS, OWNER_DATASETS } from "@/lib/analytics-export";

export const dynamic = "force-dynamic";

/**
 * Platform analytics.
 *
 * The owner's page and this one look similar and answer opposite questions. An
 * owner asks "how is my restaurant doing"; we ask "which restaurants are worth
 * the cost of serving them, and is the product working the same way for all of
 * them". So the metric that leads here is **surcharge revenue**, not gross
 * volume — gross is the tenant's number, the surcharge is ours — and the
 * default view is a leaderboard rather than a chart.
 *
 * The per-tenant drilldown deliberately renders the *same* components as
 * `/dashboard/analytics` against the same query functions. Two implementations
 * of "conversion rate" is how the console ends up telling us 4.1% while the
 * owner's page tells them 3.8%, and there is no way to win the support
 * conversation that follows.
 *
 * Every query below `platformHeadline` and `tenantLeaderboard` reads across the
 * tenant boundary. That is what `requireAdmin()` at the top of this function is
 * for, and it is the only reason those functions are allowed to exist.
 */

type Tab = "platform" | "tenants" | "product";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "platform", label: "Platform" },
  { key: "tenants", label: "Tenants" },
  { key: "product", label: "Product" },
];

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requireAdmin();

  const params = readFilterParams(searchParams);
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "platform") as Tab;
  const focusId = typeof searchParams.restaurant === "string" ? searchParams.restaurant : null;

  const since = params.range === "all" ? await earliestActivity(null) : null;
  const range = resolveRange({
    preset: params.range,
    from: params.from,
    to: params.to,
    timezone: PLATFORM_TZ,
    now: new Date(),
    since,
  });

  const filter: AnalyticsFilter = {
    range,
    timezone: PLATFORM_TZ,
    q: params.q || null,
    source: (params.source || null) as VisitSource | null,
    device: (params.device || null) as VisitDevice | null,
    includeSimulated: params.includeSimulated,
  };

  const filterState = {
    range,
    q: params.q,
    source: params.source,
    device: params.device,
    includeSimulated: params.includeSimulated,
    tab,
  };

  const prev = previousRange(range);
  const prevFilter = { ...filter, range: { ...range, from: prev.from, to: prev.to } };
  const [current, previous, points, prevPoints] = await Promise.all([
    platformHeadline(filter),
    platformHeadline(prevFilter),
    platformSeries(filter),
    platformSeries(prevFilter),
  ]);

  const labels = points.map((p) => bucketLabel(p.at, range.granularity, PLATFORM_TZ));

  return (
    <>
      <SectionTitle
        title="Analytics"
        subtitle="Traffic, conversion, and what the platform actually earns from it."
        action={
          <Badge tone={params.includeSimulated ? "warn" : "neutral"}>
            {params.includeSimulated ? "Including seeded traffic" : "Real traffic only"}
          </Badge>
        }
      />


      <AnalyticsFilters
        action="/admin/analytics"
        state={filterState}
        timezone={PLATFORM_TZ}
        hidden={focusId ? { restaurant: focusId } : {}}
        searchPlaceholder="Search tenants by name or slug"
        actions={
          // On the tenant drilldown the export switches to that tenant's own
          // datasets, because a leaderboard CSV is not what anyone clicking
          // Export while reading one restaurant's funnel is asking for.
          <ExportMenu
            href="/api/analytics/csv"
            datasets={focusId ? OWNER_DATASETS : ADMIN_DATASETS}
            params={exportParams(params, focusId ? { restaurant: focusId } : {})}
          />
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Surcharge revenue"
          value={centsToMoney(current.surchargeCts)}
          hint="Ours, not the tenant's"
          tone="accent"
          delta={delta(current.surchargeCts, previous.surchargeCts)}
          previousValue={centsToMoney(previous.surchargeCts)}
          spark={points.map((p) => p.revenueCts)}
        />
        <Metric
          label="Gross volume"
          value={centsToMoney(current.grossCts)}
          hint={`${centsToMoney(current.refundedCts)} refunded`}
          delta={delta(current.grossCts, previous.grossCts)}
          previousValue={centsToMoney(previous.grossCts)}
        />
        <Metric
          label="Orders"
          value={current.orders.toLocaleString()}
          delta={delta(current.orders, previous.orders)}
          previousValue={previous.orders.toLocaleString()}
          spark={points.map((p) => p.orders)}
        />
        <Metric
          label="Visits"
          value={current.visits.toLocaleString()}
          delta={delta(current.visits, previous.visits)}
          previousValue={previous.visits.toLocaleString()}
          spark={points.map((p) => p.visits)}
        />
        <Metric
          label="Conversion"
          value={formatPct(current.conversionRate)}
          hint="Platform-wide"
          delta={delta(current.conversionRate, previous.conversionRate)}
          previousValue={formatPct(previous.conversionRate)}
        />
        <Metric
          label="Tenants trading"
          value={current.tenantsTrading.toLocaleString()}
          hint={`Avg visit ${formatDuration(current.avgDwellMs)}`}
          delta={delta(current.tenantsTrading, previous.tenantsTrading)}
          previousValue={previous.tenantsTrading.toLocaleString()}
        />
      </div>

      <Card className="mb-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium text-ink">Traffic and our cut</h2>
          <span className="text-[11px] text-mute">
            by {range.granularity === "hour" ? "hour" : range.granularity} · {PLATFORM_TZ.replace(/_/g, " ")}
          </span>
        </div>
        <LineChart
          labels={labels}
          series={[
            { label: "Visits", values: points.map((p) => p.visits), format: "count" },
            { label: "Orders", values: points.map((p) => p.orders), format: "count" },
            {
              label: "Surcharge",
              values: points.map((p) => p.revenueCts),
              secondary: true,
              color: "#5bbf7a",
              format: "money",
            },
          ]}
          compare={[
            { label: "Visits", values: prevPoints.map((p) => p.visits), format: "count" },
            { label: "Orders", values: prevPoints.map((p) => p.orders), format: "count" },
            {
              label: "Surcharge",
              values: prevPoints.map((p) => p.revenueCts),
              secondary: true,
              color: "#5bbf7a",
              format: "money",
            },
          ]}
        />
      </Card>

      <nav className="mb-4 flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={hrefFor(params, t.key, focusId)}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx(
              "rounded-sm px-3 py-1.5 text-[13px] transition-colors",
              tab === t.key ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2 hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "platform" && <PlatformTab filter={filter} />}
      {tab === "tenants" && <TenantsTab filter={filter} params={params} focusId={focusId} />}
      {tab === "product" && <ProductTab filter={filter} />}
    </>
  );
}

function hrefFor(
  params: ReturnType<typeof readFilterParams>,
  tab: string,
  restaurant: string | null
) {
  const sp = new URLSearchParams();
  if (params.range) sp.set("range", params.range);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.q) sp.set("q", params.q);
  if (params.source) sp.set("source", params.source);
  if (params.device) sp.set("device", params.device);
  if (params.includeSimulated) sp.set("sim", "1");
  if (restaurant) sp.set("restaurant", restaurant);
  sp.set("tab", tab);
  return `/admin/analytics?${sp.toString()}`;
}

// ---------------------------------------------------------------------------

async function PlatformTab({ filter }: { filter: AnalyticsFilter }) {
  const rows = await tenantLeaderboard(filter);

  const totals = rows.reduce(
    (a, r) => ({
      visits: a.visits + r.visits,
      orders: a.orders + r.orders,
      surcharge: a.surcharge + r.surchargeCts,
    }),
    { visits: 0, orders: 0, surcharge: 0 }
  );

  // Concentration, stated plainly. A platform where three tenants are most of
  // the revenue has a different risk profile from one where thirty are, and
  // that fact is invisible in every aggregate above.
  const topThree = rows.slice(0, 3).reduce((n, r) => n + r.surchargeCts, 0);
  const concentration = totals.surcharge > 0 ? topThree / totals.surcharge : 0;

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[12px] leading-relaxed text-dim">
          The top three tenants are{" "}
          <strong className="text-ink">{formatPct(concentration, 0)}</strong> of surcharge revenue in
          this period, across {rows.length} trading. Conversion below is measured per tenant, so a
          storefront that gets traffic and converts none of it is visible here before it churns.
        </p>
      </Card>

      {rows.length === 0 ? (
        <Empty title="No activity in this period" body="Widen the range, or check the filters." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Tenant</Th>
              <Th className="text-right">Visits</Th>
              <Th className="text-right">Orders</Th>
              <Th className="text-right">Conversion</Th>
              <Th className="text-right">Avg visit</Th>
              <Th className="text-right">Volume</Th>
              <Th className="text-right">Our cut</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.restaurantId}>
                <Td>
                  <Link
                    href={`/admin/restaurants/${r.restaurantId}`}
                    className="text-ink hover:text-accent"
                  >
                    {r.name}
                  </Link>
                  <span className="ml-2 text-[11px] text-mute">/r/{r.slug}</span>
                  {r.status !== "ACTIVE" && (
                    <span className="ml-2">
                      <Badge tone={r.status === "SUSPENDED" ? "bad" : "warn"}>
                        {r.status.toLowerCase()}
                      </Badge>
                    </span>
                  )}
                </Td>
                <Td className="text-right font-mono">{r.visits.toLocaleString()}</Td>
                <Td className="text-right font-mono">{r.orders.toLocaleString()}</Td>
                <Td className="text-right font-mono">
                  {r.visits > 0 ? formatPct(r.conversionRate) : "—"}
                </Td>
                <Td className="text-right font-mono">{formatDuration(r.avgDwellMs)}</Td>
                <Td className="text-right font-mono">{centsToMoney(r.revenueCts)}</Td>
                <Td className="text-right font-mono text-accent">{centsToMoney(r.surchargeCts)}</Td>
                <Td>
                  <Link
                    href={`/admin/analytics?tab=tenants&restaurant=${r.restaurantId}&range=${filter.range.preset}`}
                    className="text-[12px] text-accent underline underline-offset-2"
                  >
                    Drill in
                  </Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * One tenant, through the owner's own lens.
 *
 * Same query functions, same components as `/dashboard/analytics`. When support
 * is on the phone with an owner looking at their dashboard, the console has to
 * be showing them the same numbers — not numbers computed a second way that
 * happen to be close.
 */
async function TenantsTab({
  filter,
  params,
  focusId,
}: {
  filter: AnalyticsFilter;
  params: ReturnType<typeof readFilterParams>;
  focusId: string | null;
}) {
  const restaurants = await prisma.restaurant.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, timezone: true },
  });

  const selected = restaurants.find((r) => r.id === focusId) ?? null;

  const picker = (
    <Card className="mb-4">
      <form method="GET" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="tab" value="tenants" />
        <input type="hidden" name="range" value={params.range ?? ""} />
        {params.includeSimulated && <input type="hidden" name="sim" value="1" />}
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-medium text-dim">Tenant</span>
          <select
            name="restaurant"
            defaultValue={selected?.id ?? ""}
            className={cx(inputClass, "w-[320px]")}
          >
            <option value="">Pick a tenant…</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} (/r/{r.slug})
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="h-9 rounded-sm border border-line2 px-4 text-[13px] text-ink hover:bg-surface2"
        >
          Open
        </button>
        {selected && (
          <Link
            href={`/admin/restaurants/${selected.id}`}
            className="h-9 rounded-sm border border-line2 px-4 text-[13px] leading-9 text-ink hover:bg-surface2"
          >
            Tenant page
          </Link>
        )}
      </form>
    </Card>
  );

  if (!selected) {
    return (
      <>
        {picker}
        <Empty
          title="Pick a tenant"
          body="This shows one restaurant exactly as its owner sees it — same queries, same numbers."
        />
      </>
    );
  }

  // Re-resolved in the *tenant's* timezone. Reading their Tuesday in ours is
  // how support ends up disagreeing with an owner about which day was busy.
  const tenantFilter: AnalyticsFilter = { ...filter, timezone: selected.timezone };

  return (
    <>
      {picker}
      {/* The same component the tenant's own admin page renders. Extracted
          from this file when that tab was added — see its header. */}
      <TenantAnalytics
        restaurantId={selected.id}
        timezone={selected.timezone}
        filter={tenantFilter}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The storefront as a product, aggregated across every tenant.
 *
 * This is the tab that answers questions no single restaurant can. If the
 * checkout step loses a fifth of its traffic at *every* tenant, that is not
 * thirty restaurants with a menu problem — it is our checkout, and it is worth
 * more than any individual tenant's conversion rate.
 */
async function ProductTab({ filter }: { filter: AnalyticsFilter }) {
  const [rows, cells] = await Promise.all([
    tenantLeaderboard(filter),
    // Platform-wide demand shape. Reckoned in the platform timezone, which is
    // wrong for any individual tenant and right for the aggregate — the
    // alternative is summing seven different local clocks into one grid.
    platformHeatmap(filter),
  ]);

  const trading = rows.filter((r) => r.visits > 20);
  const median = medianOf(trading.map((r) => r.conversionRate));
  const best = [...trading].sort((a, b) => b.conversionRate - a.conversionRate).slice(0, 5);
  const worst = [...trading].sort((a, b) => a.conversionRate - b.conversionRate).slice(0, 5);

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[12px] leading-relaxed text-dim">
          Median tenant conversion is <strong className="text-ink">{formatPct(median)}</strong> across{" "}
          {trading.length} storefronts with meaningful traffic. Tenants below twenty visits are left
          out — a restaurant with three visits and one order converts at 33% and tells us nothing.
        </p>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-1 text-[13px] font-medium text-ink">Converting best</h2>
          <p className="mb-3 text-[11.5px] text-mute">Worth understanding — these are the template.</p>
          <ConversionList rows={best} />
        </Card>
        <Card>
          <h2 className="mb-1 text-[13px] font-medium text-ink">Converting worst</h2>
          <p className="mb-3 text-[11.5px] text-mute">
            Traffic arriving and leaving. Usually a menu with no photos or a kitchen marked closed.
          </p>
          <ConversionList rows={worst} />
        </Card>
      </div>

      <Card>
        <h2 className="mb-1 text-[13px] font-medium text-ink">When the platform is busy</h2>
        <p className="mb-4 text-[11.5px] text-mute">
          All tenants, {PLATFORM_TZ.replace(/_/g, " ")}. This is the shape that decides when a deploy
          is cheap and when the sweep cron competes with a dinner rush.
        </p>
        {/* Conversion is off here on purpose. A cross-tenant rate for 7pm
            Friday averages a dozen storefronts with different menus, prices
            and catchments — it computes, and it means nothing anyone can act
            on. Per-tenant conversion lives on the drilldown, where it does. */}
        <Heatmap cells={cells} conversionAvailable={false} />
      </Card>
    </div>
  );
}

function ConversionList({ rows }: { rows: Array<{ restaurantId: string; name: string; visits: number; conversionRate: number }> }) {
  if (!rows.length) return <p className="text-[12px] text-mute">Not enough traffic to rank yet.</p>;
  return (
    <ul className="m-0 list-none space-y-2 p-0 text-[12.5px]">
      {rows.map((r) => (
        <li key={r.restaurantId} className="flex items-baseline justify-between gap-3">
          <Link href={`/admin/restaurants/${r.restaurantId}`} className="truncate text-ink hover:text-accent">
            {r.name}
          </Link>
          <span className="shrink-0 font-mono text-dim">
            {formatPct(r.conversionRate)}
            <span className="ml-2 text-mute">{r.visits.toLocaleString()} visits</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Median, not mean: one enormous tenant would otherwise define the "typical" one. */
function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

