import "server-only";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PLAN,
  PLAN_SPECS,
  isPaidPlan,
  isPlan,
  planChangeDecision,
  type Plan,
  type SubscriptionState,
} from "@/lib/plans";

/**
 * Subscription billing — **the only place money moves towards us rather than
 * through us.**
 *
 * Everywhere else in this product, a charge is created *on the restaurant's
 * connected account* and we take a slice as `application_fee_amount` (see the
 * long note at the top of `payments-stripe.ts` about why that shape is the
 * whole business). This module is the exception and the opposite: a
 * subscription on the **platform** account, charging the owner's own card.
 *
 * Two consequences that are easy to get wrong:
 *
 * - **No `Stripe-Account` header, ever.** Every call here is platform-scoped.
 *   Adding that header would create the customer and subscription on the
 *   restaurant's account, where they would bill the restaurant's own customers
 *   and be invisible to us.
 * - **A different card.** `Restaurant.stripeCustomerId` is the owner paying us.
 *   `Restaurant.stripeAccountId` is the connected account their diners pay.
 *   They are different objects in different places and must not share a column.
 *
 * ## Prices live in Stripe, amounts live here
 *
 * `PLAN_SPECS` is the source of truth for what a plan costs, and the Stripe
 * Price ids are configuration. A mismatch between the two bills an owner
 * something other than what the pricing page promised, so `assertPriceSanity`
 * refuses to proceed when they disagree rather than quietly charging the Stripe
 * number.
 */

const API = "https://api.stripe.com/v1";

function secretKey(): string | null {
  return process.env.STRIPE_SECRET_KEY ?? null;
}

/** Stripe Price id per paid plan. ZERO has none — there is nothing to charge. */
export function priceIdFor(plan: Plan): string | null {
  if (plan === "FLAT") return process.env.STRIPE_PRICE_FLAT ?? null;
  if (plan === "HYBRID") return process.env.STRIPE_PRICE_HYBRID ?? null;
  return null;
}

/**
 * Whether subscription billing can run at all.
 *
 * Soft, like `providerConfigured` for OAuth: an unconfigured deployment shows
 * the plans and refuses the upgrade with a sentence, rather than throwing on a
 * settings page.
 */
export function billingConfigured(): boolean {
  return Boolean(secretKey() && priceIdFor("FLAT") && priceIdFor("HYBRID"));
}

type StripeError = { error?: { message?: string; code?: string; type?: string } };

async function stripe<T>(
  path: string,
  form?: Record<string, string>,
  idempotencyKey?: string
): Promise<T & StripeError> {
  const key = secretKey();
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");

  const headers: Record<string, string> = {
    Authorization: `Basic ${btoa(`${key}:`)}`,
  };
  if (form) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  // Note the absence of Stripe-Account. That is the point of this module.

  const res = await fetch(`${API}${path}`, {
    method: form ? "POST" : "GET",
    headers,
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  return (await res.json()) as T & StripeError;
}

/* ── Customer and card ──────────────────────────────────────────────────── */

type StripeCustomer = { id: string };
type StripeSetupIntent = { id: string; client_secret: string; status: string };
type StripePaymentMethod = { id: string; card?: { brand?: string; last4?: string } };
type StripeSubscription = {
  id: string;
  status: string;
  current_period_end?: number;
  items?: { data: Array<{ id: string; price?: { id: string; unit_amount?: number } }> };
  latest_invoice?: { payment_intent?: { status?: string; client_secret?: string } };
};

/**
 * The tenant's Stripe customer, created once and reused.
 *
 * Idempotency-keyed on the restaurant id so a double-submitted upgrade cannot
 * produce two customers — which would mean two subscriptions and a restaurant
 * billed twice, a failure that is invisible from our side until they complain.
 */
export async function ensureCustomer(restaurantId: string): Promise<string> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, name: true, slug: true, stripeCustomerId: true, users: { select: { email: true }, take: 1 } },
  });
  if (!r) throw new Error("restaurant not found");
  if (r.stripeCustomerId) return r.stripeCustomerId;

  const created = await stripe<StripeCustomer>(
    "/customers",
    {
      name: r.name,
      "metadata[restaurantId]": r.id,
      "metadata[slug]": r.slug,
      ...(r.users[0]?.email ? { email: r.users[0].email } : {}),
    },
    `cust:${r.id}`
  );
  if (!created.id) throw new Error(created.error?.message ?? "could not create a billing customer");

  await prisma.restaurant.update({
    where: { id: r.id },
    data: { stripeCustomerId: created.id },
  });
  return created.id;
}

/**
 * A SetupIntent for collecting a card in our own UI.
 *
 * The client secret goes to the browser, which mounts Stripe Elements and
 * confirms it. The card never touches our server — we only ever see the
 * resulting PaymentMethod id, and we keep nothing off it but the brand and last
 * four for display.
 */
export async function createCardSetupIntent(
  restaurantId: string
): Promise<{ clientSecret: string; customerId: string }> {
  const customerId = await ensureCustomer(restaurantId);
  const intent = await stripe<StripeSetupIntent>("/setup_intents", {
    customer: customerId,
    "payment_method_types[]": "card",
    usage: "off_session", // it will be charged monthly without them present
    "metadata[restaurantId]": restaurantId,
  });
  if (!intent.client_secret) {
    throw new Error(intent.error?.message ?? "could not start card setup");
  }
  return { clientSecret: intent.client_secret, customerId };
}

/**
 * Attach a confirmed card and make it the default for invoices.
 *
 * Both halves matter: attaching without setting `invoice_settings` leaves the
 * subscription with no default payment method, so the first invoice fails and
 * the owner is dunned for a card they just successfully entered.
 */
export async function attachCard(
  restaurantId: string,
  paymentMethodId: string
): Promise<{ brand: string | null; last4: string | null }> {
  const customerId = await ensureCustomer(restaurantId);

  const attached = await stripe<StripePaymentMethod>(
    `/payment_methods/${encodeURIComponent(paymentMethodId)}/attach`,
    { customer: customerId }
  );
  if (!attached.id) throw new Error(attached.error?.message ?? "that card could not be saved");

  await stripe(`/customers/${encodeURIComponent(customerId)}`, {
    "invoice_settings[default_payment_method]": paymentMethodId,
  });

  const brand = attached.card?.brand ?? null;
  const last4 = attached.card?.last4 ?? null;

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { planCardBrand: brand, planCardLast4: last4 },
  });

  return { brand, last4 };
}

/* ── Subscriptions ──────────────────────────────────────────────────────── */

/**
 * Refuse to bill an amount that disagrees with what we advertise.
 *
 * The Stripe Price is configured out-of-band, so nothing stops it drifting from
 * `PLAN_SPECS` — and the failure is silent and in Stripe's favour: an owner who
 * agreed to $149 on the pricing page gets charged whatever the Price says.
 * Better to refuse the upgrade and make somebody fix the configuration.
 */
function assertPriceSanity(plan: Plan, unitAmount: number | undefined): void {
  const expected = PLAN_SPECS[plan].monthlyCts;
  if (unitAmount != null && unitAmount !== expected) {
    throw new Error(
      `Stripe price for ${plan} is ${unitAmount} but the plan says ${expected}. ` +
        `Refusing to bill an amount we didn't advertise.`
    );
  }
}

export type StartResult =
  | { ok: true; subscriptionId: string; periodEnd: Date | null }
  /** The card needs 3-D Secure. The browser finishes it and we re-read. */
  | { ok: false; requiresAction: true; clientSecret: string }
  | { ok: false; error: string };

/**
 * Start a paid subscription. Only ever called when leaving ZERO — a switch
 * between paid plans goes through `scheduleSwitch` instead, because there is
 * already a subscription to modify at the boundary.
 */
export async function startSubscription(restaurantId: string, plan: Plan): Promise<StartResult> {
  if (!isPaidPlan(plan)) return { ok: false, error: "That plan has nothing to bill." };
  if (!billingConfigured()) {
    return { ok: false, error: "Card billing isn't switched on for this deployment yet." };
  }

  const price = priceIdFor(plan);
  if (!price) return { ok: false, error: "That plan isn't configured for billing yet." };

  const customerId = await ensureCustomer(restaurantId);

  const sub = await stripe<StripeSubscription>(
    "/subscriptions",
    {
      customer: customerId,
      "items[0][price]": price,
      // We want the failure now, in front of the owner, rather than an invoice
      // that quietly enters dunning after they have left the page believing
      // they upgraded.
      payment_behavior: "default_incomplete",
      "payment_settings[save_default_payment_method]": "on_subscription",
      "expand[]": "latest_invoice.payment_intent",
      "metadata[restaurantId]": restaurantId,
      "metadata[plan]": plan,
    },
    // Keyed on tenant+plan so a double-tapped Upgrade cannot create two
    // subscriptions. Stripe replays the first response.
    `sub:${restaurantId}:${plan}`
  );

  if (!sub.id) return { ok: false, error: sub.error?.message ?? "Could not start that plan." };

  assertPriceSanity(plan, sub.items?.data?.[0]?.price?.unit_amount);

  const intent = sub.latest_invoice?.payment_intent;
  if (intent?.status === "requires_action" && intent.client_secret) {
    return { ok: false, requiresAction: true, clientSecret: intent.client_secret };
  }
  if (sub.status !== "active" && sub.status !== "trialing") {
    return {
      ok: false,
      error: "That card was declined. Try another one, or check with your bank.",
    };
  }

  const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      plan,
      pendingPlan: null,
      stripeSubscriptionId: sub.id,
      planPeriodEnd: periodEnd,
      planPastDueSince: null,
    },
  });

  await recordChange(restaurantId, DEFAULT_PLAN, plan, "owner", new Date());
  return { ok: true, subscriptionId: sub.id, periodEnd };
}

/**
 * Schedule a switch for the billing boundary.
 *
 * Writes only our own row. Stripe is not told until the boundary arrives (the
 * sweep does it), which is what keeps the "no proration, nobody pays twice"
 * promise — telling Stripe now would either prorate immediately or need a
 * subscription schedule, and both reintroduce the partial-refund chase this
 * design exists to avoid.
 */
export async function scheduleSwitch(
  restaurantId: string,
  target: Plan,
  actorId: string | null
): Promise<{ ok: true; effectiveAt: Date } | { ok: false; error: string }> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      plan: true,
      pendingPlan: true,
      planPeriodEnd: true,
      planPastDueSince: true,
    },
  });
  if (!r) return { ok: false, error: "Restaurant not found." };

  const state: SubscriptionState = {
    plan: isPlan(r.plan) ? r.plan : DEFAULT_PLAN,
    pendingPlan: r.pendingPlan && isPlan(r.pendingPlan) ? r.pendingPlan : null,
    currentPeriodEnd: r.planPeriodEnd,
    pastDueSince: r.planPastDueSince,
  };

  const decision = planChangeDecision(state, target, new Date());

  if (decision.kind === "rejected") return { ok: false, error: decision.reason };

  if (decision.kind === "cancelled_pending") {
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { pendingPlan: null },
    });
    return { ok: true, effectiveAt: new Date() };
  }

  if (decision.kind === "immediate") {
    // Leaving ZERO. The caller collects a card first and then calls
    // startSubscription; this path should not be reachable from the scheduler.
    return { ok: false, error: "That change needs a card — use the upgrade flow." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { pendingPlan: decision.plan },
  });

  return { ok: true, effectiveAt: decision.effectiveAt };
}

/** Cancel the Stripe subscription outright. Used when landing on ZERO. */
export async function cancelSubscription(restaurantId: string): Promise<void> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { stripeSubscriptionId: true },
  });
  if (!r?.stripeSubscriptionId) return;

  await fetch(`${API}/subscriptions/${encodeURIComponent(r.stripeSubscriptionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Basic ${btoa(`${secretKey()}:`)}` },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { stripeSubscriptionId: null, planPeriodEnd: null, planPastDueSince: null },
  });
}

/**
 * Move an existing subscription onto a different price. Used by the sweep when
 * a scheduled switch between two paid plans comes due.
 */
export async function swapSubscriptionPrice(
  restaurantId: string,
  target: Plan
): Promise<{ ok: boolean; error?: string }> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { stripeSubscriptionId: true },
  });
  if (!r?.stripeSubscriptionId) return { ok: false, error: "no subscription" };

  const price = priceIdFor(target);
  if (!price) return { ok: false, error: "target plan has no configured price" };

  const current = await stripe<StripeSubscription>(
    `/subscriptions/${encodeURIComponent(r.stripeSubscriptionId)}`
  );
  const itemId = current.items?.data?.[0]?.id;
  if (!itemId) return { ok: false, error: "subscription has no items" };

  const updated = await stripe<StripeSubscription>(
    `/subscriptions/${encodeURIComponent(r.stripeSubscriptionId)}`,
    {
      "items[0][id]": itemId,
      "items[0][price]": price,
      // The switch happens exactly at the boundary, so there is nothing to
      // prorate — and asking for a proration here would produce the credit
      // note this whole design avoids.
      proration_behavior: "none",
    }
  );
  if (!updated.id) return { ok: false, error: updated.error?.message ?? "swap failed" };

  assertPriceSanity(target, updated.items?.data?.[0]?.price?.unit_amount);
  return { ok: true };
}

/* ── History ────────────────────────────────────────────────────────────── */

/**
 * Append to the plan history. Best-effort: a missing audit row must never fail
 * a billing operation that already succeeded at Stripe, because that leaves the
 * two out of step in the direction that bills someone.
 */
export async function recordChange(
  restaurantId: string,
  fromPlan: Plan,
  toPlan: Plan,
  source: "owner" | "admin" | "dunning",
  effectiveAt: Date,
  actorId?: string | null
): Promise<void> {
  if (fromPlan === toPlan) return;
  await prisma.planChange
    .create({
      data: { restaurantId, fromPlan, toPlan, source, actorId: actorId ?? null, effectiveAt },
    })
    .catch(() => null);
}
