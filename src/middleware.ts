import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/session";
import { customDomainFromHost, DOMAIN_HEADER, TENANT_HOST_HEADER } from "@/lib/domains";

// Paths that must never be rewritten onto a tenant, even on a custom domain:
// framework internals, our own APIs, and static assets.
function isPassThrough(pathname: string): boolean {
  return (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname === "/sw.js" ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname.startsWith("/icon-") ||
    /\.[a-z0-9]+$/i.test(pathname) // any file with an extension (images, etc.)
  );
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── Custom-domain routing ────────────────────────────────────────────
  // A request whose Host isn't one of ours belongs to a tenant. Serve their
  // store from the site root by rewriting onto /r/<domain>; the store page
  // resolves the tenant by customDomain (and only if verified).
  // Prefer the tenant hostname Cloudflare preserved for us; fall back to Host
  // for local dev and any request that didn't pass through the proxy.
  const domain = customDomainFromHost(
    req.headers.get(TENANT_HOST_HEADER) ?? req.headers.get("host")
  );
  if (domain) {
    if (isPassThrough(pathname)) return NextResponse.next();

    // The order status page is served as-is, not rewritten onto the tenant
    // tree. There is no /r/[slug]/o/[token] route, so rewriting would 404 —
    // and it shouldn't exist: /o/[token] is already tenant-scoped by the token,
    // which resolves the order and its restaurant on its own.
    //
    // DOMAIN_HEADER is still set, because the page has to know it's on a
    // custom domain to link back to the store at "/" rather than "/r/<slug>".
    //
    // Set on the *request* headers rather than the response: there's no
    // rewrite here to carry them, and the request form is what `headers()`
    // reads in the route.
    // Unsubscribe gets the same treatment as order status, and for a stronger
    // reason. `unsubscribeUrl()` always mints these on the platform origin, so
    // this branch should be unreachable — but a link that has been forwarded,
    // copied, or rewritten by a mail client must still work, and an unsubscribe
    // that 404s is the exact failure that turns a reader into a spam complaint.
    // The token resolves the customer on its own; there is no tenant tree to
    // rewrite onto.
    if (pathname.startsWith("/o/") || pathname.startsWith("/u/")) {
      const forwarded = new Headers(req.headers);
      forwarded.set(DOMAIN_HEADER, domain);
      return NextResponse.next({ request: { headers: forwarded } });
    }

    const url = req.nextUrl.clone();
    url.pathname = pathname === "/" ? `/r/${domain}` : `/r/${domain}${pathname}`;

    const res = NextResponse.rewrite(url);
    res.headers.set(DOMAIN_HEADER, domain);
    return res;
  }

  // ── Platform (primary host) auth guards ──────────────────────────────
  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (
    pathname.startsWith("/admin") ||
    pathname.startsWith("/dashboard") ||
    pathname.startsWith("/onboarding")
  ) {
    if (!session) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    if (pathname.startsWith("/admin") && session.role !== "ADMIN") {
      return NextResponse.redirect(new URL("/dashboard", req.url));
    }
    if (pathname.startsWith("/dashboard") && !session.restaurantId) {
      return NextResponse.redirect(new URL("/admin", req.url));
    }
  }

  // Onboarding is an owner surface; admins have nothing to do there.
  if (pathname.startsWith("/onboarding") && session && !session.restaurantId) {
    return NextResponse.redirect(new URL("/admin", req.url));
  }

  if ((pathname === "/login" || pathname === "/signup") && session) {
    return NextResponse.redirect(new URL(session.role === "ADMIN" ? "/admin" : "/dashboard", req.url));
  }

  // Stamp the pathname onto the request so the requireAdmin/requireOwner guards
  // can record it as operator activity. Query strings are deliberately left off
  // — they can carry a token or a customer email, and the activity log has no
  // business storing either. Only the guarded operator surfaces are stamped;
  // everything else the guards ignore anyway.
  if (
    session &&
    (pathname.startsWith("/admin") ||
      pathname.startsWith("/dashboard") ||
      pathname.startsWith("/onboarding"))
  ) {
    const forwarded = new Headers(req.headers);
    forwarded.set("x-hearth-path", pathname);
    forwarded.set("x-hearth-method", req.method);
    return NextResponse.next({ request: { headers: forwarded } });
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except Next internals and static files so custom-domain
  // hosts can be rewritten at the root. The auth logic still only fires on the
  // guarded prefixes above.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js).*)"],
};
