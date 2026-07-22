import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { billingConfigured } from "@/lib/billing";
import {
  DEFAULT_PLAN,
  PLAN_SPECS,
  dunningState,
  effectivePlan,
  isPlan,
  type Plan,
} from "@/lib/plans";
import { Card, SectionTitle } from "@/components/hearth/ui";
import PlanPicker from "./PlanPicker";

export const dynamic = "force-dynamic";

/**
 * The owner's plan page.
 *
 * The plan shown is `effectivePlan`, not the raw column: a scheduled switch
 * applies on its own date whether or not the sweep that materialises it has
 * run, and a page that disagreed with what the checkout is actually charging
 * would be worse than no page.
 */
export default async function PlanPage() {
  const { restaurantId } = await requireOwner();

  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      plan: true,
      pendingPlan: true,
      planPeriodEnd: true,
      planPastDueSince: true,
      planCardBrand: true,
      planCardLast4: true,
    },
  });
  if (!r) notFound();

  const state = {
    plan: isPlan(r.plan) ? r.plan : DEFAULT_PLAN,
    pendingPlan: r.pendingPlan && isPlan(r.pendingPlan) ? (r.pendingPlan as Plan) : null,
    currentPeriodEnd: r.planPeriodEnd,
    pastDueSince: r.planPastDueSince,
  };

  const now = new Date();
  const current = effectivePlan(state, now);
  const dunning = dunningState(state, now);

  // Last 30 days of real trade, so the comparison between plans is grounded in
  // their own numbers rather than in a marketing example.
  const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const usage = await prisma.order.aggregate({
    where: {
      restaurantId,
      createdAt: { gte: since },
      status: { notIn: ["CANCELED", "REJECTED"] },
    },
    _count: true,
    _sum: { subtotalCts: true, surchargeCts: true },
  });

  const periodEnd = r.planPeriodEnd
    ? r.planPeriodEnd.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Plan"
        subtitle="Same product on every plan. The only thing that changes is who pays for it."
      />

      {/*
        The dunning banner is the loudest thing on the page during a grace
        period, because the consequence is a change to the tenant's pricing that
        they did not consciously choose. Being surprised by that is a fair thing
        to be angry about, so it gets said early, repeatedly, and with a date.
      */}
      {dunning.kind === "grace" && (
        <div className="rounded-md border border-warnLine bg-warnBg px-4 py-3">
          <p className="text-[13px] font-semibold text-warnInk">
            We couldn&apos;t take your last payment.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-warnInk">
            Update your card in the next {dunning.daysLeft}{" "}
            {dunning.daysLeft === 1 ? "day" : "days"}. On{" "}
            {dunning.downgradesAt.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
            })}{" "}
            you&apos;ll move to Zero Monthly automatically — your page keeps taking orders, but a
            service fee will start appearing on your customers&apos; tickets.
          </p>
        </div>
      )}

      {dunning.kind === "lapsed" && (
        <div className="rounded-md border border-warnLine bg-warnBg px-4 py-3">
          <p className="text-[13px] font-semibold text-warnInk">
            You&apos;re on Zero Monthly because a payment didn&apos;t go through.
          </p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-warnInk">
            Your customers are now paying a service fee. Add a working card and pick a paid plan
            below to take it off their tickets again.
          </p>
        </div>
      )}

      {state.pendingPlan && dunning.kind === "ok" && (
        <div className="rounded-md border border-line bg-surface2 px-4 py-3 text-[12.5px] leading-relaxed text-dim">
          Scheduled: you move to{" "}
          <span className="font-medium text-ink">{PLAN_SPECS[state.pendingPlan].name}</span>
          {periodEnd ? ` on ${periodEnd}` : ""}. Nothing changes until then, and you can cancel it
          below.
        </div>
      )}

      {!billingConfigured() && (
        <Card>
          <p className="text-[12.5px] leading-relaxed text-dim">
            <span className="text-ink">Paid plans aren&apos;t switched on yet.</span> Subscription
            billing needs Stripe prices configured on this deployment — see{" "}
            <code className="text-dim">docs/plans.md</code>. Zero Monthly works normally in the
            meantime.
          </p>
        </Card>
      )}

      <PlanPicker
        currentPlan={current}
        pendingPlan={state.pendingPlan}
        periodEnd={periodEnd}
        card={r.planCardLast4 ? { brand: r.planCardBrand, last4: r.planCardLast4 } : null}
        billingReady={billingConfigured()}
        usage={{
          orderCount: usage._count ?? 0,
          subtotalCts: usage._sum.subtotalCts ?? 0,
          surchargeCts: usage._sum.surchargeCts ?? 0,
        }}
      />
    </div>
  );
}
