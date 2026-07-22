import "server-only";
import { prisma } from "@/lib/prisma";
import {
  DEFAULT_PLAN,
  dunningState,
  isPaidPlan,
  isPlan,
  type Plan,
  type SubscriptionState,
} from "@/lib/plans";
import { cancelSubscription, recordChange, swapSubscriptionPrice } from "@/lib/billing";

/**
 * The two things that have to happen to a plan when nobody is looking:
 * scheduled switches landing at the billing boundary, and grace periods
 * expiring.
 *
 * Both are also applied *on read* by `effectivePlan` and `dunningState`, which
 * is the important half — this sweep materialises the row so the database
 * agrees with what those functions already return. That ordering is deliberate
 * and matters here more than anywhere else in the repo, because **the Railway
 * cron still does not exist** (see `docs/deploy-sweep.md`). If the truth lived
 * only in this file, a restaurant would keep being billed for a plan they
 * cancelled a month ago, and the first anyone would hear of it is a chargeback.
 *
 * So: reads are correct without this running. This makes them cheap, keeps the
 * audit history honest, and tells Stripe.
 */

export type PlanSweepResult = {
  switched: number;
  lapsed: number;
  errors: string[];
};

function stateOf(r: {
  plan: string;
  pendingPlan: string | null;
  planPeriodEnd: Date | null;
  planPastDueSince: Date | null;
}): SubscriptionState {
  return {
    plan: isPlan(r.plan) ? r.plan : DEFAULT_PLAN,
    pendingPlan: r.pendingPlan && isPlan(r.pendingPlan) ? r.pendingPlan : null,
    currentPeriodEnd: r.planPeriodEnd,
    pastDueSince: r.planPastDueSince,
  };
}

/**
 * Land every scheduled switch whose date has passed.
 *
 * The Stripe call happens before our write, on purpose: if Stripe fails we
 * leave the pending row in place and try again next run, which is a switch that
 * lands late. Writing first and failing at Stripe would give us a tenant our
 * database says is on Hybrid while Stripe keeps billing them for Flat — money
 * moving on one system's idea of the truth and not the other's.
 */
export async function applyScheduledPlanChanges(now = new Date()): Promise<PlanSweepResult> {
  const due = await prisma.restaurant.findMany({
    where: {
      pendingPlan: { not: null },
      planPeriodEnd: { lte: now },
    },
    select: {
      id: true,
      plan: true,
      pendingPlan: true,
      planPeriodEnd: true,
      planPastDueSince: true,
    },
    take: 200,
  });

  const errors: string[] = [];
  let switched = 0;

  for (const r of due) {
    const state = stateOf(r);
    const target = state.pendingPlan;
    if (!target || target === state.plan) {
      // Nothing to do, but the row is stale — clear it so this tenant stops
      // being selected on every run.
      await prisma.restaurant.update({ where: { id: r.id }, data: { pendingPlan: null } });
      continue;
    }

    try {
      if (!isPaidPlan(target)) {
        // Landing on ZERO: end the subscription outright. They have already had
        // the month they paid for.
        await cancelSubscription(r.id);
      } else if (isPaidPlan(state.plan)) {
        const swap = await swapSubscriptionPrice(r.id, target);
        if (!swap.ok) {
          errors.push(`${r.id}: ${swap.error ?? "price swap failed"}`);
          continue; // leave pending, retry next run
        }
      } else {
        // ZERO → paid should never be scheduled; it goes through the upgrade
        // flow, which needs a card. Surfacing rather than silently starting a
        // subscription nobody agreed to pay for.
        errors.push(`${r.id}: scheduled upgrade from a free plan has no card`);
        continue;
      }

      await prisma.restaurant.update({
        where: { id: r.id },
        data: {
          plan: target,
          pendingPlan: null,
          ...(isPaidPlan(target) ? {} : { planPeriodEnd: null, planPastDueSince: null }),
        },
      });
      await recordChange(r.id, state.plan, target, "owner", r.planPeriodEnd ?? now);
      switched++;
    } catch (err) {
      errors.push(`${r.id}: ${err instanceof Error ? err.message : "switch failed"}`);
    }
  }

  return { switched, lapsed: 0, errors };
}

/**
 * Drop tenants whose grace period has run out to the free plan.
 *
 * Never a suspension. A restaurant that cannot hand over food it has already
 * made is a wildly disproportionate response to an expired card, so the
 * downgrade keeps them trading — see the note on `dunningState`.
 *
 * What this does *not* do is tell the owner. The banner on `/dashboard/plan`
 * warns for fourteen days beforehand, and an email at the moment of the
 * downgrade is the obvious addition — it is listed in `docs/plans.md` as the
 * P1, because a tenant discovering the change from a customer complaint about a
 * new fee is the bad version of this feature.
 */
export async function applyPlanLapses(now = new Date()): Promise<PlanSweepResult> {
  const candidates = await prisma.restaurant.findMany({
    where: { planPastDueSince: { not: null } },
    select: {
      id: true,
      plan: true,
      pendingPlan: true,
      planPeriodEnd: true,
      planPastDueSince: true,
    },
    take: 200,
  });

  const errors: string[] = [];
  let lapsed = 0;

  for (const r of candidates) {
    const state = stateOf(r);
    if (dunningState(state, now).kind !== "lapsed") continue;

    try {
      await cancelSubscription(r.id);
      await prisma.restaurant.update({
        where: { id: r.id },
        data: {
          plan: DEFAULT_PLAN,
          pendingPlan: null,
          planPeriodEnd: null,
          planPastDueSince: null,
        },
      });
      // Recorded as "dunning" rather than "owner", because this is the one plan
      // change nobody chose and it is the one most likely to be argued about.
      await recordChange(r.id, state.plan, DEFAULT_PLAN, "dunning", now);
      lapsed++;
    } catch (err) {
      errors.push(`${r.id}: ${err instanceof Error ? err.message : "lapse failed"}`);
    }
  }

  return { switched: 0, lapsed, errors };
}

/** Both, for the cron. */
export async function runPlanSweeps(now = new Date()): Promise<PlanSweepResult> {
  const a = await applyScheduledPlanChanges(now);
  const b = await applyPlanLapses(now);
  return {
    switched: a.switched,
    lapsed: b.lapsed,
    errors: [...a.errors, ...b.errors],
  };
}
