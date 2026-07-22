import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { ownerTicketThread, CATEGORY_LABELS } from "@/lib/support";
import { Card, SectionTitle } from "@/components/hearth/ui";
import SupportThread, { PriorityBadge, StatusBadge } from "@/components/hearth/SupportThread";
import ReplyBox from "./ReplyBox";

export const dynamic = "force-dynamic";

export default async function OwnerTicketPage({ params }: { params: { id: string } }) {
  const { restaurantId } = await requireOwner();

  // Scoped in the query, not checked after it. A ticket belonging to another
  // tenant is simply not found — there is no branch here that could be got
  // wrong, because there is no branch.
  const ticket = await ownerTicketThread(restaurantId, params.id);
  if (!ticket) notFound();

  return (
    <>
      <div className="mb-4">
        <Link href="/dashboard/support" className="text-[12.5px] text-mute hover:text-ink">
          ← Support
        </Link>
      </div>

      <SectionTitle
        title={ticket.subject}
        subtitle={`Ticket #${ticket.number} · ${CATEGORY_LABELS[ticket.category]} · filed ${ticket.createdAt.toLocaleDateString(
          "en-US",
          { month: "long", day: "numeric" }
        )}`}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <StatusBadge status={ticket.status} />
        <PriorityBadge priority={ticket.priority} />
        {ticket.status === "WAITING" && (
          <span className="text-[12px] text-mute">
            We&rsquo;ve replied — read below and let us know if that sorted it.
          </span>
        )}
      </div>

      <div className="mb-6">
        <SupportThread messages={ticket.messages} viewerIsAdmin={false} />
      </div>

      {ticket.status === "ARCHIVED" ? (
        <Card>
          <p className="text-[13px] text-dim">
            This ticket is closed for good. If the problem is back, file a new one and link this
            number — we&rsquo;ll still have the history.
          </p>
        </Card>
      ) : (
        <Card>
          <h3 className="mb-3 text-[14px] font-semibold text-ink">
            {ticket.status === "RESOLVED" ? "Not fixed?" : "Add to this ticket"}
          </h3>
          <ReplyBox ticketId={ticket.id} resolved={ticket.status === "RESOLVED"} />
        </Card>
      )}
    </>
  );
}
