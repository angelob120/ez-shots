/**
 * What happens to an order after it is placed — including every way it can go
 * wrong.
 *
 * All of it lives here rather than in the two dozen call sites that touch an
 * order, because the invariants only hold if there is exactly one door:
 *
 *   - An order moves only along a legal edge of the state machine. No route
 *     sets `status` directly.
 *   - Every transition writes an OrderEvent. The timeline the customer reads
 *     and the audit trail a chargeback needs are the same rows.
 *   - Refunds are clamped against what was actually charged, so double-refunds
 *     and over-refunds are arithmetically impossible rather than merely
 *     unlikely.
 *   - Nothing bad happens to an order in silence. If we cancel it, we say so.
 */

import { prisma } from "@/lib/prisma";
import { paymentProviderForMode, modeFromTag } from "@/lib/payments";
import { queueMessage } from "@/lib/sms";
import { centsToMoney } from "@/lib/money";
import { canonicalUrl, type OriginShape } from "@/lib/domains";
import { ISSUE_LABELS } from "@/lib/order-labels";
import type { NotifyInput } from "@/lib/notifications";
import type { ActorKind, IssueStatus, OrderProblem, OrderStatus, Prisma } from "@prisma/client";

/**
 * Lets standing journeys know an order did something.
 *
 * Imported lazily rather than at the top of the file, and that is not a style
 * choice. `lib/automations.ts` is `server-only` and pulls in both send doors;
 * a static import here would drag all of it into every module that touches an
 * order — which is most of them, including the ones the pure order tests
 * exercise without a database.
 *
 * `fireTrigger` swallows its own errors. A marketing follow-up must never be
 * able to fail the transition that handed a customer their food.
 */
async function fireTrigger(
  restaurantId: string,
  trigger: "ORDER_FULFILLED" | "ORDER_CANCELED" | "ORDER_REFUNDED",
  customerId: string | null,
  context: Record<string, string | number | boolean | null | undefined>
) {
  if (!customerId) return;
  try {
    const mod = await import("@/lib/automations");
    await mod.fireTrigger(restaurantId, trigger, customerId, context);
  } catch (err) {
    console.error("[orders] automation trigger failed", trigger, err);
  }
}

/**
 * Raise a platform (admin/owner) alert. Imported lazily for the same reason as
 * `fireTrigger` above — `lib/notifications.ts` is `server-only` and pulls in
 * the operator send doors, and a static import would drag that into every
 * module that touches an order, including the ones the pure tests exercise
 * without a database. Best-effort; `notify` swallows its own errors, and this
 * wrapper swallows the import itself.
 */
async function notifyPlatform(input: NotifyInput) {
  try {
    const mod = await import("@/lib/notifications");
    await mod.notify(input);
  } catch (err) {
    console.error("[orders] platform notify failed", input.kind, err);
  }
}

// ---------------------------------------------------------------------------
// The state machine
// ---------------------------------------------------------------------------

/**
 * Legal moves. Terminal states have no exits — a COMPLETED order is not
 * reopened, it gets a refund or an issue instead, which is a different thing
 * and modelled as one.
 *
 * REJECTED vs CANCELED is a real distinction and not pedantry: rejected means
 * the kitchen never took the job (always a full refund, never the customer's
 * fault), canceled means it stopped partway (refund depends on why).
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  RECEIVED: ["ACCEPTED", "PREPARING", "REJECTED", "CANCELED"],
  ACCEPTED: ["PREPARING", "READY", "CANCELED"],
  PREPARING: ["READY", "CANCELED"],
  // A ready order can still be canceled — the classic no-show, where the food
  // was made and nobody came for it.
  READY: ["COMPLETED", "CANCELED"],
  COMPLETED: [],
  CANCELED: [],
  REJECTED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/** Statuses still on the kitchen board. */
export const LIVE_STATUSES: OrderStatus[] = ["RECEIVED", "ACCEPTED", "PREPARING", "READY"];

/** Problems the restaurant caused. These always refund the service fee too. */
const RESTAURANT_FAULT: OrderProblem[] = [
  "OUT_OF_STOCK",
  "CLOSING_SOON",
  "CLOSED",
  "TOO_BUSY",
  "KITCHEN_ISSUE",
  "WEATHER",
  "PRICING_ERROR",
  "QUALITY",
];

export function isRestaurantFault(problem: OrderProblem): boolean {
  return RESTAURANT_FAULT.includes(problem);
}

export const PROBLEM_LABELS: Record<OrderProblem, string> = {
  OUT_OF_STOCK: "Out of an item",
  CLOSING_SOON: "Too close to closing",
  CLOSED: "We were closed",
  TOO_BUSY: "Kitchen at capacity",
  KITCHEN_ISSUE: "Kitchen problem",
  WEATHER: "Weather or power",
  CUSTOMER_REQUEST: "Customer asked to cancel",
  NO_SHOW: "Never picked up",
  PRICING_ERROR: "Menu priced wrong",
  DUPLICATE_ORDER: "Duplicate order",
  QUALITY: "Quality problem",
  OTHER: "Other",
};

/** What the customer is told, per problem. Plain, specific, no corporate hedging. */
const PROBLEM_APOLOGY: Record<OrderProblem, string> = {
  OUT_OF_STOCK: "we ran out of something in your order",
  CLOSING_SOON: "your order came in too close to closing for us to make it",
  CLOSED: "we were already closed when your order came through",
  TOO_BUSY: "the kitchen is backed up and we couldn't get to your order in time",
  KITCHEN_ISSUE: "we hit a problem in the kitchen",
  WEATHER: "we had to shut early",
  CUSTOMER_REQUEST: "you asked us to cancel it",
  NO_SHOW: "the order wasn't picked up",
  PRICING_ERROR: "an item was priced wrong on our menu",
  DUPLICATE_ORDER: "this looked like a duplicate of another order",
  QUALITY: "the food wasn't up to standard",
  OTHER: "we couldn't complete it",
};

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

/**
 * The status-page key. A pickup order has no login behind it, so this link is
 * the only thing standing between a stranger and someone's phone number —
 * hence 160 bits from the CSPRNG rather than a sequence or the order id.
 */
export function newOrderToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function orderPath(token: string): string {
  return `/o/${token}`;
}

/**
 * Absolute link for text messages, on the restaurant's canonical origin — its
 * own verified domain when it has one, ours otherwise. Falls back to the path
 * alone when nothing is configured, which is still useful in the logged-message
 * stub and is what `scripts/config-check.mjs` refuses to boot on once SMS is
 * live.
 *
 * The restaurant is a required argument rather than an optional one on purpose:
 * this printed our host on every tenant's receipts for as long as it could be
 * called without one, and an optional parameter would let the same bug back in
 * the next time somebody adds a caller.
 */
export function orderUrl(token: string, restaurant: OriginShape | null): string {
  return canonicalUrl(restaurant, orderPath(token));
}

// ---------------------------------------------------------------------------
// Refund arithmetic
// ---------------------------------------------------------------------------

type MoneyShape = {
  subtotalCts: number;
  surchargeCts: number;
  taxCts: number;
  totalCts: number;
  refundedCts: number;
};

/** The most that can still go back on this order. Never negative. */
export function refundableCts(order: MoneyShape): number {
  return Math.max(0, order.totalCts - order.refundedCts);
}

/**
 * What to give back when part of an order couldn't be made.
 *
 * The food value of the missing units, plus the tax and — when the failure is
 * ours — the service fee that rode on it, both prorated. Charging someone a
 * service fee for food they never got is the fastest way to make a refund feel
 * like an insult.
 */
export function computePartialRefundCts(
  order: MoneyShape,
  removedFoodCts: number,
  includeSurcharge: boolean
): number {
  if (removedFoodCts <= 0 || order.subtotalCts <= 0) return 0;

  const food = Math.min(removedFoodCts, order.subtotalCts);
  const share = food / order.subtotalCts;

  const tax = Math.round(order.taxCts * share);
  const surcharge = includeSurcharge ? Math.round(order.surchargeCts * share) : 0;

  // If the whole basket came out, hand back everything left rather than
  // letting rounding strand a few cents on a dead order.
  if (food >= order.subtotalCts && includeSurcharge) return refundableCts(order);

  return Math.min(food + tax + surcharge, refundableCts(order));
}

/** Food value of a line, as charged. */
export function lineFoodCts(item: { unitPriceCts: number; modifiersCts: number; qty: number }): number {
  return Math.max(0, item.unitPriceCts + item.modifiersCts) * item.qty;
}

// ---------------------------------------------------------------------------
// Event log
// ---------------------------------------------------------------------------

type EventInput = {
  orderId: string;
  kind: string;
  actor: ActorKind;
  fromStatus?: OrderStatus | null;
  toStatus?: OrderStatus | null;
  publicNote?: string | null;
  meta?: Prisma.InputJsonValue;
  tx?: Prisma.TransactionClient;
};

export async function logEvent(input: EventInput) {
  const db = input.tx ?? prisma;
  return db.orderEvent.create({
    data: {
      orderId: input.orderId,
      kind: input.kind,
      actor: input.actor,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      publicNote: input.publicNote ?? null,
      meta: input.meta ?? {},
    },
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Status texts are TRANSACTIONAL, so they reach customers who never opted into
 * marketing. That is the correct call both legally and morally: "your order is
 * ready" is not a promotion.
 */
async function notify(
  order: {
    id: string;
    restaurantId: string;
    customerId: string | null;
    number: string;
    publicToken: string;
  },
  // Name and origin travel together because every message needs both: the
  // tenant's name in the body and the tenant's host in the link.
  restaurant: (OriginShape & { name: string }) | null,
  body: string
) {
  await queueMessage({
    restaurantId: order.restaurantId,
    customerId: order.customerId,
    kind: "TRANSACTIONAL",
    body: `${restaurant?.name ?? ""}: ${body} ${orderUrl(order.publicToken, restaurant)}`,
  });
}

function statusMessage(status: OrderStatus, number: string, promisedAt: Date | null): string | null {
  const eta = promisedAt
    ? promisedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : null;

  switch (status) {
    case "ACCEPTED":
      return `order ${number} is confirmed${eta ? `, ready around ${eta}` : ""}.`;
    case "PREPARING":
      return `we've started on order ${number}${eta ? `, ready around ${eta}` : ""}.`;
    case "READY":
      return `order ${number} is ready for pickup.`;
    case "COMPLETED":
      // Handing food across a counter is its own notification.
      return null;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

export type OrderActionResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

const ORDER_WITH_CONTEXT = {
  include: {
    // customDomain/domainVerifiedAt ride along because every notify() builds a
    // link on the tenant's canonical origin. See lib/domains.ts.
    restaurant: {
      select: {
        name: true,
        prepMinutes: true,
        customDomain: true,
        domainVerifiedAt: true,
      },
    },
    items: true,
  },
} as const;

type OrderWithContext = Prisma.OrderGetPayload<typeof ORDER_WITH_CONTEXT>;

async function loadOrder(
  where: Prisma.OrderWhereInput
): Promise<OrderWithContext | null> {
  return prisma.order.findFirst({ where, ...ORDER_WITH_CONTEXT });
}

/**
 * Move an order forward. The only writer of `status` in the codebase.
 *
 * Refuses illegal edges instead of coercing them, so a double-clicked "Mark
 * ready" or a stale dashboard tab can't drag a canceled order back onto the
 * board.
 */
export async function transitionOrder(input: {
  orderId: string;
  restaurantId?: string;
  to: OrderStatus;
  actor: ActorKind;
  note?: string;
}): Promise<OrderActionResult<{ status: OrderStatus }>> {
  const order = await loadOrder({
    id: input.orderId,
    ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
  });
  if (!order) return { ok: false, error: "Order not found." };

  if (order.status === input.to) return { ok: true, value: { status: order.status } };

  if (!canTransition(order.status, input.to)) {
    return {
      ok: false,
      error: `An order that's ${order.status.toLowerCase()} can't be moved to ${input.to.toLowerCase()}.`,
    };
  }

  const now = new Date();
  const stamps: Prisma.OrderUpdateManyMutationInput = { status: input.to };
  if (input.to === "ACCEPTED") stamps.acceptedAt = now;
  if (input.to === "READY") stamps.readyAt = now;
  if (input.to === "COMPLETED") stamps.completedAt = now;

  // Moving straight from RECEIVED to PREPARING still counts as accepting it.
  if (input.to === "PREPARING" && !order.acceptedAt) stamps.acceptedAt = now;

  // `canTransition` above was checked against a read that is already stale by
  // the time we write. Repeating the status we read as a WHERE clause closes
  // the gap: of two double-clicks, exactly one matches a row. Without it both
  // pass the check and both send the customer a text.
  const moved = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: stamps,
    });
    if (count === 0) return null;

    await logEvent({
      orderId: order.id,
      kind: "status_changed",
      actor: input.actor,
      fromStatus: order.status,
      toStatus: input.to,
      publicNote: input.note ?? null,
      tx,
    });
    return tx.order.findUnique({ where: { id: order.id } });
  });

  if (!moved) {
    return { ok: false, error: "That order changed while you were looking at it. Reload and try again." };
  }

  const body = statusMessage(input.to, order.number, moved.promisedAt);
  if (body) await notify(order, order.restaurant, body);

  // Standing journeys that watch the order lifecycle. `fireTrigger` swallows
  // its own errors on purpose — a marketing follow-up must never be able to
  // fail the transition that handed a customer their food.
  if (input.to === "COMPLETED") {
    await fireTrigger(order.restaurantId, "ORDER_FULFILLED", order.customerId, {
      orderId: order.id,
      triggerKey: order.id,
    });
  }

  return { ok: true, value: { status: moved.status } };
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------

/**
 * Send money back and tell the customer.
 *
 * The clamp against `refundableCts` is not enough on its own: two owners on two
 * tablets both read `refundedCts = 0`, both clamp to the full total, and both
 * pay out. So the amount is *reserved* first — a conditional write that only
 * lands if `refundedCts` still holds the value we read — and only then handed
 * to the provider. A lost race writes nothing and is reported as such.
 *
 * Reserving before charging rather than after is deliberate. It means a crash
 * between the two leaves an order looking more refunded than it is, which an
 * owner can see and correct; the other order leaves money gone with no record,
 * which nobody can.
 *
 * A provider failure releases the reservation and is recorded as a FAILED
 * Refund row, never swallowed — an order that owes a customer money must stay
 * visibly in that state until someone fixes it.
 */
export async function issueRefund(input: {
  orderId: string;
  restaurantId?: string;
  amountCts: number;
  reason: OrderProblem;
  actor: ActorKind;
  actorId?: string;
  note?: string;
  /** Skip the text — used when a cancellation is already sending its own. */
  silent?: boolean;
}): Promise<OrderActionResult<{ refundedCts: number }>> {
  const order = await loadOrder({
    id: input.orderId,
    ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
  });
  if (!order) return { ok: false, error: "Order not found." };

  const available = refundableCts(order);
  if (available <= 0) return { ok: false, error: "This order has already been fully refunded." };

  const amount = Math.min(Math.max(0, Math.round(input.amountCts)), available);
  if (amount <= 0) return { ok: false, error: "Refund amount must be greater than zero." };

  const includedSurcharge = isRestaurantFault(input.reason);

  const refund = await prisma.refund.create({
    data: {
      orderId: order.id,
      amountCts: amount,
      reason: input.reason,
      note: input.note?.slice(0, 300) || null,
      includedSurcharge,
      issuedBy: input.actor,
      issuedById: input.actorId ?? null,
      attempts: 1,
    },
  });

  // Optimistic lock. `refundedCts` in the WHERE is the version number: if
  // another refund landed since we read the order, no row matches and we know
  // our clamp was computed against a stale total.
  const reserved = await prisma.order.updateMany({
    where: { id: order.id, refundedCts: order.refundedCts },
    data: { refundedCts: order.refundedCts + amount },
  });

  if (reserved.count === 0) {
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", error: "concurrent_refund" },
    });
    return {
      ok: false,
      error: "This order was refunded by someone else a moment ago. Reload and check the total before trying again.",
    };
  }

  const totalAfter = order.refundedCts + amount;

  // Refund through the same key set that took the money — recovered from the
  // tag stamped on the order at charge time.
  const res = await paymentProviderForMode(modeFromTag(order.paymentProvider)).refund({
    restaurantId: order.restaurantId,
    reference: order.paymentReference ?? "",
    amountCts: amount,
    includeSurcharge: includedSurcharge,
    reason: input.reason,
    idempotencyKey: refund.id,
  });

  if (!res.ok) {
    // Release the reservation. Unconditional decrement rather than a second
    // optimistic write: this amount is ours, and a concurrent refund that
    // legitimately moved the total must not block us giving it back.
    await prisma.order.update({
      where: { id: order.id },
      data: { refundedCts: { decrement: amount } },
    });
    await prisma.refund.update({
      where: { id: refund.id },
      data: { status: "FAILED", provider: res.provider, error: res.error ?? "refund_failed" },
    });
    await logEvent({
      orderId: order.id,
      kind: "refund_failed",
      actor: input.actor,
      meta: { refundId: refund.id, amountCts: amount, error: res.error ?? null },
    });
    // Urgent platform alert: a refund that failed leaves money owed, and the
    // FailedRefunds banner only shows to someone already on the dashboard.
    // Best-effort; the failed-refund row is the system of record either way.
    await notifyPlatform({
      kind: "REFUND_FAILED",
      audience: { to: "ADMINS" },
      title: `Refund failed on order ${order.number}`,
      body: `${centsToMoney(amount)} could not be returned (${res.error ?? "refund_failed"}). Money is owed.`,
      link: "/admin/orders",
      restaurantId: order.restaurantId,
      dedupeKey: `refund-failed:${refund.id}`,
      severity: "URGENT",
    });
    return { ok: false, error: "The refund couldn't be processed. Nothing was returned — try again." };
  }

  await prisma.refund.update({
    where: { id: refund.id },
    data: {
      status: "SUCCEEDED",
      provider: res.provider,
      providerRef: res.reference,
      succeededAt: new Date(),
    },
  });

  await logEvent({
    orderId: order.id,
    kind: "refund_issued",
    actor: input.actor,
    publicNote: `${centsToMoney(amount)} refunded — ${PROBLEM_LABELS[input.reason].toLowerCase()}.`,
    meta: { refundId: refund.id, amountCts: amount, reason: input.reason },
  });

  // The customer's lifetime value should reflect what they actually paid.
  if (order.customerId) {
    await prisma.customer.update({
      where: { id: order.customerId },
      data: { lifetimeCts: { decrement: amount } },
    });
  }

  if (!input.silent) {
    const full = totalAfter >= order.totalCts;
    await notify(
      order,
      order.restaurant,
      `${full ? "a full refund of" : "we've refunded"} ${centsToMoney(amount)} for order ${order.number} — ${PROBLEM_APOLOGY[input.reason]}. It's back on your card in 3–5 days.`
    );
  }

  await fireTrigger(order.restaurantId, "ORDER_REFUNDED", order.customerId, {
    orderId: order.id,
    triggerKey: refund.id,
    refundedCts: amount,
  });

  return { ok: true, value: { refundedCts: totalAfter } };
}

/**
 * Refunds that failed and haven't been settled since.
 *
 * These are orders where the customer is owed money and didn't get it. The
 * dashboard shows them above everything else, because it is the one state in
 * the system where doing nothing keeps costing the restaurant its reputation.
 */
export async function outstandingRefunds(restaurantId: string) {
  return prisma.refund.findMany({
    where: { status: "FAILED", resolvedAt: null, order: { restaurantId } },
    orderBy: { createdAt: "asc" }, // oldest debt first — it's been owed longest
    include: { order: { select: { number: true, publicToken: true } } },
    take: 20,
  });
}

/**
 * Try a failed payout again.
 *
 * A new Refund row is created by `issueRefund` for the fresh attempt, so the
 * ledger keeps one row per call to the provider and the original failure is
 * still readable. This one is marked resolved and points at its replacement.
 */
export async function retryRefund(input: {
  refundId: string;
  restaurantId: string;
  actor: ActorKind;
  actorId?: string;
}): Promise<OrderActionResult<{ refundedCts: number }>> {
  const failed = await prisma.refund.findFirst({
    where: { id: input.refundId, status: "FAILED", resolvedAt: null, order: { restaurantId: input.restaurantId } },
  });
  if (!failed) return { ok: false, error: "That refund is no longer outstanding." };

  const res = await issueRefund({
    orderId: failed.orderId,
    restaurantId: input.restaurantId,
    amountCts: failed.amountCts,
    reason: failed.reason,
    actor: input.actor,
    actorId: input.actorId,
    note: failed.note ?? undefined,
  });

  await prisma.refund.update({
    where: { id: failed.id },
    data: {
      attempts: { increment: 1 },
      ...(res.ok
        ? { resolvedAt: new Date(), resolvedNote: "Retried successfully." }
        : { error: res.error }),
    },
  });

  return res;
}

/**
 * Stop tracking a failed refund without putting money through the provider.
 *
 * The escape hatch for money handed back in cash at the counter, or a charge
 * that turned out never to have landed. It demands a note because "how did
 * this customer actually get made whole" is the question a chargeback asks.
 */
export async function dismissFailedRefund(input: {
  refundId: string;
  restaurantId: string;
  note: string;
  actor: ActorKind;
}): Promise<OrderActionResult<void>> {
  const note = input.note.trim().slice(0, 300);
  if (note.length < 3) return { ok: false, error: "Say how the customer was made whole." };

  const failed = await prisma.refund.findFirst({
    where: { id: input.refundId, status: "FAILED", resolvedAt: null, order: { restaurantId: input.restaurantId } },
  });
  if (!failed) return { ok: false, error: "That refund is no longer outstanding." };

  await prisma.refund.update({
    where: { id: failed.id },
    data: { resolvedAt: new Date(), resolvedNote: note },
  });

  await logEvent({
    orderId: failed.orderId,
    kind: "refund_settled_offline",
    actor: input.actor,
    meta: { refundId: failed.id, amountCts: failed.amountCts, note },
  });

  return { ok: true, value: undefined };
}

/**
 * How many times the unattended sweep will re-try a payout before it gives up
 * and leaves the debt to a human.
 *
 * There is no transient/permanent signal to lean on — `RefundResult` has no
 * `retryable` flag the way `SendResult` does, because a card processor rejecting
 * a refund looks the same whether the card is dead or the network blipped. So
 * the guard is a count, not a verdict: a payout that fails five sweeps running
 * is a phone call to the processor, not a loop, and the dashboard banner still
 * has it the whole time.
 */
export const MAX_REFUND_RETRIES = 5;

/**
 * Unattended retry for refunds that failed on the provider.
 *
 * The dashboard banner is the human path: an owner sees the debt and clicks
 * retry or settles it in cash. This is the path for the hours nobody is on the
 * board — a processor blip at 2am should not wait until 9 for someone to notice
 * an order still owes a customer money.
 *
 * It retries *in place*, against the same Refund row, and that is the whole
 * reason this is a separate function from `retryRefund`. The row id is the
 * idempotency key the payments seam dedupes on (see `RefundInput.idempotencyKey`),
 * so reusing it means a retry after a lost response returns the original result
 * instead of moving the money twice. `retryRefund` — the button — mints a fresh
 * row and so a fresh key on every press, which is safe under a human's eye but
 * exactly wrong to run on a timer: a send that succeeded but timed out would be
 * paid again, and a provider that's down would breed a new outstanding row every
 * two minutes.
 *
 * The money was released when the refund first failed (reserve-then-charge, see
 * `issueRefund`), so this re-reserves against a fresh read before charging —
 * another refund may have succeeded in the meantime and shrunk what's still
 * owable. A lost race writes nothing and is picked up on the next sweep.
 */
export async function retryFailedRefunds(restaurantId?: string): Promise<number> {
  const failed = await prisma.refund.findMany({
    where: { status: "FAILED", resolvedAt: null },
  });

  let recovered = 0;

  for (const refund of failed) {
    if (refund.attempts >= MAX_REFUND_RETRIES) continue;
    // A lost optimistic race, not a debt: another refund already moved this
    // money. Retrying only recomputes an empty refundable and fails forever.
    if (refund.error === "concurrent_refund") continue;

    const order = await prisma.order.findUnique({ where: { id: refund.orderId } });
    if (!order) continue;
    if (restaurantId && order.restaurantId !== restaurantId) continue;

    const available = refundableCts(order);
    if (available <= 0) {
      // The balance was cleared some other way since this failed. Nothing to
      // pay, so stop tracking it — settled, just not by us.
      await prisma.refund.update({
        where: { id: refund.id },
        data: {
          attempts: { increment: 1 },
          resolvedAt: new Date(),
          resolvedNote: "No balance left to refund — settled another way.",
        },
      });
      continue;
    }

    const amount = Math.min(refund.amountCts, available);

    // Re-reserve against the value we just read, same optimistic lock as
    // issueRefund. Of two writers, exactly one matches the row.
    const reserved = await prisma.order.updateMany({
      where: { id: order.id, refundedCts: order.refundedCts },
      data: { refundedCts: order.refundedCts + amount },
    });
    if (reserved.count === 0) continue;

    const res = await paymentProviderForMode(modeFromTag(order.paymentProvider)).refund({
      restaurantId: order.restaurantId,
      reference: order.paymentReference ?? "",
      amountCts: amount,
      includeSurcharge: refund.includedSurcharge,
      reason: refund.reason,
      idempotencyKey: refund.id, // stable across retries — the point of this path
    });

    if (!res.ok) {
      await prisma.order.update({
        where: { id: order.id },
        data: { refundedCts: { decrement: amount } },
      });
      await prisma.refund.update({
        where: { id: refund.id },
        data: { attempts: { increment: 1 }, provider: res.provider, error: res.error ?? "refund_failed" },
      });
      continue;
    }

    await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: "SUCCEEDED",
        provider: res.provider,
        providerRef: res.reference,
        succeededAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    await logEvent({
      orderId: order.id,
      kind: "refund_issued",
      actor: "SYSTEM",
      publicNote: `${centsToMoney(amount)} refunded — ${PROBLEM_LABELS[refund.reason].toLowerCase()}.`,
      meta: { refundId: refund.id, amountCts: amount, reason: refund.reason, retry: true },
    });

    if (order.customerId) {
      await prisma.customer.update({
        where: { id: order.customerId },
        data: { lifetimeCts: { decrement: amount } },
      });
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: order.restaurantId },
      select: { name: true, customDomain: true, domainVerifiedAt: true },
    });
    await notify(
      { id: order.id, restaurantId: order.restaurantId, customerId: order.customerId, number: order.number, publicToken: order.publicToken },
      restaurant,
      `we've refunded ${centsToMoney(amount)} for order ${order.number} — sorry it took a moment to go through. It's back on your card in 3–5 days.`
    );

    recovered++;
  }

  return recovered;
}

// ---------------------------------------------------------------------------
// The failure paths
// ---------------------------------------------------------------------------

/**
 * Kill an order and make the customer whole.
 *
 * `refund: "auto"` is the right answer almost always — full money back — and
 * exists so no caller has to remember to do it. The escape hatch is there for
 * a no-show on food that was actually cooked, where an owner may reasonably
 * keep the money.
 */
export async function cancelOrder(input: {
  orderId: string;
  restaurantId?: string;
  problem: OrderProblem;
  actor: ActorKind;
  actorId?: string;
  note?: string;
  /** REJECTED when the kitchen never started; CANCELED once it had. */
  reject?: boolean;
  refund?: "auto" | "none";
}): Promise<OrderActionResult<{ refundedCts: number }>> {
  const order = await loadOrder({
    id: input.orderId,
    ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
  });
  if (!order) return { ok: false, error: "Order not found." };

  if (isTerminal(order.status)) {
    return { ok: false, error: `That order is already ${order.status.toLowerCase()}.` };
  }

  // Reject is only honest before the kitchen committed to the food.
  const to: OrderStatus = input.reject && order.status === "RECEIVED" ? "REJECTED" : "CANCELED";
  const now = new Date();

  // Same optimistic lock as transitionOrder, and it matters more here: a
  // double-cancel would fire two refunds and two apology texts at a customer
  // whose order only failed once.
  const canceled = await prisma.$transaction(async (tx) => {
    const { count } = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: {
        status: to,
        canceledAt: now,
        problem: input.problem,
        problemNote: input.note?.slice(0, 300) || null,
        endedBy: input.actor,
      },
    });
    if (count === 0) return false;

    await logEvent({
      orderId: order.id,
      kind: to === "REJECTED" ? "order_rejected" : "order_canceled",
      actor: input.actor,
      fromStatus: order.status,
      toStatus: to,
      publicNote: input.note?.slice(0, 300) || PROBLEM_LABELS[input.problem],
      meta: { problem: input.problem },
      tx,
    });
    return true;
  });

  if (!canceled) {
    return { ok: false, error: "That order was already closed out by someone else. Reload to see where it landed." };
  }

  let refunded = order.refundedCts;

  if ((input.refund ?? "auto") === "auto") {
    const owed = refundableCts(order);
    if (owed > 0) {
      const res = await issueRefund({
        orderId: order.id,
        amountCts: owed,
        reason: input.problem,
        actor: input.actor,
        actorId: input.actorId,
        note: input.note,
        silent: true, // the cancellation message below covers it
      });
      if (res.ok) refunded = res.value.refundedCts;
    }
  }

  // Customer counters are a cache over the orders table, and the question they
  // answer is "is this a customer?" An order that ended with the customer
  // paying nothing never became one — the kitchen refused it, or gave the money
  // back — and leaving it counted inflates the returning-customers figure and
  // will eventually aim a win-back campaign at an order that never happened.
  //
  // A no-show the owner kept the money for is the opposite case: food was made
  // and paid for. That is a real transaction however annoying it was, so the
  // counters stand. Hence the test is what the customer ended up paying, not
  // whether the order was canceled.
  const paidNothing = refunded >= order.totalCts;

  if (order.customerId && paidNothing) {
    const prior = await prisma.order.findFirst({
      where: {
        customerId: order.customerId,
        id: { not: order.id },
        status: { notIn: ["CANCELED", "REJECTED"] },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    await prisma.customer.update({
      where: { id: order.customerId },
      data: {
        orderCount: { decrement: 1 },
        // lifetimeCts was already walked back per refunded cent by issueRefund.
        lastOrderAt: prior?.createdAt ?? null,
      },
    });
  }

  const money =
    refunded > order.refundedCts
      ? ` We've refunded ${centsToMoney(refunded - order.refundedCts)} — back on your card in 3–5 days.`
      : "";

  // A no-show isn't something to apologise for — the restaurant made the food
  // and waited. Saying "sorry" there reads as sarcasm at best.
  const body =
    input.problem === "NO_SHOW"
      ? `order ${order.number} was closed out — it wasn't picked up.${money}`
      : `sorry — order ${order.number} was canceled because ${PROBLEM_APOLOGY[input.problem]}.${money}`;

  await notify(order, order.restaurant, body);

  await fireTrigger(order.restaurantId, "ORDER_CANCELED", order.customerId, {
    orderId: order.id,
    triggerKey: order.id,
    problem: input.problem,
  });

  return { ok: true, value: { refundedCts: refunded } };
}

/**
 * How long a bag can sit on the pickup shelf before the board offers to close
 * it out. Long enough to cover a customer stuck in traffic, short enough that
 * the shelf doesn't fill up with dead orders over a service.
 */
export const NO_SHOW_AFTER_MINS = 45;

/** Has this order been sitting ready long enough to be treated as abandoned? */
export function isProbableNoShow(
  order: { status: OrderStatus; readyAt: Date | null },
  now: Date = new Date()
): boolean {
  if (order.status !== "READY" || !order.readyAt) return false;
  return now.getTime() - order.readyAt.getTime() >= NO_SHOW_AFTER_MINS * 60_000;
}

/**
 * Food that was made and nobody came for.
 *
 * `NO_SHOW` sat in the enum with no code path able to produce it, so these
 * orders stayed READY forever — cluttering the board and leaving the customer's
 * status page insisting their food is waiting, days later.
 *
 * Deliberately owner-initiated and never automatic. Whether to refund someone
 * who didn't turn up is a judgement call about a regular, a first-timer, or a
 * genuine mix-up, and it is not ours to make: the food was cooked and the
 * restaurant is out the cost either way. So the caller states the refund.
 */
export async function markNoShow(input: {
  orderId: string;
  restaurantId: string;
  actor: ActorKind;
  actorId?: string;
  note?: string;
  /** "none" keeps the money — the default, since the food exists. */
  refund?: "auto" | "none";
}): Promise<OrderActionResult<{ refundedCts: number }>> {
  const order = await loadOrder({ id: input.orderId, restaurantId: input.restaurantId });
  if (!order) return { ok: false, error: "Order not found." };

  // Only from READY. An order still being cooked hasn't been stood up yet, and
  // one already handed over was collected by definition.
  if (order.status !== "READY") {
    return {
      ok: false,
      error: `Only an order that's ready and waiting can be marked a no-show — this one is ${order.status.toLowerCase()}.`,
    };
  }

  return cancelOrder({
    orderId: order.id,
    restaurantId: input.restaurantId,
    problem: "NO_SHOW",
    actor: input.actor,
    actorId: input.actorId,
    note: input.note,
    refund: input.refund ?? "none",
  });
}

/**
 * The out-of-stock path, and the reason partial refunds exist at all.
 *
 * A customer who ordered four things and can't have one of them would much
 * rather get the other three and their money back for the fourth than lose the
 * whole order. So the kitchen marks what it can actually make, and if that
 * turns out to be nothing, this collapses into a full cancellation.
 */
export async function markItemsUnavailable(input: {
  orderId: string;
  restaurantId: string;
  /** Per line: how many are actually being made. 0 drops the line entirely. */
  lines: Array<{ orderItemId: string; fulfilledQty: number }>;
  actor: ActorKind;
  actorId?: string;
  note?: string;
}): Promise<OrderActionResult<{ refundedCts: number; canceled: boolean }>> {
  const order = await loadOrder({ id: input.orderId, restaurantId: input.restaurantId });
  if (!order) return { ok: false, error: "Order not found." };
  if (isTerminal(order.status)) {
    return { ok: false, error: `That order is already ${order.status.toLowerCase()}.` };
  }

  const byId = new Map(order.items.map((i) => [i.id, i]));
  let removedFoodCts = 0;
  const updates: Array<{ id: string; fulfilledQty: number; name: string; dropped: number }> = [];

  for (const line of input.lines) {
    const item = byId.get(line.orderItemId);
    if (!item) continue;

    // Already-reduced lines are measured against what's left, not the original
    // quantity, so applying this twice can't refund the same unit twice.
    const current = item.fulfilledQty ?? item.qty;
    const next = Math.max(0, Math.min(Math.floor(line.fulfilledQty), current));
    if (next === current) continue;

    const dropped = current - next;
    removedFoodCts += Math.max(0, item.unitPriceCts + item.modifiersCts) * dropped;
    updates.push({ id: item.id, fulfilledQty: next, name: item.name, dropped });
  }

  if (!updates.length) return { ok: false, error: "Nothing changed." };

  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.orderItem.update({ where: { id: u.id }, data: { fulfilledQty: u.fulfilledQty } });
    }
    await logEvent({
      orderId: order.id,
      kind: "items_unavailable",
      actor: input.actor,
      publicNote: updates.map((u) => `${u.dropped}× ${u.name} unavailable`).join(", "),
      meta: { lines: updates.map((u) => ({ id: u.id, fulfilledQty: u.fulfilledQty })) },
      tx,
    });
  });

  // Nothing left to cook — this is a cancellation wearing a different hat.
  const remaining = order.items.reduce((sum, i) => {
    const u = updates.find((x) => x.id === i.id);
    return sum + (u ? u.fulfilledQty : i.fulfilledQty ?? i.qty);
  }, 0);

  if (remaining === 0) {
    const res = await cancelOrder({
      orderId: order.id,
      restaurantId: input.restaurantId,
      problem: "OUT_OF_STOCK",
      actor: input.actor,
      actorId: input.actorId,
      note: input.note,
    });
    return res.ok
      ? { ok: true, value: { refundedCts: res.value.refundedCts, canceled: true } }
      : res;
  }

  const amount = computePartialRefundCts(order, removedFoodCts, true);
  const res = await issueRefund({
    orderId: order.id,
    amountCts: amount,
    reason: "OUT_OF_STOCK",
    actor: input.actor,
    actorId: input.actorId,
    note: input.note ?? updates.map((u) => `${u.dropped}× ${u.name}`).join(", "),
    silent: true,
  });

  await notify(
    order,
    order.restaurant,
    `sorry — we're out of ${updates.map((u) => u.name).join(" and ")}. The rest of order ${order.number} is still coming, and we've refunded ${centsToMoney(amount)}.`
  );

  return {
    ok: true,
    value: { refundedCts: res.ok ? res.value.refundedCts : order.refundedCts, canceled: false },
  };
}

/**
 * Customer-initiated cancel from the status page.
 *
 * Allowed only while nobody has started cooking. Past that the food exists and
 * someone has to pay for it — so the customer is pushed to report an issue
 * instead, which a human reads.
 */
export async function customerCancelOrder(input: {
  token: string;
  note?: string;
}): Promise<OrderActionResult<{ refundedCts: number }>> {
  const order = await prisma.order.findUnique({ where: { publicToken: input.token } });
  if (!order) return { ok: false, error: "Order not found." };

  if (isTerminal(order.status)) {
    return { ok: false, error: `This order is already ${order.status.toLowerCase()}.` };
  }
  if (order.status !== "RECEIVED" && order.status !== "ACCEPTED") {
    return {
      ok: false,
      error: "The kitchen has already started this order, so it can't be canceled here. Report a problem below and they'll get back to you.",
    };
  }

  return cancelOrder({
    orderId: order.id,
    problem: "CUSTOMER_REQUEST",
    actor: "CUSTOMER",
    note: input.note,
    reject: false,
  });
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

/**
 * Re-exported so existing server callers keep one import. The labels
 * themselves live in `lib/order-labels.ts`, which has no dependencies — the
 * status page is a client component and importing this module from the browser
 * pulls Prisma, Stripe and the send doors in with it.
 */
export { ISSUE_LABELS };

/**
 * A problem reported after the fact. Deliberately does not touch the order's
 * status: an order can be COMPLETED and still be wrong, and pretending
 * otherwise is how complaints get lost.
 */
export async function reportIssue(input: {
  token: string;
  kind: keyof typeof ISSUE_LABELS;
  body: string;
}): Promise<OrderActionResult<{ id: string }>> {
  const order = await prisma.order.findUnique({ where: { publicToken: input.token } });
  if (!order) return { ok: false, error: "Order not found." };

  const body = input.body.trim().slice(0, 1000);
  if (body.length < 3) return { ok: false, error: "Tell us a little about what went wrong." };

  // One open report at a time. Stops a frustrated double-submit from turning
  // into two tickets that get answered separately.
  const existing = await prisma.orderIssue.findFirst({
    where: { orderId: order.id, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
  });
  if (existing) {
    return { ok: false, error: "You've already reported a problem with this order — they're on it." };
  }

  const issue = await prisma.orderIssue.create({
    data: {
      orderId: order.id,
      restaurantId: order.restaurantId,
      kind: input.kind as never,
      body,
    },
  });

  await logEvent({
    orderId: order.id,
    kind: "issue_reported",
    actor: "CUSTOMER",
    publicNote: "You reported a problem. The restaurant has been notified.",
    meta: { issueId: issue.id, issueKind: input.kind },
  });

  return { ok: true, value: { id: issue.id } };
}

/**
 * Answer a customer's report.
 *
 * Lives here rather than in the dashboard action because it sends money-adjacent
 * news to a customer, and because it was previously silent: the resolution was
 * written to the timeline and the customer only saw it if they happened to
 * reopen the link. Someone who reported a problem and got a refund was never
 * told. The messaging plumbing existed the whole time and simply wasn't called.
 */
export async function resolveIssue(input: {
  issueId: string;
  restaurantId: string;
  status: IssueStatus;
  resolution?: string;
}): Promise<OrderActionResult<void>> {
  const issue = await prisma.orderIssue.findFirst({
    where: { id: input.issueId, restaurantId: input.restaurantId },
  });
  if (!issue) return { ok: false, error: "That report no longer exists." };

  const resolution = input.resolution?.trim().slice(0, 500) || null;
  const closed = input.status === "RESOLVED" || input.status === "DECLINED";

  await prisma.orderIssue.update({
    where: { id: issue.id },
    data: {
      status: input.status,
      resolution,
      acknowledgedAt: issue.acknowledgedAt ?? new Date(),
      resolvedAt: closed ? new Date() : null,
    },
  });

  // The customer reads this on their status page, so it goes in the timeline
  // as well as in the text — the page is the durable copy.
  await logEvent({
    orderId: issue.orderId,
    kind: "issue_updated",
    actor: "RESTAURANT",
    publicNote: resolution || `The restaurant marked your report ${input.status.toLowerCase()}.`,
    meta: { issueId: issue.id, status: input.status },
  });

  const order = await loadOrder({ id: issue.orderId });
  if (order) {
    // The owner's own words when they wrote any; a plain statement of where
    // things stand when they didn't. Never both — a customer doesn't need the
    // status name and the explanation of the status name.
    const body = resolution
      ? `about order ${order.number}: ${resolution}`
      : input.status === "ACKNOWLEDGED"
        ? `we've seen your report about order ${order.number} and we're looking into it.`
        : input.status === "DECLINED"
          ? `we've looked into your report about order ${order.number} and won't be able to make a change. Get in touch if that doesn't seem right.`
          : `your report about order ${order.number} has been sorted.`;

    await notify(order, order.restaurant, body);
  }

  return { ok: true, value: undefined };
}

/**
 * Sweep for orders nobody ever acknowledged.
 *
 * A customer standing in a lobby with no reply is the single worst state this
 * system can produce, so after the tenant's grace period the platform cancels
 * and refunds on the restaurant's behalf.
 *
 * Which status counts as "unacknowledged" depends on the tenant. With
 * `autoAccept` on — the default — an order is created ACCEPTED without a human
 * ever seeing it, so ACCEPTED is exactly as unattended as RECEIVED is
 * elsewhere. The first version of this only looked at RECEIVED, which meant it
 * matched nothing at all for every restaurant on the default config.
 *
 * Run from `scripts/sweep.ts` on a schedule. Deliberately NOT called from
 * dashboard load: the scenario it exists for is "nobody is watching the
 * dashboard", so triggering it on dashboard load makes it fire in exactly the
 * cases it isn't needed and stay silent in the ones it is.
 */
export async function expireStaleOrders(restaurantId?: string): Promise<number> {
  const restaurants = await prisma.restaurant.findMany({
    where: { ...(restaurantId ? { id: restaurantId } : {}), status: "ACTIVE" },
    select: { id: true, autoExpireMins: true, autoAccept: true },
  });

  let expired = 0;

  for (const r of restaurants) {
    const cutoff = new Date(Date.now() - Math.max(1, r.autoExpireMins) * 60_000);
    const unattended: OrderStatus = r.autoAccept ? "ACCEPTED" : "RECEIVED";

    const stale = await prisma.order.findMany({
      where: { restaurantId: r.id, status: unattended, createdAt: { lt: cutoff } },
      select: { id: true },
    });

    for (const o of stale) {
      const res = await cancelOrder({
        orderId: o.id,
        restaurantId: r.id,
        problem: "TOO_BUSY",
        actor: "SYSTEM",
        note: "No response from the restaurant in time.",
        reject: true,
      });
      if (res.ok) expired++;
    }
  }

  return expired;
}

/**
 * Tell customers whose food is late that it's late.
 *
 * An order past its promised time is not something to cancel — it's being
 * cooked, and taking it away from someone who is already waiting helps nobody.
 * What it needs is an admission. One message, once, when the promise has been
 * broken by a wide enough margin that the customer has certainly noticed.
 *
 * The `order_overdue` event is both the customer's timeline entry and the
 * de-dupe key: a sweep that runs every minute must not text every minute.
 */
export async function flagOverdueOrders(input: {
  restaurantId?: string;
  /** How far past the promise before we say something. */
  graceMins?: number;
} = {}): Promise<number> {
  const grace = Math.max(1, input.graceMins ?? 15);
  const cutoff = new Date(Date.now() - grace * 60_000);

  const late = await prisma.order.findMany({
    where: {
      ...(input.restaurantId ? { restaurantId: input.restaurantId } : {}),
      status: "PREPARING",
      promisedAt: { lt: cutoff },
    },
    ...ORDER_WITH_CONTEXT,
  });

  let flagged = 0;

  for (const order of late) {
    const already = await prisma.orderEvent.findFirst({
      where: { orderId: order.id, kind: "order_overdue" },
      select: { id: true },
    });
    if (already) continue;

    await logEvent({
      orderId: order.id,
      kind: "order_overdue",
      actor: "SYSTEM",
      publicNote: "This order is running behind. The kitchen is still working on it.",
      meta: { promisedAt: order.promisedAt?.toISOString() ?? null, graceMins: grace },
    });

    await notify(
      order,
      order.restaurant,
      `order ${order.number} is running late — it's still being made. Sorry for the wait.`
    );

    flagged++;
  }

  return flagged;
}

/**
 * Everything the scheduled job does, in one call so the runner stays dumb.
 */
export async function runOrderSweeps(restaurantId?: string) {
  const expired = await expireStaleOrders(restaurantId);
  const overdue = await flagOverdueOrders({ restaurantId });
  const refundsRecovered = await retryFailedRefunds(restaurantId);
  return { expired, overdue, refundsRecovered };
}

// ---------------------------------------------------------------------------
// Customer-facing copy
// ---------------------------------------------------------------------------

export function statusHeadline(
  status: OrderStatus,
  problem?: OrderProblem | null
): { title: string; tone: "ok" | "warn" | "bad" } {
  // A no-show is technically a cancellation, but telling someone their order
  // was "Canceled" when they simply didn't come for it invites a support call
  // asking why. Name what actually happened.
  if (status === "CANCELED" && problem === "NO_SHOW") {
    return { title: "Not picked up", tone: "bad" };
  }

  switch (status) {
    case "RECEIVED":
      return { title: "Sent to the kitchen", tone: "warn" };
    case "ACCEPTED":
      return { title: "Confirmed", tone: "ok" };
    case "PREPARING":
      return { title: "Being made now", tone: "ok" };
    case "READY":
      return { title: "Ready for pickup", tone: "ok" };
    case "COMPLETED":
      return { title: "Picked up", tone: "ok" };
    case "REJECTED":
      return { title: "Couldn't be made", tone: "bad" };
    case "CANCELED":
      return { title: "Canceled", tone: "bad" };
    // Unreachable today. Kept so that adding a status later degrades to a
    // dull-but-true heading instead of rendering blank at the customer.
    default:
      return { title: "Order update", tone: "warn" };
  }
}
