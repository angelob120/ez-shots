import Link from "next/link";
import { cx } from "@/components/hearth/ui";

/**
 * URL-driven tabs, matching `/admin/support` and `/admin/tools`. A GET link so
 * every view is a bookmarkable URL rather than client state.
 */

export type NotifTab = "inbox" | "preferences" | "compose";

export const NOTIF_TABS: Array<{ key: NotifTab; label: string }> = [
  { key: "inbox", label: "Inbox" },
  { key: "preferences", label: "Preferences" },
  { key: "compose", label: "Compose" },
];

export default function NotifTabs({ tab, unread }: { tab: NotifTab; unread?: number }) {
  return (
    <div className="mb-6 flex items-center gap-1 border-b border-line">
      {NOTIF_TABS.map((t) => (
        <Link
          key={t.key}
          href={`/admin/notifications?tab=${t.key}`}
          aria-current={tab === t.key ? "page" : undefined}
          className={cx(
            "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] transition-colors",
            tab === t.key
              ? "border-accent text-ink"
              : "border-transparent text-dim hover:text-ink"
          )}
        >
          {t.label}
          {t.key === "inbox" && unread ? (
            <span className="rounded-full bg-accentDim/30 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
              {unread}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
