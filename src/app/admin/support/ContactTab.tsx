import Link from "next/link";
import { adminContacts, STATUS_LABELS } from "@/lib/support";
import { Badge, Card, Empty, cx } from "@/components/hearth/ui";
import StatusActions from "./StatusActions";
import NoteBox from "./NoteBox";
import type { SupportStatus } from "@prisma/client";

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "LIVE", label: "Needs a reply" },
  { key: "RESOLVED", label: "Replied" },
  { key: "ARCHIVED", label: "Archived" },
];

/**
 * Enquiries from the public form.
 *
 * Rendered as expanded cards rather than a table with a drilldown, because a
 * contact enquiry is one paragraph and reading it *is* the work — a list that
 * makes you click into each row to find out whether it's a real lead or a
 * cold-email bot adds a step to every single one.
 *
 * There's no reply box. We answer these by email, from an address the sender
 * already gave us, and a reply form here would imply a thread that doesn't
 * exist — the sender has no account and no page to read an answer on. Tickets
 * are threaded because owners have somewhere to read them.
 */
export default async function ContactTab({ filter }: { filter: string }) {
  const status = (FILTERS.some((f) => f.key === filter) ? filter : "LIVE") as
    | SupportStatus
    | "LIVE";
  const rows = await adminContacts(status);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/support?tab=contact&status=${f.key}`}
            className={cx(
              "rounded-sm px-2.5 py-1 text-[12.5px] transition-colors",
              status === f.key ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2 hover:text-ink"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <Empty
          title="Nothing waiting"
          body={
            status === "LIVE"
              ? "Every enquiry from the contact form has been dealt with."
              : `No ${STATUS_LABELS[status as SupportStatus].toLowerCase()} enquiries.`
          }
        />
      ) : (
        <div className="space-y-4">
          {rows.map((c) => (
            <Card key={c.id} className={c.readAt ? undefined : "border-line2"}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink">{c.name}</span>
                    {!c.readAt && (
                      <span className="text-[10.5px] font-medium uppercase tracking-wide text-accent">
                        new
                      </span>
                    )}
                    {c.matchedRestaurantId && (
                      <Link href={`/admin/restaurants/${c.matchedRestaurantId}`}>
                        <Badge tone="good">Existing owner</Badge>
                      </Link>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-mute">
                    <a href={`mailto:${c.email}`} className="text-dim hover:text-ink">
                      {c.email}
                    </a>
                    {c.phone && <span>{c.phone}</span>}
                    {c.business && <span>{c.business}</span>}
                    <span>
                      {c.createdAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                </div>
                <StatusActions id={c.id} status={c.status} kind="contact" />
              </div>

              {/* Plain text. This came from an unauthenticated form and is
                  never rendered as anything else. */}
              <p className="mt-4 whitespace-pre-wrap border-l-2 border-line2 pl-4 text-[13px] leading-relaxed text-dim">
                {c.message}
              </p>

              <div className="mt-5 border-t border-line pt-4">
                <NoteBox target={{ contactId: c.id }} notes={c.notes} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
