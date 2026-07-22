/**
 * Storefront analytics — the ingest door.
 *
 * This is the only module that writes `Visit` or `VisitEvent`. Everything that
 * measures the storefront comes through `recordEvents`, for the same reason
 * `lib/orders.ts` owns `Order.status`: the invariants below are only invariants
 * because there is one place to enforce them.
 *
 * What it enforces, and why each one matters:
 *
 * - **The client never names the tenant.** A beacon carries a slug; the slug is
 *   resolved here against `tenantWhere`. Accepting a `restaurantId` from a
 *   public, unauthenticated endpoint would let anyone write rows into any
 *   tenant's numbers — the analytics equivalent of the isolation rule the rest
 *   of the codebase follows for queries.
 *
 * - **Fields are allowlisted, not merged.** There is no free-form `meta` bag.
 *   Events carry a fixed set of typed columns and a `label` that is only ever
 *   populated from a small set of kinds. An open JSON field on a public
 *   endpoint is how a phone number ends up in an analytics table, and once it
 *   is there it is in every backup.
 *
 * - **Dwell time is clamped at write.** A tab left open overnight is not a
 *   nine-hour visit. One such row moves a tenant's average session length more
 *   than a hundred honest ones, and an owner who sees "average visit: 4h" stops
 *   believing the rest of the page. Clamping on read would leave the bad number
 *   in the table for the next person to trip over.
 *
 * - **Sessions are stitched server-side.** The browser proposes an `anonId`;
 *   whether that is a continuing visit or a new one is decided here, by
 *   `SESSION_GAP_MS` against `lastSeenAt`. A client-supplied visit id would
 *   make session count a number the client controls.
 *
 * The `anonId` deserves its own note: it is a random value the browser mints
 * into localStorage, per tenant. It is not derived from an IP, a user agent, or
 * any fingerprint, it is never joined to `Customer`, and it identifies nobody.
 * It exists to tell "one person who came back four times" apart from "four
 * people", which is the difference between a regular and a rush.
 */

import type { Prisma, VisitDevice, VisitEventKind, VisitSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { tenantWhere } from "@/lib/domains";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * Gap after which a returning `anonId` is a new visit rather than the same one
 * continuing. Thirty minutes is the web-analytics convention and it fits the
 * behaviour this measures: somebody who opens the menu, gets distracted, and
 * comes back an hour later made two decisions to order, not one.
 */
export const SESSION_GAP_MS = 30 * 60 * 1000;

/**
 * Ceiling on a single visit's dwell time. Ninety minutes is well past any
 * honest pickup-ordering session and well short of "this tab has been open
 * since Tuesday".
 */
export const MAX_DWELL_MS = 90 * 60 * 1000;

/** Ceiling on a single event's dwell contribution — one screen, one sitting. */
export const MAX_EVENT_DWELL_MS = 30 * 60 * 1000;

/** Most events one beacon may carry. The tracker batches; it doesn't dump. */
export const MAX_EVENTS_PER_BEACON = 40;

/** Longest `label` we will store. Search terms are short; anything long is not one. */
export const MAX_LABEL_LEN = 80;

/**
 * Kinds allowed to carry a `label` at all.
 *
 * A search term is genuinely useful — "what did people look for and not find"
 * is one of the few things that tells an owner what to put on the menu. An
 * error code tells them why checkout is failing. Nothing else needs free text,
 * so nothing else gets it.
 */
const LABEL_KINDS: ReadonlySet<VisitEventKind> = new Set<VisitEventKind>([
  "SEARCH",
  "CHECKOUT_ERROR",
]);

const EVENT_KINDS: ReadonlySet<string> = new Set([
  "PAGE_VIEW",
  "VIEW_CHANGE",
  "ITEM_VIEW",
  "ITEM_ADD",
  "ITEM_REMOVE",
  "CART_VIEW",
  "CHECKOUT_START",
  "CHECKOUT_ERROR",
  "ORDER_PLACED",
  "SEARCH",
  "HEARTBEAT",
]);

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export type IncomingEvent = {
  kind: string;
  /** Client clock, milliseconds. Sanity-checked against the server's — see `resolveAt`. */
  at?: number;
  itemId?: string | null;
  view?: string | null;
  valueCts?: number | null;
  dwellMs?: number | null;
  label?: string | null;
};

export type TrackInput = {
  /** Tenant slug or verified custom domain. Resolved here, never trusted as an id. */
  slug: string;
  anonId: string;
  /** Only read on the first event of a visit; ignored afterwards. */
  source?: string | null;
  referrer?: string | null;
  userAgent?: string | null;
  events: IncomingEvent[];
};

export type TrackResult =
  | { ok: true; visitId: string; accepted: number }
  | { ok: false; reason: "unknown_tenant" | "no_events" | "bad_input" };

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/** A random-looking opaque string and nothing else — never a phone, never an id we issued. */
export function isValidAnonId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]{12,64}$/.test(v);
}

export function normalizeDevice(userAgent: string | null | undefined): VisitDevice {
  if (!userAgent) return "UNKNOWN";
  const ua = userAgent.toLowerCase();
  // Order matters: an iPad's UA contains neither "mobile" nor, on recent
  // iPadOS, "ipad" — it claims to be a Mac. Tablet detection is therefore
  // best-effort, which is fine: the split that drives decisions is
  // phone-versus-not, and a misfiled iPad lands on the correct side of it.
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) return "TABLET";
  if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(ua)) return "MOBILE";
  return "DESKTOP";
}

/**
 * Where they came from, as one of eight buckets.
 *
 * An explicit `?src=` wins over the referrer, because that is the parameter we
 * print on the QR codes and put in the texts we send — it is the only signal
 * that survives a PWA launch, where there is no referrer at all.
 *
 * The full referrer is deliberately reduced to a host and then dropped. A
 * complete referring URL is a tracking surface with query strings in it, and we
 * have no use for it that a hostname doesn't serve.
 */
export function classifySource(src: string | null | undefined, referrer: string | null | undefined): {
  source: VisitSource;
  referrerHost: string | null;
} {
  const tag = (src ?? "").trim().toLowerCase();
  const host = referrerHost(referrer);

  const tagged: Record<string, VisitSource> = {
    qr: "QR",
    sms: "SMS",
    text: "SMS",
    social: "SOCIAL",
    maps: "MAPS",
    direct: "DIRECT",
  };
  if (tagged[tag]) return { source: tagged[tag], referrerHost: host };

  if (!host) return { source: "DIRECT", referrerHost: null };

  if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave)\./.test(host)) {
    // Google Maps and Google Search share a hostname on some referrers; the
    // maps subdomain is the only reliable tell, and missing it costs a search
    // hit filed as search, which is what it mostly is.
    if (host.startsWith("maps.")) return { source: "MAPS", referrerHost: host };
    return { source: "SEARCH_ENGINE", referrerHost: host };
  }
  if (/(^|\.)(facebook|instagram|tiktok|twitter|x|threads|reddit|snapchat|pinterest)\./.test(host)) {
    return { source: "SOCIAL", referrerHost: host };
  }
  if (/(^|\.)(yelp|apple|mapquest|waze)\./.test(host)) {
    return { source: "MAPS", referrerHost: host };
  }
  return { source: "REFERRAL", referrerHost: host };
}

function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const h = new URL(referrer).hostname.toLowerCase();
    return h ? h.slice(0, 120) : null;
  } catch {
    return null;
  }
}

function clampInt(v: unknown, lo: number, hi: number): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

/**
 * Server time wins unless the client's is close enough to be believable.
 *
 * Client clocks are wrong often enough to matter — a device set to next year
 * would otherwise put events in a tenant's future and quietly break every date
 * range. But rejecting the client's timestamp outright would collapse a batched
 * beacon's events onto a single instant, losing the ordering that makes a
 * funnel a funnel. So: trust it inside a window, discard it outside one.
 */
export function resolveAt(clientAt: number | undefined, now: number): Date {
  if (typeof clientAt !== "number" || !Number.isFinite(clientAt)) return new Date(now);
  const skew = Math.abs(now - clientAt);
  if (skew > MAX_DWELL_MS) return new Date(now);
  // Never accept a future timestamp, even a plausible one.
  return new Date(Math.min(clientAt, now));
}

function normalizeEvent(raw: IncomingEvent, now: number): {
  kind: VisitEventKind;
  at: Date;
  itemId: string | null;
  view: string | null;
  valueCts: number | null;
  dwellMs: number | null;
  label: string | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  if (typeof raw.kind !== "string" || !EVENT_KINDS.has(raw.kind)) return null;
  const kind = raw.kind as VisitEventKind;

  return {
    kind,
    at: resolveAt(raw.at, now),
    // Existence is checked against the tenant's own menu below — an itemId is
    // client-supplied, and a cross-tenant one would attribute a competitor's
    // traffic to this restaurant's item.
    itemId: typeof raw.itemId === "string" && raw.itemId.length <= 40 ? raw.itemId : null,
    view: typeof raw.view === "string" ? raw.view.slice(0, 24) : null,
    valueCts: clampInt(raw.valueCts, 0, 100_000_00),
    dwellMs: clampInt(raw.dwellMs, 0, MAX_EVENT_DWELL_MS),
    label: LABEL_KINDS.has(kind) && typeof raw.label === "string"
      ? raw.label.trim().slice(0, MAX_LABEL_LEN) || null
      : null,
  };
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/**
 * Record a batch of storefront events.
 *
 * Returns quietly on anything malformed rather than throwing. This is called
 * from a fire-and-forget beacon on a customer's phone: there is no one to show
 * an error to, and an analytics failure must never be able to take down the
 * ordering flow it is measuring. Everything that matters is validated; what
 * fails validation is dropped, not escalated.
 */
export async function recordEvents(input: TrackInput): Promise<TrackResult> {
  if (!input || typeof input.slug !== "string" || !isValidAnonId(input.anonId)) {
    return { ok: false, reason: "bad_input" };
  }
  if (!Array.isArray(input.events) || input.events.length === 0) {
    return { ok: false, reason: "no_events" };
  }

  const now = Date.now();
  const events = input.events
    .slice(0, MAX_EVENTS_PER_BEACON)
    .map((e) => normalizeEvent(e, now))
    .filter((e): e is NonNullable<typeof e> => e !== null)
    .sort((a, b) => a.at.getTime() - b.at.getTime());

  if (events.length === 0) return { ok: false, reason: "no_events" };

  const restaurant = await prisma.restaurant.findFirst({
    where: tenantWhere(input.slug),
    select: { id: true },
  });
  if (!restaurant) return { ok: false, reason: "unknown_tenant" };

  const restaurantId = restaurant.id;

  // Drop item references that don't belong to this tenant. One query, and it
  // closes the only path by which a public endpoint could attribute traffic
  // across the isolation boundary.
  const claimed = [...new Set(events.map((e) => e.itemId).filter((v): v is string => !!v))];
  let valid: Set<string> = new Set();
  if (claimed.length) {
    const rows = await prisma.menuItem.findMany({
      where: { restaurantId, id: { in: claimed } },
      select: { id: true },
    });
    valid = new Set(rows.map((r) => r.id));
  }

  const visit = await resolveVisit({
    restaurantId,
    anonId: input.anonId,
    firstAt: events[0].at,
    source: input.source,
    referrer: input.referrer,
    userAgent: input.userAgent,
  });

  const lastAt = events[events.length - 1].at;

  await prisma.visitEvent.createMany({
    data: events.map((e) => ({
      restaurantId,
      visitId: visit.id,
      kind: e.kind,
      at: e.at,
      itemId: e.itemId && valid.has(e.itemId) ? e.itemId : null,
      view: e.view,
      valueCts: e.valueCts,
      dwellMs: e.dwellMs,
      label: e.label,
      simulated: visit.simulated,
    })),
  });

  // Roll the milestones forward. They only ever go from false to true — a
  // customer who reached checkout and backed out still reached checkout, and a
  // funnel that could move backwards would report a step as narrower than the
  // one below it.
  const reached = milestonesFrom(events.map((e) => e.kind));

  const dwell = Math.min(
    MAX_DWELL_MS,
    Math.max(0, lastAt.getTime() - visit.startedAt.getTime())
  );

  await prisma.visit.update({
    where: { id: visit.id },
    data: {
      lastSeenAt: lastAt > visit.lastSeenAt ? lastAt : visit.lastSeenAt,
      dwellMs: Math.max(visit.dwellMs, dwell),
      eventCount: { increment: events.length },
      ...(reached.viewedMenu ? { viewedMenu: true } : {}),
      ...(reached.viewedItem ? { viewedItem: true } : {}),
      ...(reached.addedToCart ? { addedToCart: true } : {}),
      ...(reached.startedCheckout ? { startedCheckout: true } : {}),
    },
  });

  return { ok: true, visitId: visit.id, accepted: events.length };
}

/**
 * Which funnel steps a batch of events implies.
 *
 * Exported because the mapping from "what the storefront calls a thing" to
 * "which step of the funnel that is" is the single assumption every conversion
 * number on both dashboards rests on, and it should be testable without a
 * database behind it.
 */
export function milestonesFrom(kinds: VisitEventKind[]): {
  viewedMenu: boolean;
  viewedItem: boolean;
  addedToCart: boolean;
  startedCheckout: boolean;
} {
  const has = (k: VisitEventKind) => kinds.includes(k);
  // Each step implies the ones before it. Without this, a customer who
  // quick-adds from the menu without opening an item sheet would report as
  // "added to cart but never viewed the menu" — which is not a surprising
  // insight, it's a broken funnel.
  const addedToCart = has("ITEM_ADD");
  const startedCheckout = has("CHECKOUT_START") || has("ORDER_PLACED");
  const viewedItem = has("ITEM_VIEW") || addedToCart;
  const viewedMenu =
    has("VIEW_CHANGE") || has("SEARCH") || has("CART_VIEW") || viewedItem || startedCheckout;

  return { viewedMenu, viewedItem, addedToCart, startedCheckout };
}

/**
 * Find the visit this event belongs to, or open a new one.
 *
 * The stitching rule lives here rather than in the browser on purpose: a
 * client-supplied visit id would make "how many people came today" a number the
 * client decides.
 */
async function resolveVisit(args: {
  restaurantId: string;
  anonId: string;
  firstAt: Date;
  source: string | null | undefined;
  referrer: string | null | undefined;
  userAgent: string | null | undefined;
}) {
  const cutoff = new Date(args.firstAt.getTime() - SESSION_GAP_MS);

  const open = await prisma.visit.findFirst({
    where: {
      restaurantId: args.restaurantId,
      anonId: args.anonId,
      lastSeenAt: { gte: cutoff },
    },
    orderBy: { lastSeenAt: "desc" },
  });
  if (open) return open;

  const { source, referrerHost: host } = classifySource(args.source, args.referrer);

  // The unique key is (restaurant, anon, startedAt), so two beacons racing on
  // the first event of a visit — which happens, because the tracker fires page
  // view and the first heartbeat close together — would collide. Catching that
  // and re-reading is cheaper and more honest than a lock: either way one row
  // wins, and both beacons then write against it.
  try {
    return await prisma.visit.create({
      data: {
        restaurantId: args.restaurantId,
        anonId: args.anonId,
        startedAt: args.firstAt,
        lastSeenAt: args.firstAt,
        source,
        device: normalizeDevice(args.userAgent),
        referrerHost: host,
      },
    });
  } catch {
    const existing = await prisma.visit.findFirst({
      where: { restaurantId: args.restaurantId, anonId: args.anonId },
      orderBy: { lastSeenAt: "desc" },
    });
    if (existing) return existing;
    throw new Error("could not open a visit");
  }
}

/**
 * Mark the visit that produced an order.
 *
 * Called from `placeOrderAction` after the order is committed, and deliberately
 * best-effort: a customer with analytics blocked, or one whose beacon never
 * landed, still gets their food. An order that can't be attributed is a gap in
 * a chart; an order that fails to place because a chart wanted attributing is a
 * bug that costs a restaurant a sale.
 *
 * This is also the only place `converted` is ever set. Deriving it from the
 * presence of an ORDER_PLACED event would let the public beacon inflate a
 * tenant's conversion rate by simply claiming the event.
 */
export async function attachOrderToVisit(args: {
  restaurantId: string;
  anonId: string | null | undefined;
  orderId: string;
  totalCts: number;
}): Promise<void> {
  if (!isValidAnonId(args.anonId)) return;

  try {
    const visit = await prisma.visit.findFirst({
      where: {
        restaurantId: args.restaurantId,
        anonId: args.anonId,
        lastSeenAt: { gte: new Date(Date.now() - SESSION_GAP_MS) },
      },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, simulated: true },
    });
    if (!visit) return;

    await prisma.$transaction([
      prisma.visit.update({
        where: { id: visit.id },
        data: {
          orderId: args.orderId,
          converted: true,
          addedToCart: true,
          startedCheckout: true,
          viewedMenu: true,
          lastSeenAt: new Date(),
          eventCount: { increment: 1 },
        },
      }),
      prisma.visitEvent.create({
        data: {
          restaurantId: args.restaurantId,
          visitId: visit.id,
          kind: "ORDER_PLACED",
          valueCts: args.totalCts,
          view: "checkout",
          simulated: visit.simulated,
        },
      }),
    ]);
  } catch {
    /* attribution is never worth failing an order over */
  }
}

// ---------------------------------------------------------------------------
// Simulated traffic
// ---------------------------------------------------------------------------

/**
 * Write a simulated visit. Used only by `lib/simulator.ts`.
 *
 * Every row it writes carries `simulated: true` — the same contract as the
 * `+1555017` phone block and the `"sim"` payment provider. That marker is the
 * only thing that makes `wipeSimulatedAnalytics` safe to run against a tenant
 * that also has real traffic, so a generator that forgets to stamp it leaves
 * rows nobody can ever clean up.
 */
export async function recordSimulatedVisit(args: {
  restaurantId: string;
  anonId: string;
  startedAt: Date;
  dwellMs: number;
  source: VisitSource;
  device: VisitDevice;
  orderId?: string | null;
  totalCts?: number;
  events: Array<{ kind: VisitEventKind; offsetMs: number; itemId?: string | null; view?: string | null; valueCts?: number | null; label?: string | null }>;
}) {
  const dwell = Math.min(MAX_DWELL_MS, Math.max(0, args.dwellMs));
  const reached = milestonesFrom(args.events.map((e) => e.kind));

  const visit = await prisma.visit.create({
    data: {
      restaurantId: args.restaurantId,
      anonId: args.anonId,
      startedAt: args.startedAt,
      lastSeenAt: new Date(args.startedAt.getTime() + dwell),
      dwellMs: dwell,
      source: args.source,
      device: args.device,
      orderId: args.orderId ?? null,
      converted: !!args.orderId,
      viewedMenu: reached.viewedMenu,
      viewedItem: reached.viewedItem,
      addedToCart: reached.addedToCart,
      startedCheckout: reached.startedCheckout || !!args.orderId,
      eventCount: args.events.length,
      simulated: true,
    },
  });

  if (args.events.length) {
    await prisma.visitEvent.createMany({
      data: args.events.map((e) => ({
        restaurantId: args.restaurantId,
        visitId: visit.id,
        kind: e.kind,
        at: new Date(args.startedAt.getTime() + Math.min(dwell, Math.max(0, e.offsetMs))),
        itemId: e.itemId ?? null,
        view: e.view ?? null,
        valueCts: e.valueCts ?? null,
        label: e.label ?? null,
        simulated: true,
      })),
    });
  }

  return visit;
}

/** Exact inverse of `recordSimulatedVisit`. Never touches an unmarked row. */
export async function wipeSimulatedAnalytics(restaurantId: string): Promise<{
  visits: number;
  events: number;
}> {
  const events = await prisma.visitEvent.deleteMany({ where: { restaurantId, simulated: true } });
  const visits = await prisma.visit.deleteMany({ where: { restaurantId, simulated: true } });
  return { visits: visits.count, events: events.count };
}

/**
 * Drop visits older than a retention window.
 *
 * Nothing calls this yet; it's here because the events table is the fastest
 * growing thing in the database and the decision about how long a restaurant's
 * traffic detail is kept should be made deliberately rather than by whoever
 * first notices the disk filling. `Visit` rows are cheap and carry every
 * headline number, so this trims events first and only then the visits behind
 * them — a year-old conversion rate survives, a year-old scroll does not.
 */
export async function pruneAnalytics(opts: {
  eventsOlderThan: Date;
  visitsOlderThan: Date;
}): Promise<{ events: number; visits: number }> {
  const events = await prisma.visitEvent.deleteMany({ where: { at: { lt: opts.eventsOlderThan } } });
  const visits = await prisma.visit.deleteMany({
    where: { startedAt: { lt: opts.visitsOlderThan } },
  });
  return { events: events.count, visits: visits.count };
}

export type VisitWhere = Prisma.VisitWhereInput;
