import { prisma } from "@/lib/prisma";
import type {
  ChargeInput,
  ChargeResult,
  PaymentProvider,
  RefundInput,
  RefundResult,
} from "@/lib/payments";

/**
 * Stripe behind the PaymentProvider seam.
 *
 * Talks to the REST API over fetch rather than pulling in the `stripe` SDK —
 * the same call the SMS path made about Twilio. The surface used here is three
 * endpoints (create/confirm PaymentIntent, create Refund) and a webhook the
 * dashboard doesn't need yet; the SDK is a large dependency that would mostly
 * be carried, not used.
 *
 * Nothing in this file decides the *amounts* or *whether* to charge — totals
 * and the surcharge are settled in lib/money.ts, and the caller in
 * placeOrderAction has already refused a closed kitchen. This only knows how to
 * move the money and how to describe what went wrong afterwards.
 *
 * The surcharge is the revenue model, and it must not come out of the owner's
 * pocket — nor out of ours. That is why this is a **direct charge**: the
 * PaymentIntent is created *on* the restaurant's connected account (the
 * `Stripe-Account` header), and `application_fee_amount` is what comes back to
 * the platform. Stripe's own processing fee is then deducted from the
 * connected account's balance, not ours.
 *
 * This was a destination charge until it wasn't, and the difference is the
 * whole business. On a destination charge the platform is merchant of record
 * and Stripe's docs are explicit that "your account balance is debited for the
 * cost of the Stripe fees, refunds, and chargebacks". At a $1–2 surcharge and
 * a ~$1.20 Stripe fee on a normal ticket, that shape loses money on every
 * order. Do not reintroduce `transfer_data[destination]` here.
 *
 * A tenant with no connected account yet can still transact in test mode; the
 * charge falls back to a plain platform charge and the fee is a no-op. Going
 * live without a connected account would route the *whole* bill to us, which
 * the config check refuses (see scripts/config-check.mjs).
 */

const API = "https://api.stripe.com/v1";

/**
 * Stripe's own test payment method. In test mode a charge can be confirmed
 * server-side with this without any card UI or 3-D Secure step, which is the
 * whole point of the testing path: an end-to-end "buy" that shows up in the
 * Stripe test dashboard and is refundable, driven entirely by the existing
 * synchronous seam. Never valid against a live key — Stripe rejects it — so it
 * can't leak into a real charge.
 */
const TEST_PAYMENT_METHOD = "pm_card_visa";

export type StripeConfig = {
  secretKey: string;
  /** false in test mode — enables the test-card fallback above. */
  live: boolean;
  /** Currency for every charge. USD-only for now; the product is US pickup. */
  currency: string;
};

export function stripeConfigFromEnv(): StripeConfig | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  // The key itself is the source of truth for live-vs-test — sk_live_ can only
  // touch live money, sk_test_ only test. STRIPE_MODE is a second, explicit
  // switch so a live key can never be reached by accident in a dev deploy: we
  // only go live when the key says live AND the operator said live.
  const keyIsLive = secretKey.startsWith("sk_live_");
  const modeIsLive = process.env.STRIPE_MODE === "live";

  return {
    secretKey,
    live: keyIsLive && modeIsLive,
    currency: (process.env.STRIPE_CURRENCY ?? "usd").toLowerCase(),
  };
}

export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";

  constructor(private readonly cfg: StripeConfig) {}

  async charge(input: ChargeInput): Promise<ChargeResult> {
    if (input.amountCts <= 0) {
      return {
        ok: false,
        provider: this.name,
        reference: "",
        status: "invalid_amount",
        error: "Amount must be positive",
      };
    }

    // Resolved before anything else because on a direct charge it isn't a
    // routing detail — it's *which account the intent lives on*. An intent
    // created on a connected account is invisible to a platform-scoped read,
    // so the 3-D Secure re-read below needs the same header the create used.
    const account = await connectedAccountFor(input.restaurantId);

    // A card that needed 3-D Secure was confirmed by the browser and handed
    // back as an intent id. We don't create a second intent — we read the one
    // the customer already authorised and trust nothing but its status.
    if (input.paymentIntentId) {
      return this.finalize(input.paymentIntentId, account);
    }

    const paymentMethod =
      input.paymentMethodId ?? (this.cfg.live ? undefined : TEST_PAYMENT_METHOD);

    if (!paymentMethod) {
      // Live mode with no card collected. Nothing to charge, and confirming
      // against a test card would (correctly) be rejected by a live key.
      return {
        ok: false,
        provider: this.name,
        reference: "",
        status: "no_payment_method",
        error: "No card was provided.",
      };
    }

    const form: Record<string, string> = {
      amount: String(input.amountCts),
      currency: this.cfg.currency,
      payment_method: paymentMethod,
      confirm: "true",
      description: input.description,
      // Card only, and no redirect-based methods — a redirect can't be
      // completed inside a synchronous checkout call.
      "payment_method_types[]": "card",
      "metadata[restaurantId]": input.restaurantId,
    };
    for (const [k, v] of Object.entries(input.metadata ?? {})) {
      form[`metadata[${k}]`] = v;
    }

    if (account) {
      // Direct charge: the intent is created on the restaurant's account (see
      // the header in `post`), funds land there, Stripe's fee is deducted from
      // their balance, and this is the slice that comes back to us. Stripe
      // caps it at the charge amount; the fee is a few percent either way, so
      // the clamp is a guard against a bad config rather than a live concern.
      //
      // This is the surcharge on ZERO and a commission on HYBRID — the same
      // field carrying two economically opposite things. `lib/plans.ts` decides
      // which; this only moves it.
      form.application_fee_amount = String(Math.min(input.applicationFeeCts, input.amountCts));
    }

    let body: StripeIntent | StripeError | null;
    try {
      body = await this.post<StripeIntent | StripeError>(
        "/payment_intents",
        form,
        // The order row hasn't been written yet, so there's no id to key on.
        // A restaurant + amount + minute window is enough to stop a
        // double-tapped Pay button from charging twice within the retry a
        // network blip would trigger.
        `charge_${input.restaurantId}_${input.amountCts}_${Math.floor(Date.now() / 60_000)}`,
        account
      );
    } catch (err) {
      return {
        ok: false,
        provider: this.name,
        reference: "",
        status: "network_error",
        error: `network: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    return this.interpret(body);
  }

  /** Reads an intent the client already confirmed and reports where it landed. */
  private async finalize(
    paymentIntentId: string,
    account: string | null
  ): Promise<ChargeResult> {
    let body: StripeIntent | StripeError | null;
    try {
      body = await this.get<StripeIntent | StripeError>(
        `/payment_intents/${encodeURIComponent(paymentIntentId)}`,
        account
      );
    } catch (err) {
      return {
        ok: false,
        provider: this.name,
        reference: paymentIntentId,
        status: "network_error",
        error: `network: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return this.interpret(body);
  }

  /** One place that turns a PaymentIntent (or error) into a ChargeResult. */
  private interpret(body: StripeIntent | StripeError | null): ChargeResult {
    if (!body || "error" in body) {
      return {
        ok: false,
        provider: this.name,
        reference: body && "error" in body ? body.error.payment_intent?.id ?? "" : "",
        status: body && "error" in body ? body.error.code ?? "error" : "error",
        error: body && "error" in body ? body.error.message : "Stripe returned no body",
      };
    }

    switch (body.status) {
      case "succeeded":
        return { ok: true, provider: this.name, reference: body.id, status: body.status };
      case "requires_action":
      case "requires_confirmation":
        // The card wants 3-D Secure. The browser has to finish it — we hand
        // back the client secret and say so; the caller collects the
        // authorisation and comes back with the same intent id.
        return {
          ok: false,
          provider: this.name,
          reference: body.id,
          status: body.status,
          requiresAction: true,
          clientSecret: body.client_secret,
          error: "Additional authentication required.",
        };
      default:
        // requires_payment_method (declined), canceled, processing — none of
        // which is a completed charge.
        return {
          ok: false,
          provider: this.name,
          reference: body.id,
          status: body.status,
          error: `Payment ${body.status}.`,
        };
    }
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (input.amountCts <= 0) {
      return { ok: false, provider: this.name, reference: "", error: "Refund amount must be positive" };
    }

    const form: Record<string, string> = {
      payment_intent: input.reference,
      amount: String(input.amountCts),
      "metadata[reason]": input.reason.slice(0, 200),
    };
    // The application fee doesn't come back unless we ask, and on a direct
    // charge the money moves out of the *restaurant's* balance. So the flag is
    // literally "who funds the service fee on this refund": left false, the
    // restaurant refunds only the food and we keep our cut; set true, Stripe
    // claws our fee back too so the customer is made whole from both pockets
    // and the owner is never out of pocket for our revenue.
    //
    // Stripe refunds the fee *proportionally* on a partial refund, which lines
    // up with the share orders.ts already computed, give or take a cent of
    // rounding. Don't try to refund the fee separately to make it exact — two
    // writers on the same money is the bug class this codebase keeps closing.
    if (input.includeSurcharge) form.refund_application_fee = "true";

    // Same account the charge was created on. A refund issued platform-scoped
    // against a connected account's charge doesn't find it.
    const account = await connectedAccountFor(input.restaurantId);

    let body: StripeRefund | StripeError | null;
    try {
      body = await this.post<StripeRefund | StripeError>(
        "/refunds",
        form,
        // The Refund row id — the caller's idempotency key. A retry after a
        // lost response carries the same key and Stripe returns the original
        // refund instead of moving the money twice. This is the only thing
        // that makes the retry queue safe.
        input.idempotencyKey,
        account
      );
    } catch (err) {
      return {
        ok: false,
        provider: this.name,
        reference: "",
        error: `network: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    if (!body || "error" in body) {
      return {
        ok: false,
        provider: this.name,
        reference: "",
        error: body && "error" in body ? body.error.message : "Stripe returned no body",
      };
    }

    // pending is normal for some methods and still means Stripe accepted it;
    // only an outright failed status is a refund that didn't take.
    if (body.status === "failed" || body.status === "canceled") {
      return { ok: false, provider: this.name, reference: body.id, error: `Refund ${body.status}.` };
    }
    return { ok: true, provider: this.name, reference: body.id };
  }

  /**
   * `stripeAccount` is what makes a charge direct. With it, the platform's
   * secret key acts *as* the connected account and the object is created on
   * their books; without it the same key acts as the platform. It is the only
   * difference between the two charge shapes at the wire level, which is why
   * every call that touches a charge has to agree about it.
   */
  private async post<T>(
    path: string,
    form: Record<string, string>,
    idempotencyKey?: string,
    stripeAccount?: string | null
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${this.cfg.secretKey}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    if (stripeAccount) headers["Stripe-Account"] = stripeAccount;

    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers,
      body: new URLSearchParams(form),
      // A charge should not hold a checkout open forever. Stripe is normally
      // well under a second; past fifteen there is something worth surfacing
      // as a failure rather than waiting out.
      signal: AbortSignal.timeout(15_000),
    });
    return (await res.json()) as T;
  }

  private async get<T>(path: string, stripeAccount?: string | null): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${this.cfg.secretKey}:`)}`,
    };
    if (stripeAccount) headers["Stripe-Account"] = stripeAccount;

    const res = await fetch(`${API}${path}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    return (await res.json()) as T;
  }
}

/**
 * The restaurant's Stripe Connect account id, or null if they haven't onboarded.
 *
 * Null is a legitimate state in test mode — the charge falls back to a plain
 * platform charge on our own books and the fee is a no-op. It is not a
 * legitimate state live; config-check.mjs makes that its own kind of loud.
 *
 * Read fresh on every charge and every refund rather than passed in, so the
 * two can't disagree. They must not: a refund scoped to the platform can't see
 * a charge that lives on a connected account, and vice versa.
 */
async function connectedAccountFor(restaurantId: string): Promise<string | null> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { stripeAccountId: true },
  });
  return restaurant?.stripeAccountId ?? null;
}

// Only the fields we read. Stripe returns a great deal more.
type StripeIntent = {
  id: string;
  status:
    | "succeeded"
    | "requires_action"
    | "requires_confirmation"
    | "requires_payment_method"
    | "processing"
    | "canceled";
  client_secret?: string;
};

type StripeRefund = {
  id: string;
  status: "succeeded" | "pending" | "failed" | "canceled" | "requires_action";
};

type StripeError = {
  error: {
    code?: string;
    message: string;
    payment_intent?: { id: string };
  };
};
