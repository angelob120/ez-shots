import Link from "next/link";
import { cx } from "@/components/hearth/ui";

/**
 * URL-driven tabs, matching `/admin/restaurants/[id]` and `/admin/tools`.
 *
 * A GET link rather than client state so every view is a URL that can be
 * bookmarked and pasted into a message — the same reasoning as the analytics
 * filter bar. "Look at the contact queue" should be a link, not an instruction
 * to click something after arriving.
 */

export type SupportTab = "tickets" | "contact" | "load";

export const SUPPORT_TABS: Array<{ key: SupportTab; label: string }> = [
  { key: "tickets", label: "Tickets" },
  { key: "contact", label: "Contact form" },
  { key: "load", label: "Support load" },
];

export default function SupportTabs({
  tab,
  counts,
}: {
  tab: SupportTab;
  /** Live counts per tab. Zero renders nothing rather than a "0" badge — a
   *  badge that is usually zero stops being read at all. */
  counts?: Partial<Record<SupportTab, number>>;
}) {
  return (
    <div className="mb-6 flex items-center gap-1 border-b border-line">
      {SUPPORT_TABS.map((t) => {
        const n = counts?.[t.key] ?? 0;
        return (
          <Link
            key={t.key}
            href={`/admin/support?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] transition-colors",
              tab === t.key
                ? "border-accent text-ink"
                : "border-transparent text-dim hover:text-ink"
            )}
          >
            {t.label}
            {n > 0 && (
              <span className="rounded-full bg-accentDim/30 px-1.5 py-0.5 text-[10.5px] font-medium text-accent">
                {n}
              </span>
            )}
          </Link>
        );
      })}
    </div>
  );
}
