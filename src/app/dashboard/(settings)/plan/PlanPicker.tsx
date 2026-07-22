"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button, Card, cx } from "@/components/hearth/ui";
import { useStripeCard } from "@/components/customer/useStripeCard";
// VISIBLE_PLANS, not PLANS: a hidden plan must still price correctly for a
// tenant already on it, so `PLAN_SPECS` keeps all three. See lib/features.ts.
import { PLAN_SPECS, VISIBLE_PLANS as PLANS, type Plan } from "@/lib/plans";
import {
  changePlanAction,
  saveCardAction,
  startCardSetupAction,
  cancelPlanNowAction,
  type PlanResult,
} from "./actions";

/**
 * Choosing and paying for a plan.
 *
 * The card field is Stripe Elements on the **platform** account —
 * `stripeAccount: null`, unlike the storefront checkout which tokenizes on the
 * restaurant's connected account. An owner paying us is not a diner paying a
 * restaurant, and a payment method is scoped to whichever account tokenized it,
 * so getting this wrong produces a card that exists but cannot be charged.
 *
 * The whole flow is deliberately explicit about *when* a change lands and
 * *who* ends up paying, because both are easy to get wrong from the owner's
 * side: moving to Zero Monthly saves them $399 and starts charging their
 * customers a fee, and that trade should never be a surprise.
 */

function money(cts: number): string {
  return cts % 100 === 0 ? `$${cts / 100}` : `$${(cts / 100).toFixed(2)}`;
}

function Submit({ label, pending: pendingLabel, disabled }: { label: string; pending: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

export default function PlanPicker({
  currentPlan,
  pendingPlan,
  periodEnd,
  card,
  billingReady,
  usage,
}: {
  currentPlan: Plan;
  pendingPlan: Plan | null;
  periodEnd: string | null;
  card: { brand: string | null; last4: string | null } | null;
  billingReady: boolean;
  /** Last 30 days, for the "what would this have cost me" comparison. */
  usage: { orderCount: number; subtotalCts: number; surchargeCts: number };
}) {
  const [selected, setSelected] = React.useState<Plan>(currentPlan);
  const [changeState, changeAction] = useFormState(changePlanAction, undefined);
  const [cardState, cardAction] = useFormState(saveCardAction, undefined);
  const [cancelState, cancelAction] = useFormState(cancelPlanNowAction, undefined);

  const [collecting, setCollecting] = React.useState(false);
  const [cardBusy, setCardBusy] = React.useState(false);
  const [cardError, setCardError] = React.useState<string | null>(null);
  const [savedPm, setSavedPm] = React.useState<string | null>(null);
  const formRef = React.useRef<HTMLFormElement>(null);

  const stripe = useStripeCard({
    cardEnabled: billingReady,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? null,
    // The platform account. See the note at the top of this file.
    stripeAccount: null,
  });

  /**
   * Collect a card: ask the server for a SetupIntent, confirm it in the
   * browser, then post the resulting `pm_...` back to be attached.
   *
   * The card number never reaches our server at any point in that sequence.
   */
  async function submitCard() {
    setCardBusy(true);
    setCardError(null);
    try {
      const started = await startCardSetupAction();
      if (!started.ok) throw new Error(started.error);
      const pm = await stripe.confirmCardSetup(started.clientSecret);
      setSavedPm(pm);
      // Hand it to the server action through the form, so the result lands in
      // `useFormState` alongside every other outcome on this page.
      requestAnimationFrame(() => formRef.current?.requestSubmit());
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "That card couldn't be saved.");
    } finally {
      setCardBusy(false);
    }
  }

  React.useEffect(() => {
    if (cardState?.ok) {
      setCollecting(false);
      setSavedPm(null);
    }
  }, [cardState?.ok]);

  const needsCard = PLAN_SPECS[selected].monthlyCts > 0 && !card;

  return (
    <div className="space-y-6">
      {/* ── The three plans ──────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {PLANS.map((p) => {
          const spec = PLAN_SPECS[p];
          const isCurrent = p === currentPlan;
          const isPending = p === pendingPlan;
          const isSelected = p === selected;

          return (
            <button
              key={p}
              type="button"
              onClick={() => setSelected(p)}
              aria-pressed={isSelected}
              className={cx(
                "rounded-md border p-5 text-left transition-colors",
                isSelected ? "border-accent bg-accent/[0.06]" : "border-line bg-surface hover:border-line2"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-semibold text-ink">{spec.name}</span>
                {isCurrent && (
                  <span className="rounded-sm bg-accentFill px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accentInk">
                    Current
                  </span>
                )}
                {isPending && !isCurrent && (
                  <span className="rounded-sm border border-warnLine px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warnInk">
                    Scheduled
                  </span>
                )}
              </div>

              <p className="mt-2 text-[22px] font-semibold tracking-tight text-ink">
                {money(spec.monthlyCts)}
                <span className="text-[12px] font-normal text-mute">
                  {spec.monthlyCts === 0 ? " / month, forever" : " / month"}
                  {spec.commissionBps > 0 && ` + ${spec.commissionBps / 100}%`}
                </span>
              </p>

              <p className="mt-2 text-[12px] leading-relaxed text-dim">{spec.pitch}</p>

              {/*
                The single most important line on the card. An owner comparing
                $0 against $399 is not comparing like with like unless they can
                see who covers the difference.
              */}
              <p className="mt-3 border-t border-line pt-3 text-[11.5px] text-mute">
                {spec.chargesCustomer
                  ? "Your customers pay a small service fee."
                  : "Your customers pay nothing extra."}
              </p>
            </button>
          );
        })}
      </div>

      {/* ── What it would have cost ──────────────────────────────────── */}
      {usage.orderCount > 0 && (
        <Card>
          <p className="text-[12px] font-medium text-ink">
            Based on your last 30 days &mdash; {usage.orderCount} orders,{" "}
            {money(usage.subtotalCts)} in food
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {PLANS.map((p) => {
              const spec = PLAN_SPECS[p];
              const ownerPays = spec.monthlyCts + Math.round((usage.subtotalCts * spec.commissionBps) / 10_000);
              const customersPaid = spec.chargesCustomer ? usage.surchargeCts : 0;
              return (
                <div key={p} className="rounded-sm border border-line bg-surface2 px-3 py-2">
                  <p className="text-[11px] text-mute">{spec.name}</p>
                  <p className="mt-0.5 text-[15px] font-semibold tabular-nums text-ink">
                    {money(ownerPays)}
                    <span className="text-[11px] font-normal text-mute"> to you</span>
                  </p>
                  <p className="text-[11px] text-dim">
                    {customersPaid > 0
                      ? `${money(customersPaid)} paid by customers`
                      : "nothing from customers"}
                  </p>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-mute">
            Card processing is yours on every plan and isn&apos;t counted here. These are estimates
            from real orders, not a quote.
          </p>
        </Card>
      )}

      {/* ── Card on file ─────────────────────────────────────────────── */}
      {billingReady && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink">Card on file</p>
              <p className="text-[12px] text-dim">
                {card?.last4
                  ? `${card.brand ?? "Card"} ending ${card.last4}`
                  : "None yet. Needed for the paid plans."}
              </p>
            </div>
            <Button type="button" variant="outline" onClick={() => setCollecting((v) => !v)}>
              {collecting ? "Cancel" : card ? "Replace card" : "Add card"}
            </Button>
          </div>

          {collecting && (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <div className="rounded-sm border border-line2 bg-surface2 px-3 py-3">
                <stripe.CardMount />
              </div>
              {(cardError || stripe.error) && (
                <p className="text-[12px] text-badInk">{cardError ?? stripe.error}</p>
              )}
              <Button type="button" onClick={submitCard} disabled={cardBusy || !stripe.mounted}>
                {cardBusy ? "Saving…" : "Save card"}
              </Button>
              <p className="text-[11px] leading-relaxed text-mute">
                Your card details go straight to Stripe and never touch our servers. We keep the
                brand and last four digits so you can tell which card is on file.
              </p>

              {/* Posts the confirmed pm_... so the outcome lands in one place. */}
              <form ref={formRef} action={cardAction} className="hidden">
                <input type="hidden" name="paymentMethodId" value={savedPm ?? ""} />
              </form>
            </div>
          )}

          {cardState?.error && <p className="mt-3 text-[12px] text-badInk">{cardState.error}</p>}
          {cardState?.ok && <p className="mt-3 text-[12px] text-accent">{cardState.ok}</p>}
        </Card>
      )}

      {/* ── Commit ──────────────────────────────────────────────────── */}
      {selected !== currentPlan || pendingPlan ? (
        <Card>
          <form action={changeAction} className="space-y-3">
            <input type="hidden" name="plan" value={selected} />

            <p className="text-[13px] leading-relaxed text-ink">
              {selected === currentPlan && pendingPlan ? (
                <>Cancel the scheduled switch and stay on {PLAN_SPECS[currentPlan].name}.</>
              ) : PLAN_SPECS[currentPlan].monthlyCts === 0 ? (
                <>
                  Switch to {PLAN_SPECS[selected].name} for {money(PLAN_SPECS[selected].monthlyCts)}
                  /month, starting today.
                </>
              ) : (
                <>
                  Switch to {PLAN_SPECS[selected].name}
                  {periodEnd ? ` on ${periodEnd}` : ""}. Nothing changes until then, and you can
                  cancel any time before it.
                </>
              )}
            </p>

            {/*
              Said plainly, because it is the consequence an owner is most
              likely to miss: moving to Zero Monthly saves them the fee and
              starts charging their customers one.
            */}
            {PLAN_SPECS[selected].chargesCustomer && selected !== currentPlan && (
              <p className="rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] leading-relaxed text-warnInk">
                On {PLAN_SPECS[selected].name} a service fee is added to each of your customers&apos;
                tickets, disclosed to them before they pay. You pay nothing.
              </p>
            )}

            {needsCard && (
              <p className="text-[12px] text-badInk">Add a card above before switching to this plan.</p>
            )}

            <Submit
              label={selected === currentPlan ? "Cancel scheduled switch" : `Switch to ${PLAN_SPECS[selected].name}`}
              pending="Working…"
              disabled={needsCard || !billingReady}
            />

            {changeState?.error && <p className="text-[12px] text-badInk">{changeState.error}</p>}
            {changeState?.ok && <p className="text-[12px] text-accent">{changeState.ok}</p>}
            {changeState?.requiresAction && (
              <p className="text-[12px] text-warnInk">
                Your bank asked for extra verification. Re-submit and complete the check.
              </p>
            )}
          </form>
        </Card>
      ) : null}

      {/* ── The blunt exit ──────────────────────────────────────────── */}
      {PLAN_SPECS[currentPlan].monthlyCts > 0 && (
        <Card>
          <form action={cancelAction} className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[13px] font-medium text-ink">End your plan today</p>
              <p className="max-w-[420px] text-[12px] leading-relaxed text-dim">
                Drops you to Zero Monthly straight away. You lose the rest of the month you&apos;ve
                already paid for &mdash; switching at your renewal date instead is usually better.
              </p>
            </div>
            <Submit label="Cancel now" pending="Cancelling…" />
          </form>
          {cancelState?.error && <p className="mt-2 text-[12px] text-badInk">{cancelState.error}</p>}
          {cancelState?.ok && <p className="mt-2 text-[12px] text-accent">{cancelState.ok}</p>}
        </Card>
      )}
    </div>
  );
}
