import { prisma } from "@/lib/prisma";
import { stripeConfigForMode, type PaymentMode } from "@/lib/payments";

/**
 * Stripe Connect onboarding — the flow that gives each restaurant its own
 * `acct_...` so card funds settle to them and the surcharge rides as the
 * platform's application fee (see lib/payments-stripe.ts for the charge side).
 *
 * All of this runs against the *current platform mode's* platform key: a TEST
 * account is a test connected account, a LIVE one is real. That's deliberate —
 * an owner onboarding while the platform is in test mode is practising against
 * Stripe's test Connect, and the same button does the real thing once the
 * platform flips to live.
 *
 * Express accounts: Stripe hosts the onboarding form and the payout dashboard,
 * so we never collect bank details ourselves. We only ever hold the account id
 * and a cached copy of its readiness flags.
 */

const API = "https://api.stripe.com/v1";

function secretForMode(mode: PaymentMode): string | null {
  return stripeConfigForMode(mode)?.secretKey ?? null;
}

async function post<T>(secret: string, path: string, form: Record<string, string>): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${secret}:`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as T;
}

async function get<T>(secret: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Basic ${btoa(`${secret}:`)}` },
    signal: AbortSignal.timeout(15_000),
  });
  return (await res.json()) as T;
}

export type ConnectResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Whether Connect is enabled on the *platform's* Stripe account for a mode.
 *
 * This is the setup step that belongs to the platform, not any restaurant, and
 * its absence is exactly what makes the owner's "Connect with Stripe" button
 * fail. Probed by listing connected accounts: a platform with Connect on gets a
 * list (possibly empty); one without gets an error. Admin-only and infrequent,
 * so the extra API call is fine.
 *
 * Returns `unknown` (not false) when there's no key or the call itself fails,
 * so a network blip never gets reported to an admin as "Connect is off".
 */
export async function platformConnectStatus(
  mode: PaymentMode
): Promise<"enabled" | "disabled" | "unknown"> {
  const secret = secretForMode(mode);
  if (!secret) return "unknown";
  try {
    const res = await get<{ object?: string; data?: unknown[]; error?: { message: string } }>(
      secret,
      "/accounts?limit=1"
    );
    if (res.object === "list") return "enabled";
    if (res.error) {
      // The one error we can read as a definite "not set up": Stripe telling us
      // this account isn't a Connect platform. Anything else is inconclusive.
      return /connect/i.test(res.error.message) ? "disabled" : "unknown";
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * The restaurant's connected account id, creating one on first call. Idempotent
 * by storage: once an id is on the row we never make a second account, so a
 * double-clicked "Connect" button can't strand a duplicate.
 */
export async function ensureConnectAccount(
  restaurantId: string,
  mode: PaymentMode
): Promise<ConnectResult<string>> {
  const secret = secretForMode(mode);
  if (!secret) return { ok: false, error: "Payments aren't configured for this mode yet." };

  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { stripeAccountId: true, name: true, city: true },
  });
  if (!r) return { ok: false, error: "Restaurant not found." };
  if (r.stripeAccountId) return { ok: true, value: r.stripeAccountId };

  const account = await post<{ id?: string; error?: { message: string } }>(secret, "/accounts", {
    type: "express",
    country: "US",
    "capabilities[card_payments][requested]": "true",
    "capabilities[transfers][requested]": "true",
    business_type: "company",
    "business_profile[name]": r.name,
    "metadata[restaurantId]": restaurantId,
  });
  if (!account.id) {
    return { ok: false, error: account.error?.message ?? "Stripe declined to create the account." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { stripeAccountId: account.id },
  });
  return { ok: true, value: account.id };
}

/**
 * A one-time onboarding URL to send the owner to. Account Links expire quickly
 * and are single-use, so this is generated fresh each time the owner clicks
 * Connect rather than stored.
 */
export async function createOnboardingLink(
  accountId: string,
  mode: PaymentMode,
  urls: { refreshUrl: string; returnUrl: string }
): Promise<ConnectResult<string>> {
  const secret = secretForMode(mode);
  if (!secret) return { ok: false, error: "Payments aren't configured for this mode yet." };

  const link = await post<{ url?: string; error?: { message: string } }>(secret, "/account_links", {
    account: accountId,
    // refresh_url is where Stripe bounces the owner if the link expired before
    // they finished — straight back to us to mint a new one.
    refresh_url: urls.refreshUrl,
    return_url: urls.returnUrl,
    type: "account_onboarding",
  });
  if (!link.url) {
    return { ok: false, error: link.error?.message ?? "Stripe didn't return an onboarding link." };
  }
  return { ok: true, value: link.url };
}

/**
 * Pull the connected account's current state and cache the readiness flags on
 * the restaurant. Called on return from onboarding and behind a manual refresh;
 * `charges_enabled` is the one that actually decides whether a live direct
 * charge will clear.
 */
export async function refreshConnectStatus(
  restaurantId: string,
  mode: PaymentMode
): Promise<ConnectResult<{ chargesEnabled: boolean; payoutsEnabled: boolean; detailsSubmitted: boolean }>> {
  const secret = secretForMode(mode);
  if (!secret) return { ok: false, error: "Payments aren't configured for this mode yet." };

  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { stripeAccountId: true },
  });
  if (!r?.stripeAccountId) return { ok: false, error: "No connected account to check yet." };

  const acct = await get<{
    charges_enabled?: boolean;
    payouts_enabled?: boolean;
    details_submitted?: boolean;
    error?: { message: string };
  }>(secret, `/accounts/${encodeURIComponent(r.stripeAccountId)}`);
  if (acct.error) return { ok: false, error: acct.error.message };

  const value = {
    chargesEnabled: !!acct.charges_enabled,
    payoutsEnabled: !!acct.payouts_enabled,
    detailsSubmitted: !!acct.details_submitted,
  };
  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      stripeChargesEnabled: value.chargesEnabled,
      stripePayoutsEnabled: value.payoutsEnabled,
      stripeDetailsSubmitted: value.detailsSubmitted,
    },
  });
  return { ok: true, value };
}
