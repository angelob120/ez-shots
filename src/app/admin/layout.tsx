import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";
import { unreadCount } from "@/lib/notifications";
import { resolveModeState } from "@/lib/payments";
import ModeBanner from "@/components/hearth/ModeBanner";
import ThemeToggle from "@/components/hearth/ThemeToggle";
import { getTheme, themeAttr } from "@/lib/theme";
import AdminNav from "./AdminNav";
import Logo from "@/components/hearth/Logo";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireAdmin();

  // Read in the layout, not on the payments page — the failure being guarded
  // against is forgetting, so the warning has to be somewhere you can't
  // navigate away from. This call also *applies* an expired window, so simply
  // being in the console is enough to trip a lapsed timer.
  const modeState = await resolveModeState();

  // Read in the layout so the bell's count is honest on every admin page, not
  // just the notifications one — the same reasoning as the mode banner above.
  const unread = await unreadCount(session.userId);

  const theme = getTheme();

  return (
    <div className="hearth-shell" data-h-theme={themeAttr(theme)}>
      {modeState.mode !== "LIVE" && (
        <ModeBanner
          mode={modeState.mode}
          expiresAt={modeState.expiresAt?.toISOString() ?? null}
          revertTo={modeState.revertTo}
        />
      )}

      <header className="sticky top-0 z-20 border-b border-line bg-base/90 backdrop-blur">
        {/* Everything either side of the nav is `shrink-0` and `whitespace-nowrap`;
            the nav itself is the only thing allowed to give. Without that the
            row's contents fight for space, wrap, and push the header past its
            fixed h-14. */}
        <div className="mx-auto flex h-14 max-w-[1180px] items-center gap-4 px-6">
          <Link href="/admin" className="flex shrink-0 items-center gap-2">
            <Logo />
          </Link>
          <AdminNav />
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/admin/notifications"
              title="Notifications"
              aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
              className="relative rounded-sm border border-line2 px-2 py-1.5 text-dim transition-colors hover:text-ink"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {unread > 0 && (
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-accentFill px-1 text-[10px] font-semibold leading-none text-accentInk">
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </Link>
            <ThemeToggle theme={theme} />
            {/* The signed-in address used to sit here as its own element and is
                now the Sign out button's tooltip instead.
                
                Responsive hiding doesn't solve this one: the container is
                capped at 1180px, so a wider viewport gives the row no extra
                room and a `lg:`/`xl:` breakpoint would reveal the email at
                exactly the widths where the nav already can't fit. The nav
                carries nine destinations and they're all navigation; the email
                is identification, and there is only ever one admin signed in
                per browser. Attaching it to the control it describes keeps it
                reachable and costs no width. */}
            <form action={logoutAction}>
              <button
                title={`Signed in as ${session.email}`}
                className="whitespace-nowrap rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim transition-colors hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1180px] px-6 py-8">{children}</main>
    </div>
  );
}
