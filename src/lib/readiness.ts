import "server-only";

/**
 * "What is this tenant missing, and does it stop them trading?"
 *
 * One module answers it, for the same reason `lib/entitlements.ts` owns
 * suspensions: the admin home, the tenant page checklist, and the restaurants
 * index all ask the same question, and three implementations would drift until
 * two of them lied.
 *
 * The distinction that matters here is **blocking vs advisory**. A tenant with
 * no menu items cannot take an order — that is a launch blocker and it belongs
 * at the top of somebody's day. A tenant with no custom domain is fine forever;
 * surfacing it with the same weight trains an operator to ignore the list, and
 * an attention list that gets ignored is worse than no list, because it looks
 * like coverage.
 *
 * Everything here is derived. Nothing is cached on the Restaurant row, which is
 * deliberate — `docs/post-order-gaps.md` item 4 is the standing reminder of what
 * happens when a counter and its source disagree.
 *
 * ─── Not to be confused with `lib/onboarding.ts` ──────────────────────────
 *
 * They look like the same module and are not. This one answers **"what should
 * an operator look at?"** across every tenant, including things no owner is
 * ever asked about (no owner login, never launched, no custom domain). It is
 * read-only advice for us, and nothing it returns blocks anybody.
 *
 * `lib/onboarding.ts` answers **"may this specific owner open for business?"**
 * It is a gate with teeth, it covers a deliberately smaller set, and it is
 * pure so it can be tested without a database.
 *
 * The overlap is real — both look at menu items and hours — and the honest
 * reason they aren't merged is that their answers legitimately differ. Hours
 * are `blocking: false` here (an established tenant with no schedule keeps
 * trading, because availability fails open) and required there (a tenant that
 * has never set them must not launch). Collapsing them would force one of
 * those two correct answers to become wrong. If you change what "has a menu"
 * or "has hours" means, change it in both.
 */

import { prisma } from "@/lib/prisma";
import { hasSchedule, parseWeeklyHours } from "@/lib/hours";
import type { Prisma } from "@prisma/client";

export type CheckKey =
  | "owner"
  | "menu"
  | "hours"
  | "payments"
  | "launched"
  | "domain"
  | "branding";

export type Check = {
  key: CheckKey;
  label: string;
  /** True when this is settled and needs nobody's attention. */
  done: boolean;
  /** Blocking checks stop the tenant taking a real order. */
  blocking: boolean;
  /** What an operator would do about it, in the imperative. */
  fix: string;
  /** Where to go and do it. Relative to the tenant's admin page. */
  tab?: string;
};

/** The shape the checks read. Keep in sync with `readinessSelect`. */
export type ReadinessInput = {
  id: string;
  name: string;
  slug: string;
  status: string;
  onboardedAt: Date | null;
  onboardingStep: number;
  hoursJson: Prisma.JsonValue;
  customDomain: string | null;
  domainVerifiedAt: Date | null;
  logoUrl: string | null;
  heroUrl: string | null;
  stripeAccountId: string | null;
  stripeChargesEnabled: boolean;
  cardPaymentsEnabled: boolean;
  _count: { items: number; orders: number; users: number };
};

/** The one `select` every caller uses, so a new check can't silently read null. */
export const readinessSelect = {
  id: true,
  name: true,
  slug: true,
  status: true,
  onboardedAt: true,
  onboardingStep: true,
  hoursJson: true,
  customDomain: true,
  domainVerifiedAt: true,
  logoUrl: true,
  heroUrl: true,
  stripeAccountId: true,
  stripeChargesEnabled: true,
  cardPaymentsEnabled: true,
  _count: { select: { items: true, orders: true, users: true } },
} satisfies Prisma.RestaurantSelect;

export function readinessChecks(r: ReadinessInput): Check[] {
  return [
    {
      key: "owner",
      label: "Owner login",
      done: r._count.users > 0,
      blocking: true,
      // An invited-but-unredeemed tenant has no user rows yet, which is the
      // common case for a brand-new account rather than a fault.
      fix: "Send an invite link so the owner can set their own password.",
      tab: "people",
    },
    {
      key: "menu",
      label: "Menu items",
      done: r._count.items > 0,
      blocking: true,
      fix: "No items means the storefront renders an empty page and no order can be placed.",
    },
    {
      key: "hours",
      label: "Opening hours",
      done: hasSchedule(parseWeeklyHours(r.hoursJson)),
      // Not blocking: lib/hours.ts fails open, so a tenant with no schedule
      // keeps trading. It's still the top cause of "why did we get an order at
      // 3am", so it earns a place on the list.
      blocking: false,
      fix: "No schedule set — ordering never closes. Failing open is intentional, but it's rarely what they want.",
    },
    {
      key: "payments",
      label: "Card payments",
      done: r.stripeChargesEnabled,
      blocking: false,
      fix: r.stripeAccountId
        ? "Connect account exists but charges aren't enabled yet — they haven't finished Stripe's form."
        : "No Stripe account. Generate a Connect link and send it to the owner.",
      tab: "payments",
    },
    {
      key: "branding",
      label: "Logo or hero image",
      done: Boolean(r.logoUrl || r.heroUrl),
      blocking: false,
      fix: "The storefront falls back to a plain header. Fine to launch, worth fixing.",
    },
    {
      key: "launched",
      label: "Finished setup",
      done: Boolean(r.onboardedAt),
      blocking: true,
      fix: `Still in the wizard at step ${Math.min(r.onboardingStep + 1, 4)} of 4.`,
    },
    {
      key: "domain",
      label: "Custom domain",
      // No domain at all is a settled state, not an outstanding task — most
      // tenants never want one. A domain that's been typed but never verified
      // is the actual problem: somebody started and got stuck.
      done: !r.customDomain || Boolean(r.domainVerifiedAt),
      blocking: false,
      fix: "Domain entered but never verified — DNS is probably wrong or was never added.",
      tab: "domain",
    },
  ];
}

export type Readiness = {
  checks: Check[];
  outstanding: Check[];
  blockers: Check[];
  /** 0–1 across every check, for a progress bar. */
  progress: number;
  /** True when nothing blocking is left. */
  canTrade: boolean;
};

export function readiness(r: ReadinessInput): Readiness {
  const checks = readinessChecks(r);
  const outstanding = checks.filter((c) => !c.done);
  const blockers = outstanding.filter((c) => c.blocking);
  return {
    checks,
    outstanding,
    blockers,
    progress: checks.filter((c) => c.done).length / checks.length,
    canTrade: blockers.length === 0,
  };
}

// ---------------------------------------------------------------------------
// Cross-tenant: what needs attention right now
// ---------------------------------------------------------------------------

export type AttentionItem = {
  restaurantId: string;
  name: string;
  slug: string;
  /** Sorts the list. Lower is more urgent. */
  rank: number;
  headline: string;
  detail: string;
  href: string;
};

/**
 * The admin home's first screen.
 *
 * Ordering is by what costs money to leave alone, not by recency:
 * a tenant that can't trade outranks one that's merely quiet. "Quiet" is last
 * on purpose — it's the only signal here that's a guess rather than a fact.
 */
export async function attentionList(): Promise<AttentionItem[]> {
  const weekAgo = new Date(Date.now() - 7 * 864e5);

  const [restaurants, staleInviteTenants, quiet] = await Promise.all([
    prisma.restaurant.findMany({
      where: { status: { not: "SUSPENDED" } },
      select: readinessSelect,
      orderBy: { createdAt: "desc" },
    }),
    // Invited, never accepted, link already dead. Nobody is coming.
    prisma.invite.findMany({
      where: { redeemedAt: null, revokedAt: null, expiresAt: { lt: new Date() } },
      select: { restaurantId: true, email: true, expiresAt: true },
      orderBy: { expiresAt: "desc" },
    }),
    // Tenants that used to trade and stopped. A brand-new account with no
    // orders is not "quiet", it's new — hence the createdAt bound.
    prisma.restaurant.findMany({
      where: {
        status: "ACTIVE",
        onboardedAt: { not: null, lt: weekAgo },
        orders: { none: { createdAt: { gte: weekAgo } } },
      },
      select: { id: true, name: true, slug: true, _count: { select: { orders: true } } },
    }),
  ]);

  const items: AttentionItem[] = [];
  const staleByTenant = new Map(staleInviteTenants.map((i) => [i.restaurantId, i]));

  for (const r of restaurants) {
    const state = readiness(r as ReadinessInput);
    const href = `/admin/restaurants/${r.id}`;

    if (state.blockers.length > 0) {
      const stale = staleByTenant.get(r.id);
      items.push({
        restaurantId: r.id,
        name: r.name,
        slug: r.slug,
        rank: stale ? 0 : 1,
        headline: stale ? "Invite expired, never accepted" : "Can't take orders yet",
        detail: stale
          ? `${stale.email} never set up their login.`
          : state.blockers.map((b) => b.label).join(", ") + " outstanding.",
        href: stale ? `${href}?tab=people` : href,
      });
      continue;
    }

    const domain = state.outstanding.find((c) => c.key === "domain");
    if (domain) {
      items.push({
        restaurantId: r.id,
        name: r.name,
        slug: r.slug,
        rank: 2,
        headline: "Domain never verified",
        detail: `${r.customDomain} is set but DNS hasn't checked out.`,
        href: `${href}?tab=domain`,
      });
    }
  }

  for (const q of quiet) {
    if (q._count.orders === 0) continue; // never traded — that's the blocker list's job
    items.push({
      restaurantId: q.id,
      name: q.name,
      slug: q.slug,
      rank: 3,
      headline: "No orders in 7 days",
      detail: `${q._count.orders} lifetime, nothing this week.`,
      href: `/admin/restaurants/${q.id}`,
    });
  }

  return items.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
