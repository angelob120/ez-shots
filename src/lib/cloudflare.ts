import "server-only";

/**
 * Cloudflare for SaaS — custom hostname management.
 *
 * The tenant points ONE CNAME at our fallback origin. Cloudflare terminates
 * TLS for their hostname (issuing a per-hostname cert automatically) and
 * proxies to our Railway service. Nothing has to be registered in Railway per
 * tenant, so owners never need access to our hosting account.
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN  — token with Zone:SSL and Certificates:Edit on the zone
 *   CLOUDFLARE_ZONE_ID    — the zone that owns the fallback origin
 *   HEARTH_FALLBACK_ORIGIN — e.g. "origin.hearth.app" (shown to tenants)
 */

const API = "https://api.cloudflare.com/client/v4";

export function fallbackOrigin(): string {
  return process.env.HEARTH_FALLBACK_ORIGIN ?? "";
}

/** True when Cloudflare is wired up. Lets the app degrade gracefully. */
export function cloudflareEnabled(): boolean {
  return Boolean(
    process.env.CLOUDFLARE_API_TOKEN &&
      process.env.CLOUDFLARE_ZONE_ID &&
      process.env.HEARTH_FALLBACK_ORIGIN
  );
}

export type CustomHostname = {
  id: string;
  hostname: string;
  /** Ownership/routing status: pending | active | active_redeploying | moved | deleted | blocked */
  status: string;
  /** Cert status: initializing | pending_validation | active | ... */
  sslStatus: string;
  /** Present while Cloudflare still needs a DNS record to prove ownership. */
  ownership?: { name: string; value: string } | null;
};

type CfEnvelope<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  result: T;
};

async function cf<T>(
  path: string,
  init: RequestInit = {}
): Promise<{ ok: true; result: T } | { ok: false; error: string }> {
  const zone = process.env.CLOUDFLARE_ZONE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!zone || !token) return { ok: false, error: "Cloudflare is not configured." };

  let res: Response;
  try {
    res = await fetch(`${API}/zones/${zone}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
    });
  } catch {
    // Network-level failure — never let this bubble as an unhandled rejection.
    return { ok: false, error: "Couldn't reach Cloudflare. Try again shortly." };
  }

  let body: CfEnvelope<T>;
  try {
    body = (await res.json()) as CfEnvelope<T>;
  } catch {
    return { ok: false, error: `Cloudflare returned an unreadable response (${res.status}).` };
  }

  if (!body.success) {
    const msg = body.errors?.map((e) => e.message).join("; ") || `Request failed (${res.status}).`;
    return { ok: false, error: msg };
  }
  return { ok: true, result: body.result };
}

type RawHostname = {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string };
  ownership_verification?: { name?: string; value?: string };
  ownership_verification_http?: { http_url?: string; http_body?: string };
};

function shape(r: RawHostname): CustomHostname {
  const own = r.ownership_verification;
  return {
    id: r.id,
    hostname: r.hostname,
    status: r.status,
    sslStatus: r.ssl?.status ?? "unknown",
    ownership: own?.name && own?.value ? { name: own.name, value: own.value } : null,
  };
}

/**
 * Register a tenant hostname. Uses HTTP domain-control validation, which
 * completes on its own once the tenant's CNAME resolves to our fallback
 * origin — so the tenant only ever adds a single DNS record.
 */
export async function createCustomHostname(hostname: string) {
  const r = await cf<RawHostname>("/custom_hostnames", {
    method: "POST",
    body: JSON.stringify({
      hostname,
      ssl: {
        method: "http",
        type: "dv",
        settings: { min_tls_version: "1.2" },
      },
    }),
  });
  return r.ok ? { ok: true as const, hostname: shape(r.result) } : r;
}

export async function getCustomHostname(id: string) {
  const r = await cf<RawHostname>(`/custom_hostnames/${id}`);
  return r.ok ? { ok: true as const, hostname: shape(r.result) } : r;
}

/** Look up by hostname — used to recover if we lost the stored id. */
export async function findCustomHostname(hostname: string) {
  const r = await cf<RawHostname[]>(
    `/custom_hostnames?hostname=${encodeURIComponent(hostname)}`
  );
  if (!r.ok) return r;
  const first = r.result?.[0];
  return { ok: true as const, hostname: first ? shape(first) : null };
}

export async function deleteCustomHostname(id: string) {
  const r = await cf<unknown>(`/custom_hostnames/${id}`, { method: "DELETE" });
  return r.ok ? { ok: true as const } : r;
}

/** Fully live = routing active AND cert issued. Both must be true. */
export function isLive(h: CustomHostname): boolean {
  return h.status === "active" && h.sslStatus === "active";
}

/** Human-readable explanation of why a hostname isn't live yet. */
export function pendingReason(h: CustomHostname, origin: string): string {
  if (h.status !== "active") {
    return `Waiting on DNS. Point ${h.hostname} at ${origin} with a CNAME — we check automatically, and it usually takes a few minutes.`;
  }
  if (h.sslStatus !== "active") {
    return "DNS looks right. Issuing the SSL certificate now — this usually finishes within a few minutes.";
  }
  return "Almost there.";
}
