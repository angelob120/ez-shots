/**
 * Payment seam. V1 ships the stub: checkout "succeeds" without charging.
 * Stripe Connect sits behind the same interface: a direct charge on the
 * restaurant's connected account, with the surcharge taken as an application
 * fee. The owner's payout is untouched, and because the charge is theirs
 * rather than ours, Stripe's processing fee comes out of their balance instead
 * of eating the fee that is our entire revenue. See lib/payments-stripe.ts.
 */

import { prisma } from "@/lib/prisma";
import { StripePaymentProvider, type StripeConfig } from "@/lib/payments-stripe";

/**
 * Platform payment mode. Held in the database (PlatformSetting) so "us" can
 * flip it from /admin without a redeploy — a production box with the live keys
 * installed can still be driven end-to-end on TEST or STUB.
 *
 *   LIVE — real money, live keys.
 *   TEST — real Stripe charges against test keys; visible in the Stripe test
 *          dashboard, refundable, no real money moves.
 *   STUB — charges nothing, reports success. The V1 default.
 */
export type PaymentMode = "LIVE" | "TEST" | "STUB";

export type ChargeInput = {
  restaurantId: string;
  amountCts: number;
  /**
   * What the platform takes from this charge, as Stripe's
   * `application_fee_amount`.
   *
   * Named for what it *is* rather than for the surcharge, because on a paid
   * plan the two are no longer the same number. On ZERO it equals the service
   * fee the customer paid. On HYBRID it is a commission out of the
   * restaurant's own proceeds and the customer paid no fee at all. On FLAT it
   * is zero. `platformFeeCts` in `lib/plans.ts` is the only thing that should
   * compute it — see the note there on why confusing the two overcharges a
   * diner or underpays a restaurant.
   */
  applicationFeeCts: number;
  description: string;
  metadata?: Record<string, string>;
  /**
   * A PaymentMethod collected in the browser (`pm_...`). The stub ignores it;
   * a real provider charges it. Absent in test mode, where the provider
   * supplies its own test card so a buy can run end-to-end with no card UI.
   */
  paymentMethodId?: string;
  /**
   * Set on the second pass of a card that needed 3-D Secure: the browser has
   * finished the challenge, and this is the intent it authorised. The provider
   * reads that intent instead of creating a new charge, so the retry can't
   * charge twice.
   */
  paymentIntentId?: string;
};

export type ChargeResult = {
  ok: boolean;
  provider: string;
  reference: string;
  status: string;
  error?: string;
  /**
   * True when the card needs a browser-side authentication step (3-D Secure).
   * Not a failure and not a success — the caller must run the challenge with
   * `clientSecret`, then charge again carrying the resulting paymentIntentId.
   */
  requiresAction?: boolean;
  clientSecret?: string;
};

export type RefundInput = {
  /**
   * Which tenant's books this refund moves money on. Required because charges
   * are *direct* — they live on the restaurant's connected account, not ours,
   * and a refund has to be issued against the same account or Stripe can't
   * find the charge. The stub ignores it.
   */
  restaurantId: string;
  /** The reference returned by charge(). */
  reference: string;
  amountCts: number;
  /** True when the service fee is going back with it. */
  includeSurcharge: boolean;
  reason: string;
  /**
   * Stable key for this refund attempt — the Refund row id. A retry after a
   * network timeout carries the same key, so the provider returns the original
   * result instead of moving the money a second time. We cannot tell a lost
   * response apart from a failed call, so this is the only thing that makes
   * retrying safe. Stripe takes it directly as an idempotency key.
   */
  idempotencyKey?: string;
};

export type RefundResult = {
  ok: boolean;
  provider: string;
  reference: string;
  error?: string;
};

export interface PaymentProvider {
  readonly name: string;
  charge(input: ChargeInput): Promise<ChargeResult>;
  /**
   * Money back. Partial refunds are the common case — a single 86'd item on
   * an otherwise fine order — so the amount is always explicit rather than
   * implied by the original charge.
   */
  refund(input: RefundInput): Promise<RefundResult>;
}

class StubPaymentProvider implements PaymentProvider {
  readonly name = "stub";

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
    return {
      ok: true,
      provider: this.name,
      reference: `stub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      status: "stub_succeeded",
    };
  }

  async refund(input: RefundInput): Promise<RefundResult> {
    if (input.amountCts <= 0) {
      return {
        ok: false,
        provider: this.name,
        reference: "",
        error: "Refund amount must be positive",
      };
    }
    return {
      ok: true,
      provider: this.name,
      reference: `stubref_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    };
  }
}

const stub = new StubPaymentProvider();

/**
 * Test injection point. When set, it wins over every mode — the pure-logic and
 * concurrency tests replace the seam with a double and drive orders.ts without
 * a database or a network. Production never calls this.
 */
let override: PaymentProvider | null = null;

export function setPaymentProvider(p: PaymentProvider) {
  override = p;
}

/**
 * The provider for a given mode. This is the real runtime entry point: the
 * charge path passes the *current* platform mode, and every refund passes the
 * mode the original charge was made in (recovered from the order — see
 * modeFromTag), because a charge created with the test keys can only be
 * refunded with the test keys.
 *
 * STUB, and any Stripe mode whose keys are missing, resolve to the stub. A
 * missing key set is shouted about at boot (scripts/config-check.mjs); here it
 * degrades safely rather than throwing mid-checkout.
 */
export function paymentProviderForMode(mode: PaymentMode): PaymentProvider {
  if (override) return override;
  if (mode === "STUB") return stub;

  const cfg = stripeConfigForMode(mode);
  if (!cfg) {
    console.error(
      `[payments] mode=${mode} but its Stripe keys are unset — using the stub. NO MONEY WILL BE CHARGED.`
    );
    return stub;
  }
  return new StripePaymentProvider(cfg);
}

/** Longest a non-LIVE window may run, and what an unspecified one gets. */
export const MAX_TEST_WINDOW_HOURS = 7 * 24;
export const DEFAULT_TEST_WINDOW_HOURS = 24;

/**
 * Where an expiring window lands.
 *
 * Reverting blindly to LIVE is the obvious rule and the wrong one: if the live
 * secret key isn't set, `paymentProviderForMode` quietly falls back to the stub,
 * so the platform would report LIVE while charging nobody — the same silent
 * failure the timer exists to prevent, just wearing a more reassuring label.
 * When we can't actually go live, we go to STUB and say so loudly.
 */
export function safeRevertTarget(preferred?: PaymentMode | null): PaymentMode {
  const want = preferred ?? "LIVE";
  if (want === "LIVE" && !stripeConfigForMode("LIVE")) {
    console.error(
      "[payments] a non-live window expired but STRIPE_SECRET_KEY_LIVE is unset — falling back to STUB rather than claiming LIVE."
    );
    return "STUB";
  }
  if (want === "TEST" && !stripeConfigForMode("TEST")) return "STUB";
  return want;
}

export type ModeState = {
  mode: PaymentMode;
  /** When the current non-LIVE window closes. Null when there's no timer. */
  expiresAt: Date | null;
  revertTo: PaymentMode | null;
  /** Set when the timer fired rather than a person switching it. */
  revertedAt: Date | null;
  testModeEnabled: boolean;
};

/**
 * Everything about the current mode, with the expiry already applied.
 *
 * This is the enforcement point, not the admin page — a guard that only runs
 * when somebody happens to load a screen is not a guard. Every charge and every
 * refund goes through `resolvePaymentMode`, which delegates here, so an expired
 * window is over the moment the next order is placed whether or not anyone is
 * watching.
 *
 * The write-back is best effort. Returning the reverted mode is what matters;
 * persisting it just stops the banner claiming the old one.
 */
export async function resolveModeState(): Promise<ModeState> {
  const row = await prisma.platformSetting.findUnique({ where: { id: "singleton" } });

  if (!row) {
    return {
      mode: envDefaultMode(),
      expiresAt: null,
      revertTo: null,
      revertedAt: null,
      testModeEnabled: false,
    };
  }

  const mode = (row.paymentMode ?? envDefaultMode()) as PaymentMode;
  const expired =
    mode !== "LIVE" && row.modeExpiresAt != null && row.modeExpiresAt.getTime() <= Date.now();

  if (!expired) {
    return {
      mode,
      expiresAt: row.modeExpiresAt ?? null,
      revertTo: (row.modeRevertTo as PaymentMode | null) ?? null,
      revertedAt: row.modeRevertedAt ?? null,
      testModeEnabled: row.testModeEnabled ?? false,
    };
  }

  const target = safeRevertTarget(row.modeRevertTo as PaymentMode | null);
  const revertedAt = new Date();

  try {
    await prisma.platformSetting.update({
      where: { id: "singleton" },
      data: {
        paymentMode: target,
        modeExpiresAt: null,
        modeRevertTo: null,
        // Kept so the admin banner can say "this reverted on its own at 04:12"
        // instead of leaving somebody hunting for who changed it.
        modeRevertedAt: revertedAt,
      },
    });
  } catch (err) {
    // A failed write must not take checkout down with it. The returned mode is
    // already correct; the row catches up on the next request.
    console.error("[payments] couldn't persist the mode revert:", err);
  }

  console.warn(
    `[payments] non-live window expired — reverting ${mode} → ${target}. Real charges resume now.`
  );

  return {
    mode: target,
    expiresAt: null,
    revertTo: null,
    revertedAt,
    testModeEnabled: row.testModeEnabled ?? false,
  };
}

/**
 * The platform's current payment mode, with any expired non-LIVE window already
 * applied. When the setting has never been written, falls back to the
 * PAYMENT_MODE env default, and failing that to STUB — the safe direction for a
 * fresh deploy, since STUB can only ever *under*-charge.
 */
export async function resolvePaymentMode(): Promise<PaymentMode> {
  return (await resolveModeState()).mode;
}

/** Are the demo affordances (autofill, seeding, sample CSV) currently visible? */
export async function testModeEnabled(): Promise<boolean> {
  return (await resolveModeState()).testModeEnabled;
}

export function envDefaultMode(): PaymentMode {
  const m = (process.env.PAYMENT_MODE ?? "").toUpperCase();
  if (m === "LIVE" || m === "TEST" || m === "STUB") return m;
  return "STUB";
}

/**
 * How the mode is stamped onto an order so a later refund can pick the same key
 * set. Stored in Order.paymentProvider, which used to hold only the provider
 * name — the tag is a superset ("stub" | "stripe-test" | "stripe-live") that
 * still reads as the provider at a glance.
 */
export function providerTag(mode: PaymentMode): string {
  return mode === "STUB" ? "stub" : `stripe-${mode.toLowerCase()}`;
}

export function modeFromTag(tag: string | null | undefined): PaymentMode {
  if (tag === "stripe-live") return "LIVE";
  if (tag === "stripe-test") return "TEST";
  // "stub", null, and the legacy bare "stripe" (from before modes existed, when
  // nothing charged real money) all resolve to the stub for refunds.
  return "STUB";
}

/**
 * Build a Stripe config for a mode from env. Prefers the explicit split vars
 * (STRIPE_SECRET_KEY_LIVE / _TEST) so both key sets can sit side by side in the
 * same environment, which is the whole point of the admin toggle. Falls back to
 * the single unsuffixed vars when their key prefix matches the requested mode,
 * so an environment that only ever had one set keeps working.
 */
export function stripeConfigForMode(mode: PaymentMode): StripeConfig | null {
  if (mode === "STUB") return null;
  const live = mode === "LIVE";
  const wantPrefix = live ? "sk_live_" : "sk_test_";

  const secretKey =
    process.env[live ? "STRIPE_SECRET_KEY_LIVE" : "STRIPE_SECRET_KEY_TEST"] ??
    (process.env.STRIPE_SECRET_KEY?.startsWith(wantPrefix) ? process.env.STRIPE_SECRET_KEY : undefined);

  if (!secretKey) return null;
  return { secretKey, live, currency: (process.env.STRIPE_CURRENCY ?? "usd").toLowerCase() };
}

/**
 * The publishable key the storefront needs to mount the card field, for a mode.
 * Server-side only — page.tsx reads it and passes the right one to the client,
 * so it never has to be baked into the bundle as a NEXT_PUBLIC_ var.
 */
export function stripePublishableKeyForMode(mode: PaymentMode): string | null {
  if (mode === "STUB") return null;
  const live = mode === "LIVE";
  const wantPrefix = live ? "pk_live_" : "pk_test_";
  return (
    process.env[live ? "STRIPE_PUBLISHABLE_KEY_LIVE" : "STRIPE_PUBLISHABLE_KEY_TEST"] ??
    (process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith(wantPrefix)
      ? process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
      : undefined) ??
    null
  );
}

/**
 * Back-compat shim. A couple of callers still ask for "the provider" without a
 * mode; give them the env-default mode's provider. New code should call
 * paymentProviderForMode with an explicit mode.
 */
export function getPaymentProvider(): PaymentProvider {
  return paymentProviderForMode(envDefaultMode());
}
