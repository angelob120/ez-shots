/**
 * The order simulator — fabricates customers, orders and trouble against a
 * real tenant so the dashboard, the board, the reports and the recovery paths
 * can be exercised without anyone standing at a till.
 *
 * This is the one door for simulated data, in the same sense that
 * `lib/orders.ts` is the one door for order status: every row this module
 * invents carries a marker (`SIM_PHONE_PREFIX` on the customer,
 * `SIM_PROVIDER_TAG` on the order) and `wipeSimulatedData` is the exact
 * inverse. Nothing else in the codebase writes those markers, which is the
 * only reason a wipe can be trusted to leave real trade alone. If you add a
 * generator here, it stamps the marker and the wipe finds it.
 *
 * Two rules it does *not* get to break:
 *
 * 1. **Creating an order in a given status is a create, not a transition**, so
 *    seeding writes `status` directly. Every subsequent move goes through
 *    `transitionOrder` / `cancelOrder` / `markNoShow` / `markItemsUnavailable`
 *    like anything else. A simulator that bypassed the state machine would be
 *    testing a system nobody ships.
 * 2. **Every simulated phone number is unroutable.** See `SIM_PHONE_PREFIX`.
 *    The paths being exercised are the ones that send things.
 *
 * Gated on `testModeEnabled()` — the same platform switch that shows the demo
 * scaffolding — and every caller is behind `requireAdmin()`. The gate is
 * re-checked here rather than only in the admin action, because hiding a
 * control is a courtesy and not enforcement.
 */

import { prisma } from "@/lib/prisma";
import { recordSimulatedVisit, wipeSimulatedAnalytics } from "@/lib/analytics";
import type { OrderStatus, Prisma } from "@prisma/client";
import { computeTotals, effectiveItemPriceCts } from "@/lib/money";
import {
  newOrderToken,
  transitionOrder,
  cancelOrder,
  markNoShow,
  markItemsUnavailable,
  reportIssue,
  lineFoodCts,
} from "@/lib/orders";
import { testModeEnabled } from "@/lib/payments";
import {
  SIM_PHONE_PREFIX,
  SIM_PROVIDER_TAG,
  SIM_PROFILES,
  SIM_NOTES,
  type SimProfileKey,
  type TroubleKey,
  clampInt,
  eventsFor,
  isLiveSimStatus,
  makeRng,
  pick,
  pickStatus,
  placedAgoMs,
  randInt,
  simName,
  simPhone,
  timestampsFor,
  type Rng,
} from "@/lib/simulator-data";

export * from "@/lib/simulator-data";

export type SimResult<T = void> = { ok: true; value: T; note: string } | { ok: false; error: string };

const MAX_ORDERS_PER_RUN = 250;

/**
 * Ceiling on browsing visits per run.
 *
 * Visits are an order of magnitude more numerous than orders — that's the
 * point of them — so a 250-order run at a realistic conversion rate wants a few
 * thousand. This caps it, because a seeding button that can spend two minutes
 * inserting rows is a button an operator learns to be afraid of.
 */
const MAX_SEEDED_VISITS = 2_000;

/**
 * Sources, weighted the way a real pickup restaurant's traffic falls.
 *
 * Not uniform, deliberately. A uniform draw makes every breakdown chart a flat
 * bar, which looks like a broken chart rather than seeded data — and the whole
 * value of the source panel is that some channels are obviously bigger and
 * some obviously convert better.
 */
const SIM_SOURCE_WEIGHTS: Array<{ source: "DIRECT" | "QR" | "SEARCH_ENGINE" | "SOCIAL" | "MAPS" | "SMS" | "REFERRAL"; weight: number; convertBoost: number }> = [
  { source: "DIRECT", weight: 26, convertBoost: 1.4 },
  { source: "MAPS", weight: 22, convertBoost: 1.0 },
  { source: "SEARCH_ENGINE", weight: 20, convertBoost: 0.8 },
  { source: "QR", weight: 12, convertBoost: 2.2 },
  { source: "SOCIAL", weight: 10, convertBoost: 0.5 },
  { source: "SMS", weight: 6, convertBoost: 2.6 },
  { source: "REFERRAL", weight: 4, convertBoost: 0.6 },
];

/** Phones dominate pickup ordering, and any seeded data that says otherwise
 *  would send someone off optimising a desktop layout nobody uses. */
const SIM_DEVICE_WEIGHTS: Array<{ device: "MOBILE" | "TABLET" | "DESKTOP"; weight: number }> = [
  { device: "MOBILE", weight: 78 },
  { device: "DESKTOP", weight: 17 },
  { device: "TABLET", weight: 5 },
];

function weightedPick<T extends { weight: number }>(rng: () => number, rows: T[]): T {
  const total = rows.reduce((n, r) => n + r.weight, 0);
  let roll = rng() * total;
  for (const r of rows) {
    roll -= r.weight;
    if (roll <= 0) return r;
  }
  return rows[rows.length - 1];
}

/**
 * The slice of a menu item an order line needs. Named rather than inferred
 * because the generated Prisma client is stale in the sandbox (see CLAUDE.md),
 * which turns the inferred payload into `unknown` and buries the real errors.
 */
type SimMenuItem = { id: string; name: string; priceCts: number; salePriceCts: number | null };

/**
 * Refuses to invent data on a platform that hasn't opted into test tooling.
 *
 * `testModeEnabled` is deliberately a *separate* switch from `paymentMode` (see
 * CLAUDE.md): a real Stripe test charge must not also arm a button that writes
 * two hundred fake orders into a tenant's customer list.
 */
async function assertSimulationAllowed(): Promise<string | null> {
  if (await testModeEnabled()) return null;
  return "Test tools are switched off. Turn them on at /admin/tools (Mode tab) first.";
}

/** Matches exactly the customers this module invented, and nothing else. */
export function simCustomerWhere(restaurantId: string): Prisma.CustomerWhereInput {
  return { restaurantId, phone: { startsWith: SIM_PHONE_PREFIX } };
}

// ---------------------------------------------------------------------------
// What's currently in there
// ---------------------------------------------------------------------------

export type SimSummary = {
  customers: number;
  orders: number;
  liveOrders: number;
  messages: number;
  openIssues: number;
  failedRefunds: number;
  simRevenueCts: number;
};

/**
 * The counts the panel leads with. An operator about to press "wipe" needs to
 * know what's about to disappear, and an operator looking at a board full of
 * tickets needs to know how many of them are imaginary.
 */
export async function simulationSummary(restaurantId: string): Promise<SimSummary> {
  const customers = await prisma.customer.findMany({
    where: simCustomerWhere(restaurantId),
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);
  const orderWhere = simOrderWhere(restaurantId, customerIds);

  const [orders, liveOrders, messages, openIssues, failedRefunds, revenue] = await Promise.all([
    prisma.order.count({ where: orderWhere }),
    prisma.order.count({
      where: { ...orderWhere, status: { in: ["RECEIVED", "ACCEPTED", "PREPARING", "READY"] } },
    }),
    customerIds.length
      ? prisma.message.count({ where: { restaurantId, customerId: { in: customerIds } } })
      : Promise.resolve(0),
    prisma.orderIssue.count({
      where: { restaurantId, status: { in: ["OPEN", "ACKNOWLEDGED"] }, order: orderWhere },
    }),
    prisma.refund.count({ where: { status: "FAILED", resolvedAt: null, order: orderWhere } }),
    prisma.order.aggregate({ where: orderWhere, _sum: { totalCts: true } }),
  ]);

  return {
    customers: customerIds.length,
    orders,
    liveOrders,
    messages,
    openIssues,
    failedRefunds,
    simRevenueCts: revenue._sum.totalCts ?? 0,
  };
}

function simOrderWhere(restaurantId: string, customerIds: string[]): Prisma.OrderWhereInput {
  // Either marker is enough. The customer link is the normal one; the provider
  // tag survives a customer row going missing, which is what makes a partially
  // failed wipe recoverable rather than permanent litter.
  return {
    restaurantId,
    OR: [
      { paymentProvider: SIM_PROVIDER_TAG },
      ...(customerIds.length ? [{ customerId: { in: customerIds } }] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Seeding orders
// ---------------------------------------------------------------------------

export type SimulateOrdersInput = {
  restaurantId: string;
  count?: number;
  /** How far back terminal orders are spread. Live ones are always recent. */
  days?: number;
  /** 0–100. The rest of the orders reuse an existing simulated customer. */
  newCustomerPct?: number;
  profile?: SimProfileKey;
  /** Same seed, same run — useful when chasing a bug you only saw once. */
  seed?: number;
};

export async function simulateOrders(
  input: SimulateOrdersInput
): Promise<SimResult<{ orders: number; customers: number }>> {
  const blocked = await assertSimulationAllowed();
  if (blocked) return { ok: false, error: blocked };

  const count = clampInt(input.count, 1, MAX_ORDERS_PER_RUN, 20);
  const days = clampInt(input.days, 0, 365, 14);
  const newPct = clampInt(input.newCustomerPct, 0, 100, 40);
  const profile = SIM_PROFILES[input.profile ?? "shift"] ?? SIM_PROFILES.shift;
  const rng = makeRng(input.seed ?? Date.now());

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    include: {
      items: {
        where: { available: true },
        select: { id: true, name: true, priceCts: true, salePriceCts: true },
      },
    },
  });
  if (!restaurant) return { ok: false, error: "Restaurant not found." };
  const menu = restaurant.items as SimMenuItem[];
  if (!menu.length) {
    return {
      ok: false,
      error: "This tenant has no available menu items — seed a menu first, or there's nothing to order.",
    };
  }

  // Existing simulated customers are candidates for reuse, so repeat-customer
  // metrics (orderCount, lifetimeCts, the new-vs-returning donut) have anything
  // to measure. A simulator that only ever invents first-time buyers makes the
  // entire retention product look broken.
  const existing = await prisma.customer.findMany({
    where: simCustomerWhere(input.restaurantId),
    select: { id: true },
  });
  const pool = existing.map((c) => c.id);
  let newCustomers = 0;

  // Order numbers are unique per tenant. Start past whatever is already there
  // and walk forward; a collision (a real order landing mid-run) just takes the
  // next number rather than aborting the batch.
  let seq = await prisma.order.count({ where: { restaurantId: input.restaurantId } });
  let created = 0;

  for (let i = 0; i < count; i++) {
    const status = pickStatus(rng, profile);
    const placedAt = new Date(Date.now() - placedAgoMs(rng, status, days));
    const ts = timestampsFor(status, placedAt, restaurant.prepMinutes);

    // Lines. Modifiers are deliberately not simulated: they'd have to be drawn
    // from each item's real groups to be valid, and an invalid modifier snapshot
    // is worse than none — OrderItemModifier is what a dispute is settled from.
    const lineCount = randInt(rng, 1, 3);
    const lines = Array.from({ length: lineCount }, () => {
      const item = pick(rng, menu);
      return {
        item,
        qty: randInt(rng, 1, 3),
        unitPriceCts: effectiveItemPriceCts(item),
      };
    });

    const subtotalCts = lines.reduce(
      (a, l) => a + lineFoodCts({ unitPriceCts: l.unitPriceCts, modifiersCts: 0, qty: l.qty }),
      0
    );
    const totals = computeTotals(subtotalCts, restaurant);

    const customerId =
      pool.length > 0 && rng() * 100 >= newPct
        ? pick(rng, pool)
        : await createSimCustomer(input.restaurantId, rng, placedAt).then((id) => {
            pool.push(id);
            newCustomers++;
            return id;
          });

    // A canceled or rejected order was refunded in full — that's what the
    // customer-facing copy on those two statuses promises, so the money has to
    // agree with it.
    const refundedCts = ts.canceledAt ? totals.totalCts : 0;

    const order = await prisma.order.create({
      data: {
        restaurantId: input.restaurantId,
        customerId,
        number: `A-${8000 + (++seq % 90000)}`,
        status,
        publicToken: newOrderToken(),
        subtotalCts: totals.subtotalCts,
        surchargeCts: totals.surchargeCts,
        taxCts: totals.taxCts,
        totalCts: totals.totalCts,
        refundedCts,
        fulfillment: "pickup",
        notes: pick(rng, SIM_NOTES) || null,
        paymentProvider: SIM_PROVIDER_TAG,
        paymentReference: `sim_${newOrderToken().slice(0, 12)}`,
        paymentStatus: "sim_succeeded",
        createdAt: ts.createdAt,
        promisedAt: ts.promisedAt,
        acceptedAt: ts.acceptedAt,
        readyAt: ts.readyAt,
        completedAt: ts.completedAt,
        canceledAt: ts.canceledAt,
        problem: ts.canceledAt ? (status === "REJECTED" ? "TOO_BUSY" : "KITCHEN_ISSUE") : null,
        endedBy: ts.canceledAt ? "RESTAURANT" : null,
        items: {
          create: lines.map((l) => ({
            menuItemId: l.item.id,
            name: l.item.name,
            unitPriceCts: l.unitPriceCts,
            modifiersCts: 0,
            qty: l.qty,
          })),
        },
      },
      select: { id: true },
    });

    await prisma.orderEvent.createMany({
      data: eventsFor(status, ts).map((e) => ({
        orderId: order.id,
        kind: e.kind,
        actor: e.actor,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
        publicNote: e.publicNote ?? null,
        meta: { simulated: true },
        createdAt: e.at,
      })),
    });

    if (refundedCts > 0) {
      await prisma.refund.create({
        data: {
          orderId: order.id,
          amountCts: refundedCts,
          reason: status === "REJECTED" ? "TOO_BUSY" : "KITCHEN_ISSUE",
          includedSurcharge: true,
          status: "SUCCEEDED",
          provider: SIM_PROVIDER_TAG,
          providerRef: `sim_re_${newOrderToken().slice(0, 10)}`,
          issuedBy: "RESTAURANT",
          attempts: 1,
          createdAt: ts.canceledAt!,
          succeededAt: ts.canceledAt!,
        },
      });
    }

    await prisma.rewardsLedger.create({
      data: {
        customerId,
        points: Math.round(totals.subtotalCts / 100),
        reason: "order",
        orderId: order.id,
        createdAt: ts.createdAt,
      },
    });

    // Counters, matching `placeOrderAction`'s rule rather than inventing a new
    // one: a cancellation that returned every cent doesn't count as trade.
    await prisma.customer.update({
      where: { id: customerId },
      data: {
        lastOrderAt: ts.createdAt,
        ...(refundedCts >= totals.totalCts
          ? {}
          : { orderCount: { increment: 1 }, lifetimeCts: { increment: totals.totalCts } }),
      },
    });

    // The visit that "produced" this order. Written after the order so it can
    // carry the real id — an attributed visit with a dangling orderId would
    // make the conversion column disagree with the revenue column, which is
    // the specific bug an operator uses this tool to rule out.
    await seedConvertingVisit({
      restaurantId: input.restaurantId,
      rng,
      placedAt: ts.createdAt,
      orderId: order.id,
      totalCts: totals.totalCts,
      lines,
      menu,
    });

    created++;
  }

  // The visits that produced nothing.
  //
  // Without these the tenant converts at exactly 100%, which makes every
  // funnel, drop-off list and source comparison in the product render as a
  // straight line — the panels would look like they were working while
  // measuring a business that cannot exist. The ratio is drawn per run rather
  // than fixed so two seeded tenants don't look suspiciously identical.
  const browsers = Math.min(MAX_SEEDED_VISITS, created * randInt(rng, 5, 13));
  await seedBrowsingVisits({
    restaurantId: input.restaurantId,
    rng,
    count: browsers,
    days,
    menu,
  });

  // firstOrderAt is only correct once every order exists, since orders are
  // generated in random time order rather than chronologically.
  await resyncFirstOrderAt(input.restaurantId, pool);

  return {
    ok: true,
    value: { orders: created, customers: newCustomers },
    note: `Seeded ${created} ${profile.label.toLowerCase()} orders (${newCustomers} new customers) across ${days} days.`,
  };
}

async function createSimCustomer(restaurantId: string, rng: Rng, at: Date): Promise<string> {
  // Collisions are possible in a 10,000-number block, so take the next free
  // slot rather than failing the batch.
  for (let attempt = 0; attempt < 40; attempt++) {
    const phone = simPhone(randInt(rng, 0, 9999));
    const clash = await prisma.customer.findUnique({
      where: { restaurantId_phone: { restaurantId, phone } },
      select: { id: true },
    });
    if (clash) continue;

    const created = await prisma.customer.create({
      data: {
        restaurantId,
        phone,
        name: simName(rng),
        // Most real checkouts opt in; a minority don't, and the minority is the
        // interesting case — it's what proves the consent gate is doing work.
        ...(rng() < 0.75
          ? {
              optInStatus: "OPTED_IN" as const,
              optInAt: at,
              optInSource: "simulator",
              optInText: "Simulated consent — this number is not routable.",
            }
          : {}),
        cohort: rng() < 0.2 ? "HOLDOUT" : "TREATMENT",
        firstOrderAt: at,
        lastOrderAt: at,
        createdAt: at,
      },
      select: { id: true },
    });
    return created.id;
  }
  throw new Error("Simulated phone block is full — wipe simulated data before seeding more.");
}

// ---------------------------------------------------------------------------
// Seeding storefront traffic
// ---------------------------------------------------------------------------

/**
 * The visit behind a simulated order.
 *
 * Walks the same path the storefront actually produces — landing, menu, an item
 * or two, cart, checkout — because the drop-off and funnel panels read the
 * *last* view and the milestone booleans, and a timeline that skipped straight
 * from PAGE_VIEW to ORDER_PLACED would render as a funnel with no middle.
 *
 * The ORDER_PLACED event and `converted` are set by `recordSimulatedVisit` from
 * the `orderId` argument, not invented here, so seeded conversions obey exactly
 * the rule real ones do: a visit is converted because an order points at it.
 */
async function seedConvertingVisit(args: {
  restaurantId: string;
  rng: () => number;
  placedAt: Date;
  orderId: string;
  totalCts: number;
  lines: Array<{ item: SimMenuItem; qty: number; unitPriceCts: number }>;
  menu: SimMenuItem[];
}) {
  const { rng, lines, menu } = args;

  // Someone who buys has usually read for a while. Ninety seconds to six
  // minutes, which is roughly where honest storefront sessions land.
  const dwellMs = randInt(rng, 90, 360) * 1000;
  const startedAt = new Date(args.placedAt.getTime() - dwellMs);

  const events: Parameters<typeof recordSimulatedVisit>[0]["events"] = [
    { kind: "PAGE_VIEW", offsetMs: 0, view: "landing" },
    { kind: "VIEW_CHANGE", offsetMs: Math.round(dwellMs * 0.08), view: "menu" },
  ];

  // A couple of items they looked at and didn't buy, so the item table has a
  // view-to-add ratio below 100% to show.
  const browsed = randInt(rng, 0, 3);
  for (let i = 0; i < browsed; i++) {
    events.push({
      kind: "ITEM_VIEW",
      offsetMs: Math.round(dwellMs * (0.12 + i * 0.06)),
      itemId: pick(rng, menu).id,
      view: "item",
    });
  }

  lines.forEach((l, i) => {
    const base = 0.3 + i * 0.12;
    events.push({
      kind: "ITEM_VIEW",
      offsetMs: Math.round(dwellMs * base),
      itemId: l.item.id,
      view: "item",
    });
    events.push({
      kind: "ITEM_ADD",
      offsetMs: Math.round(dwellMs * (base + 0.04)),
      itemId: l.item.id,
      view: "item",
      valueCts: l.unitPriceCts * l.qty,
    });
  });

  events.push({ kind: "CART_VIEW", offsetMs: Math.round(dwellMs * 0.82), view: "cart" });
  events.push({
    kind: "CHECKOUT_START",
    offsetMs: Math.round(dwellMs * 0.9),
    view: "checkout",
    valueCts: args.totalCts,
  });

  const source = weightedPick(rng, SIM_SOURCE_WEIGHTS).source;

  await recordSimulatedVisit({
    restaurantId: args.restaurantId,
    anonId: simAnonId(rng),
    startedAt,
    dwellMs,
    source,
    device: weightedPick(rng, SIM_DEVICE_WEIGHTS).device,
    orderId: args.orderId,
    totalCts: args.totalCts,
    events,
  });
}

/**
 * Visits that came and went.
 *
 * The distribution matters more than the volume. Real storefront traffic is
 * mostly shallow — a large share never gets past the landing screen — with a
 * thinning tail that reaches the cart and stops. Seeding a uniform spread would
 * produce a funnel with equal steps, which is the one shape the funnel panel
 * exists to tell you that you don't have.
 */
async function seedBrowsingVisits(args: {
  restaurantId: string;
  rng: () => number;
  count: number;
  days: number;
  menu: SimMenuItem[];
}) {
  const { rng, menu } = args;

  for (let i = 0; i < args.count; i++) {
    const channel = weightedPick(rng, SIM_SOURCE_WEIGHTS);

    // How far down the funnel this one got, 0–4. Biased shallow, then nudged
    // by the channel — a QR scan at the counter is a customer with intent, a
    // stray social click mostly isn't.
    const roll = Math.min(1, rng() ** 1.9 * channel.convertBoost);
    const depth = Math.min(4, Math.floor(roll * 5));

    // A bounce is seconds; someone who reached the cart and thought about it
    // is minutes. Tying dwell to depth is what makes the "time on page" metric
    // move with the funnel instead of drifting independently of it.
    const dwellMs = depth === 0 ? randInt(rng, 3, 25) * 1000 : randInt(rng, 25, 300) * 1000;

    const startedAt = new Date(
      Date.now() - Math.round(rng() * Math.max(1, args.days) * 86400000) - dwellMs
    );

    const events: Parameters<typeof recordSimulatedVisit>[0]["events"] = [
      { kind: "PAGE_VIEW", offsetMs: 0, view: "landing" },
    ];

    if (depth >= 1) {
      events.push({ kind: "VIEW_CHANGE", offsetMs: Math.round(dwellMs * 0.2), view: "menu" });
      // Some of them search. These are the rows that make the search-terms
      // panel useful, including the ones that never lead anywhere.
      if (rng() < 0.25) {
        events.push({
          kind: "SEARCH",
          offsetMs: Math.round(dwellMs * 0.3),
          view: "menu",
          label: pick(rng, menu).name.split(" ")[0].toLowerCase(),
        });
      }
    }
    if (depth >= 2) {
      const item = pick(rng, menu);
      events.push({ kind: "ITEM_VIEW", offsetMs: Math.round(dwellMs * 0.45), itemId: item.id, view: "item" });
    }
    if (depth >= 3) {
      const item = pick(rng, menu);
      events.push({
        kind: "ITEM_ADD",
        offsetMs: Math.round(dwellMs * 0.6),
        itemId: item.id,
        view: "item",
        valueCts: effectiveItemPriceCts(item),
      });
      events.push({ kind: "CART_VIEW", offsetMs: Math.round(dwellMs * 0.75), view: "cart" });
    }
    if (depth >= 4) {
      events.push({ kind: "CHECKOUT_START", offsetMs: Math.round(dwellMs * 0.9), view: "checkout" });
      // The most instructive seeded row in the set: reached checkout, hit a
      // problem, left. Without a few of these the drop-off panel never has a
      // checkout column, and that column is the one worth building it for.
      if (rng() < 0.35) {
        events.push({
          kind: "CHECKOUT_ERROR",
          offsetMs: Math.round(dwellMs * 0.95),
          view: "checkout",
          label: rng() < 0.5 ? "declined" : "closed",
        });
      }
    }

    await recordSimulatedVisit({
      restaurantId: args.restaurantId,
      anonId: simAnonId(rng),
      startedAt,
      dwellMs,
      source: channel.source,
      device: weightedPick(rng, SIM_DEVICE_WEIGHTS).device,
      events,
    });
  }
}

/**
 * A simulated anonymous id.
 *
 * Prefixed `sim`, which is belt and braces rather than the actual safety
 * mechanism — `Visit.simulated` is what the wipe reads. The prefix is here so
 * that anyone who ever finds one of these ids in a log or a debugging session
 * knows immediately it isn't a person.
 */
function simAnonId(rng: () => number): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "sim";
  for (let i = 0; i < 15; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

async function resyncFirstOrderAt(restaurantId: string, customerIds: string[]) {
  if (!customerIds.length) return;
  const firsts = await prisma.order.groupBy({
    by: ["customerId"],
    where: { restaurantId, customerId: { in: customerIds } },
    _min: { createdAt: true },
  });
  for (const f of firsts) {
    if (!f.customerId || !f._min.createdAt) continue;
    await prisma.customer.update({
      where: { id: f.customerId },
      data: { firstOrderAt: f._min.createdAt },
    });
  }
}

// ---------------------------------------------------------------------------
// Driving the shift forward
// ---------------------------------------------------------------------------

const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  RECEIVED: "ACCEPTED",
  ACCEPTED: "PREPARING",
  PREPARING: "READY",
  READY: "COMPLETED",
};

/**
 * Nudge every live simulated order one step along.
 *
 * Goes through `transitionOrder`, so this is a genuine exercise of the state
 * machine, the event log and the customer notifications rather than a set of
 * status writes that happen to look like one. Real orders are untouched: a
 * testing tool that could complete a paying customer's ticket is not a testing
 * tool.
 */
export async function advanceOrders(input: {
  restaurantId: string;
  steps?: number;
}): Promise<SimResult<{ moved: number }>> {
  const blocked = await assertSimulationAllowed();
  if (blocked) return { ok: false, error: blocked };

  const steps = clampInt(input.steps, 1, 5, 1);
  let moved = 0;

  for (let step = 0; step < steps; step++) {
    const live = await prisma.order.findMany({
      where: {
        restaurantId: input.restaurantId,
        paymentProvider: SIM_PROVIDER_TAG,
        status: { in: ["RECEIVED", "ACCEPTED", "PREPARING", "READY"] },
      },
      select: { id: true, status: true },
    });
    if (!live.length) break;

    for (const o of live) {
      const to = NEXT_STATUS[o.status];
      if (!to) continue;
      const res = await transitionOrder({
        orderId: o.id,
        restaurantId: input.restaurantId,
        to,
        actor: "ADMIN",
        note: "Simulator advanced the shift.",
      });
      if (res.ok) moved++;
    }
  }

  return {
    ok: true,
    value: { moved },
    note: moved ? `Moved ${moved} tickets forward.` : "Nothing live to move.",
  };
}

// ---------------------------------------------------------------------------
// Injecting trouble
// ---------------------------------------------------------------------------

/**
 * Put one specific broken state in front of the operator.
 *
 * Every scenario here corresponds to a piece of recovery UI or a sweep that is
 * otherwise almost impossible to see: you cannot make a refund fail on demand,
 * and you cannot wait ten minutes for an unattended ticket every time you touch
 * the board. Each one reaches for the real door where a real door exists — a
 * no-show goes through `markNoShow`, a complaint through `reportIssue` — and
 * only fabricates a row where no door can produce the state (a provider
 * failure, by definition, can't be requested).
 */
export async function injectTrouble(input: {
  restaurantId: string;
  scenario: TroubleKey;
}): Promise<SimResult<{ detail: string }>> {
  const blocked = await assertSimulationAllowed();
  if (blocked) return { ok: false, error: blocked };

  const rng = makeRng(Date.now());

  switch (input.scenario) {
    case "stale_order":
      return seedSingle(input.restaurantId, rng, "RECEIVED", async (r) => {
        const mins = Math.max(1, r.autoExpireMins) + 5;
        return { placedAt: new Date(Date.now() - mins * 60_000), detail: `Placed ${mins} minutes ago and never acknowledged. The next sweep should reject and refund it.` };
      });

    case "overdue_order":
      return seedSingle(input.restaurantId, rng, "PREPARING", async (r) => ({
        placedAt: new Date(Date.now() - (r.prepMinutes + 40) * 60_000),
        detail: "Promised time is 40 minutes gone. The next sweep should apologise once.",
      }));

    case "no_show":
      return seedSingle(input.restaurantId, rng, "READY", async () => ({
        placedAt: new Date(Date.now() - 70 * 60_000),
        detail: "Ready and uncollected for over an hour — the board should now offer to close it out.",
      }));

    case "partial_86": {
      const order = await prisma.order.findFirst({
        where: {
          restaurantId: input.restaurantId,
          paymentProvider: SIM_PROVIDER_TAG,
          status: { in: ["RECEIVED", "ACCEPTED", "PREPARING"] },
        },
        include: { items: true },
        orderBy: { createdAt: "desc" },
      });
      if (!order || !order.items.length) {
        return { ok: false, error: "No live simulated order to 86 — seed a busy shift first." };
      }
      const line = order.items[0];
      const current = line.fulfilledQty ?? line.qty;
      const res = await markItemsUnavailable({
        orderId: order.id,
        restaurantId: input.restaurantId,
        lines: [{ orderItemId: line.id, fulfilledQty: Math.max(0, current - 1) }],
        actor: "ADMIN",
        note: "Simulated 86.",
      });
      if (!res.ok) return { ok: false, error: res.error };
      return {
        ok: true,
        value: { detail: `Dropped one ${line.name} from ${order.number}; refunded ${res.value.refundedCts} cents.` },
        note: "Out-of-stock injected.",
      };
    }

    case "open_issue": {
      const order = await prisma.order.findFirst({
        where: { restaurantId: input.restaurantId, paymentProvider: SIM_PROVIDER_TAG, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        select: { publicToken: true, number: true },
      });
      if (!order) return { ok: false, error: "No completed simulated order to complain about — seed some past trade first." };

      const res = await reportIssue({
        token: order.publicToken,
        kind: pick(rng, ["MISSING_ITEM", "WRONG_ITEM", "QUALITY", "LONG_WAIT"] as const),
        body: "Simulated complaint: one of the items was missing from the bag.",
      });
      if (!res.ok) return { ok: false, error: res.error };
      return { ok: true, value: { detail: `Complaint filed against ${order.number}.` }, note: "Issue injected." };
    }

    case "failed_refund": {
      const order = await prisma.order.findFirst({
        where: {
          restaurantId: input.restaurantId,
          paymentProvider: SIM_PROVIDER_TAG,
          status: "COMPLETED",
          refundedCts: 0,
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, number: true, totalCts: true },
      });
      if (!order) return { ok: false, error: "No un-refunded completed simulated order — seed some past trade first." };

      // Written directly rather than through `issueRefund`, and that's the one
      // place this module doesn't use the front door. It can't: the stub
      // provider always succeeds, so the only way to produce a provider failure
      // is to write the outcome. Note this leaves `Order.refundedCts` at zero —
      // which is precisely what `issueRefund` does on a failure, since it
      // reserves the amount and releases it again. The invariant holds.
      const refund = await prisma.refund.create({
        data: {
          orderId: order.id,
          amountCts: Math.round(order.totalCts / 2),
          reason: "QUALITY",
          note: "Simulated provider failure.",
          includedSurcharge: true,
          status: "FAILED",
          provider: SIM_PROVIDER_TAG,
          error: "simulated_card_declined: the customer's bank refused the reversal.",
          issuedBy: "RESTAURANT",
          attempts: 1,
        },
        select: { id: true },
      });
      return {
        ok: true,
        value: { detail: `Outstanding failed refund on ${order.number} (${refund.id}). The dashboard banner should be shouting.` },
        note: "Failed refund injected.",
      };
    }

    case "failed_message": {
      const customer = await prisma.customer.findFirst({
        where: simCustomerWhere(input.restaurantId),
        select: { id: true, phone: true },
      });
      if (!customer) return { ok: false, error: "No simulated customers yet — seed some orders first." };

      await prisma.message.create({
        data: {
          restaurantId: input.restaurantId,
          customerId: customer.id,
          kind: "TRANSACTIONAL",
          status: "FAILED",
          body: "Simulated send that failed on a transient provider error.",
          to: customer.phone,
          provider: SIM_PROVIDER_TAG,
          error: "simulated_timeout",
          attempts: 1,
          // The retry sweep reads exactly this field. A permanent failure
          // (retryable: false) must never be re-attempted, so injecting a
          // retryable one is the only version that tests the queue.
          retryable: true,
        },
      });
      return {
        ok: true,
        value: { detail: `Queued a retryable failure to ${customer.phone}.` },
        note: "Failed message injected.",
      };
    }

    case "opted_out": {
      const customer = await prisma.customer.findFirst({
        where: { ...simCustomerWhere(input.restaurantId), optOutAt: null },
        select: { id: true, phone: true },
      });
      if (!customer) return { ok: false, error: "No opted-in simulated customer to opt out — seed some orders first." };

      await prisma.customer.update({
        where: { id: customer.id },
        data: { optInStatus: "OPTED_OUT", optOutAt: new Date() },
      });
      return {
        ok: true,
        value: { detail: `${customer.phone} has replied STOP. Every send to them from now on — transactional included — should log SKIPPED.` },
        note: "Opt-out injected.",
      };
    }

    default:
      return { ok: false, error: "Unknown scenario." };
  }
}

/**
 * Shared body for the scenarios that need one purpose-built order in a
 * particular status at a particular age.
 */
async function seedSingle(
  restaurantId: string,
  rng: Rng,
  status: OrderStatus,
  plan: (r: { prepMinutes: number; autoExpireMins: number }) => Promise<{ placedAt: Date; detail: string }>
): Promise<SimResult<{ detail: string }>> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: {
      items: { where: { available: true }, select: { id: true, name: true, priceCts: true, salePriceCts: true }, take: 20 },
    },
  });
  if (!restaurant) return { ok: false, error: "Restaurant not found." };
  const menu = restaurant.items as SimMenuItem[];
  if (!menu.length) return { ok: false, error: "This tenant has no available menu items." };

  const { placedAt, detail } = await plan(restaurant);
  const ts = timestampsFor(status, placedAt, restaurant.prepMinutes);
  const item = pick(rng, menu);
  const qty = randInt(rng, 1, 2);
  const unitPriceCts = effectiveItemPriceCts(item);
  const totals = computeTotals(lineFoodCts({ unitPriceCts, modifiersCts: 0, qty }), restaurant);

  const customerId = await createSimCustomer(restaurantId, rng, placedAt);
  const seq = await prisma.order.count({ where: { restaurantId } });

  const order = await prisma.order.create({
    data: {
      restaurantId,
      customerId,
      number: `A-${8000 + ((seq + 1) % 90000)}`,
      status,
      publicToken: newOrderToken(),
      subtotalCts: totals.subtotalCts,
      surchargeCts: totals.surchargeCts,
      taxCts: totals.taxCts,
      totalCts: totals.totalCts,
      paymentProvider: SIM_PROVIDER_TAG,
      paymentReference: `sim_${newOrderToken().slice(0, 12)}`,
      paymentStatus: "sim_succeeded",
      createdAt: ts.createdAt,
      promisedAt: ts.promisedAt,
      acceptedAt: ts.acceptedAt,
      readyAt: ts.readyAt,
      items: { create: [{ menuItemId: item.id, name: item.name, unitPriceCts, modifiersCts: 0, qty }] },
    },
    select: { id: true, number: true },
  });

  await prisma.orderEvent.createMany({
    data: eventsFor(status, ts).map((e) => ({
      orderId: order.id,
      kind: e.kind,
      actor: e.actor,
      fromStatus: e.fromStatus ?? null,
      toStatus: e.toStatus ?? null,
      publicNote: e.publicNote ?? null,
      meta: { simulated: true },
      createdAt: e.at,
    })),
  });

  return { ok: true, value: { detail: `${order.number}: ${detail}` }, note: "Scenario injected." };
}

/**
 * Close out a no-show through the real door, for the operator who wants to see
 * what `markNoShow` does rather than only that the prompt appears.
 */
export async function closeNoShow(input: {
  restaurantId: string;
  refund: "auto" | "none";
}): Promise<SimResult<{ detail: string }>> {
  const blocked = await assertSimulationAllowed();
  if (blocked) return { ok: false, error: blocked };

  const order = await prisma.order.findFirst({
    where: { restaurantId: input.restaurantId, paymentProvider: SIM_PROVIDER_TAG, status: "READY" },
    orderBy: { readyAt: "asc" },
    select: { id: true, number: true },
  });
  if (!order) return { ok: false, error: "No simulated order is sitting READY." };

  const res = await markNoShow({
    orderId: order.id,
    restaurantId: input.restaurantId,
    actor: "ADMIN",
    note: "Simulated no-show.",
    refund: input.refund,
  });
  if (!res.ok) return { ok: false, error: res.error };
  return {
    ok: true,
    value: { detail: `${order.number} closed as a no-show; ${res.value.refundedCts} cents refunded.` },
    note: "No-show closed.",
  };
}

/** Cancel every live simulated order, through `cancelOrder`. */
export async function cancelSimulatedOrders(
  restaurantId: string
): Promise<SimResult<{ canceled: number }>> {
  const blocked = await assertSimulationAllowed();
  if (blocked) return { ok: false, error: blocked };

  const live = await prisma.order.findMany({
    where: {
      restaurantId,
      paymentProvider: SIM_PROVIDER_TAG,
      status: { in: ["RECEIVED", "ACCEPTED", "PREPARING", "READY"] },
    },
    select: { id: true },
  });

  let canceled = 0;
  for (const o of live) {
    const res = await cancelOrder({
      orderId: o.id,
      restaurantId,
      problem: "OTHER",
      actor: "ADMIN",
      note: "Simulator cleared the board.",
      refund: "auto",
    });
    if (res.ok) canceled++;
  }
  return { ok: true, value: { canceled }, note: `Canceled and refunded ${canceled} simulated tickets.` };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

export type WipeCounts = {
  orders: number;
  customers: number;
  messages: number;
};

/**
 * The exact inverse of everything above.
 *
 * Deletes only rows carrying a simulator marker, and deletes orders *before*
 * customers on purpose: `Order.customerId` is `onDelete: SetNull`, so removing
 * the customers first would strand their orders with no owner and no way to
 * find them again except the provider tag. Order deletion cascades to items,
 * modifiers, events, refunds and issues; customer deletion cascades to the
 * rewards ledger.
 *
 * Deliberately not wrapped in a single transaction: a batch of a few hundred
 * cascading deletes is long enough to matter, and a wipe that half-finished is
 * harmless (run it again) whereas a wipe that times out and rolls back leaves
 * the operator with no way to clear a tenant at all.
 */
export async function wipeSimulatedData(restaurantId: string): Promise<SimResult<WipeCounts>> {
  const blocked = await assertSimulationAllowed();
  if (blocked) return { ok: false, error: blocked };

  const customers = await prisma.customer.findMany({
    where: simCustomerWhere(restaurantId),
    select: { id: true },
  });
  const customerIds = customers.map((c) => c.id);

  const messages = customerIds.length
    ? await prisma.message.deleteMany({ where: { restaurantId, customerId: { in: customerIds } } })
    : { count: 0 };

  const orders = await prisma.order.deleteMany({
    where: simOrderWhere(restaurantId, customerIds),
  });

  const removedCustomers = customerIds.length
    ? await prisma.customer.deleteMany({ where: { id: { in: customerIds } } })
    : { count: 0 };

  // Analytics carries its own marker (`Visit.simulated`) rather than being
  // reached through the customer or order links, because a visit has neither
  // until it converts — most of them never do. Wiping by that flag is what
  // makes this safe on a tenant with real traffic; wiping by "visits attached
  // to simulated orders" would leave every invented bounce behind forever.
  const analytics = await wipeSimulatedAnalytics(restaurantId);

  return {
    ok: true,
    value: { orders: orders.count, customers: removedCustomers.count, messages: messages.count },
    note: `Removed ${orders.count} orders, ${removedCustomers.count} customers, ${messages.count} messages and ${analytics.visits} simulated visits. Real trade untouched.`,
  };
}
