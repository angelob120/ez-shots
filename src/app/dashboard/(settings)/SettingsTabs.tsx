"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FEATURES } from "@/lib/features";

// Two tabs are conditional, and both would otherwise be a page with one inert
// control on it: the plan picker when there is only one plan to pick, and the
// sign-in tab when there is no provider to connect. See lib/features.ts.
const TABS = [
  { href: "/dashboard/branding", label: "Branding" },
  { href: "/dashboard/payments", label: "Payments" },
  ...(FEATURES.multiplePlans ? [{ href: "/dashboard/plan", label: "Plan" }] : []),
  ...(FEATURES.oauthSignIn ? [{ href: "/dashboard/sign-in", label: "Sign-in" }] : []),
];

export default function SettingsTabs() {
  const pathname = usePathname();

  return (
    <div className="mb-6 flex items-center gap-1 border-b border-line">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? "page" : undefined}
            className={[
              "-mb-px border-b-2 px-3 py-2 text-[13px] transition-colors",
              active
                ? "border-accent text-ink"
                : "border-transparent text-dim hover:text-ink",
            ].join(" ")}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
