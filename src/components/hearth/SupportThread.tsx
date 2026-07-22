import { Badge } from "@/components/hearth/ui";
import type { SupportPriority, SupportStatus } from "@prisma/client";
// The labels module rather than `lib/support`: this component is rendered on
// both sides and there's no reason for it to drag a server-only module along.
import { STATUS_LABELS } from "@/lib/support-labels";

/**
 * The conversation, rendered identically on both sides.
 *
 * One component for the owner's view and ours, for the same reason the
 * analytics drilldown reuses the owner's charts: two renderings of the same
 * thread is how a support call becomes an argument about who said what. The
 * only thing that differs is which side is styled as "you", which is a prop.
 *
 * It takes messages only. There is no way to pass a `SupportNote` in — notes
 * are a different type from a different table, and that is the point.
 */

export type ThreadMessage = {
  id: string;
  fromAdmin: boolean;
  authorName: string;
  body: string;
  createdAt: Date;
};

function when(d: Date) {
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function StatusBadge({ status }: { status: SupportStatus }) {
  const tone =
    status === "OPEN" ? "warn" : status === "WAITING" ? "neutral" : status === "RESOLVED" ? "good" : "neutral";
  return <Badge tone={tone as "warn" | "neutral" | "good"}>{STATUS_LABELS[status]}</Badge>;
}

export function PriorityBadge({ priority }: { priority: SupportPriority }) {
  if (priority === "NORMAL" || priority === "LOW") return null;
  return <Badge tone="bad">{priority === "URGENT" ? "Can't take orders" : "Costing orders"}</Badge>;
}

export default function SupportThread({
  messages,
  viewerIsAdmin,
}: {
  messages: ThreadMessage[];
  /** Which side gets the "you" treatment. Presentation only. */
  viewerIsAdmin: boolean;
}) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => {
        const mine = m.fromAdmin === viewerIsAdmin;
        return (
          <li
            key={m.id}
            className={[
              "rounded-md border px-4 py-3",
              mine ? "border-line2 bg-surface2" : "border-line bg-surface",
            ].join(" ")}
          >
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[12.5px] font-medium text-ink">
                {m.fromAdmin ? "EZ Orders" : m.authorName}
                {mine && <span className="ml-1.5 text-[11px] text-mute">you</span>}
              </span>
              <span className="shrink-0 text-[11px] text-mute">{when(m.createdAt)}</span>
            </div>
            {/* whitespace-pre-wrap, not a markdown renderer: this text was typed
                by a stranger on a public form in one case, and rendering it as
                anything but text is how that becomes an injection. */}
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-dim">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}
