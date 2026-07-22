import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { platformOrigin } from "@/lib/domains";
import { setSession } from "@/lib/auth";
import { recordLogin } from "@/lib/activity";
import { setCustomerSession } from "@/lib/customer-session";
import { exchangeCode, openState } from "@/lib/oauth-server";
import {
  OAUTH_STATE_COOKIE,
  isOAuthProvider,
  providerConfig,
  staffLinkDecision,
  type OAuthIdentity,
  type OAuthState,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * Finish a Google or Apple sign-in.
 *
 * Google returns via GET, Apple via a cross-site form POST, so both verbs land
 * on the same handler. Everything else about the two is identical because the
 * differences were absorbed in `lib/oauth.ts`.
 *
 * The order of checks is the security of this route:
 *
 *   1. The state cookie is present, signed by us, and unexpired.
 *   2. The `state` parameter the provider echoed matches the nonce in it. A
 *      forged callback fails here, because the attacker cannot set a cookie in
 *      the victim's browser for our origin.
 *   3. The code is exchanged and the ID token is *verified* against the
 *      provider's published keys — not decoded.
 *   4. Only then does anything get looked up or written.
 */

export async function GET(req: NextRequest, ctx: { params: { provider: string } }) {
  const url = new URL(req.url);
  return handle(req, ctx, {
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
    name: null,
  });
}

export async function POST(req: NextRequest, ctx: { params: { provider: string } }) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.redirect(`${platformOrigin()}/login?oauth=failed`);
  }

  // Apple sends the display name exactly once, in the callback body, and never
  // again — not in the ID token, and not on any subsequent sign-in. Miss it
  // here and the account is nameless forever.
  let name: string | null = null;
  const userJson = form.get("user");
  if (typeof userJson === "string") {
    try {
      const parsed = JSON.parse(userJson) as { name?: { firstName?: string; lastName?: string } };
      name = [parsed.name?.firstName, parsed.name?.lastName].filter(Boolean).join(" ") || null;
    } catch {
      /* the name is a nicety; a malformed one must not fail the sign-in */
    }
  }

  return handle(req, ctx, {
    code: typeof form.get("code") === "string" ? String(form.get("code")) : null,
    state: typeof form.get("state") === "string" ? String(form.get("state")) : null,
    error: typeof form.get("error") === "string" ? String(form.get("error")) : null,
    name,
  });
}

type Callback = {
  code: string | null;
  state: string | null;
  error: string | null;
  name: string | null;
};

async function handle(
  req: NextRequest,
  { params }: { params: { provider: string } },
  cb: Callback
): Promise<NextResponse> {
  const origin = platformOrigin();
  const fail = (message: string, state?: OAuthState | null) => {
    const back =
      state?.audience === "customer" && state.slug
        ? `${origin}/r/${state.slug}?signin=${encodeURIComponent(message)}`
        : `${origin}/login?oauth=${encodeURIComponent(message)}`;
    const res = NextResponse.redirect(back);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  };

  if (!isOAuthProvider(params.provider)) return fail("unknown");

  const state = await openState(req.cookies.get(OAUTH_STATE_COOKIE)?.value);
  if (!state || state.provider !== params.provider) {
    return fail("That sign-in expired before it finished. Try again.");
  }
  // The echoed parameter and the sealed cookie must agree. This is the check
  // that makes a callback URL forwarded by someone else inert.
  if (!cb.state || cb.state !== state.nonce) {
    return fail("That sign-in couldn't be verified. Try again.", state);
  }
  if (cb.error || !cb.code) {
    return fail("Sign-in was cancelled.", state);
  }

  const config = providerConfig(params.provider);
  if (!config) return fail("unavailable", state);

  const exchanged = await exchangeCode(config, cb.code, state, origin, cb.name);
  if (!exchanged.ok) return fail(exchanged.error, state);

  return state.audience === "customer"
    ? finishCustomer(exchanged.identity, state, origin)
    : finishStaff(exchanged.identity, state, origin);
}

/* ── Staff ──────────────────────────────────────────────────────────────── */

/**
 * Sign in an operator. **Never creates an account.**
 *
 * The decision itself is `staffLinkDecision`, which is pure and covered by
 * tests; everything here is the lookups it needs and the writes it permits. If
 * you are adding a branch that ends in `setSession`, it belongs in that
 * function, not in this one.
 */
async function finishStaff(
  identity: OAuthIdentity,
  state: OAuthState,
  origin: string
): Promise<NextResponse> {
  const linked = await prisma.oAuthIdentity.findUnique({
    where: { provider_subject: { provider: identity.provider, subject: identity.subject } },
    select: { id: true, userId: true, user: { select: { restaurant: { select: { status: true } } } } },
  });

  const byEmail = identity.email
    ? await prisma.user.findUnique({
        where: { email: identity.email },
        select: { id: true, restaurant: { select: { status: true } } },
      })
    : null;

  const decision = staffLinkDecision(
    identity,
    linked
      ? { userId: linked.userId, suspended: linked.user.restaurant?.status === "SUSPENDED" }
      : null,
    byEmail ? { userId: byEmail.id, suspended: byEmail.restaurant?.status === "SUSPENDED" } : null
  );

  if (decision.kind === "deny") {
    const res = NextResponse.redirect(`${origin}/login?oauth=${encodeURIComponent(decision.reason)}`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  }

  const user = await prisma.user.findUnique({
    where: { id: decision.userId },
    select: { id: true, email: true, role: true, restaurantId: true },
  });
  if (!user) {
    const res = NextResponse.redirect(`${origin}/login?oauth=${encodeURIComponent("That account no longer exists.")}`);
    res.cookies.delete(OAUTH_STATE_COOKIE);
    return res;
  }

  // Record the link on first use, and the visit on every use. Upserted on
  // (provider, subject) so a repeat sign-in is idempotent under a double-tap.
  await prisma.oAuthIdentity.upsert({
    where: { provider_subject: { provider: identity.provider, subject: identity.subject } },
    create: {
      provider: identity.provider,
      subject: identity.subject,
      email: identity.email,
      userId: user.id,
      lastLoginAt: new Date(),
    },
    update: { lastLoginAt: new Date(), email: identity.email },
  });

  await setSession({
    userId: user.id,
    email: user.email,
    role: user.role === "ADMIN" ? "ADMIN" : "OWNER",
    restaurantId: user.restaurantId,
  });
  await recordLogin({ userId: user.id, method: "OAUTH" });

  const home = user.role === "ADMIN" ? "/admin" : "/dashboard";
  const res = NextResponse.redirect(`${origin}${state.next !== "/" ? state.next : home}`);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}

/* ── Customers ──────────────────────────────────────────────────────────── */

/**
 * Sign in a diner, creating the account on first use.
 *
 * The opposite of the staff rule, and safely so: this account can see one
 * person's own orders at one restaurant and nothing else. It is scoped by
 * `restaurantId` from the sealed state — resolved from a slug server-side in
 * the start route, never taken from a parameter.
 *
 * Note what is *not* written: no `Customer` row, no phone number, no consent.
 * A `Customer` is keyed by phone and only checkout can create one, and consent
 * has one door. An account holder who has never ordered is a person we may not
 * text, and this code is why that stays true.
 */
async function finishCustomer(
  identity: OAuthIdentity,
  state: OAuthState,
  origin: string
): Promise<NextResponse> {
  const back = `${origin}/r/${state.slug ?? ""}`;

  if (!state.restaurantId) {
    return NextResponse.redirect(`${origin}/`);
  }

  const account = await prisma.customerAccount.upsert({
    where: {
      restaurantId_provider_subject: {
        restaurantId: state.restaurantId,
        provider: identity.provider,
        subject: identity.subject,
      },
    },
    create: {
      restaurantId: state.restaurantId,
      provider: identity.provider,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      lastLoginAt: new Date(),
    },
    // The name is only refreshed when we actually have one: Apple sends it on
    // the first sign-in and never again, so writing the null back on the second
    // would erase it.
    update: {
      lastLoginAt: new Date(),
      email: identity.email,
      ...(identity.name ? { name: identity.name } : {}),
    },
    select: { id: true, email: true, name: true },
  });

  await setCustomerSession({
    accountId: account.id,
    restaurantId: state.restaurantId,
    email: account.email,
    name: account.name,
  });

  const res = NextResponse.redirect(state.next.startsWith("/r/") ? `${origin}${state.next}` : back);
  res.cookies.delete(OAUTH_STATE_COOKIE);
  return res;
}
