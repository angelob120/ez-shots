import "server-only";

/**
 * Custom-domain mutations — the one door.
 *
 * These moved out of `dashboard/actions.ts` when the admin console needed the
 * same three operations. Two copies of "is this domain live" is how you get a
 * console that reports Verified while the owner's page reports Pending, and the
 * support call that follows can't be resolved by either screen.
 *
 * Every function takes a `restaurantId` and does no auth of its own. The route
 * that calls it is responsible for that: `requireOwner()` on the owner side
 * (scoped to their own tenant), `requireAdmin()` on ours (unscoped, because an
 * admin acts across accounts). Same split as `lib/entitlements.ts`.
 *
 * The flow itself, unchanged:
 *   1. Save the domain → we register it with Cloudflare for SaaS.
 *   2. Owner adds ONE CNAME at their registrar pointing at our fallback origin.
 *      Cloudflare handles ownership validation and issues the cert.
 *   3. Re-check → poll Cloudflare. Only when routing AND cert are both active do
 *      we set `domainVerifiedAt`, so "Live" never lies.
 */

import { prisma } from "@/lib/prisma";
import { normalizeCustomDomain, generateVerifyToken, domainVariants } from "@/lib/domains";
import { verifyDomainChallenge } from "@/lib/domains-server";
import {
  cloudflareEnabled,
  createCustomHostname,
  deleteCustomHostname,
  findCustomHostname,
  getCustomHostname,
  isLive,
  pendingReason,
  fallbackOrigin,
} from "@/lib/cloudflare";

export type DomainResult = { error?: string; ok?: string };

export async function saveDomain(restaurantId: string, raw: string): Promise<DomainResult> {
  const domain = normalizeCustomDomain(raw);
  if (!domain) return { error: "Enter a valid domain, like orders.yourrestaurant.com." };

  // normalizeCustomDomain quietly drops a leading "www." Saying so beats
  // someone wondering why they asked for www and got the bare domain.
  const strippedWww = /^\s*(https?:\/\/)?www\./i.test(raw);

  const taken = await prisma.restaurant.findFirst({
    where: { customDomain: domain, NOT: { id: restaurantId } },
    select: { id: true, name: true },
  });
  if (taken) {
    return { error: `That domain is already connected to ${taken.name}.` };
  }

  const current = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      customDomain: true,
      domainVerifyToken: true,
      cfHostnameId: true,
      cfWwwHostnameId: true,
    },
  });
  const sameDomain = current?.customDomain === domain;

  const { www } = domainVariants(domain);
  const wwwNote = www
    ? ` We register ${www} alongside it, so both work — one CNAME each.`
    : strippedWww
      ? ` Using ${domain} — "www" isn't a separate record on a subdomain.`
      : "";

  // Nothing to do on a re-save — keep the pending record so DNS that's already
  // been added stays valid.
  if (sameDomain && current?.cfHostnameId) {
    return { ok: `Domain saved. Add the CNAME, then re-check.${wwwNote}` };
  }

  // Changing domains: retire the old Cloudflare hostnames so we don't leak
  // registrations (they're billable above the free tier). Both of them —
  // the www twin is just as billable and just as orphaned.
  if (!sameDomain && cloudflareEnabled()) {
    if (current?.cfHostnameId) await deleteCustomHostname(current.cfHostnameId);
    if (current?.cfWwwHostnameId) await deleteCustomHostname(current.cfWwwHostnameId);
  }

  const token =
    sameDomain && current?.domainVerifyToken ? current.domainVerifyToken : generateVerifyToken();

  if (!cloudflareEnabled()) {
    // Degrade to the legacy TXT flow rather than hard-failing.
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        customDomain: domain,
        domainVerifyToken: token,
        domainVerifiedAt: sameDomain ? undefined : null,
        cfHostnameId: null,
        cfStatus: null,
        cfSslStatus: null,
      },
    });
    return { ok: `Domain saved. Add the DNS records, then verify.${wwwNote}` };
  }

  const created = await createCustomHostname(domain);
  if (!created.ok) return { error: `Couldn't register that domain: ${created.error}` };

  // The www twin is best effort. If Cloudflare refuses it we still have a
  // working apex, and failing the whole save over the convenience hostname
  // would strand the tenant with no domain at all rather than most of one.
  let wwwHostname: { id: string; status: string; sslStatus: string } | null = null;
  if (www) {
    const madeWww = await createCustomHostname(www);
    if (madeWww.ok) {
      wwwHostname = {
        id: madeWww.hostname.id,
        status: madeWww.hostname.status,
        sslStatus: madeWww.hostname.sslStatus,
      };
    } else {
      console.error(`[domains] couldn't register ${www}: ${madeWww.error}`);
    }
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      customDomain: domain,
      domainVerifyToken: token,
      domainVerifiedAt: null,
      cfHostnameId: created.hostname.id,
      cfStatus: created.hostname.status,
      cfSslStatus: created.hostname.sslStatus,
      cfWwwHostnameId: wwwHostname?.id ?? null,
      cfWwwStatus: wwwHostname?.status ?? null,
      cfWwwSslStatus: wwwHostname?.sslStatus ?? null,
    },
  });

  return { ok: `Domain saved. Add the CNAME, then re-check.${wwwNote}` };
}

export async function recheckDomain(restaurantId: string): Promise<DomainResult> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      customDomain: true,
      domainVerifyToken: true,
      domainVerifiedAt: true,
      cfHostnameId: true,
      cfWwwHostnameId: true,
    },
  });
  if (!r?.customDomain) return { error: "Add a domain first." };

  // Self-heal: Cloudflare IS configured but we have no hostname id — either
  // this record predates the integration, or registration failed at save time.
  // Register (or re-attach) now. Without this we'd fall through to the TXT
  // check below, which can report "Live" for a hostname Cloudflare has never
  // seen — the domain then serves nothing, and the console lies about it.
  if (cloudflareEnabled() && !r.cfHostnameId) {
    const existing = await findCustomHostname(r.customDomain);
    if (!existing.ok) return { error: `Cloudflare: ${existing.error}` };

    let cf = existing.hostname;
    if (!cf) {
      const created = await createCustomHostname(r.customDomain);
      if (!created.ok) return { error: `Couldn't register with Cloudflare: ${created.error}` };
      cf = created.hostname;
    }

    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: {
        cfHostnameId: cf.id,
        cfStatus: cf.status,
        cfSslStatus: cf.sslStatus,
        // A hostname Cloudflare doesn't consider live is not live, whatever a
        // previous TXT-only check may have written.
        domainVerifiedAt: isLive(cf) ? r.domainVerifiedAt ?? new Date() : null,
      },
    });

    if (isLive(cf)) return { ok: "Verified — the domain is live." };
    return { error: pendingReason(cf, fallbackOrigin()) };
  }

  // Legacy path — only when Cloudflare genuinely isn't configured.
  if (!cloudflareEnabled()) {
    if (!r.domainVerifyToken) return { error: "Add a domain first." };
    if (r.domainVerifiedAt) return { ok: "Domain is already verified and live." };
    const result = await verifyDomainChallenge(r.customDomain, r.domainVerifyToken);
    if (!result.ok) return { error: result.reason ?? "Couldn't verify the domain yet." };
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { domainVerifiedAt: new Date() },
    });
    // Deliberately not "live" — a TXT record proves ownership, not routing.
    return { ok: "Ownership verified. Routing isn't managed yet — finish setup manually." };
  }

  if (!r.cfHostnameId) return { error: "Cloudflare isn't configured for this domain." };

  const got = await getCustomHostname(r.cfHostnameId);
  if (!got.ok) return { error: got.error };

  const h = got.hostname;
  const live = isLive(h);

  // The www twin, if there is one. Self-heals a registration that failed at
  // save time, since that path is best effort by design.
  const { www } = domainVariants(r.customDomain);
  let wwwState: { id: string; status: string; sslStatus: string } | null = null;
  if (www) {
    const found = r.cfWwwHostnameId
      ? await getCustomHostname(r.cfWwwHostnameId)
      : await createCustomHostname(www);
    if (found.ok && found.hostname) {
      wwwState = {
        id: found.hostname.id,
        status: found.hostname.status,
        sslStatus: found.hostname.sslStatus,
      };
    }
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      cfStatus: h.status,
      cfSslStatus: h.sslStatus,
      cfWwwHostnameId: wwwState?.id ?? r.cfWwwHostnameId,
      cfWwwStatus: wwwState?.status ?? null,
      cfWwwSslStatus: wwwState?.sslStatus ?? null,
      // Only verified when routing AND cert are both active on the *primary*.
      // The www twin deliberately doesn't gate this: a tenant whose apex is
      // serving shouldn't be held back because a convenience hostname is still
      // issuing a certificate.
      domainVerifiedAt: live ? r.domainVerifiedAt ?? new Date() : null,
    },
  });

  if (!live) return { error: pendingReason(h, fallbackOrigin()) };

  const wwwLagging = wwwState && !(wwwState.status === "active" && wwwState.sslStatus === "active");
  return {
    ok: wwwLagging
      ? `Verified — ${r.customDomain} is live. ${www} is still coming up at the edge; it needs its own CNAME.`
      : "Verified — the domain is live.",
  };
}

export async function clearDomain(restaurantId: string): Promise<void> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { cfHostnameId: true, cfWwwHostnameId: true },
  });
  if (cloudflareEnabled()) {
    // Both, or the www twin becomes an orphaned billable registration nothing
    // in the app knows about any more.
    if (r?.cfHostnameId) await deleteCustomHostname(r.cfHostnameId);
    if (r?.cfWwwHostnameId) await deleteCustomHostname(r.cfWwwHostnameId);
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      customDomain: null,
      domainVerifyToken: null,
      domainVerifiedAt: null,
      cfHostnameId: null,
      cfStatus: null,
      cfSslStatus: null,
      cfWwwHostnameId: null,
      cfWwwStatus: null,
      cfWwwSslStatus: null,
    },
  });
}

/**
 * Everything a console needs to render domain state for one tenant, including
 * the two things that fail independently: our verification record and
 * Cloudflare's edge state. "Verified with us" and "active at the edge" are
 * different failures with the same symptom, which is why both are shown.
 */
export type DomainView = {
  domain: string | null;
  verifiedAt: Date | null;
  challengeToken: string | null;
  cfHostnameId: string | null;
  cfStatus: string | null;
  cfSslStatus: string | null;
  /** The `www.` twin, when the domain is an apex. Null for subdomains. */
  wwwDomain: string | null;
  cfWwwStatus: string | null;
  cfWwwSslStatus: string | null;
  cloudflare: boolean;
  cnameTarget: string;
};

export async function domainView(restaurantId: string): Promise<DomainView> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      customDomain: true,
      domainVerifiedAt: true,
      domainVerifyToken: true,
      cfHostnameId: true,
      cfStatus: true,
      cfSslStatus: true,
      cfWwwStatus: true,
      cfWwwSslStatus: true,
    },
  });

  return {
    domain: r?.customDomain ?? null,
    verifiedAt: r?.domainVerifiedAt ?? null,
    challengeToken: r?.domainVerifyToken ?? null,
    cfHostnameId: r?.cfHostnameId ?? null,
    cfStatus: r?.cfStatus ?? null,
    cfSslStatus: r?.cfSslStatus ?? null,
    wwwDomain: r?.customDomain ? domainVariants(r.customDomain).www : null,
    cfWwwStatus: r?.cfWwwStatus ?? null,
    cfWwwSslStatus: r?.cfWwwSslStatus ?? null,
    cloudflare: cloudflareEnabled(),
    cnameTarget: fallbackOrigin(),
  };
}
