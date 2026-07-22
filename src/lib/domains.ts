/**
 * Custom-domain helpers. Everything here is edge-safe (no node built-ins, no
 * Prisma) so it can be imported from middleware. DNS verification lives in
 * `domains-server.ts`, which is server-only.
 */

/** DNS label a tenant publishes the ownership challenge under. */
export const DOMAIN_CHALLENGE_PREFIX = "_hearth-challenge";

/** Header the middleware sets when serving a request from a tenant's custom
 * domain, so store surfaces know to use site-root PWA paths. */
export const DOMAIN_HEADER = "x-hearth-domain";

/**
 * Header carrying the ORIGINAL hostname the visitor typed.
 *
 * Railway's router rejects any Host it doesn't have registered, so Cloudflare
 * rewrites Host to our Railway hostname before forwarding and stashes the real
 * one here. Without this the tenant's hostname is lost by the time the request
 * reaches us.
 *
 * That rewrite is done by the `hearth-host-rewrite` Worker (see
 * `workers/host-rewrite/`). The Origin Rule + Transform Rule pair that would
 * normally do this is Enterprise-only, and Snippets are Pro+; a Worker is the
 * one mechanism available on the Free plan.
 *
 * SECURITY: this header is client-settable, so it is only meaningful because
 * the Worker deletes any inbound value before setting its own. Trust it only
 * on requests that came through our Cloudflare zone — never on a request that
 * reached Railway directly on the *.up.railway.app hostname.
 */
export const TENANT_HOST_HEADER = "x-tenant-host";

/**
 * Hostnames that belong to the platform itself, not to a tenant. Requests to
 * these are served normally (marketing site, dashboards, admin). Everything
 * else is treated as a bring-your-own custom domain.
 *
 * Set PRIMARY_DOMAIN (comma-separated) in the environment to your apex + www.
 */
function primaryHosts(): string[] {
  const fromEnv = (process.env.PRIMARY_DOMAIN ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  return [...fromEnv, "localhost", "127.0.0.1"];
}

/** Strip port, lowercase, drop a trailing dot. */
export function normalizeHost(host: string | null | undefined): string {
  if (!host) return "";
  return host
    .split(":")[0]
    .trim()
    .toLowerCase()
    .replace(/\.$/, "");
}

/**
 * Validate + normalize a domain an owner typed into the dashboard. Returns the
 * clean hostname, or null if it doesn't look like a domain. Accepts a pasted
 * URL and pulls the host out of it.
 */
export function normalizeCustomDomain(input: string): string | null {
  let v = (input ?? "").trim().toLowerCase();
  if (!v) return null;
  // Tolerate a pasted URL.
  v = v.replace(/^https?:\/\//, "").split("/")[0];
  v = normalizeHost(v);
  // Strip a leading "www." — we route the apex and www is added at DNS/host.
  v = v.replace(/^www\./, "");
  // Basic hostname shape: labels of a–z/0–9/hyphen, at least one dot, a TLD.
  const ok = /^(?=.{1,253}$)([a-z0-9](-?[a-z0-9])*\.)+[a-z]{2,}$/.test(v);
  if (!ok) return null;
  return v;
}

/**
 * Is a hostname an apex (`theirplace.com`) rather than a subdomain
 * (`order.theirplace.com`)?
 *
 * Naive label-counting, and knowingly so: it calls `theirplace.co.uk` a
 * subdomain because the alternative is shipping a copy of the public suffix
 * list. The only consequence is that such a tenant doesn't get an automatic
 * `www` twin — a missing convenience, not a broken domain — and the cost of
 * being wrong the other way (registering `www.theirplace.co.uk` for someone who
 * asked for the apex of a multi-part TLD) is a billable Cloudflare hostname
 * nobody uses.
 */
export function isApexDomain(domain: string): boolean {
  return normalizeHost(domain).split(".").length === 2;
}

/**
 * Every hostname we should hold a certificate for, given what the owner typed.
 *
 * Routing already tolerates `www` — `customDomainFromHost` strips it before
 * matching — but Cloudflare for SaaS issues a cert *per hostname*. Registering
 * only the bare domain means a customer who types `www.theirplace.com` gets a
 * browser security warning on the restaurant's own domain, which is a worse
 * outcome than the restaurant never having bought one.
 *
 * Only apexes get the twin. Nobody types `www.order.theirplace.com`, and each
 * registration is billable above Cloudflare's free tier.
 */
export function domainVariants(domain: string): { primary: string; www: string | null } {
  const primary = normalizeHost(domain);
  return { primary, www: isApexDomain(primary) ? `www.${primary}` : null };
}

/**
 * Is this incoming Host header one of ours (platform), or a tenant's custom
 * domain? Railway/preview hosts count as platform so previews keep working.
 */
export function isPrimaryHost(host: string | null | undefined): boolean {
  const h = normalizeHost(host);
  if (!h) return true; // no host → don't treat as custom
  if (primaryHosts().includes(h)) return true;
  if (h.endsWith(".railway.app") || h.endsWith(".up.railway.app")) return true;
  if (h.endsWith(".vercel.app")) return true;
  return false;
}

/** A tenant's custom domain if this host is one; otherwise null. */
export function customDomainFromHost(host: string | null | undefined): string | null {
  const h = normalizeHost(host);
  if (!h || isPrimaryHost(h)) return null;
  return h.replace(/^www\./, "");
}

/**
 * Prisma `where` that resolves a store from the `/r/[slug]` segment, which is
 * either a real slug or — when a request came in on a custom domain — the
 * hostname the middleware rewrote in. Custom domains only match once verified.
 */
export function tenantWhere(param: string) {
  const p = decodeURIComponent(param).toLowerCase();
  return {
    OR: [{ slug: param }, { customDomain: p, domainVerifiedAt: { not: null } }],
  };
}

// ---------------------------------------------------------------------------
// Canonical origin
// ---------------------------------------------------------------------------

/** Add a scheme if the configured value is a bare hostname. */
function withScheme(host: string): string {
  const h = host.trim().replace(/\/+$/, "");
  if (!h) return "";
  if (h.startsWith("http://") || h.startsWith("https://")) return h;
  // localhost is the one place a dev server isn't on TLS.
  return `${h.startsWith("localhost") || h.startsWith("127.0.0.1") ? "http" : "https"}://${h}`;
}

/**
 * Our own public origin — what a tenant without a custom domain gets.
 *
 * APP_URL leads because it is the one value an operator sets deliberately and
 * `scripts/config-check.mjs` already refuses to boot without it once SMS is
 * live. PRIMARY_DOMAIN is a routing list that happens to start with the public
 * host; Railway's domain is a last resort so previews stay usable.
 *
 * Deliberately NOT the Cloudflare fallback origin. That hostname exists so
 * tenants have something to point a CNAME at, and printing it on a customer's
 * receipt would leak a routing detail as if it were a brand.
 */
export function platformOrigin(): string {
  const raw =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.PRIMARY_DOMAIN ?? "").split(",")[0].trim() ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    "";
  return withScheme(raw);
}

/** The bit of a restaurant that decides which origin its links carry. */
export type OriginShape = {
  customDomain?: string | null;
  domainVerifiedAt?: Date | string | null;
};

/**
 * The one answer to "what host do this tenant's links use".
 *
 * A verified custom domain is the tenant's canonical origin, not an alias: the
 * owner bought a domain so their customers would see it, and a status link that
 * still prints our host makes their receipts advertise us instead of them.
 *
 * Verification is the gate rather than mere presence, because an unverified
 * domain is a hostname somebody typed into a form — emitting links to it sends
 * customers somewhere that does not resolve.
 *
 * Returns "" when nothing is configured at all. Callers that need an absolute
 * URL must handle that; a bare path is readable in a logged stub message and
 * useless in a real text, which is the distinction `config-check.mjs` grades.
 */
export function canonicalOrigin(restaurant: OriginShape | null | undefined): string {
  const domain = restaurant?.customDomain ? normalizeHost(restaurant.customDomain) : "";
  if (domain && restaurant?.domainVerifiedAt) return `https://${domain}`;
  return platformOrigin();
}

/**
 * Absolute URL for a path on a tenant's canonical origin. Falls back to the
 * path alone when no origin is configured.
 */
export function canonicalUrl(restaurant: OriginShape | null | undefined, path: string): string {
  const origin = canonicalOrigin(restaurant);
  return origin ? `${origin}${path}` : path;
}

/** URL-safe random token for the DNS ownership challenge. */
export function generateVerifyToken(): string {
  // Web Crypto is available on both edge and node runtimes.
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return `hearth-verify=${s}`;
}
