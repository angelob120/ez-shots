import Link from "next/link";
import { Card } from "@/components/hearth/ui";
import type { SupportInbox } from "@/lib/support";

/**
 * "Is anybody waiting on me?" on the home page.
 *
 * The count is not the point — `oldestUnansweredHours` is. Four open tickets
 * filed this morning is a normal Tuesday; one open ticket filed nine days ago
 * is a restaurant quietly deciding we don't answer. A widget showing only a
 * number can't tell those apart, and the one that matters is the one it hides.
 *
 * Renders nothing at all when the queue is empty. An always-present card
 * reading "0 tickets" is a thing the eye learns to skip, and then it skips it
 * on the morning it says 3.
 */
export default function SupportInboxCard({ inbox }: { inbox: SupportInbox }) {
  const total = inbox.openTickets + inbox.openContacts + inbox.waitingTickets;
  if (total === 0) return null;

  // Loud only when it's earned it: something urgent, or something that has
  // been sitting for more than a day.
  const stale = (inbox.oldestUnansweredHours ?? 0) >= 24;
  const loud = inbox.urgentTickets > 0 || stale;

  const items: Array<{ href: string; label: string; n: number; strong?: boolean }> = [
    {
      href: "/admin/support?tab=tickets&status=OPEN",
      label: `open ticket${inbox.openTickets === 1 ? "" : "s"}`,
      n: inbox.openTickets,
      strong: true,
    },
    {
      href: "/admin/support?tab=contact",
      label: `contact enquir${inbox.openContacts === 1 ? "y" : "ies"}`,
      n: inbox.openContacts,
      strong: true,
    },
    {
      href: "/admin/support?tab=tickets&status=WAITING",
      label: "waiting on the owner",
      n: inbox.waitingTickets,
    },
  ].filter((i) => i.n > 0);

  return (
    <Card className={loud ? "mb-4 border-warnLine" : "mb-4"}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className={`text-[15px] font-semibold ${loud ? "text-warn" : "text-ink"}`}>
          Support inbox
        </h2>
        <Link href="/admin/support" className="text-[11.5px] text-mute hover:text-ink">
          Open the queue →
        </Link>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="group flex items-baseline gap-1.5">
            <span
              className={`font-mono text-[19px] tabular-nums ${
                i.strong ? "text-ink" : "text-dim"
              } group-hover:text-accent`}
            >
              {i.n}
            </span>
            <span className="text-[12.5px] text-dim">{i.label}</span>
          </Link>
        ))}
      </div>

      {(inbox.unreadTickets > 0 || inbox.unreadContacts > 0 || stale || inbox.urgentTickets > 0) && (
        <p className="mt-3 border-t border-line pt-3 text-[12px] text-mute">
          {inbox.urgentTickets > 0 && (
            <span className="text-warn">
              {inbox.urgentTickets} marked as costing them orders.{" "}
            </span>
          )}
          {inbox.unreadTickets + inbox.unreadContacts > 0 && (
            <>{inbox.unreadTickets + inbox.unreadContacts} never opened. </>
          )}
          {stale && (
            <span className={inbox.oldestUnansweredHours! >= 72 ? "text-warn" : undefined}>
              Oldest unanswered: {Math.floor(inbox.oldestUnansweredHours! / 24)}d.
            </span>
          )}
        </p>
      )}
    </Card>
  );
}
