"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Grouped navigation.
 *
 * The flat strip this replaces had six items and no ordering principle, so it
 * read as six equally-likely destinations when in practice one of them (the
 * tenant list) is opened twenty times for each visit to any other. Grouping
 * makes the shape of the job legible: who we have, what's happening, and how
 * the platform is configured.
 *
 * Active state matches on prefix rather than equality so a tenant detail page
 * still highlights Restaurants — otherwise the deepest page in the console is
 * the one place the nav claims you're nowhere.
 */
const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string }> }> = [
  {
    label: "Tenants",
    items: [
      { href: "/admin/restaurants", label: "Restaurants" },
      { href: "/admin/users", label: "Users" },
      // Cross-tenant customer lookup. Sits under Tenants rather than
      // Operations because it answers "who is this person and whose customer
      // are they", which is a directory question, not an operational one.
      { href: "/admin/customers", label: "Customers" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/orders", label: "Orders" },
      { href: "/admin/analytics", label: "Analytics" },
      // Operator login history and in-app activity. Under Operations because
      // it answers "who's been in and what were they doing" — a question about
      // people working today, not a platform-wide configuration act.
      { href: "/admin/activity", label: "Activity" },
      // Under Operations rather than Platform: booked calls are work waiting
      // on a person today, which is the same question Orders and Support ask.
      // Availability is a setting, but it lives behind a tab here because the
      // thing you go looking for after "why has nobody booked" is the grid.
      { href: "/admin/calendar", label: "Calendar" },
      // One entry, three tabs. Tickets, contact enquiries, and the hours
      // ledger are all "somebody needed something from us" — splitting them
      // across nav items is how one of the three becomes the page nobody opens.
      { href: "/admin/support", label: "Support" },
      // The alert inbox. Under Operations because it's the same question the
      // rest of this group asks — what's happened that needs a person today.
      // The header bell is the at-a-glance count; this is the way in you can
      // find without knowing the icon is clickable.
      { href: "/admin/notifications", label: "Notifications" },
    ],
  },
  {
    label: "Platform",
    items: [
      // "Test mode" used to sit beside this as its own entry. It's the first
      // tab of Testing tools now — two nav items for one question was the
      // reason an admin could be looking at the tools while the switch that
      // arms them sat on a page they hadn't opened.
      { href: "/admin/tools", label: "Testing tools" },
      // Under Platform rather than Operations: a template is something we
      // publish into every tenant, which is a configuration act, not a piece
      // of work waiting on somebody today.
      { href: "/admin/templates", label: "Journey templates" },
      // The master onboarding checklist wording, applied to every tenant.
      // Under Platform because it's a global template we publish, not work
      // waiting on a single account today.
      { href: "/admin/onboarding", label: "Onboarding" },
      { href: "/admin/fees", label: "Fees" },
    ],
  },
];

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminNav() {
  const pathname = usePathname();

  return (
    /*
     * `min-w-0 flex-1` is the load-bearing part. A flex child refuses to shrink
     * below its content width by default, so an overflowing nav pushes the logo
     * and the Sign out button instead of scrolling itself — which is what wrapped
     * both onto a second line and broke the header's fixed height.
     */
    <nav className="hearth-rail flex min-w-0 flex-1 items-center gap-1">
      <Link
        href="/admin"
        className={[
          "shrink-0 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-[13px] transition-colors",
          pathname === "/admin" ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2 hover:text-ink",
        ].join(" ")}
      >
        Home
      </Link>

      {GROUPS.map((g) => (
        <div key={g.label} className="flex shrink-0 items-center">
          <span className="mx-1.5 h-4 w-px shrink-0 bg-line" aria-hidden />
          <span className="sr-only">{g.label}</span>
          {g.items.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={isActive(pathname, n.href) ? "page" : undefined}
              className={[
                "shrink-0 whitespace-nowrap rounded-sm px-2.5 py-1.5 text-[13px] transition-colors",
                isActive(pathname, n.href)
                  ? "bg-surface2 text-ink"
                  : "text-dim hover:bg-surface2 hover:text-ink",
              ].join(" ")}
            >
              {n.label}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}
