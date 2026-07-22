/**
 * host-rewrite — Cloudflare Worker
 *
 * Cloudflare for SaaS terminates TLS for tenant custom hostnames and forwards
 * the request to our fallback origin with the tenant's Host intact
 * (`Host: order.ezleadz.io`). Railway's router only recognises hostnames
 * registered on the service, so it answers with its own "Not Found" page
 * before our app ever runs.
 *
 * This Worker sits in front of that hop and does two things:
 *
 *   1. Rewrites the outbound request to the Railway hostname, so Railway
 *      recognises it and routes to our service.
 *   2. Stashes the hostname the visitor actually typed in `x-tenant-host`,
 *      which `src/middleware.ts` reads to resolve the tenant.
 *
 * On paid plans this would be an Origin Rule (Host Header) plus a Transform
 * Rule. Both are gated above Free, so we do it in ~30 lines instead.
 *
 * Route: `*​/*` on the blueobsidian.xyz zone. A hostname-specific route would
 * NOT work — Worker routes match the request URL, and for custom-hostname
 * traffic that URL is the tenant's domain, not our fallback origin.
 */

export interface Env {
  /** Railway service hostname, e.g. hearth-production-1ce0.up.railway.app */
  RAILWAY_HOST: string;
  /** Comma-separated hosts that are the platform itself, not a tenant. */
  PLATFORM_HOSTS: string;
}

/** Header carrying the original hostname. Must match TENANT_HOST_HEADER. */
const TENANT_HOST_HEADER = "x-tenant-host";

function splitHosts(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();

    const headers = new Headers(request.headers);

    // Never trust a client-supplied value. Anyone can send this header; only
    // the value we set below is meaningful, so strip it unconditionally first.
    headers.delete(TENANT_HOST_HEADER);

    const platformHosts = [
      ...splitHosts(env.PLATFORM_HOSTS),
      env.RAILWAY_HOST.toLowerCase(),
    ];

    // Platform traffic (marketing site, dashboard, admin, the fallback origin
    // itself) already reaches Railway under a Host it recognises. Pass it
    // through untouched — but with the spoofed header removed.
    if (platformHosts.includes(host)) {
      return fetch(new Request(url.toString(), { ...requestInit(request), headers }));
    }

    // Tenant custom domain. Point the subrequest at Railway (which sets Host
    // for us) and carry the original hostname forward.
    headers.set(TENANT_HOST_HEADER, host);

    // Next.js guards Server Actions by comparing the `Origin` header against
    // `x-forwarded-host`. Rewriting Host without rewriting Origin breaks that
    // comparison for every POST — the action aborts with "Invalid Server
    // Actions request" and the page renders a 500.
    //
    // So carry Origin (and Referer) across the rewrite too. This preserves the
    // CSRF protection rather than defeating it: we only rewrite when the
    // request is SAME-ORIGIN — Origin's hostname equals the hostname the
    // visitor is on. A genuine cross-site POST carries some other Origin,
    // which we leave untouched so Next still rejects it.
    rewriteSameOrigin(headers, "origin", host, env.RAILWAY_HOST);
    rewriteSameOrigin(headers, "referer", host, env.RAILWAY_HOST);

    url.hostname = env.RAILWAY_HOST;
    url.protocol = "https:";
    url.port = "";

    return fetch(new Request(url.toString(), { ...requestInit(request), headers }));
  },
} satisfies ExportedHandler<Env>;

/**
 * Swap `visitorHost` for `railwayHost` in a URL-valued header, but ONLY if the
 * header already points at `visitorHost`. Anything else (a cross-site Origin,
 * a malformed value, an absent header) is left exactly as-is.
 */
function rewriteSameOrigin(
  headers: Headers,
  name: "origin" | "referer",
  visitorHost: string,
  railwayHost: string
): void {
  const raw = headers.get(name);
  if (!raw || raw === "null") return;

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return; // Not a URL we can reason about — leave Next.js to reject it.
  }

  if (parsed.hostname.toLowerCase() !== visitorHost) return; // Cross-site.

  parsed.hostname = railwayHost;
  parsed.protocol = "https:";
  parsed.port = "";
  headers.set(name, name === "origin" ? parsed.origin : parsed.toString());
}

function requestInit(request: Request): RequestInit {
  return {
    method: request.method,
    body: request.body,
    // Let the app's own redirects reach the browser instead of being followed
    // here — Next.js auth guards rely on 307s.
    redirect: "manual",
  };
}
