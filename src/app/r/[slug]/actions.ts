"use server";

import { prisma } from "@/lib/prisma";
import { computeTotals, normalizePhone, effectiveItemPriceCts, centsToMoney } from "@/lib/money";
import { notify } from "@/lib/notifications";
import {
  DEFAULT_PLAN,
  effectivePlan,
  isPlan,
  platformFeeCts,
  surchargeConfigFor,
  type Plan,
} from "@/lib/plans";
import { paymentProviderForMode, resolvePaymentMode, providerTag } from "@/lib/payments";
import { queueMessage } from "@/lib/sms";
import { OPT_IN_TEXT } from "@/lib/consent";
import { checkAvailability } from "@/lib/hours";
import { cardPaymentsAllowed } from "@/lib/entitlements";
import { logEvent, newOrderToken, orderPath, orderUrl } from "@/lib/orders";
import { attachOrderToVisit } from "@/lib/analytics";
import { getCustomerSession } from "@/lib/customer-session";
import { fireTrigger } from "@/lib/automations";
import type { CartLineInput } from "@/lib/cart";

export type PlaceOrderInput = {
  slug: string;
  lines: CartLineInput[];
  phone: string;
  name?: string;
  optIn: boolean;
  notes?: string;
  /** A card collected in the browser (`pm_...`). Absent in the stub/test path. */
  paymentMethodId?: string;
  /**
   * Set on the retry after a 3-D Secure challenge: the intent the browser just
   * authorised. The provider finalizes it instead of charging again.
   */
  paymentIntentId?: string;
  /**
   * The browser's anonymous visit id, so the traffic that produced this order
   * can be credited with it. Optional and never required: a customer with
   * storage disabled, or with the beacon blocked, still gets their food — the
   * cost is one unattributed order in a chart, which is the correct thing to
   * trade away. See `attachOrderToVisit`.
   */
  anonId?: string;
};

export type PlacedOrder = {
  number: string;
  subtotalCts: number;
  surchargeCts: number;
  taxCts: number;
  totalCts: number;
  surchargeLabel: string;
  /** Link to the status page — the customer's handle on this order forever. */
  trackUrl: string;
  /** When we told them it would be ready, as an ISO string. */
  promisedAt: string | null;
  lines: Array<{ name: string; qty: number; lineTotalCts: number; choices: string }>;
};

export type PlaceOrderResult =
  | { ok: true; order: PlacedOrder }
  /**
   * The card needs a 3-D Secure challenge. Nothing has been written — no
   * order, no customer. The browser runs the challenge with `clientSecret`,
   * then calls placeOrderAction again with `paymentIntentId` set, and the
   * second pass finalizes that same intent rather than charging afresh.
   */
  | { ok: false; requiresAction: true; clientSecret: string; paymentIntentId: string }
  /**
   * `reopens` is populated when the refusal was about timing, so the UI can
   * say "we open again tomorrow at 11" instead of just "no".
   */
  | { ok: false; error: string; reopens?: string | null };

function orderNumber(seq: number) {
  return `A-${8000 + (seq % 90000)}`;
}

export async function placeOrderAction(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { slug: input.slug },
    include: {
      closures: { select: { startDate: true, endDate: true, reason: true } },
    },
  });
  if (!restaurant) {
    return { ok: false, error: "This restaurant isn't taking orders right now." };
  }

  // The cheapest support ticket is the order that was never taken. Closed,
  // on holiday, paused mid-service, or past last call — all refused here,
  // while the customer can still do something about it.
  const availability = checkAvailability(restaurant, new Date());
  if (!availability.ok) {
    return {
      ok: false,
      error: availability.message,
      reopens: availability.reopens,
    };
  }

  if (!input.lines?.length) return { ok: false, error: "Your cart is empty." };

  const phone = normalizePhone(input.phone ?? "");
  if (!phone) {
    return { ok: false, error: "Enter a valid mobile number so we can text you when it's ready." };
  }

  // Prices and modifier rules always come from the database, never the client.
  const ids = [...new Set(input.lines.map((l) => l.itemId))];
  const items = await prisma.menuItem.findMany({
    where: { id: { in: ids }, restaurantId: restaurant.id, available: true },
    include: {
      modifierGroups: {
        orderBy: { sort: "asc" },
        include: { options: { orderBy: { sort: "asc" } } },
      },
    },
  });
  const byId = new Map(items.map((i) => [i.id, i]));

  type Resolved = {
    item: (typeof items)[number];
    qty: number;
    notes: string;
    unitPriceCts: number;
    modifiersCts: number;
    chosen: Array<{ groupName: string; optionName: string; priceDeltaCts: number; optionId: string }>;
  };

  const resolved: Resolved[] = [];

  for (const line of input.lines) {
    const item = byId.get(line.itemId);
    if (!item) continue; // 86'd between loading the menu and checking out

    const qty = Math.max(1, Math.min(50, Math.floor(line.qty)));
    const picked = new Set(line.optionIds ?? []);

    const chosen: Resolved["chosen"] = [];
    let modifiersCts = 0;
    let invalid = false;

    for (const group of item.modifierGroups) {
      const hits = group.options.filter((o) => picked.has(o.id) && o.available);

      // Re-check the group's own rules. A stale tab, or a hand-rolled request,
      // does not get to skip a required choice or stack ten add-ons.
      if (hits.length < group.minSelect || hits.length > group.maxSelect) {
        invalid = true;
        break;
      }

      for (const o of hits) {
        modifiersCts += o.priceDeltaCts;
        chosen.push({
          groupName: group.name,
          optionName: o.name,
          priceDeltaCts: o.priceDeltaCts,
          optionId: o.id,
        });
      }
    }

    if (invalid) {
      return { ok: false, error: `The options for ${item.name} changed. Open it again and re-pick.` };
    }

    // Any id that didn't match a live option on this item is rejected outright.
    if (chosen.length !== picked.size) {
      return {
        ok: false,
        error: `Some choices for ${item.name} are no longer available. Open it again and re-pick.`,
      };
    }

    resolved.push({
      item,
      qty,
      notes: (line.notes ?? "").slice(0, 200),
      unitPriceCts: effectiveItemPriceCts(item),
      modifiersCts,
      chosen,
    });
  }

  if (!resolved.length) {
    return { ok: false, error: "Those items are no longer available. Refresh and try again." };
  }

  const subtotalCts = resolved.reduce(
    (a, l) => a + Math.max(0, l.unitPriceCts + l.modifiersCts) * l.qty,
    0
  );
  // A tenant with cards switched off takes no online payment, and the service
  // fee — which only exists because the platform is processing the card — is
  // waived rather than charged for the restaurant to pocket in cash. So the fee
  // config is zeroed and the effective mode drops to STUB for this order.
  // Re-derived server-side rather than trusted from the page render: a
  // suspension landing mid-session must take effect on the next order, not the
  // next page load. `cardPaymentsAllowed` is both switches — the owner's and
  // ours — so a suspended tenant silently drops to pay-at-counter here.
  const cardsOn = await cardPaymentsAllowed(restaurant);

  // Which plan the tenant is actually on right now. Read through
  // `effectivePlan` rather than off the column, because a scheduled switch
  // applies on its own date whether or not the sweep that materialises it has
  // run — and the sweep still doesn't exist in production.
  const plan = effectivePlan(
    {
      plan: isPlan(restaurant.plan) ? restaurant.plan : DEFAULT_PLAN,
      pendingPlan: isPlan(restaurant.pendingPlan ?? "") ? (restaurant.pendingPlan as Plan) : null,
      currentPeriodEnd: restaurant.planPeriodEnd,
      pastDueSince: restaurant.planPastDueSince,
    },
    new Date()
  );

  // Two gates on the customer's service fee, and both have to pass for one to
  // appear. The plan decides whether this tenant charges its customers at all;
  // cards-off waives it regardless, because the fee only exists when the
  // platform is processing the card and it must not become cash the restaurant
  // pockets at the counter.
  const feeCfg = cardsOn
    ? surchargeConfigFor(plan, restaurant)
    : { ...restaurant, surchargePct: 0, surchargeMinCts: 0, surchargeMaxCts: 0 };
  const totals = computeTotals(subtotalCts, feeCfg);

  // The platform mode, resolved once here and stamped onto the order below, so
  // a refund weeks later reaches for the same key set that took the money.
  // Cards-off forces STUB regardless of the platform mode.
  const mode = cardsOn ? await resolvePaymentMode() : "STUB";

  const charge = await paymentProviderForMode(mode).charge({
    restaurantId: restaurant.id,
    amountCts: totals.totalCts,
    // Our cut. Equal to the surcharge on ZERO; a commission out of the
    // restaurant's proceeds on HYBRID; nothing on FLAT. Cards-off means no
    // charge at all, so the zeroed config above already made it zero.
    applicationFeeCts: cardsOn ? platformFeeCts(plan, totals) : 0,
    description: `${restaurant.name} order`,
    paymentMethodId: input.paymentMethodId,
    paymentIntentId: input.paymentIntentId,
  });
  if (!charge.ok) {
    // A card that needs 3-D Secure is neither a failure nor a completed
    // charge. Hand the challenge back to the browser; nothing has been written
    // yet, so there is nothing to unwind if the customer abandons it.
    if (charge.requiresAction && charge.clientSecret) {
      return {
        ok: false,
        requiresAction: true,
        clientSecret: charge.clientSecret,
        paymentIntentId: charge.reference,
      };
    }
    return { ok: false, error: "Payment could not be completed. Nothing was charged." };
  }

  // Upsert the customer. This — not the order — is the asset.
  const existing = await prisma.customer.findUnique({
    where: { restaurantId_phone: { restaurantId: restaurant.id, phone } },
  });

  const now = new Date();
  const optInFields = input.optIn
    ? {
        optInStatus: "OPTED_IN" as const,
        optInAt: now,
        optInSource: "checkout_v1",
        optInText: OPT_IN_TEXT,
      }
    : {};

  const customer = existing
    ? await prisma.customer.update({
        where: { id: existing.id },
        data: {
          name: input.name?.trim() || existing.name,
          lastOrderAt: now,
          orderCount: { increment: 1 },
          lifetimeCts: { increment: totals.totalCts },
          // Never silently downgrade an existing consent.
          ...(input.optIn && existing.optInStatus !== "OPTED_IN" ? optInFields : {}),
        },
      })
    : await prisma.customer.create({
        data: {
          restaurantId: restaurant.id,
          phone,
          name: input.name?.trim() || null,
          firstOrderAt: now,
          lastOrderAt: now,
          orderCount: 1,
          lifetimeCts: totals.totalCts,
          // 20% holdout, assigned once at creation and never changed — this is
          // what makes the lift measurement mean anything.
          cohort: Math.random() < 0.2 ? "HOLDOUT" : "TREATMENT",
          ...optInFields,
        },
      });

  // Link a storefront sign-in to the customer it turned out to be.
  //
  // This is the only place the link is made, and it is made *here* rather than
  // at sign-in because a `Customer` is keyed by phone number and a sign-in
  // supplies an email address. Until someone orders, an account is a person we
  // can greet by name and nothing more.
  //
  // Best-effort on purpose: a failure here must not fail a paid order. The
  // worst case is an account that shows no history until the next order.
  const account = await getCustomerSession(restaurant.id);
  if (account) {
    await prisma.customerAccount
      .updateMany({
        // Scoped to the tenant and to a currently-unlinked row. A signed-in
        // account that already points at a different customer is left alone —
        // two people sharing a laptop must not merge into one record.
        where: { id: account.accountId, restaurantId: restaurant.id, customerId: null },
        data: { customerId: customer.id },
      })
      .catch(() => null);
  }

  const seq = await prisma.order.count({ where: { restaurantId: restaurant.id } });

  // The promise, made once and stored, so "is it late?" has an answer that
  // doesn't drift every time someone reloads the page.
  const promisedAt = new Date(now.getTime() + availability.promiseMinutes * 60_000);

  // Tenants that keep a tablet on the pass want to confirm each ticket
  // themselves; everyone else would rather the customer got an instant yes.
  const autoAccepted = restaurant.autoAccept;

  const order = await prisma.order.create({
    data: {
      restaurantId: restaurant.id,
      customerId: customer.id,
      number: orderNumber(seq + 1),
      status: autoAccepted ? "ACCEPTED" : "RECEIVED",
      publicToken: newOrderToken(),
      promisedAt,
      acceptedAt: autoAccepted ? now : null,
      subtotalCts: totals.subtotalCts,
      surchargeCts: totals.surchargeCts,
      taxCts: totals.taxCts,
      totalCts: totals.totalCts,
      fulfillment: "pickup",
      notes: (input.notes ?? "").slice(0, 300) || null,
      // The tag, not the bare provider name, so a refund can recover which key
      // set to use (see modeFromTag).
      paymentProvider: providerTag(mode),
      paymentReference: charge.reference,
      paymentStatus: charge.status,
      items: {
        create: resolved.map((l) => ({
          menuItemId: l.item.id,
          name: l.item.name,
          unitPriceCts: l.unitPriceCts,
          modifiersCts: l.modifiersCts,
          qty: l.qty,
          notes: l.notes || null,
          modifiers: {
            create: l.chosen.map((c) => ({
              groupName: c.groupName,
              optionName: c.optionName,
              priceDeltaCts: c.priceDeltaCts,
              optionId: c.optionId,
            })),
          },
        })),
      },
    },
  });

  await prisma.rewardsLedger.create({
    data: {
      customerId: customer.id,
      points: Math.round(totals.subtotalCts / 100),
      reason: "order",
      orderId: order.id,
    },
  });

  await logEvent({
    orderId: order.id,
    kind: "order_placed",
    actor: "CUSTOMER",
    toStatus: order.status,
    publicNote: "Order placed.",
    meta: { promiseMinutes: availability.promiseMinutes, autoAccepted },
  });

  // Credit the visit. Deliberately after the order and its ledger entry are
  // committed, and internally swallowed: attribution is a reporting nicety and
  // the order is the thing that matters. It is also the only writer of
  // `Visit.converted` — a conversion the public beacon could claim for itself
  // would make every tenant's conversion rate a number anyone can inflate.
  await attachOrderToVisit({
    restaurantId: restaurant.id,
    anonId: input.anonId,
    orderId: order.id,
    totalCts: totals.totalCts,
  });

  const eta = promisedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

  // Transactional, so it bypasses the marketing opt-in gate. Logged, not sent.
  // The link matters more than the words: it's how a customer with a problem
  // finds their order again without phoning anyone.
  await queueMessage({
    restaurantId: restaurant.id,
    customerId: customer.id,
    kind: "TRANSACTIONAL",
    body: `${restaurant.name}: order ${order.number} ${autoAccepted ? "confirmed" : "received"}, ready around ${eta}. Track it or report a problem: ${orderUrl(order.publicToken, restaurant)}`,
  });

  // Standing journeys. Fired after the order, its ledger entry and its
  // confirmation text are all done, and internally swallowed — a marketing
  // follow-up must never be able to fail an order somebody has already paid
  // for. FIRST_ORDER is a separate trigger rather than a condition on
  // ORDER_PLACED because "welcome, thanks for trying us" and "thanks for
  // ordering again" are different messages, and an owner should be able to
  // draw them as different journeys.
  //
  // `triggerKey` is the order id, which is what makes ONCE_PER_TRIGGER mean
  // "once for this order" rather than "once ever".
  const firstOrder = !existing;
  await fireTrigger(restaurant.id, "ORDER_PLACED", customer.id, {
    orderId: order.id,
    triggerKey: order.id,
    orderTotalCts: totals.totalCts,
  });
  if (firstOrder) {
    await fireTrigger(restaurant.id, "CUSTOMER_CREATED", customer.id, { triggerKey: customer.id });
    await fireTrigger(restaurant.id, "FIRST_ORDER", customer.id, {
      orderId: order.id,
      triggerKey: order.id,
      orderTotalCts: totals.totalCts,
    });
  }
  // Only when consent was newly granted here. An opted-in customer ordering
  // again has not opted in again, and a journey that welcomes them to the
  // texting list every Friday is the fastest route to a STOP.
  if (input.optIn && existing?.optInStatus !== "OPTED_IN") {
    await fireTrigger(restaurant.id, "OPTED_IN", customer.id, { triggerKey: customer.id });
  }

  // Alert the restaurant's own owners that an order landed. Best-effort and
  // internally swallowed like everything else after the paid order — the
  // customer's confirmation and the order row are what matter, not the owner's
  // heads-up. Owners get in-app + email by default; the dashboard board is
  // still the authority, this is the "even when I'm not looking at it" copy.
  await notify({
    kind: "ORDER_PLACED",
    audience: { to: "OWNERS_OF", restaurantId: restaurant.id },
    title: `New order ${order.number}`,
    body: `${order.number} for ${centsToMoney(totals.totalCts)}, ready around ${eta}.`,
    link: "/dashboard",
    restaurantId: restaurant.id,
    dedupeKey: `order:${order.id}`,
  });

  return {
    ok: true,
    order: {
      number: order.number,
      subtotalCts: totals.subtotalCts,
      surchargeCts: totals.surchargeCts,
      taxCts: totals.taxCts,
      totalCts: totals.totalCts,
      surchargeLabel: restaurant.surchargeLabel,
      trackUrl: orderPath(order.publicToken),
      promisedAt: promisedAt.toISOString(),
      lines: resolved.map((l) => ({
        name: l.item.name,
        qty: l.qty,
        lineTotalCts: Math.max(0, l.unitPriceCts + l.modifiersCts) * l.qty,
        choices: l.chosen.map((c) => c.optionName).join(" · "),
      })),
    },
  };
}
