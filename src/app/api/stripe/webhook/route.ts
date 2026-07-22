import { prisma } from "@/lib/prisma";
import { readStripeWebhook } from "@/lib/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/stripe/webhook — Stripe reporting state changes out of band.
 *
 * Two things arrive here that the request/response flow can't see on its own:
 * a connected account finishing (or failing) onboarding, and a payment settling
 * or failing after the fact. Both otherwise depend on someone clicking Refresh.
 *
 * Both now originate on *connected* accounts, because charges are direct — the
 * PaymentIntent lives on the restaurant's books, not the platform's. So the
 * Stripe endpoint feeding this route must have "Listen to events on connected
 * accounts" enabled; a platform-only endpoint sees `account.updated` and
 * nothing else, and payment status silently stops updating. The handlers below
 * match on ids rather than on the event's `account` field, so they work
 * unchanged for either origin — the endpoint setting is the thing to get right.
 *
 * Deliberately narrow about what it *writes*. `Order.status` and `refundedCts`
 * have exactly one writer in lib/orders.ts, and this is not it — so this touches
 * only the Connect readiness mirror and the payment-status string, never the
 * money invariants. External dashboard refunds are logged, not reconciled into
 * refundedCts; doing that safely means routing through orders.ts, which is
 * follow-up work, not a webhook side effect.
 */

export async function POST(req: Request) {
  const read = await readStripeWebhook(req);
  // Signature failures get the real status so Stripe retries a transient
  // misconfiguration; a verified-but-unhandled event still returns 200 so it
  // isn't retried forever.
  if (!read.ok) return new Response(read.reason, { status: read.status });

  const { type, data } = read.event;
  const obj = data.object;

  switch (type) {
    case "account.updated": {
      // Connected account readiness changed — mirror the flags onto whichever
      // restaurant owns this account. updateMany so an account we don't know
      // (another platform, a restored DB) is a no-op, not a 500-retry loop.
      const id = str(obj.id);
      if (id) {
        await prisma.restaurant.updateMany({
          where: { stripeAccountId: id },
          data: {
            stripeChargesEnabled: bool(obj.charges_enabled),
            stripePayoutsEnabled: bool(obj.payouts_enabled),
            stripeDetailsSubmitted: bool(obj.details_submitted),
          },
        });
      }
      break;
    }

    case "payment_intent.succeeded":
    case "payment_intent.payment_failed": {
      // Reconcile the payment-status string against the order the intent paid
      // for. Scalar only — no status-machine or refund fields touched here.
      const ref = str(obj.id);
      const status = str(obj.status);
      if (ref && status) {
        await prisma.order.updateMany({
          where: { paymentReference: ref },
          data: { paymentStatus: status },
        });
      }
      break;
    }

    /*
      Subscription invoices — the owner paying *us*, on the platform account.
      Every other event in this switch originates on a connected account; these
      do not, which is why they match on `stripeCustomerId` rather than
      `stripeAccountId`. Confusing the two would attach a tenant's software bill
      to their diners' payment account.
    */
    case "invoice.paid": {
      const customer = str(obj.customer);
      if (customer) {
        // Clearing `planPastDueSince` is what stops the grace clock and, with
        // it, the automatic downgrade. A payment that succeeds after a failure
        // has to un-do the dunning state or the tenant drops to ZERO anyway,
        // fourteen days after a bill they actually paid.
        await prisma.restaurant.updateMany({
          where: { stripeCustomerId: customer },
          data: {
            planPastDueSince: null,
            ...(periodEnd(obj) ? { planPeriodEnd: periodEnd(obj) } : {}),
          },
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const customer = str(obj.customer);
      if (customer) {
        // Only stamp the *first* failure — Stripe retries a failed invoice
        // several times over about two weeks, and each retry arrives here. If
        // every one reset the clock, the grace period would never expire and a
        // non-paying tenant would keep paid-plan pricing forever.
        await prisma.restaurant.updateMany({
          where: { stripeCustomerId: customer, planPastDueSince: null },
          data: { planPastDueSince: new Date() },
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      // Cancelled at Stripe — by us, by them, or by Stripe giving up on
      // collection. Either way the tenant is on the free plan now, and the
      // local row has to agree or the checkout keeps waiving a fee nobody is
      // paying for.
      const customer = str(obj.customer);
      if (customer) {
        await prisma.restaurant.updateMany({
          where: { stripeCustomerId: customer },
          data: {
            plan: "ZERO",
            pendingPlan: null,
            stripeSubscriptionId: null,
            planPeriodEnd: null,
            planPastDueSince: null,
          },
        });
      }
      break;
    }

    default:
      // Verified but not something we act on. 200 so Stripe stops resending.
      break;
  }

  return new Response(null, { status: 200 });
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function bool(v: unknown): boolean {
  return v === true;
}

/** The end of the period an invoice covers, as a Date. Stripe sends seconds. */
function periodEnd(obj: Record<string, unknown>): Date | null {
  const lines = obj.lines as { data?: Array<{ period?: { end?: number } }> } | undefined;
  const end = lines?.data?.[0]?.period?.end;
  return typeof end === "number" ? new Date(end * 1000) : null;
}
