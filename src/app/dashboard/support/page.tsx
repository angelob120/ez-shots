import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { ownerTickets, CATEGORY_LABELS } from "@/lib/support";
import { Card, Empty, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import { PriorityBadge, StatusBadge } from "@/components/hearth/SupportThread";
import NewTicketForm from "./NewTicketForm";
import BookACall from "./BookACall";

export const dynamic = "force-dynamic";

export default async function OwnerSupportPage({
  searchParams,
}: {
  searchParams: { closed?: string };
}) {
  const { session, restaurantId } = await requireOwner();
  const showClosed = searchParams.closed === "1";

  const [user, tickets] = await Promise.all([
    prisma.user.findUnique({
      where: { id: session.userId },
      select: { name: true, email: true },
    }),
    ownerTickets(restaurantId, showClosed),
  ]);

  return (
    <>
      <SectionTitle
        title="Support"
        subtitle="Tell us what's broken. Every ticket goes straight to a person, and the whole conversation stays on this page."
        action={
          <span className="flex items-center gap-2">
            <Link
              href="/dashboard/support/help"
              className="inline-flex h-9 items-center rounded-sm border border-line2 bg-surface2 px-3.5 text-[13px] font-medium text-ink hover:bg-surface"
            >
              Browse help
            </Link>
            <NewTicketForm
              defaultName={user?.name ?? "Owner"}
              defaultEmail={user?.email ?? session.email}
            />
          </span>
        }
      />

      {/*
        Above the ticket list rather than below it. Someone arriving here has a
        problem right now, and the fastest resolution we can offer is the one
        already written down — offering it after they have scrolled past their
        own ticket history is offering it too late to be taken.
      */}
      <Card className="mb-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Try the answers first</h3>
            <p className="mt-1 max-w-[520px] text-[13px] leading-relaxed text-dim">
              Refunds, missing orders, payouts that haven&apos;t landed, hours behaving oddly —
              they&apos;re written up and searchable, and most of them you can fix in a minute
              without waiting on us.
            </p>
          </div>
          <Link
            href="/dashboard/support/help"
            className="inline-flex h-9 shrink-0 items-center rounded-sm border border-line2 bg-surface2 px-3.5 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Search help
          </Link>
        </div>
      </Card>

      <div className="mb-4 flex items-center gap-3 text-[12.5px]">
        <Link
          href="/dashboard/support"
          className={showClosed ? "text-dim hover:text-ink" : "text-ink"}
        >
          Open
        </Link>
        <span className="text-line2">·</span>
        <Link
          href="/dashboard/support?closed=1"
          className={showClosed ? "text-ink" : "text-dim hover:text-ink"}
        >
          Everything
        </Link>
      </div>

      {tickets.length === 0 ? (
        <Empty
          title={showClosed ? "No tickets yet" : "Nothing open"}
          body="When something isn't working, report it here rather than sitting on it — we'd rather hear about a small thing early."
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Subject</Th>
              <Th>About</Th>
              <Th>Status</Th>
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id}>
                <Td className="font-mono text-[12px] text-mute">{t.number}</Td>
                <Td>
                  <Link href={`/dashboard/support/${t.id}`} className="text-ink hover:underline">
                    {t.subject}
                  </Link>
                  <span className="ml-2 text-[11px] text-mute">
                    {t._count.messages} message{t._count.messages === 1 ? "" : "s"}
                  </span>
                </Td>
                <Td className="text-dim">{CATEGORY_LABELS[t.category]}</Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={t.status} />
                    <PriorityBadge priority={t.priority} />
                  </span>
                </Td>
                <Td className="text-[12px] text-mute">
                  {t.lastActivityAt.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {/* Renders nothing when no booking type is set up — it brings its own frame. */}
      <div className="mt-6">
        <BookACall />
      </div>

      <Card className="mt-4">
        <h3 className="mb-2 text-[14px] font-semibold text-ink">Before you file</h3>
        <p className="text-[13px] leading-relaxed text-dim">
          If an order is the problem, include the order number — it's the fastest route to an
          answer, because it lets us read the exact timeline of what the system did. If money is
          involved, say so and mark it urgent. We treat &ldquo;a customer is owed a refund&rdquo;
          differently from everything else.
        </p>
      </Card>
    </>
  );
}
