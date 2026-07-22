/**
 * Storefront analytics — the read side.
 *
 * `lib/analytics.ts` is the only writer; this is the only reader. Keeping them
 * apart matters because the two have opposite priorities: ingest must never
 * fail an order, and reads must never see a tenant that isn't theirs.
 *
 * **Tenant isolation.** Every function here takes a `restaurantId` that came
 * from `requireOwner()`, and every query filters on it — including the raw SQL,
 * where the id is always a bound parameter and never interpolated. The platform
 * functions at the bottom are the deliberate exception and each is marked; they
 * are for `/admin` and must sit behind `requireAdmin()`.
 *
 * **Simulated traffic is excluded by default.** Seeded visits carry
 * `simulated: true` for the same reason seeded orders carry `paymentProvider:
 * "sim"`. An owner's conversion rate must not include invented customers, and
 * an admin demoing the product must be able to switch them back on — hence the
 * flag rather than a hard filter.
 *
 * **Every number is either measured or explicitly derived.** Where a metric
 * can't be computed honestly from what's recorded, this module returns null and
 * the UI says so, rather than substituting a plausible-looking estimate. A
 * dashboard that guesses in one place gets disbelieved everywhere.
 */

import { Prisma } from "@prisma/client";
import type { VisitDevice, VisitSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  bucketsFor,
  granularityFor,
  previousRange,
  rate,
  truncateLocal,
  type DateRange,
  type Granularity,
} from "@/lib/analytics-range";

/** Timezone the platform-wide admin views are reckoned in. */
export const PLATFORM_TZ = "America/New_York";

export type AnalyticsFilter = {
  range: DateRange;
  timezone: string;
  /** Free text: matches item names, search terms, and order numbers. */
  q?: string | null;
  source?: VisitSource | null;
  device?: VisitDevice | null;
  includeSimulated?: boolean;
};

// ---------------------------------------------------------------------------
// Shared WHERE fragments
// ---------------------------------------------------------------------------

function visitWhere(restaurantId: string, f: AnalyticsFilter): Prisma.VisitWhereInput {
  return {
    restaurantId,
    startedAt: { gte: f.range.from, lt: f.range.to },
    ...(f.includeSimulated ? {} : { simulated: false }),
    ...(f.source ? { source: f.source } : {}),
    ...(f.device ? { device: f.device } : {}),
  };
}

function orderWhere(restaurantId: string, f: AnalyticsFilter): Prisma.OrderWhereInput {
  return {
    restaurantId,
    createdAt: { gte: f.range.from, lt: f.range.to },
    ...(f.includeSimulated ? {} : { NOT: { paymentProvider: "sim" } }),
  };
}

/**
 * Revenue counts orders that weren't rejected outright, minus what went back.
 *
 * A canceled order that was refunded in full nets to zero on its own, so it
 * doesn't need excluding — but a *rejected* one never had money attached, and
 * counting it as a zero-value sale would drag the average ticket down with a
 * transaction that never happened.
 */
const REVENUE_STATUSES = ["RECEIVED", "ACCEPTED", "PREPARING", "READY", "COMPLETED", "CANCELED"] as const;

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

export type Headline = {
  visits: number;
  visitors: number;
  orders: number;
  revenueCts: number;
  surchargeCts: number;
  refundedCts: number;
  aovCts: number;
  conversionRate: number;
  avgDwellMs: number;
  /** Visits that saw one screen and left. */
  bounceRate: number;
  newCustomers: number;
  returningCustomers: number;
};

export async function headline(
  restaurantId: string,
  f: AnalyticsFilter
): Promise<Headline> {
  const [visitAgg, visitors, bounced, orderAgg, refundAgg, customers] = await Promise.all([
    prisma.visit.aggregate({
      where: visitWhere(restaurantId, f),
      _count: { _all: true },
      _avg: { dwellMs: true },
    }),
    // A distinct count over anonId, not over visits: the difference between
    // these two numbers *is* the returning-visitor story.
    prisma.visit
      .findMany({
        where: visitWhere(restaurantId, f),
        select: { anonId: true },
        distinct: ["anonId"],
      })
      .then((rows) => rows.length),
    prisma.visit.count({
      where: { ...visitWhere(restaurantId, f), viewedMenu: false, converted: false },
    }),
    prisma.order.aggregate({
      where: { ...orderWhere(restaurantId, f), status: { in: [...REVENUE_STATUSES] } },
      _count: { _all: true },
      _sum: { totalCts: true, surchargeCts: true, refundedCts: true },
    }),
    prisma.order.aggregate({
      where: orderWhere(restaurantId, f),
      _sum: { refundedCts: true },
    }),
    customerSplit(restaurantId, f),
  ]);

  const visits = visitAgg._count._all;
  const orders = orderAgg._count._all;
  const gross = orderAgg._sum.totalCts ?? 0;
  const refunded = orderAgg._sum.refundedCts ?? 0;
  const net = Math.max(0, gross - refunded);

  return {
    visits,
    visitors,
    orders,
    revenueCts: net,
    surchargeCts: orderAgg._sum.surchargeCts ?? 0,
    refundedCts: refundAgg._sum.refundedCts ?? 0,
    aovCts: orders > 0 ? Math.round(net / orders) : 0,
    // Measured against visits rather than visitors: the question a storefront
    // conversion rate answers is "of the times someone opened this, how often
    // did it end in food", and someone who came back twice made two decisions.
    conversionRate: rate(orders, visits),
    avgDwellMs: Math.round(visitAgg._avg.dwellMs ?? 0),
    bounceRate: rate(bounced, visits),
    newCustomers: customers.newCustomers,
    returningCustomers: customers.returningCustomers,
  };
}

async function customerSplit(restaurantId: string, f: AnalyticsFilter) {
  const [newCustomers, returningCustomers] = await Promise.all([
    prisma.customer.count({
      where: { restaurantId, firstOrderAt: { gte: f.range.from, lt: f.range.to } },
    }),
    // Ordered in the window, but not for the first time. `firstOrderAt` is
    // maintained on the customer, so this needs no self-join.
    prisma.customer.count({
      where: {
        restaurantId,
        lastOrderAt: { gte: f.range.from, lt: f.range.to },
        firstOrderAt: { lt: f.range.from },
      },
    }),
  ]);
  return { newCustomers, returningCustomers };
}

/** Headline for this period alongside the one before it, for the delta chips. */
export async function headlineWithComparison(restaurantId: string, f: AnalyticsFilter) {
  const prev = previousRange(f.range);
  const prevFilter: AnalyticsFilter = {
    ...f,
    range: {
      ...f.range,
      from: prev.from,
      to: prev.to,
      granularity: granularityFor(prev.from, prev.to),
    },
  };
  const [current, previous] = await Promise.all([
    headline(restaurantId, f),
    headline(restaurantId, prevFilter),
  ]);
  return { current, previous };
}

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

export type SeriesPoint = {
  at: Date;
  visits: number;
  orders: number;
  revenueCts: number;
  conversionRate: number;
};

/**
 * Traffic and sales over the range, bucketed in the tenant's timezone.
 *
 * Raw SQL rather than a Prisma groupBy because grouping by a truncated,
 * timezone-shifted timestamp isn't expressible in the query builder — and doing
 * it in JavaScript would mean pulling every visit row in the range across the
 * wire to count them, which is the one thing this table is too big for.
 *
 * The result is then merged into `bucketsFor`, so empty buckets survive: a line
 * drawn only from the days that had traffic connects Monday to Friday and shows
 * a business that traded steadily through a week it was shut.
 */
export async function series(
  restaurantId: string,
  f: AnalyticsFilter
): Promise<SeriesPoint[]> {
  const g = f.range.granularity;
  const tz = f.timezone;
  const visitBucket = bucketExpr('v."startedAt"', g, tz);
  const orderBucket = bucketExpr('o."createdAt"', g, tz);

  const simVisits = f.includeSimulated ? Prisma.empty : Prisma.sql`AND v."simulated" = false`;
  const srcFilter = f.source ? Prisma.sql`AND v."source" = ${f.source}::"VisitSource"` : Prisma.empty;
  const devFilter = f.device ? Prisma.sql`AND v."device" = ${f.device}::"VisitDevice"` : Prisma.empty;
  const simOrders = f.includeSimulated
    ? Prisma.empty
    : Prisma.sql`AND (o."paymentProvider" IS DISTINCT FROM 'sim')`;

  const [visitRows, orderRows]: [BucketRow[], BucketMoneyRow[]] = await Promise.all([
    prisma.$queryRaw<BucketRow[]>`
      SELECT ${visitBucket} AS bucket,
             COUNT(*)::bigint AS n
      FROM "Visit" v
      WHERE v."restaurantId" = ${restaurantId}
        AND v."startedAt" >= ${f.range.from}
        AND v."startedAt" < ${f.range.to}
        ${simVisits} ${srcFilter} ${devFilter}
      GROUP BY 1
    `,
    prisma.$queryRaw<BucketMoneyRow[]>`
      SELECT ${orderBucket} AS bucket,
             COUNT(*)::bigint AS n,
             COALESCE(SUM(o."totalCts" - o."refundedCts"), 0)::bigint AS revenue
      FROM "Order" o
      WHERE o."restaurantId" = ${restaurantId}
        AND o."createdAt" >= ${f.range.from}
        AND o."createdAt" < ${f.range.to}
        AND o."status" <> 'REJECTED'
        ${simOrders}
      GROUP BY 1
    `,
  ]);

  const visitsBy = bucketMap(visitRows, tz, g, (r) => Number(r.n));
  const ordersBy = bucketMap(orderRows, tz, g, (r) => Number(r.n));
  const revenueBy = bucketMap(orderRows, tz, g, (r) => Number(r.revenue));

  return bucketsFor(f.range, tz).map((at) => {
    const key = at.getTime();
    const visits = visitsBy.get(key) ?? 0;
    const orders = ordersBy.get(key) ?? 0;
    return {
      at,
      visits,
      orders,
      revenueCts: revenueBy.get(key) ?? 0,
      conversionRate: rate(orders, visits),
    };
  });
}

/**
 * A bucket boundary as an **instant**, not a local wall time.
 *
 * The round trip matters: shift into the tenant's zone, truncate there, then
 * shift straight back. Postgres returns the result as a real timestamp, which
 * lines up byte for byte with what `truncateLocal` produces in JavaScript — so
 * the merge against `bucketsFor` is an exact key match rather than a fuzzy one.
 *
 * The version that returned a bare local timestamp needed the offset applied a
 * second time on this side, in a different language, and the two disagreed for
 * one hour twice a year: a chart with two 1am buckets and no 2am.
 *
 * `date_trunc`'s unit is bound as a parameter, and `col` is only ever one of
 * the two hardcoded strings below — nothing from a request reaches either.
 */
function bucketExpr(col: string, g: Granularity, tz: string): Prisma.Sql {
  return Prisma.sql`(date_trunc(${g}, ${Prisma.raw(col)} AT TIME ZONE 'UTC' AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
}

/** Row shapes for the bucketed queries. Named rather than inline so the
 *  `bucketMap` calls below infer from these instead of from its constraint. */
type BucketRow = { bucket: Date; n: bigint };
type BucketMoneyRow = BucketRow & { revenue: bigint };
type HeatRow = { dow: number; hour: number; n: bigint };

function bucketMap<T extends { bucket: Date }>(
  rows: T[],
  tz: string,
  g: Granularity,
  pick: (row: T) => number
): Map<number, number> {
  const out = new Map<number, number>();
  for (const row of rows) {
    // Re-truncating through the JS helper is belt and braces: the SQL already
    // aligned it, and this makes the two definitions provably agree.
    const key = truncateLocal(row.bucket, g, tz).getTime();
    out.set(key, (out.get(key) ?? 0) + pick(row));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Funnel
// ---------------------------------------------------------------------------

export type FunnelStep = {
  key: string;
  label: string;
  count: number;
  /** Share of the top of the funnel. */
  ofTotal: number;
  /** Share of the step immediately above — where the drop actually happened. */
  ofPrevious: number;
};

/**
 * The five steps from "opened the page" to "paid".
 *
 * Read off the denormalized booleans on `Visit` rather than grouped out of the
 * events table, which is what makes this cheap enough to sit at the top of the
 * page. The booleans are monotonic by construction (see `milestonesFrom`), so
 * no step can ever report wider than the one above it — a funnel that can widen
 * is a funnel nobody trusts.
 */
export async function funnel(restaurantId: string, f: AnalyticsFilter): Promise<FunnelStep[]> {
  const base = visitWhere(restaurantId, f);
  const [visits, menu, item, cart, checkout, converted] = await Promise.all([
    prisma.visit.count({ where: base }),
    prisma.visit.count({ where: { ...base, viewedMenu: true } }),
    prisma.visit.count({ where: { ...base, viewedItem: true } }),
    prisma.visit.count({ where: { ...base, addedToCart: true } }),
    prisma.visit.count({ where: { ...base, startedCheckout: true } }),
    prisma.visit.count({ where: { ...base, converted: true } }),
  ]);

  const raw: Array<{ key: string; label: string; count: number }> = [
    { key: "visit", label: "Opened the page", count: visits },
    { key: "menu", label: "Browsed the menu", count: menu },
    { key: "item", label: "Looked at an item", count: item },
    { key: "cart", label: "Added to cart", count: cart },
    { key: "checkout", label: "Started checkout", count: checkout },
    { key: "order", label: "Placed the order", count: converted },
  ];

  return raw.map((s, i) => ({
    ...s,
    ofTotal: rate(s.count, visits),
    ofPrevious: i === 0 ? 1 : rate(s.count, raw[i - 1].count),
  }));
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

export type ItemRow = {
  itemId: string;
  name: string;
  categoryName: string | null;
  views: number;
  adds: number;
  /** Units actually paid for. */
  units: number;
  revenueCts: number;
  /** Of the people who opened this item, how many added it. */
  viewToAdd: number;
  /** Of the people who added it, how many finished the order. */
  addToOrder: number;
};

/**
 * Item performance, joining what people *looked* at to what they *bought*.
 *
 * The two halves come from different tables and answer different questions.
 * Sales alone tell an owner what sells; views alone tell them what attracts
 * attention. It's the ratio between them that's actionable — a dish with a
 * thousand views and forty orders has a price problem or a description problem,
 * and neither column shows that on its own.
 */
export async function itemPerformance(
  restaurantId: string,
  f: AnalyticsFilter,
  limit = 50
): Promise<ItemRow[]> {
  const q = (f.q ?? "").trim();

  const [items, viewRows, addRows, soldRows] = await Promise.all([
    prisma.menuItem.findMany({
      where: {
        restaurantId,
        ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
      },
      select: { id: true, name: true, category: { select: { name: true } } },
    }),
    prisma.visitEvent.groupBy({
      by: ["itemId"],
      where: {
        restaurantId,
        kind: "ITEM_VIEW",
        at: { gte: f.range.from, lt: f.range.to },
        itemId: { not: null },
        ...(f.includeSimulated ? {} : { simulated: false }),
      },
      _count: { _all: true },
    }),
    prisma.visitEvent.groupBy({
      by: ["itemId"],
      where: {
        restaurantId,
        kind: "ITEM_ADD",
        at: { gte: f.range.from, lt: f.range.to },
        itemId: { not: null },
        ...(f.includeSimulated ? {} : { simulated: false }),
      },
      _count: { _all: true },
    }),
    soldByItem(restaurantId, f),
  ]);

  const viewsBy = countMap(viewRows);
  const addsBy = countMap(addRows);
  const soldBy = soldRows;

  const rows = items.map((i) => {
    const views = viewsBy.get(i.id) ?? 0;
    const adds = addsBy.get(i.id) ?? 0;
    const sold = soldBy.get(i.id) ?? { qty: 0, cts: 0 };
    return {
      itemId: i.id,
      name: i.name,
      categoryName: i.category?.name ?? null,
      views,
      adds,
      units: sold.qty,
      revenueCts: sold.cts,
      viewToAdd: rate(adds, views),
      addToOrder: rate(sold.qty, adds),
    };
  });

  return rows
    .filter((r) => r.views > 0 || r.units > 0)
    .sort((a, b) => b.revenueCts - a.revenueCts || b.views - a.views)
    .slice(0, limit);
}

/**
 * Units and money per menu item.
 *
 * Raw SQL rather than a `groupBy`, for two reasons the schema forces.
 *
 * `OrderItem` has no line-total column — a line's value is
 * `(unitPriceCts + modifiersCts) * qty`, which is `lineFoodCts` in
 * `lib/orders.ts` — and Prisma's `_sum` can only add a column that exists. It
 * also stores `fulfilledQty`, which is null in the normal case and *lower* than
 * `qty` when the kitchen 86'd part of a line. Counting `qty` there would credit
 * an item with units that were refunded and never handed over, so the
 * `COALESCE` below is the difference between "what we sold" and "what was
 * ordered before we ran out".
 *
 * The arithmetic is duplicated from `lineFoodCts` because it has to run in the
 * database; if that function's definition ever changes, this changes with it.
 */
async function soldByItem(
  restaurantId: string,
  f: AnalyticsFilter
): Promise<Map<string, { qty: number; cts: number }>> {
  const simFilter = f.includeSimulated
    ? Prisma.empty
    : Prisma.sql`AND (o."paymentProvider" IS DISTINCT FROM 'sim')`;

  const rows = await prisma.$queryRaw<Array<{ menuItemId: string; qty: bigint; cts: bigint }>>`
    SELECT oi."menuItemId" AS "menuItemId",
           COALESCE(SUM(COALESCE(oi."fulfilledQty", oi."qty")), 0)::bigint AS qty,
           COALESCE(SUM(
             GREATEST(oi."unitPriceCts" + oi."modifiersCts", 0)
             * COALESCE(oi."fulfilledQty", oi."qty")
           ), 0)::bigint AS cts
    FROM "OrderItem" oi
    JOIN "Order" o ON o."id" = oi."orderId"
    WHERE o."restaurantId" = ${restaurantId}
      AND o."createdAt" >= ${f.range.from}
      AND o."createdAt" < ${f.range.to}
      AND o."status" <> 'REJECTED'
      AND oi."menuItemId" IS NOT NULL
      ${simFilter}
    GROUP BY 1
  `;

  return new Map(rows.map((r) => [r.menuItemId, { qty: Number(r.qty), cts: Number(r.cts) }]));
}

function countMap(rows: Array<{ itemId: string | null; _count: { _all: number } }>) {
  const m = new Map<string, number>();
  for (const r of rows) if (r.itemId) m.set(r.itemId, r._count._all);
  return m;
}

// ---------------------------------------------------------------------------
// Breakdowns
// ---------------------------------------------------------------------------

export type Breakdown = Array<{ key: string; label: string; visits: number; orders: number; conversionRate: number }>;

const SOURCE_LABELS: Record<VisitSource, string> = {
  DIRECT: "Direct / app",
  QR: "QR code",
  SEARCH_ENGINE: "Search",
  SOCIAL: "Social",
  MAPS: "Maps & listings",
  SMS: "Our texts",
  REFERRAL: "Other sites",
  UNKNOWN: "Unknown",
};

const DEVICE_LABELS: Record<VisitDevice, string> = {
  MOBILE: "Phone",
  TABLET: "Tablet",
  DESKTOP: "Desktop",
  UNKNOWN: "Unknown",
};

/**
 * Traffic by where it came from, and how well each source converts.
 *
 * The conversion column is the reason this exists rather than a pie chart of
 * volume. A QR code on the counter sends fewer people than Google does and
 * converts several times better, and an owner deciding where to spend an
 * afternoon needs the second fact more than the first.
 */
export async function bySource(restaurantId: string, f: AnalyticsFilter): Promise<Breakdown> {
  const [rows, converted] = await Promise.all([
    prisma.visit.groupBy({
      by: ["source"],
      where: visitWhere(restaurantId, f),
      _count: { _all: true },
    }),
    prisma.visit.groupBy({
      by: ["source"],
      where: { ...visitWhere(restaurantId, f), converted: true },
      _count: { _all: true },
    }),
  ]);

  return combine(
    rows.map((r) => ({ key: String(r.source), visits: r._count._all })),
    new Map(converted.map((r) => [String(r.source), r._count._all])),
    (k) => SOURCE_LABELS[k as VisitSource] ?? k
  );
}

export async function byDevice(restaurantId: string, f: AnalyticsFilter): Promise<Breakdown> {
  const [rows, converted] = await Promise.all([
    prisma.visit.groupBy({
      by: ["device"],
      where: visitWhere(restaurantId, f),
      _count: { _all: true },
    }),
    prisma.visit.groupBy({
      by: ["device"],
      where: { ...visitWhere(restaurantId, f), converted: true },
      _count: { _all: true },
    }),
  ]);

  return combine(
    rows.map((r) => ({ key: String(r.device), visits: r._count._all })),
    new Map(converted.map((r) => [String(r.device), r._count._all])),
    (k) => DEVICE_LABELS[k as VisitDevice] ?? k
  );
}

/**
 * The two `groupBy` calls above are spelled out rather than shared behind a
 * `field: "source" | "device"` parameter.
 *
 * Prisma's `groupBy` return type is derived from the *literal* passed to `by`,
 * so a union-typed variable there collapses the result to something with no
 * usable keys — it typechecks locally against the stale sandbox client and then
 * fails the production build, which is exactly the class of error that sent
 * this file back once already. Only the arithmetic is shared.
 */
function combine(
  rows: Array<{ key: string; visits: number }>,
  convertedBy: Map<string, number>,
  label: (key: string) => string
): Breakdown {
  return rows
    .map((r) => {
      const orders = convertedBy.get(r.key) ?? 0;
      return {
        key: r.key,
        label: label(r.key),
        visits: r.visits,
        orders,
        conversionRate: rate(orders, r.visits),
      };
    })
    .sort((a, b) => b.visits - a.visits);
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

export type HeatCell = { day: number; hour: number; visits: number; orders: number };

/**
 * Demand by hour of the week, in the tenant's timezone.
 *
 * This is the single most operationally useful chart on the page, because it is
 * the only one that maps onto a decision an owner makes every week: who to
 * roster. It's also the one where using the viewer's timezone instead of the
 * restaurant's would be most damaging — a two-hour shift moves the dinner rush
 * onto the wrong shift entirely.
 */
export async function heatmap(restaurantId: string, f: AnalyticsFilter): Promise<HeatCell[]> {
  const tz = f.timezone;
  const simVisits = f.includeSimulated ? Prisma.empty : Prisma.sql`AND v."simulated" = false`;
  const simOrders = f.includeSimulated
    ? Prisma.empty
    : Prisma.sql`AND (o."paymentProvider" IS DISTINCT FROM 'sim')`;

  const [visitRows, orderRows]: [HeatRow[], HeatRow[]] = await Promise.all([
    prisma.$queryRaw<HeatRow[]>`
      SELECT EXTRACT(DOW FROM v."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS dow,
             EXTRACT(HOUR FROM v."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS hour,
             COUNT(*)::bigint AS n
      FROM "Visit" v
      WHERE v."restaurantId" = ${restaurantId}
        AND v."startedAt" >= ${f.range.from} AND v."startedAt" < ${f.range.to}
        ${simVisits}
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<HeatRow[]>`
      SELECT EXTRACT(DOW FROM o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS dow,
             EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS hour,
             COUNT(*)::bigint AS n
      FROM "Order" o
      WHERE o."restaurantId" = ${restaurantId}
        AND o."createdAt" >= ${f.range.from} AND o."createdAt" < ${f.range.to}
        AND o."status" <> 'REJECTED'
        ${simOrders}
      GROUP BY 1, 2
    `,
  ]);

  const key = (d: number, h: number) => d * 24 + h;
  const visitsBy = new Map(visitRows.map((r) => [key(r.dow, r.hour), Number(r.n)]));
  const ordersBy = new Map(orderRows.map((r) => [key(r.dow, r.hour), Number(r.n)]));

  const cells: HeatCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cells.push({
        day: d,
        hour: h,
        visits: visitsBy.get(key(d, h)) ?? 0,
        orders: ordersBy.get(key(d, h)) ?? 0,
      });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------------
// Search terms and drop-off
// ---------------------------------------------------------------------------

export type SearchTerm = { term: string; searches: number; visits: number; converted: number };

/**
 * What customers typed into the menu search.
 *
 * The most valuable rows here are the ones with searches and no conversions —
 * people looking for something the restaurant doesn't sell, or does sell under
 * a name nobody uses. That is the only signal in the entire product that says
 * what to *add* to a menu rather than how the existing menu is doing.
 */
export async function searchTerms(
  restaurantId: string,
  f: AnalyticsFilter,
  limit = 25
): Promise<SearchTerm[]> {
  const q = (f.q ?? "").trim();

  const rows = await prisma.visitEvent.findMany({
    where: {
      restaurantId,
      kind: "SEARCH",
      at: { gte: f.range.from, lt: f.range.to },
      label: { not: null, ...(q ? { contains: q, mode: "insensitive" as const } : {}) },
      ...(f.includeSimulated ? {} : { simulated: false }),
    },
    select: { label: true, visitId: true, visit: { select: { converted: true } } },
    // Bounded: a tenant with a very chatty search box shouldn't be able to make
    // this page slow for the owner who just wants their top ten terms.
    take: 5000,
  });

  const agg = new Map<string, { searches: number; visits: Set<string>; converted: Set<string> }>();
  for (const r of rows) {
    const term = (r.label ?? "").toLowerCase().trim();
    if (!term) continue;
    const e = agg.get(term) ?? { searches: 0, visits: new Set(), converted: new Set() };
    e.searches += 1;
    e.visits.add(r.visitId);
    if (r.visit?.converted) e.converted.add(r.visitId);
    agg.set(term, e);
  }

  return [...agg.entries()]
    .map(([term, e]) => ({
      term,
      searches: e.searches,
      visits: e.visits.size,
      converted: e.converted.size,
    }))
    .sort((a, b) => b.searches - a.searches)
    .slice(0, limit);
}

export type DropOff = { view: string; visits: number; share: number };

/**
 * The last screen a non-converting visit was on.
 *
 * "Where do people give up" is a different question from the funnel above it:
 * the funnel says how many reached each step, this says where the ones who
 * never bought were standing when they stopped. A pile-up on the checkout
 * screen means the form or the card is the problem; a pile-up on the menu means
 * the menu is.
 */
export async function dropOff(restaurantId: string, f: AnalyticsFilter): Promise<DropOff[]> {
  const rows = await prisma.$queryRaw<Array<{ view: string | null; n: bigint }>>`
    SELECT last_event."view" AS view, COUNT(*)::bigint AS n
    FROM "Visit" v
    JOIN LATERAL (
      SELECT e."view"
      FROM "VisitEvent" e
      WHERE e."visitId" = v."id" AND e."view" IS NOT NULL
      ORDER BY e."at" DESC
      LIMIT 1
    ) last_event ON TRUE
    WHERE v."restaurantId" = ${restaurantId}
      AND v."startedAt" >= ${f.range.from} AND v."startedAt" < ${f.range.to}
      AND v."converted" = false
      ${f.includeSimulated ? Prisma.empty : Prisma.sql`AND v."simulated" = false`}
    GROUP BY 1
    ORDER BY 2 DESC
  `;

  const total = rows.reduce((n, r) => n + Number(r.n), 0);
  return rows.map((r) => ({
    view: r.view ?? "unknown",
    visits: Number(r.n),
    share: rate(Number(r.n), total),
  }));
}

// ---------------------------------------------------------------------------
// Visit log
// ---------------------------------------------------------------------------

export type VisitRow = {
  id: string;
  startedAt: Date;
  dwellMs: number;
  source: VisitSource;
  device: VisitDevice;
  events: number;
  converted: boolean;
  orderNumber: string | null;
  orderTotalCts: number | null;
  simulated: boolean;
};

/**
 * Individual visits, newest first.
 *
 * Aggregates hide the case that explains the aggregate. When conversion drops
 * on a Tuesday, the thing that tells an owner why is reading four of Tuesday's
 * visits end to end — which is what this table and `visitTimeline` are for.
 */
export async function recentVisits(
  restaurantId: string,
  f: AnalyticsFilter,
  opts: { take?: number; skip?: number } = {}
): Promise<{ rows: VisitRow[]; total: number }> {
  const q = (f.q ?? "").trim();
  const where: Prisma.VisitWhereInput = {
    ...visitWhere(restaurantId, f),
    ...(q
      ? {
          OR: [
            { order: { number: { contains: q, mode: "insensitive" } } },
            { referrerHost: { contains: q, mode: "insensitive" } },
            { events: { some: { label: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.visit.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: opts.take ?? 50,
      skip: opts.skip ?? 0,
      select: {
        id: true,
        startedAt: true,
        dwellMs: true,
        source: true,
        device: true,
        eventCount: true,
        converted: true,
        simulated: true,
        order: { select: { number: true, totalCts: true } },
      },
    }),
    prisma.visit.count({ where }),
  ]);

  return {
    rows: rows.map((v) => ({
      id: v.id,
      startedAt: v.startedAt,
      dwellMs: v.dwellMs,
      source: v.source,
      device: v.device,
      events: v.eventCount,
      converted: v.converted,
      orderNumber: v.order?.number ?? null,
      orderTotalCts: v.order?.totalCts ?? null,
      simulated: v.simulated,
    })),
    total,
  };
}

/** Every event in one visit, in order. Scoped to the tenant, not just the id. */
export async function visitTimeline(restaurantId: string, visitId: string) {
  const visit = await prisma.visit.findFirst({
    where: { id: visitId, restaurantId },
    include: {
      order: { select: { number: true, totalCts: true, publicToken: true } },
      events: {
        orderBy: { at: "asc" },
        take: 500,
        select: {
          id: true,
          kind: true,
          at: true,
          view: true,
          valueCts: true,
          dwellMs: true,
          label: true,
          item: { select: { name: true } },
        },
      },
    },
  });
  return visit;
}

// ---------------------------------------------------------------------------
// Platform-wide — /admin only, must sit behind requireAdmin()
// ---------------------------------------------------------------------------

export type TenantRow = {
  restaurantId: string;
  name: string;
  slug: string;
  status: string;
  visits: number;
  orders: number;
  revenueCts: number;
  surchargeCts: number;
  conversionRate: number;
  avgDwellMs: number;
};

/**
 * Every tenant's numbers side by side. **Unscoped by design** — the one place
 * in this module that reads across the isolation boundary, and the reason both
 * callers of it start with `requireAdmin()`.
 *
 * Surcharge is its own column because it is the platform's revenue, and reading
 * it as a share of a tenant's gross is how we find out that a tenant with heavy
 * traffic and tiny tickets is costing more to serve than they bring in.
 */
export async function tenantLeaderboard(f: AnalyticsFilter): Promise<TenantRow[]> {
  const [restaurants, visitRows, convertedRows, orderRows] = await Promise.all([
    prisma.restaurant.findMany({
      where: f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { slug: { contains: f.q, mode: "insensitive" } }] } : {},
      select: { id: true, name: true, slug: true, status: true },
    }),
    prisma.visit.groupBy({
      by: ["restaurantId"],
      where: {
        startedAt: { gte: f.range.from, lt: f.range.to },
        ...(f.includeSimulated ? {} : { simulated: false }),
      },
      _count: { _all: true },
      _avg: { dwellMs: true },
    }),
    prisma.visit.groupBy({
      by: ["restaurantId"],
      where: {
        startedAt: { gte: f.range.from, lt: f.range.to },
        converted: true,
        ...(f.includeSimulated ? {} : { simulated: false }),
      },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ["restaurantId"],
      where: {
        createdAt: { gte: f.range.from, lt: f.range.to },
        status: { in: [...REVENUE_STATUSES] },
        ...(f.includeSimulated ? {} : { NOT: { paymentProvider: "sim" } }),
      },
      _count: { _all: true },
      _sum: { totalCts: true, refundedCts: true, surchargeCts: true },
    }),
  ]);

  const visitsBy = new Map(visitRows.map((r) => [r.restaurantId, r]));
  const convBy = new Map(convertedRows.map((r) => [r.restaurantId, r._count._all]));
  const ordersBy = new Map(orderRows.map((r) => [r.restaurantId, r]));

  return restaurants
    .map((r) => {
      const v = visitsBy.get(r.id);
      const o = ordersBy.get(r.id);
      const visits = v?._count._all ?? 0;
      const orders = o?._count._all ?? 0;
      return {
        restaurantId: r.id,
        name: r.name,
        slug: r.slug,
        status: r.status,
        visits,
        orders,
        revenueCts: Math.max(0, (o?._sum.totalCts ?? 0) - (o?._sum.refundedCts ?? 0)),
        surchargeCts: o?._sum.surchargeCts ?? 0,
        conversionRate: rate(orders, visits),
        avgDwellMs: Math.round(v?._avg.dwellMs ?? 0),
      };
    })
    .filter((r) => r.visits > 0 || r.orders > 0 || !!f.q)
    .sort((a, b) => b.revenueCts - a.revenueCts || b.visits - a.visits);
}

export type PlatformHeadline = {
  tenantsTrading: number;
  visits: number;
  orders: number;
  grossCts: number;
  surchargeCts: number;
  refundedCts: number;
  conversionRate: number;
  avgDwellMs: number;
};

/** **Unscoped by design.** `requireAdmin()` only. */
export async function platformHeadline(f: AnalyticsFilter): Promise<PlatformHeadline> {
  const simVisit = f.includeSimulated ? {} : { simulated: false };
  const simOrder = f.includeSimulated ? {} : { NOT: { paymentProvider: "sim" } };

  const [visitAgg, converted, orderAgg, trading] = await Promise.all([
    prisma.visit.aggregate({
      where: { startedAt: { gte: f.range.from, lt: f.range.to }, ...simVisit },
      _count: { _all: true },
      _avg: { dwellMs: true },
    }),
    prisma.visit.count({
      where: { startedAt: { gte: f.range.from, lt: f.range.to }, converted: true, ...simVisit },
    }),
    prisma.order.aggregate({
      where: {
        createdAt: { gte: f.range.from, lt: f.range.to },
        status: { in: [...REVENUE_STATUSES] },
        ...simOrder,
      },
      _count: { _all: true },
      _sum: { totalCts: true, surchargeCts: true, refundedCts: true },
    }),
    prisma.order
      .groupBy({
        by: ["restaurantId"],
        where: { createdAt: { gte: f.range.from, lt: f.range.to }, ...simOrder },
      })
      .then((rows) => rows.length),
  ]);

  const visits = visitAgg._count._all;
  const orders = orderAgg._count._all;

  return {
    tenantsTrading: trading,
    visits,
    orders,
    grossCts: Math.max(0, (orderAgg._sum.totalCts ?? 0) - (orderAgg._sum.refundedCts ?? 0)),
    surchargeCts: orderAgg._sum.surchargeCts ?? 0,
    refundedCts: orderAgg._sum.refundedCts ?? 0,
    conversionRate: rate(orders, visits),
    avgDwellMs: Math.round(visitAgg._avg.dwellMs ?? 0),
  };
}

/** **Unscoped by design.** Platform traffic and surcharge revenue over time. */
export async function platformSeries(f: AnalyticsFilter): Promise<SeriesPoint[]> {
  const g = f.range.granularity;
  const tz = f.timezone;
  const visitBucket = bucketExpr('v."startedAt"', g, tz);
  const orderBucket = bucketExpr('o."createdAt"', g, tz);
  const simVisits = f.includeSimulated ? Prisma.empty : Prisma.sql`AND v."simulated" = false`;
  const simOrders = f.includeSimulated
    ? Prisma.empty
    : Prisma.sql`AND (o."paymentProvider" IS DISTINCT FROM 'sim')`;

  const [visitRows, orderRows]: [BucketRow[], BucketMoneyRow[]] = await Promise.all([
    prisma.$queryRaw<BucketRow[]>`
      SELECT ${visitBucket} AS bucket, COUNT(*)::bigint AS n
      FROM "Visit" v
      WHERE v."startedAt" >= ${f.range.from} AND v."startedAt" < ${f.range.to} ${simVisits}
      GROUP BY 1
    `,
    prisma.$queryRaw<BucketMoneyRow[]>`
      SELECT ${orderBucket} AS bucket,
             COUNT(*)::bigint AS n,
             COALESCE(SUM(o."surchargeCts"), 0)::bigint AS revenue
      FROM "Order" o
      WHERE o."createdAt" >= ${f.range.from} AND o."createdAt" < ${f.range.to}
        AND o."status" <> 'REJECTED' ${simOrders}
      GROUP BY 1
    `,
  ]);

  const visitsBy = bucketMap(visitRows, tz, f.range.granularity, (r) => Number(r.n));
  const ordersBy = bucketMap(orderRows, tz, f.range.granularity, (r) => Number(r.n));
  const revenueBy = bucketMap(orderRows, tz, f.range.granularity, (r) => Number(r.revenue));

  return bucketsFor(f.range, tz).map((at) => {
    const k = at.getTime();
    const visits = visitsBy.get(k) ?? 0;
    const orders = ordersBy.get(k) ?? 0;
    return {
      at,
      visits,
      orders,
      revenueCts: revenueBy.get(k) ?? 0,
      conversionRate: rate(orders, visits),
    };
  });
}

/**
 * **Unscoped by design.** Demand shape across every tenant.
 *
 * A real cross-tenant aggregate rather than a sum of per-tenant grids: the
 * loop-over-tenants version issues two queries per restaurant, so it gets
 * slower exactly as the platform succeeds. Reckoned in `PLATFORM_TZ`, which is
 * wrong for any individual tenant and right for the aggregate — the alternative
 * is summing several local clocks onto one grid and calling the result an hour.
 */
export async function platformHeatmap(f: AnalyticsFilter): Promise<HeatCell[]> {
  const tz = f.timezone;
  const simVisits = f.includeSimulated ? Prisma.empty : Prisma.sql`AND v."simulated" = false`;
  const simOrders = f.includeSimulated
    ? Prisma.empty
    : Prisma.sql`AND (o."paymentProvider" IS DISTINCT FROM 'sim')`;

  const [visitRows, orderRows]: [HeatRow[], HeatRow[]] = await Promise.all([
    prisma.$queryRaw<HeatRow[]>`
      SELECT EXTRACT(DOW FROM v."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS dow,
             EXTRACT(HOUR FROM v."startedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS hour,
             COUNT(*)::bigint AS n
      FROM "Visit" v
      WHERE v."startedAt" >= ${f.range.from} AND v."startedAt" < ${f.range.to} ${simVisits}
      GROUP BY 1, 2
    `,
    prisma.$queryRaw<HeatRow[]>`
      SELECT EXTRACT(DOW FROM o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS dow,
             EXTRACT(HOUR FROM o."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz})::int AS hour,
             COUNT(*)::bigint AS n
      FROM "Order" o
      WHERE o."createdAt" >= ${f.range.from} AND o."createdAt" < ${f.range.to}
        AND o."status" <> 'REJECTED' ${simOrders}
      GROUP BY 1, 2
    `,
  ]);

  const key = (d: number, h: number) => d * 24 + h;
  const visitsBy = new Map(visitRows.map((r) => [key(r.dow, r.hour), Number(r.n)]));
  const ordersBy = new Map(orderRows.map((r) => [key(r.dow, r.hour), Number(r.n)]));

  const cells: HeatCell[] = [];
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      cells.push({
        day: d,
        hour: h,
        visits: visitsBy.get(key(d, h)) ?? 0,
        orders: ordersBy.get(key(d, h)) ?? 0,
      });
    }
  }
  return cells;
}

/** Oldest visit or order for a tenant — what "all time" resolves against. */
export async function earliestActivity(restaurantId: string | null): Promise<Date | null> {
  const [visit, order] = await Promise.all([
    prisma.visit.findFirst({
      where: restaurantId ? { restaurantId } : {},
      orderBy: { startedAt: "asc" },
      select: { startedAt: true },
    }),
    prisma.order.findFirst({
      where: restaurantId ? { restaurantId } : {},
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
  ]);
  const dates = [visit?.startedAt, order?.createdAt].filter((d): d is Date => !!d);
  if (!dates.length) return null;
  return dates.reduce((a, b) => (a < b ? a : b));
}
