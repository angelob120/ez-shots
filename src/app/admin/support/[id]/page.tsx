import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { adminTicket, CATEGORY_LABELS, PRIORITY_LABELS } from "@/lib/support";
import { Badge, Card, SectionTitle } from "@/components/hearth/ui";
import SupportThread, { PriorityBadge, StatusBadge } from "@/components/hearth/SupportThread";
import StatusActions from "../StatusActions";
import NoteBox from "../NoteBox";
import AdminReplyBox from "./AdminReplyBox";

export const dynamic = "force-dynamic";

/**
 * One ticket, everything about it.
 *
 * `adminTicket` stamps `firstReadAt` as a side effect of loading this page —
 * first-response time is measured from when we actually looked, and the only
 * moment we reliably know that is now. It's a conditional update, so opening
 * the ticket twice doesn't move the number.
 *
 * The reply box and the note box are deliberately adjacent and deliberately
 * different-looking. They write to different tables and only one of them is
 * visible to the restaurant, and that distinction has to survive a tired
 * operator at 11pm.
 */
export default async function AdminTicketPage({ params }: { params: { id: string } }) {
  await requireAdmin();

  const ticket = await adminTicket(params.id);
  if (!ticket) notFound();

  const responseHours =
    ticket.firstReadAt &&
    Math.round((ticket.firstReadAt.getTime() - ticket.createdAt.getTime()) / 360_000) / 10;

  return (
    <>
      <div className="mb-4">
        <Link href="/admin/support?tab=tickets" className="text-[12.5px] text-mute hover:text-ink">
          ← Support
        </Link>
      </div>

      <SectionTitle
        title={ticket.subject}
        subtitle={`#${ticket.number} · ${CATEGORY_LABELS[ticket.category]} · ${PRIORITY_LABELS[ticket.priority]}`}
        action={<StatusActions id={ticket.id} status={ticket.status} kind="ticket" />}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2 text-[12.5px]">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        <Link
          href={`/admin/restaurants/${ticket.restaurantId}`}
          className="text-dim hover:text-ink"
        >
          {ticket.restaurant.name}
        </Link>
        {ticket.restaurant.status !== "ACTIVE" && (
          <Badge tone="warn">{ticket.restaurant.status}</Badge>
        )}
        <span className="text-mute">·</span>
        <a href={`mailto:${ticket.contactEmail}`} className="text-dim hover:text-ink">
          {ticket.contactName} &lt;{ticket.contactEmail}&gt;
        </a>
        <span className="text-mute">·</span>
        <span className="text-mute">
          filed{" "}
          {ticket.createdAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
          {responseHours !== null && responseHours !== undefined && (
            <> · first read after {responseHours}h</>
          )}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-5">
            <SupportThread messages={ticket.messages} viewerIsAdmin />
          </div>

          {ticket.status === "ARCHIVED" ? (
            <Card>
              <p className="text-[13px] text-dim">
                Archived. Nothing more can be said on this ticket — that&rsquo;s what archiving is
                for. The history stays.
              </p>
            </Card>
          ) : (
            <Card>
              <h3 className="mb-3 text-[14px] font-semibold text-ink">Reply to the owner</h3>
              <AdminReplyBox ticketId={ticket.id} />
            </Card>
          )}
        </div>

        <Card>
          <NoteBox target={{ ticketId: ticket.id }} notes={ticket.notes} />
        </Card>
      </div>
    </>
  );
}
