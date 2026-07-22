import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
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
  byDevice,
  bySource,
  dropOff,
  earliestActivity,
  funnel,
  headlineWithComparison,
  heatmap,
  itemPerformance,
  recentVisits,
  searchTerms,
  series,
  visitTimeline,
  type AnalyticsFilter,
} from "@/lib/analytics-query";
import type { VisitDevice, VisitSource } from "@prisma/client";
import {
  Badge,
  Card,
  Empty,
  SectionTitle,
  Table,
  Td,
  Th,
  cx,
} from "@/components/hearth/ui";
import { Funnel, Heatmap, LineChart, Metric, RankedBars } from "@/components/hearth/charts";
import AnalyticsFilters, { readFilterParams } from "@/components/hearth/AnalyticsFilters";
import ExportMenu, { exportParams } from "@/components/hearth/ExportMenu";
import { OWNER_DATASETS } from "@/lib/analytics-export";

export const dynamic = "force-dynamic";

/**
 * The owner's analytics.
 *
 * Two principles decided the layout, and both are about trust rather than
 * information density.
 *
 * **The headline row answers "how am I doing" before anything else loads
 * visually.** Six numbers, each with the same period before it. An owner who
 * has to assemble that comparison themselves from two chart readings will do it
 * wrong, and then stop opening the page.
 *
 * **Everything below the fold answers "why".** The funnel, the item table, the
 * search terms, the drop-off — each one exists to explain a movement in the row
 * above it. Nothing is here because it was easy to compute: the deliberate
 * omissions include scroll depth (interesting, never actionable for a menu that
 * fits on two screens) and a session replay (which would need recording things
 * this product has no business recording).
 *
 * Tenant isolation: `restaurantId` comes from `requireOwner()` and is passed to
 * every query. Nothing on this page reads a restaurant id from the URL.
 */

type Tab = "overview" | "traffic" | "items" | "behavior" | "visits";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "traffic", label: "Traffic" },
  { key: "items", label: "Items" },
  { key: "behavior", label: "Behaviour" },
  { key: "visits", label: "Visits" },
];

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { restaurantId } = await requireOwner();
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true, slug: true, timezone: true, surchargeLabel: true },
  });
  if (!restaurant) notFound();

  const params = readFilterParams(searchParams);
  const tab = (TABS.find((t) => t.key === params.tab)?.key ?? "overview") as Tab;
  const timezone = restaurant.timezone;

  const since = params.range === "all" ? await earliestActivity(restaurantId) : null;
  const range = resolveRange({
    preset: params.range,
    from: params.from,
    to: params.to,
    timezone,
    now: new Date(),
    since,
  });

  const filter: AnalyticsFilter = {
    range,
    timezone,
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

  // Headline and the chart load on every tab: they're the context the rest of
  // the page is read against, and a tab that changed the numbers at the top
  // would make each tab look like a different business.
  //
  // The previous period's series is a third query rather than a second pass
  // over the first, and it's worth the round trip: the headline row already
  // states *that* visits fell 12%, and the only follow-up question is whether
  // they fell on one bad Saturday or every day of the week. That is a shape
  // comparison and nothing but an overlay answers it.
  const prev = previousRange(range);
  const [{ current, previous }, points, prevPoints] = await Promise.all([
    headlineWithComparison(restaurantId, filter),
    series(restaurantId, filter),
    series(restaurantId, { ...filter, range: { ...range, from: prev.from, to: prev.to } }),
  ]);

  const labels = points.map((p) => bucketLabel(p.at, range.granularity, timezone));

  return (
    <>
      <SectionTitle
        title="Analytics"
        subtitle="Who came, what they looked at, and what it turned into."
        action={
          <Link
            href={`/r/${restaurant.slug}`}
            target="_blank"
            className="rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim hover:text-ink"
          >
            View storefront
          </Link>
        }
      />

      <AnalyticsFilters
        action="/dashboard/analytics"
        state={filterState}
        timezone={timezone}
        actions={
          <ExportMenu
            href="/api/analytics/csv"
            datasets={OWNER_DATASETS}
            params={exportParams(params)}
          />
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Metric
          label="Visits"
          value={current.visits.toLocaleString()}
          hint={`${current.visitors.toLocaleString()} distinct devices`}
          delta={delta(current.visits, previous.visits)}
          previousValue={previous.visits.toLocaleString()}
          spark={points.map((p) => p.visits)}
        />
        <Metric
          label="Orders"
          value={current.orders.toLocaleString()}
          hint={`${current.newCustomers} new · ${current.returningCustomers} returning`}
          delta={delta(current.orders, previous.orders)}
          previousValue={previous.orders.toLocaleString()}
          spark={points.map((p) => p.orders)}
        />
        <Metric
          label="Conversion"
          value={formatPct(current.conversionRate)}
          hint="Visits that ended in an order"
          delta={delta(current.conversionRate, previous.conversionRate)}
          previousValue={formatPct(previous.conversionRate)}
        />
        <Metric
          label="Revenue"
          value={centsToMoney(current.revenueCts)}
          hint="Net of refunds"
          tone="accent"
          delta={delta(current.revenueCts, previous.revenueCts)}
          previousValue={centsToMoney(previous.revenueCts)}
          spark={points.map((p) => p.revenueCts)}
        />
        <Metric
          label="Average ticket"
          value={centsToMoney(current.aovCts)}
          hint={`${restaurant.surchargeLabel}: ${centsToMoney(current.surchargeCts)}`}
          delta={delta(current.aovCts, previous.aovCts)}
          previousValue={centsToMoney(previous.aovCts)}
        />
        <Metric
          label="Time on page"
          value={formatDuration(current.avgDwellMs)}
          hint={`${formatPct(current.bounceRate)} left without browsing`}
          delta={delta(current.avgDwellMs, previous.avgDwellMs)}
          previousValue={formatDuration(previous.avgDwellMs)}
        />
      </div>

      <Card className="mb-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-[13px] font-medium text-ink">Traffic and sales</h2>
          <span className="text-[11px] text-mute">
            by {range.granularity === "hour" ? "hour" : range.granularity} · hover or use arrow keys
          </span>
        </div>
        <LineChart
          labels={labels}
          series={[
            { label: "Visits", values: points.map((p) => p.visits), format: "count" },
            { label: "Orders", values: points.map((p) => p.orders), format: "count" },
            {
              label: "Revenue",
              values: points.map((p) => p.revenueCts),
              secondary: true,
              color: "#5bbf7a",
              format: "money",
            },
          ]}
          compare={[
            { label: "Visits", values: prevPoints.map((p) => p.visits), format: "count" },
            { label: "Orders", values: prevPoints.map((p) => p.orders), format: "count" },
          ]}
        />
      </Card>

      <nav className="mb-4 flex flex-wrap items-center gap-1">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={tabHref("/dashboard/analytics", params, t.key)}
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

      {tab === "overview" && <OverviewTab restaurantId={restaurantId} filter={filter} />}
      {tab === "traffic" && <TrafficTab restaurantId={restaurantId} filter={filter} />}
      {tab === "items" && <ItemsTab restaurantId={restaurantId} filter={filter} />}
      {tab === "behavior" && <BehaviorTab restaurantId={restaurantId} filter={filter} />}
      {tab === "visits" && (
        <VisitsTab
          restaurantId={restaurantId}
          filter={filter}
          timezone={timezone}
          openVisitId={typeof searchParams.visit === "string" ? searchParams.visit : null}
          params={params}
        />
      )}
    </>
  );
}

/** Carry every active filter across a tab change. Losing them would make the
 *  tabs feel like five separate pages that happen to share a heading. */
function tabHref(base: string, params: ReturnType<typeof readFilterParams>, tab: string) {
  const sp = new URLSearchParams();
  if (params.range) sp.set("range", params.range);
  if (params.from) sp.set("from", params.from);
  if (params.to) sp.set("to", params.to);
  if (params.q) sp.set("q", params.q);
  if (params.source) sp.set("source", params.source);
  if (params.device) sp.set("device", params.device);
  if (params.includeSimulated) sp.set("sim", "1");
  sp.set("tab", tab);
  return `${base}?${sp.toString()}`;
}

// ---------------------------------------------------------------------------

async function OverviewTab({ restaurantId, filter }: { restaurantId: string; filter: AnalyticsFilter }) {
  const [steps, sources, items] = await Promise.all([
    funnel(restaurantId, filter),
    bySource(restaurantId, filter),
    itemPerformance(restaurantId, filter, 8),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 text-[13px] font-medium text-ink">From landing to paid</h2>
        <p className="mb-4 text-[11.5px] text-mute">
          Each row is the share of the step above it — that&apos;s where people actually leave.
        </p>
        <Funnel steps={steps} />
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 text-[13px] font-medium text-ink">Where they came from</h2>
          <p className="mb-4 text-[11.5px] text-mute">
            Volume on the bar, conversion beside it. The best source is rarely the biggest one.
          </p>
          <RankedBars rows={sources} />
        </Card>

        <Card>
          <h2 className="mb-3 text-[13px] font-medium text-ink">Top sellers</h2>
          {items.length === 0 ? (
            <p className="text-[12px] text-mute">Nothing sold in this period.</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0 text-[12.5px]">
              {items.map((i) => (
                <li key={i.itemId} className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-ink">{i.name}</span>
                  <span className="shrink-0 font-mono text-dim">
                    {i.units} sold · {centsToMoney(i.revenueCts)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function TrafficTab({ restaurantId, filter }: { restaurantId: string; filter: AnalyticsFilter }) {
  const [sources, devices, cells] = await Promise.all([
    bySource(restaurantId, filter),
    byDevice(restaurantId, filter),
    heatmap(restaurantId, filter),
  ]);

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="mb-1 text-[13px] font-medium text-ink">When people order</h2>
        <p className="mb-4 text-[11.5px] text-mute">
          By hour, in your kitchen&apos;s timezone. Switch between visits, orders and conversion —
          the busiest hour for traffic is often not the busiest for orders, and that gap is the
          finding. Empty squares are hours with no traffic at all, which is a different thing from a
          quiet hour.
        </p>
        <Heatmap cells={cells} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-[13px] font-medium text-ink">Sources</h2>
          <RankedBars rows={sources} />
        </Card>
        <Card>
          <h2 className="mb-3 text-[13px] font-medium text-ink">Devices</h2>
          <RankedBars rows={devices} />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function ItemsTab({ restaurantId, filter }: { restaurantId: string; filter: AnalyticsFilter }) {
  const rows = await itemPerformance(restaurantId, filter, 100);

  if (!rows.length) {
    return <Empty title="No item activity yet" body="Nothing was viewed or sold in this period." />;
  }

  return (
    <>
      <Card className="mb-3">
        <p className="text-[12px] leading-relaxed text-dim">
          The two right-hand columns are the useful ones. A dish with plenty of views and a low{" "}
          <strong className="text-ink">view → add</strong> rate is being looked at and passed over —
          usually a price, a photo, or a description problem rather than a food one.
        </p>
      </Card>

      <Table>
        <thead>
          <tr>
            <Th>Item</Th>
            <Th>Category</Th>
            <Th className="text-right">Views</Th>
            <Th className="text-right">Added</Th>
            <Th className="text-right">Sold</Th>
            <Th className="text-right">Revenue</Th>
            <Th className="text-right">View → add</Th>
            <Th className="text-right">Add → order</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.itemId}>
              <Td>{r.name}</Td>
              <Td className="text-dim">{r.categoryName ?? "—"}</Td>
              <Td className="text-right font-mono">{r.views.toLocaleString()}</Td>
              <Td className="text-right font-mono">{r.adds.toLocaleString()}</Td>
              <Td className="text-right font-mono">{r.units.toLocaleString()}</Td>
              <Td className="text-right font-mono">{centsToMoney(r.revenueCts)}</Td>
              <Td className="text-right font-mono">
                {r.views > 0 ? formatPct(r.viewToAdd, 0) : "—"}
              </Td>
              <Td className="text-right font-mono">
                {r.adds > 0 ? formatPct(r.addToOrder, 0) : "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

// ---------------------------------------------------------------------------

async function BehaviorTab({ restaurantId, filter }: { restaurantId: string; filter: AnalyticsFilter }) {
  const [terms, drops, steps] = await Promise.all([
    searchTerms(restaurantId, filter),
    dropOff(restaurantId, filter),
    funnel(restaurantId, filter),
  ]);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 text-[13px] font-medium text-ink">What people searched for</h2>
        <p className="mb-4 text-[11.5px] text-mute">
          Terms that get searched and never converted are the closest thing here to a customer
          telling you what to put on the menu.
        </p>
        {terms.length === 0 ? (
          <p className="text-[12px] text-mute">Nobody used the search box in this period.</p>
        ) : (
          <ul className="m-0 list-none space-y-1.5 p-0 text-[12.5px]">
            {terms.map((t) => (
              <li key={t.term} className="flex items-baseline justify-between gap-3">
                <span className="truncate text-ink">{t.term}</span>
                <span className="shrink-0 font-mono text-dim">
                  {t.searches}×
                  {t.converted === 0 ? (
                    <span className="ml-2 text-warn">no orders</span>
                  ) : (
                    <span className="ml-2 text-mute">{t.converted} ordered</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="space-y-4">
        <Card>
          <h2 className="mb-1 text-[13px] font-medium text-ink">Where people gave up</h2>
          <p className="mb-4 text-[11.5px] text-mute">
            The last screen a visit that didn&apos;t order was on. A pile-up on checkout is a form or
            a card problem; a pile-up on the menu is a menu problem.
          </p>
          {drops.length === 0 ? (
            <p className="text-[12px] text-mute">Not enough data yet.</p>
          ) : (
            <ul className="m-0 list-none space-y-2 p-0 text-[12.5px]">
              {drops.map((d) => (
                <li key={d.view}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-ink">{d.view}</span>
                    <span className="font-mono text-dim">
                      {d.visits.toLocaleString()} · {formatPct(d.share, 0)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full bg-warn" style={{ width: `${d.share * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[13px] font-medium text-ink">Funnel</h2>
          <Funnel steps={steps} />
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function VisitsTab({
  restaurantId,
  filter,
  timezone,
  openVisitId,
  params,
}: {
  restaurantId: string;
  filter: AnalyticsFilter;
  timezone: string;
  openVisitId: string | null;
  params: ReturnType<typeof readFilterParams>;
}) {
  const [{ rows, total }, opened] = await Promise.all([
    recentVisits(restaurantId, filter, { take: 60 }),
    openVisitId ? visitTimeline(restaurantId, openVisitId) : Promise.resolve(null),
  ]);

  const fmt = (d: Date) =>
    d.toLocaleString("en-US", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

  return (
    <div className="space-y-4">
      {opened && (
        <Card>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[13px] font-medium text-ink">
              One visit, start to finish
              {opened.order && (
                <span className="ml-2 text-dim">— order {opened.order.number}</span>
              )}
            </h2>
            <Link
              href={tabHref("/dashboard/analytics", params, "visits")}
              className="text-[12px] text-dim hover:text-ink"
            >
              Close
            </Link>
          </div>
          <ol className="m-0 list-none space-y-1.5 border-l border-line pl-4 text-[12.5px]">
            {opened.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-[7px] h-1.5 w-1.5 rounded-full bg-line2" />
                <span className="font-mono text-mute">{fmt(e.at)}</span>
                <span className="ml-3 text-ink">{humanEvent(e.kind)}</span>
                {e.item && <span className="ml-2 text-dim">{e.item.name}</span>}
                {e.label && <span className="ml-2 text-dim">“{e.label}”</span>}
                {e.valueCts ? (
                  <span className="ml-2 font-mono text-dim">{centsToMoney(e.valueCts)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </Card>
      )}

      <p className="text-[12px] text-mute">
        {total.toLocaleString()} visits match. Showing the {Math.min(60, rows.length)} most recent —
        aggregates hide the case that explains them.
      </p>

      {rows.length === 0 ? (
        <Empty title="No visits recorded" body="Nothing matched these filters." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Source</Th>
              <Th>Device</Th>
              <Th className="text-right">On page</Th>
              <Th className="text-right">Actions</Th>
              <Th>Outcome</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <Td className="whitespace-nowrap font-mono text-[12px]">{fmt(v.startedAt)}</Td>
                <Td className="text-dim">{v.source.replace(/_/g, " ").toLowerCase()}</Td>
                <Td className="text-dim">{v.device.toLowerCase()}</Td>
                <Td className="text-right font-mono">{formatDuration(v.dwellMs)}</Td>
                <Td className="text-right font-mono">{v.events}</Td>
                <Td>
                  {v.converted ? (
                    <Badge tone="good">
                      {v.orderNumber ?? "ordered"}
                      {v.orderTotalCts != null ? ` · ${centsToMoney(v.orderTotalCts)}` : ""}
                    </Badge>
                  ) : (
                    <span className="text-mute">left</span>
                  )}
                  {v.simulated && (
                    <span className="ml-2">
                      <Badge tone="warn">seeded</Badge>
                    </span>
                  )}
                </Td>
                <Td>
                  <Link
                    href={`${tabHref("/dashboard/analytics", params, "visits")}&visit=${v.id}`}
                    className="text-[12px] text-accent underline underline-offset-2"
                  >
                    Timeline
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

/** Event kinds, in the words an owner would use. */
function humanEvent(kind: string): string {
  const map: Record<string, string> = {
    PAGE_VIEW: "Opened the page",
    VIEW_CHANGE: "Moved to another screen",
    ITEM_VIEW: "Looked at",
    ITEM_ADD: "Added to cart",
    ITEM_REMOVE: "Removed from cart",
    CART_VIEW: "Opened the cart",
    CHECKOUT_START: "Started checkout",
    CHECKOUT_ERROR: "Checkout failed",
    ORDER_PLACED: "Placed the order",
    SEARCH: "Searched for",
    HEARTBEAT: "Still reading",
  };
  return map[kind] ?? kind;
}
