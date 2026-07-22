"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

export const TABS = [
  { key: "overview", label: "Overview" },
  // The manual onboarding checklist — the operator's own step-by-step for taking
  // a tenant live, with saved state and notes. Sits high because a brand-new
  // account is the common reason to open this page at all.
  { key: "onboarding", label: "Onboarding" },
  // Two note streams, each its own tab: working notes while we get a tenant
  // live, and ongoing account notes once they're trading. Same table, split by
  // kind — see lib/onboarding-checklist.ts.
  { key: "onboarding-notes", label: "Onboarding notes" },
  { key: "account-notes", label: "Account notes" },
  // Analytics sits second because it answers the question an admin most often
  // opens a tenant *for* — "are they actually trading?" — which used to mean
  // navigating away to /admin/analytics, picking them out of a dropdown, and
  // losing the tenant context you were already in.
  { key: "analytics", label: "Analytics" },
  { key: "links", label: "Links" },
  { key: "people", label: "People" },
  { key: "domain", label: "Domain" },
  { key: "payments", label: "Payments" },
  { key: "pricing", label: "Pricing" },
  { key: "services", label: "Services" },
  { key: "danger", label: "Danger zone" },
] as const;

export type TabKey = (typeof TABS)[number]["key"];

export type TabBadges = Partial<Record<TabKey, { count: number; tone: "bad" | "warn" }>>;

/**
 * Tab state lives in the URL rather than component state so an admin can send
 * someone a link to the exact panel they're talking about — which is most of
 * what support handoffs are.
 *
 * Order is by how often a tab is opened, not by how the data model is shaped.
 * Links and People come second and third because a support call almost always
 * starts with "send me their ordering link" or "they can't get in"; Danger zone
 * stays last and stays visually separated for the obvious reason.
 *
 * The badges are counts of things wrong, fed from `lib/readiness.ts`. A tab with
 * nothing to report carries nothing — a zero badge is noise that teaches people
 * to stop reading badges.
 */
export default function TenantTabs({ badges = {} }: { badges?: TabBadges }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const current = params.get("tab") ?? "overview";

  return (
    <div className="hearth-scroll mb-6 flex items-center gap-1 overflow-x-auto border-b border-line">
      {TABS.map((t) => {
        const active = current === t.key;
        const badge = badges[t.key];
        return (
          <Link
            key={t.key}
            href={`${pathname}?tab=${t.key}`}
            aria-current={active ? "page" : undefined}
            className={[
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
              t.key === "danger" && "ml-auto",
              active
                ? t.key === "danger"
                  ? "border-badInk text-badInk"
                  : "border-accent text-ink"
                : "border-transparent text-dim hover:text-ink",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {t.label}
            {badge && badge.count > 0 && (
              <span
                className={[
                  "rounded-full px-1.5 text-[11px] font-medium",
                  badge.tone === "bad"
                    ? "bg-badInk/15 text-badInk"
                    : "bg-warn/15 text-warn",
                ].join(" ")}
              >
                {badge.count}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
