"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession, requireOwner } from "@/lib/auth";
import {
  DEFAULT_PLAN,
  PLAN_SPECS,
  isPaidPlan,
  isPlan,
  isSelectablePlan,
  planChangeDecision,
  type Plan,
  type SubscriptionState,
} from "@/lib/plans";
import {
  attachCard,
  billingConfigured,
  cancelSubscription,
  createCardSetupIntent,
  recordChange,
  scheduleSwitch,
  startSubscription,
} from "@/lib/billing";

/**
 * Owner-facing plan changes — the auth boundary, and nothing else.
 *
 * Every decision about *whether* a change is allowed and *when* it lands is
 * `planChangeDecision` in `lib/plans.ts`, which is pure and tested. Everything
 * about moving money is `lib/billing.ts`. This file is the seam, and it exists
 * mainly to make sure the tenant comes from the session rather than the form.
 *
 * An admin impersonating an owner cannot change a plan. Impersonation is for
 * seeing what they see; a support call that accidentally puts a restaurant on
 * $399/month is not a recoverable mistake, it is a refund and an apology.
 */

export type PlanResult = { ok?: string; error?: string; requiresAction?: string };

async function stateFor(restaurantId: string): Promise<SubscriptionState & { id: string }> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { id: true, plan: true, pendingPlan: true, planPeriodEnd: true, planPastDueSince: true },
  });
  if (!r) throw new Error("restaurant not found");
  return {
    id: r.id,
    plan: isPlan(r.plan) ? r.plan : DEFAULT_PLAN,
    pendingPlan: r.pendingPlan && isPlan(r.pendingPlan) ? r.pendingPlan : null,
    currentPeriodEnd: r.planPeriodEnd,
    pastDueSince: r.planPastDueSince,
  };
}

async function guard(): Promise<{ restaurantId: string; userId: string } | { error: string }> {
  const { restaurantId } = await requireOwner();
  const session = await getSession();
  if (!session) return { error: "Sign in again to change your plan." };
  if (session.impersonating) {
    return { error: "Plan changes aren't available while viewing another account." };
  }
  return { restaurantId, userId: session.userId };
}

/**
 * Begin collecting a card. Returns a SetupIntent client secret for Elements.
 *
 * Separate from the plan change on purpose: an owner should be able to add or
 * replace a card without it being bundled into a decision about pricing, and a
 * failed card entry should not leave a half-made plan change behind.
 */
export async function startCardSetupAction(): Promise<
  { ok: true; clientSecret: string } | { ok: false; error: string }
> {
  const g = await guard();
  if ("error" in g) return { ok: false, error: g.error };
  if (!billingConfigured()) {
    return { ok: false, error: "Card billing isn't switched on for this deployment yet." };
  }

  try {
    const { clientSecret } = await createCardSetupIntent(g.restaurantId);
    return { ok: true, clientSecret };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not start card setup.",
    };
  }
}

/** Save a card the browser has already confirmed with Stripe. */
export async function saveCardAction(
  _prev: PlanResult | undefined,
  formData: FormData
): Promise<PlanResult> {
  const g = await guard();
  if ("error" in g) return { error: g.error };

  const pm = String(formData.get("paymentMethodId") ?? "");
  // A `pm_...` is all we ever receive; the card itself never reaches us.
  if (!/^pm_[A-Za-z0-9_]+$/.test(pm)) return { error: "That card couldn't be saved." };

  try {
    const card = await attachCard(g.restaurantId, pm);
    revalidatePath("/dashboard/plan");
    return {
      ok: card.last4 ? `Card ending ${card.last4} saved.` : "Card saved.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "That card couldn't be saved." };
  }
}

/**
 * Change plan.
 *
 * Three shapes, decided by `planChangeDecision` rather than here:
 * leaving ZERO starts a subscription now; a switch between paid plans or down
 * to ZERO is scheduled for the boundary; re-picking the current plan while a
 * switch is pending cancels it.
 */
export async function changePlanAction(
  _prev: PlanResult | undefined,
  formData: FormData
): Promise<PlanResult> {
  const g = await guard();
  if ("error" in g) return { error: g.error };

  const target = String(formData.get("plan") ?? "");
  if (!isPlan(target)) return { error: "That isn't a plan we offer." };
  // Re-checked server-side even though the picker no longer draws the hidden
  // plans, for the same reason `seedTestRestaurantAction` re-checks test mode:
  // hiding a control is a courtesy and not enforcement, and this one ends in a
  // Stripe subscription on the platform account.
  if (!isSelectablePlan(target)) return { error: "That plan isn't available right now." };

  const state = await stateFor(g.restaurantId);
  const decision = planChangeDecision(state, target, new Date());

  if (decision.kind === "rejected") return { error: decision.reason };

  if (decision.kind === "cancelled_pending") {
    await prisma.restaurant.update({
      where: { id: g.restaurantId },
      data: { pendingPlan: null },
    });
    revalidatePath("/dashboard/plan");
    return { ok: `Scheduled change cancelled — you're staying on ${PLAN_SPECS[state.plan].name}.` };
  }

  if (decision.kind === "immediate") {
    // Leaving ZERO. Downgrading to ZERO can never be "immediate" because the
    // current plan would have to be ZERO already, which is rejected above.
    if (!isPaidPlan(decision.plan)) return { error: "Nothing to change." };

    const started = await startSubscription(g.restaurantId, decision.plan);
    if (!started.ok) {
      // 3-D Secure. The browser finishes the challenge and re-submits; nothing
      // has been committed on our side yet, so an abandoned challenge leaves
      // the tenant exactly where they were.
      if ("requiresAction" in started) return { requiresAction: started.clientSecret };
      return { error: started.error };
    }

    revalidatePath("/dashboard/plan");
    revalidatePath("/dashboard");
    return {
      ok: `You're on ${PLAN_SPECS[decision.plan].name}. Your customers won't see a service fee from now on.`,
    };
  }

  const scheduled = await scheduleSwitch(g.restaurantId, decision.plan, g.userId);
  if (!scheduled.ok) return { error: scheduled.error };

  revalidatePath("/dashboard/plan");

  const when = decision.effectiveAt.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const note = PLAN_SPECS[decision.plan].chargesCustomer
    ? " From then on a service fee appears on your customers' tickets."
    : "";
  return {
    ok: `Switching to ${PLAN_SPECS[decision.plan].name} on ${when}. Nothing changes until then, and you can cancel any time before it.${note}`,
  };
}

/**
 * End a paid plan immediately rather than at the boundary.
 *
 * Deliberately separate from the scheduled path and deliberately blunt: this is
 * the "I want to stop paying you today" button. They lose the rest of the month
 * they already paid for, which is why the UI says so and why it is not the
 * default route to ZERO.
 */
export async function cancelPlanNowAction(
  _prev: PlanResult | undefined,
  _formData: FormData
): Promise<PlanResult> {
  const g = await guard();
  if ("error" in g) return { error: g.error };

  const state = await stateFor(g.restaurantId);
  if (!isPaidPlan(state.plan)) return { error: "You're already on Zero Monthly." };

  await cancelSubscription(g.restaurantId);
  await prisma.restaurant.update({
    where: { id: g.restaurantId },
    data: { plan: DEFAULT_PLAN, pendingPlan: null, planPastDueSince: null, planPeriodEnd: null },
  });
  await recordChange(g.restaurantId, state.plan, DEFAULT_PLAN, "owner", new Date(), g.userId);

  revalidatePath("/dashboard/plan");
  revalidatePath("/dashboard");
  return {
    ok: "Cancelled. You're on Zero Monthly now, and a service fee will appear on your customers' tickets.",
  };
}
