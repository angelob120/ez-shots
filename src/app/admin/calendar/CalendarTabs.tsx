import Link from "next/link";
import { cx } from "@/components/hearth/ui";

/**
 * URL-driven tabs, matching `/admin/support` and `/admin/tools`.
 * A view is a link, not an instruction to click something after arriving.
 */

export type CalendarTab = "upcoming" | "past" | "new" | "availability";

export const CALENDAR_TABS: Array<{ key: CalendarTab; label: string }> = [
  { key: "upcoming", label: "Upcoming" },
  { key: "past", label: "Past" },
  { key: "new", label: "Add a call" },
  { key: "availability", label: "Availability" },
];

export default function CalendarTabs({
  tab,
  counts,
}: {
  tab: CalendarTab;
  counts?: Partial<Record<CalendarTab, number>>;
}) {
  return (
    <div className="mb-6 flex items-center gap-1 border-b border-line">
      {CALENDAR_TABS.map((t) => {
        const n = counts?.[t.key] ?? 0;
        return (
          <Link
            key={t.key}
            href={`/admin/calendar?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cx(
              "-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-[13px] transition-colors",
              tab === t.key ? "border-accent text-ink" : "border-transparent text-dim hover:text-ink",
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
