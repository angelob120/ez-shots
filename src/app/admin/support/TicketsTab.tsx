import Link from "next/link";
import { adminTickets, CATEGORY_LABELS, STATUS_LABELS } from "@/lib/support";
import { Empty, Table, Td, Th, cx } from "@/components/hearth/ui";
import { PriorityBadge, StatusBadge } from "@/components/hearth/SupportThread";
import type { SupportStatus } from "@prisma/client";

const FILTERS: Array<{ key: string; label: string }> = [
  { key: "LIVE", label: "Needs us" },
  { key: "OPEN", label: "Open" },
  { key: "WAITING", label: "Waiting on owner" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "ARCHIVED", label: "Archived" },
];

function age(d: Date) {
  const h = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export default async function TicketsTab({ filter }: { filter: string }) {
  const status = (FILTERS.some((f) => f.key === filter) ? filter : "LIVE") as
    | SupportStatus
    | "LIVE";
  const tickets = await adminTickets(status);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/support?tab=tickets&status=${f.key}`}
            className={cx(
              "rounded-sm px-2.5 py-1 text-[12.5px] transition-colors",
              status === f.key ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2 hover:text-ink"
            )}
          >
            {f.label}
          </Link>
        ))}
      </div>

      {tickets.length === 0 ? (
        <Empty
          title="Nothing here"
          body={
            status === "LIVE"
              ? "No open tickets. Every owner who asked for something has an answer."
              : `No ${STATUS_LABELS[status as SupportStatus].toLowerCase()} tickets.`
          }
        />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>#</Th>
              <Th>Restaurant</Th>
              <Th>Subject</Th>
              <Th>About</Th>
              <Th>Status</Th>
              <Th>Age</Th>
            </tr>
          </thead>
          <tbody>
            {tickets.map((t) => (
              <tr key={t.id} className={t.firstReadAt ? undefined : "bg-surface2/40"}>
                <Td className="font-mono text-[12px] text-mute">{t.number}</Td>
                <Td>
                  <Link
                    href={`/admin/restaurants/${t.restaurantId}`}
                    className="text-dim hover:text-ink"
                  >
                    {t.restaurant.name}
                  </Link>
                </Td>
                <Td>
                  <Link href={`/admin/support/${t.id}`} className="text-ink hover:underline">
                    {t.subject}
                  </Link>
                  {!t.firstReadAt && (
                    <span className="ml-2 text-[10.5px] font-medium uppercase tracking-wide text-accent">
                      new
                    </span>
                  )}
                  <span className="ml-2 text-[11px] text-mute">
                    {t._count.messages} msg
                    {t._count.notes > 0 && ` · ${t._count.notes} note`}
                  </span>
                </Td>
                <Td className="text-dim">{CATEGORY_LABELS[t.category]}</Td>
                <Td>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={t.status} />
                    <PriorityBadge priority={t.priority} />
                  </span>
                </Td>
                {/* Age from creation, not last activity: the question this
                    column answers is how long the owner has been waiting, and
                    our own replies must not reset that clock. */}
                <Td className="text-[12px] text-mute">{age(t.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
