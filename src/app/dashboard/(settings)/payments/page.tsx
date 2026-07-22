import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { resolvePaymentMode } from "@/lib/payments";
import { serviceStates } from "@/lib/entitlements";
import { Badge, Card, SectionTitle } from "@/components/hearth/ui";
import SalesTaxForm from "./SalesTaxForm";
import { ConnectControls, CardPaymentsToggle, DeliveryToggle } from "./PaymentControls";

export const dynamic = "force-dynamic";

/** One line of the payout checklist — a filled dot when done, hollow when not. */
function Step({ done, active, children }: { done: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={[
          "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold",
          done
            ? "bg-accentFill text-accentInk"
            : active
              ? "border border-accent text-accent"
              : "border border-line2 text-mute",
        ].join(" ")}
      >
        {done ? "✓" : ""}
      </span>
      <span className={done ? "text-[13px] text-dim line-through" : "text-[13px] text-ink"}>{children}</span>
    </li>
  );
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: { onboarding?: string };
}) {
  const { restaurantId } = await requireOwner();
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!r) notFound();

  const mode = await resolvePaymentMode();
  const stubbed = mode === "STUB";

  // A platform suspension. The owner is told plainly and given the reason, but
  // no control to lift it — that is the entire point of the mechanism.
  const services = await serviceStates(restaurantId);
  const paymentsSuspended = services.PAYMENTS.suspended;
  const deliverySuspended = services.DELIVERY.suspended;

  const started = !!r.stripeAccountId;
  const submitted = r.stripeDetailsSubmitted;
  const connected = r.stripeChargesEnabled;
  const justReturned = searchParams.onboarding === "return";

  const heroTone = connected ? "good" : started ? "warn" : "neutral";
  const heroTitle = connected
    ? "You're set up to get paid"
    : started
      ? "Almost there"
      : "Set up payouts to get paid";
  const heroBody = connected
    ? "Card orders settle straight to your Stripe account."
    : started
      ? "Stripe is still verifying your details. This can take a few minutes — use Refresh to check."
      : "Connect a Stripe account so card orders pay out to you. Stripe handles signup, bank details, and payouts — we never see your banking information.";

  return (
    <>
      <SectionTitle
        title="Payments"
        subtitle="Get paid for online orders, and set your sales tax rate."
      />

      {paymentsSuspended && (
        <Card className="mb-4 border-badLine">
          <h3 className="mb-1 text-[14px] font-semibold text-badInk">Card payments are suspended</h3>
          <p className="max-w-2xl text-[13px] leading-relaxed text-dim">
            {services.PAYMENTS.reason ??
              "Card payments have been switched off for this account by the platform."}{" "}
            Orders are pay-at-counter until this is resolved, and no service fee is collected on them.
            Contact support to sort it out — this isn&rsquo;t something you can switch back on here.
          </p>
        </Card>
      )}

      {/* Status hero + the single most important action */}
      <Card className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-xl">
            <div className="mb-1 flex items-center gap-2">
              <span
                className={[
                  "h-2 w-2 rounded-full",
                  connected ? "bg-good" : started ? "bg-warnInk" : "bg-mute",
                ].join(" ")}
              />
              <h3 className="text-[15px] font-semibold text-ink">{heroTitle}</h3>
              <Badge tone={heroTone}>
                {connected ? "Ready" : started ? "In review" : "Not connected"}
              </Badge>
            </div>
            <p className="text-[13px] leading-relaxed text-dim">{heroBody}</p>

            {justReturned && !connected && (
              <p className="mt-3 rounded-sm border border-line2 bg-base px-3 py-2 text-[12px] text-warn">
                Thanks — Stripe may still be reviewing. Hit Refresh in a moment to check your status.
              </p>
            )}

            {stubbed && (
              <p className="mt-3 rounded-sm border border-line2 bg-base px-3 py-2 text-[12px] text-dim">
                Online payments aren't switched on platform-wide yet — you can still finish setup now and
                it'll work the moment they're enabled.
              </p>
            )}

            <div className="mt-4">
              <ConnectControls started={started} connected={connected} stubbed={stubbed} />
            </div>
          </div>

          {/* Progress checklist */}
          <ol className="w-full max-w-[240px] space-y-2 rounded-md border border-line bg-base p-4 sm:w-auto">
            <Step done={started} active={!started}>
              Connect a Stripe account
            </Step>
            <Step done={submitted} active={started && !submitted}>
              Add your business &amp; bank details
            </Step>
            <Step done={connected} active={submitted && !connected}>
              Start receiving card payouts
            </Step>
          </ol>
        </div>
      </Card>

      {/* Settings: card on/off + sales tax, side by side on wide screens */}
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">Take cards online</h3>
            <Badge tone={paymentsSuspended ? "warn" : r.cardPaymentsEnabled ? "good" : "neutral"}>
              {paymentsSuspended ? "Suspended" : r.cardPaymentsEnabled ? "On" : "Off"}
            </Badge>
          </div>
          <p className="mb-4 text-[13px] leading-relaxed text-dim">
            On: customers pay by card at checkout. Off: orders are pay-at-counter, and no service fee is
            collected on them.
          </p>
          {paymentsSuspended ? (
            <p className="text-[12px] text-mute">
              Unavailable while card payments are suspended on this account.
            </p>
          ) : (
            <CardPaymentsToggle enabled={r.cardPaymentsEnabled} />
          )}
        </Card>

        <Card>
          <div className="mb-1 flex items-center justify-between">
            <h3 className="text-[14px] font-semibold text-ink">Delivery</h3>
            <Badge tone={deliverySuspended ? "warn" : r.deliveryEnabled ? "good" : "neutral"}>
              {deliverySuspended ? "Suspended" : r.deliveryEnabled ? "On" : "Off"}
            </Badge>
          </div>
          <p className="mb-4 text-[13px] leading-relaxed text-dim">
            Not live yet — delivery ordering is still being built, and turning this on won&rsquo;t show
            customers a delivery option. It records that you want it when it ships.
          </p>
          {deliverySuspended ? (
            <p className="text-[12px] text-mute">
              {services.DELIVERY.reason ?? "Delivery is suspended on this account."} Contact support.
            </p>
          ) : (
            <DeliveryToggle enabled={r.deliveryEnabled} />
          )}
        </Card>

        <Card>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">Sales tax</h3>
          <p className="mb-4 text-[13px] leading-relaxed text-dim">
            Your state and local rate. It's charged on the food subtotal and shown as its own line on the
            receipt.
          </p>
          <SalesTaxForm taxPct={r.taxPct} />
        </Card>
      </div>
    </>
  );
}
