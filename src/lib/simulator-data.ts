/**
 * The pure half of the order simulator — everything that decides *what* a
 * fake shift looks like, with no database behind it.
 *
 * Split from `simulator.ts` for the same reason `test-data.ts` is split from
 * the admin actions: the interesting decisions here (which phone numbers are
 * safe to invent, which timestamps a status implies, how a status mix is
 * sampled) are exactly the ones worth testing, and they can't be tested at all
 * if importing them drags in Prisma. See `scripts/simulator.test.ts`.
 */

import type { OrderStatus } from "@prisma/client";

/**
 * Every simulated customer's number starts here, and that prefix is the only
 * thing that makes cleanup safe.
 *
 * 555-01xx is the block reserved for fiction — it is not routable and never
 * will be, so a stray `queueMessage` against simulated data can't reach a real
 * handset even if the Twilio provider is switched on by accident. That matters
 * more than it sounds: the simulator's whole job is to exercise the paths that
 * send things.
 *
 * It doubles as the delete key. "Which rows did I invent?" has to have an
 * answer that survives a page reload and a redeploy, and a reserved number
 * range gives one without a schema column — which would mean a migration, and
 * `prisma generate` can't run in the sandbox (see CLAUDE.md).
 */
export const SIM_PHONE_PREFIX = "+1555017";

/**
 * Stamped into `Order.paymentProvider`. `modeFromTag` doesn't recognise it and
 * falls through to STUB, which is exactly right — a simulated order must refund
 * against the stub provider no matter what mode the platform is in, or a demo
 * on a LIVE platform would try to reverse a charge Stripe has never heard of.
 *
 * It's also the second half of the cleanup key: an order whose customer row was
 * somehow lost still identifies itself.
 */
export const SIM_PROVIDER_TAG = "sim";

export function simPhone(n: number): string {
  return `${SIM_PHONE_PREFIX}${String(Math.abs(n) % 10000).padStart(4, "0")}`;
}

export function isSimulatedPhone(phone: string | null | undefined): boolean {
  return typeof phone === "string" && phone.startsWith(SIM_PHONE_PREFIX);
}

/** Deterministic RNG (xorshift32) so a seeded run reproduces exactly. */
export type Rng = () => number;

export function makeRng(seed: number): Rng {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}

export function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" ? n : parseInt(String(n ?? ""), 10);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

// --- Who the fake customers are -------------------------------------------

export const SIM_FIRST_NAMES = [
  "Ava", "Marcus", "Priya", "Danny", "Yusuf", "Claire", "Tomas", "Nia",
  "Owen", "Rosa", "Jin", "Hannah", "Diego", "Simone", "Kofi", "Elena",
  "Reuben", "Mei", "Callum", "Fatima",
] as const;

export const SIM_LAST_INITIALS = ["A", "B", "C", "D", "F", "G", "H", "K", "L", "M", "N", "P", "R", "S", "T", "W"] as const;

export function simName(rng: Rng): string {
  return `${pick(rng, SIM_FIRST_NAMES)} ${pick(rng, SIM_LAST_INITIALS)}.`;
}

export const SIM_NOTES = [
  "", "", "", "", // most orders have no note, and the board should look like it
  "No onions please",
  "Extra napkins",
  "Allergic to peanuts",
  "Running 5 min late",
  "Please cut in half",
] as const;

// --- What a run looks like -------------------------------------------------

export type SimProfileKey = "shift" | "history" | "messy" | "quiet";

export type SimProfile = {
  label: string;
  description: string;
  /** Relative weights. Statuses absent from the map are never generated. */
  weights: Partial<Record<OrderStatus, number>>;
};

/**
 * Presets rather than a free-form status picker, because the useful question
 * is never "give me four PREPARING orders" — it's "make the board look like a
 * Friday" or "give me a month of history so the reports have something in
 * them". Each profile is one of those situations.
 */
export const SIM_PROFILES: Record<SimProfileKey, SimProfile> = {
  shift: {
    label: "Busy shift",
    description:
      "Mostly live tickets spread across the board — new, accepted, cooking, ready. What the dashboard looks like mid-service.",
    weights: { RECEIVED: 3, ACCEPTED: 3, PREPARING: 4, READY: 3, COMPLETED: 2 },
  },
  quiet: {
    label: "Quiet service",
    description: "A couple of live tickets and not much else. Good for checking an empty-ish board still reads well.",
    weights: { RECEIVED: 1, PREPARING: 1, COMPLETED: 6 },
  },
  history: {
    label: "Past trade",
    description:
      "Completed orders backdated across the window, so customers accrue counts and lifetime value and the reports have shape.",
    weights: { COMPLETED: 14, CANCELED: 1, REJECTED: 1 },
  },
  messy: {
    label: "Bad day",
    description:
      "Cancellations, rejections and refunds mixed into live tickets — the state the recovery UI exists for.",
    weights: { RECEIVED: 1, PREPARING: 2, READY: 2, COMPLETED: 5, CANCELED: 3, REJECTED: 2 },
  },
};

export const TERMINAL_SIM_STATUSES: OrderStatus[] = ["COMPLETED", "CANCELED", "REJECTED"];

export function isLiveSimStatus(s: OrderStatus): boolean {
  return !TERMINAL_SIM_STATUSES.includes(s);
}

/** Weighted draw. Returns COMPLETED if a profile somehow has no weight at all. */
export function pickStatus(rng: Rng, profile: SimProfile): OrderStatus {
  const entries = Object.entries(profile.weights).filter(([, w]) => (w ?? 0) > 0) as Array<
    [OrderStatus, number]
  >;
  const total = entries.reduce((a, [, w]) => a + w, 0);
  if (!total) return "COMPLETED";

  let roll = rng() * total;
  for (const [status, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return status;
  }
  return entries[entries.length - 1][0];
}

/**
 * How far back an order was placed.
 *
 * Live tickets are always recent and terminal ones are spread over the whole
 * window — not for realism but for survival. `expireStaleOrders` cancels an
 * unattended RECEIVED order older than the tenant's `autoExpireMins`, so a
 * RECEIVED ticket backdated three days would be swept off the board within two
 * minutes of the cron running and the operator would conclude the simulator is
 * broken. Anything still live has to be young enough to still be plausible.
 */
export const LIVE_WITHIN_MINS = 20;

export function placedAgoMs(rng: Rng, status: OrderStatus, windowDays: number): number {
  if (isLiveSimStatus(status)) return randInt(rng, 1, LIVE_WITHIN_MINS) * 60_000;
  const days = Math.max(0, windowDays);
  return Math.floor(rng() * Math.max(1, days) * 86_400_000);
}

export type SimTimestamps = {
  createdAt: Date;
  promisedAt: Date;
  acceptedAt: Date | null;
  readyAt: Date | null;
  completedAt: Date | null;
  canceledAt: Date | null;
};

/**
 * The timestamp set a status implies.
 *
 * Written as one function because the fields are not independent: a COMPLETED
 * order with a null `acceptedAt` is a shape the real flow can never produce,
 * and seeding one means every downstream thing that reasons about lateness or
 * accept-time quietly gets a case it was never written for. If the simulator
 * can emit states the app can't, it stops being a test of the app.
 */
export function timestampsFor(
  status: OrderStatus,
  placedAt: Date,
  prepMinutes: number
): SimTimestamps {
  const t = placedAt.getTime();
  const min = (n: number) => new Date(t + n * 60_000);
  const prep = Math.max(5, prepMinutes);

  const base: SimTimestamps = {
    createdAt: placedAt,
    promisedAt: min(prep),
    acceptedAt: null,
    readyAt: null,
    completedAt: null,
    canceledAt: null,
  };

  switch (status) {
    case "RECEIVED":
      return base;
    case "ACCEPTED":
      return { ...base, acceptedAt: min(1) };
    case "PREPARING":
      return { ...base, acceptedAt: min(1) };
    case "READY":
      return { ...base, acceptedAt: min(1), readyAt: min(prep) };
    case "COMPLETED":
      return {
        ...base,
        acceptedAt: min(1),
        readyAt: min(prep),
        completedAt: min(prep + 4),
      };
    case "CANCELED":
      return { ...base, acceptedAt: min(1), canceledAt: min(3) };
    case "REJECTED":
      // Never accepted — that's the whole distinction from CANCELED.
      return { ...base, canceledAt: min(2) };
    default:
      return base;
  }
}

/**
 * The event timeline a simulated order should carry.
 *
 * `OrderEvent` is append-only and is what support reads during a dispute, so a
 * simulated order with a single "placed" row is worse than useless — it teaches
 * whoever is testing the timeline UI that the timeline is always one line long.
 */
export type SimEvent = {
  kind: string;
  actor: "CUSTOMER" | "RESTAURANT" | "SYSTEM" | "ADMIN";
  fromStatus?: OrderStatus;
  toStatus?: OrderStatus;
  publicNote?: string;
  at: Date;
};

export function eventsFor(status: OrderStatus, ts: SimTimestamps): SimEvent[] {
  const events: SimEvent[] = [
    {
      kind: "order_placed",
      actor: "CUSTOMER",
      toStatus: "RECEIVED",
      publicNote: "Order placed.",
      at: ts.createdAt,
    },
  ];

  if (ts.acceptedAt) {
    events.push({
      kind: "status_change",
      actor: "RESTAURANT",
      fromStatus: "RECEIVED",
      toStatus: "ACCEPTED",
      publicNote: "The restaurant confirmed your order.",
      at: ts.acceptedAt,
    });
  }

  if (status === "PREPARING" || ts.readyAt) {
    events.push({
      kind: "status_change",
      actor: "RESTAURANT",
      fromStatus: "ACCEPTED",
      toStatus: "PREPARING",
      publicNote: "Your order is being made.",
      at: new Date((ts.acceptedAt ?? ts.createdAt).getTime() + 60_000),
    });
  }

  if (ts.readyAt) {
    events.push({
      kind: "status_change",
      actor: "RESTAURANT",
      fromStatus: "PREPARING",
      toStatus: "READY",
      publicNote: "Your order is ready for pickup.",
      at: ts.readyAt,
    });
  }

  if (ts.completedAt) {
    events.push({
      kind: "status_change",
      actor: "RESTAURANT",
      fromStatus: "READY",
      toStatus: "COMPLETED",
      publicNote: "Picked up. Thanks!",
      at: ts.completedAt,
    });
  }

  if (ts.canceledAt) {
    events.push({
      kind: status === "REJECTED" ? "order_rejected" : "order_canceled",
      actor: "RESTAURANT",
      fromStatus: status === "REJECTED" ? "RECEIVED" : "ACCEPTED",
      toStatus: status,
      publicNote:
        status === "REJECTED"
          ? "The restaurant couldn't take this order. You haven't been charged."
          : "This order was canceled and refunded in full.",
      at: ts.canceledAt,
    });
    events.push({
      kind: "refund_issued",
      actor: "RESTAURANT",
      publicNote: "Refunded in full.",
      at: new Date(ts.canceledAt.getTime() + 1_000),
    });
  }

  return events;
}

// --- Trouble scenarios -----------------------------------------------------

export type TroubleKey =
  | "stale_order"
  | "overdue_order"
  | "no_show"
  | "partial_86"
  | "open_issue"
  | "failed_refund"
  | "failed_message"
  | "opted_out";

export const TROUBLE_SCENARIOS: Record<TroubleKey, { label: string; description: string; exercises: string }> = {
  stale_order: {
    label: "Unattended ticket",
    description: "A RECEIVED order backdated past this tenant's auto-expire window.",
    exercises: "expireStaleOrders — the sweep should cancel and refund it on the next run.",
  },
  overdue_order: {
    label: "Late order",
    description: "A PREPARING order whose promised time has already passed.",
    exercises: "flagOverdueOrders — the sweep should apologise once, and only once.",
  },
  no_show: {
    label: "No-show",
    description: "An order left READY for an hour, so the board offers to close it out.",
    exercises: "isProbableNoShow on the board, then markNoShow.",
  },
  partial_86: {
    label: "Out of stock",
    description: "One line of a live order marked unavailable, triggering a partial refund.",
    exercises: "markItemsUnavailable, per-line fulfilledQty, partial refund arithmetic.",
  },
  open_issue: {
    label: "Customer complaint",
    description: "An OrderIssue reported against a completed order.",
    exercises: "reportIssue → the dashboard's issue queue → resolveIssue and its text.",
  },
  failed_refund: {
    label: "Failed refund",
    description: "A refund the provider rejected, left outstanding and unresolved.",
    exercises: "The FailedRefunds banner, retryRefund, dismissFailedRefund, retryFailedRefunds.",
  },
  failed_message: {
    label: "Failed text",
    description: "A retryable FAILED message sitting in the outbox.",
    exercises: "retryFailedMessages and the attempts cap.",
  },
  opted_out: {
    label: "Opted-out customer",
    description: "A simulated customer who replied STOP.",
    exercises: "The consent gate in queueMessage — every later send to them should log SKIPPED.",
  },
};
