import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { platformOrigin } from "@/lib/domains";
import { sealState } from "@/lib/oauth-server";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_MAX_AGE,
  authorizeUrl,
  isOAuthProvider,
  providerConfig,
  randomToken,
  safeNextPath,
  type OAuthAudience,
  type OAuthState,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";

/**
 * Begin a Google or Apple sign-in.
 *
 * Everything that decides what the sign-in *means* is settled here and sealed
 * into the state cookie — audience, tenant, and where to land afterwards. The
 * callback then reads them from a signed cookie rather than from a query
 * string, so none of it is attacker-controlled by the time it is acted on.
 *
 * The flow always runs on the platform origin. A tenant's custom domain cannot
 * be pre-registered with Google or Apple (they are bring-your-own), and the
 * state cookie set on one host is not sent back to another — so starting on a
 * custom domain fails twice over. Customer sign-ins carry their slug in the
 * state and are redirected home at the end.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { provider: string } }
) {
  const origin = platformOrigin();

  if (!isOAuthProvider(params.provider)) {
    return NextResponse.redirect(`${origin}/login?oauth=unknown`);
  }
  const config = providerConfig(params.provider);
  if (!config) {
    // Not configured on this deployment. Never a crash — a missing credential
    // should mean "that button isn't offered", not a 500 on the login page.
    return NextResponse.redirect(`${origin}/login?oauth=unavailable`);
  }

  const url = new URL(req.url);
  const audience: OAuthAudience = url.searchParams.get("as") === "customer" ? "customer" : "staff";
  const slug = url.searchParams.get("slug")?.trim().toLowerCase() ?? "";

  let restaurantId: string | undefined;
  let resolvedSlug: string | undefined;

  if (audience === "customer") {
    if (!slug) return NextResponse.redirect(`${origin}/`);
    // Resolved server-side from the slug, exactly as the analytics beacon does:
    // accepting a restaurantId from the query would let anyone mint a session
    // pointed at a tenant they were never on.
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
    if (!restaurant || restaurant.status === "SUSPENDED") {
      return NextResponse.redirect(`${origin}/`);
    }
    restaurantId = restaurant.id;
    resolvedSlug = restaurant.slug;
  }

  const state: OAuthState = {
    provider: params.provider,
    audience,
    nonce: randomToken(24),
    verifier: randomToken(32),
    next: safeNextPath(
      url.searchParams.get("next"),
      audience === "customer" ? `/r/${resolvedSlug}` : "/dashboard"
    ),
    restaurantId,
    slug: resolvedSlug,
  };

  const target = await authorizeUrl(config, state, origin);
  const res = NextResponse.redirect(target);

  res.cookies.set(OAUTH_STATE_COOKIE, await sealState(state), {
    httpOnly: true,
    // Apple posts the callback back cross-site as a form, and a Lax cookie is
    // not sent on a cross-site POST — so the state would be missing on every
    // Apple sign-in. `none` is the necessary value there; the cookie is signed,
    // carries its own expiry, and is compared against the echoed `state`
    // parameter, which is what actually defends the callback.
    //
    // Google comes back as a top-level GET, where `lax` works and is stricter,
    // so it keeps it. `none` also requires `secure`, which would break Google
    // sign-in over plain http in local development.
    sameSite: params.provider === "apple" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth",
    maxAge: OAUTH_STATE_MAX_AGE,
  });

  return res;
}
