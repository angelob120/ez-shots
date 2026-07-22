import Link from "next/link";
import { Badge, Button, Empty } from "@/components/hearth/ui";
import { listNotifications } from "@/lib/notifications";
import { badgeTone, specFor } from "@/lib/notification-format";
import { markAllReadAction, markReadAction } from "./actions";

/**
 * The signed-in admin's inbox, newest first. Read state is a column on the row
 * the reader owns (see the schema note on fan-out), so marking one read is a
 * scoped `updateMany` and nobody can touch another inbox.
 */
export default async function InboxTab({
  userId,
  unreadOnly,
}: {
  userId: string;
  unreadOnly: boolean;
}) {
  const items = await listNotifications(userId, { unreadOnly });

  return (
    <div>
      <div className="mb-4 flex items-center gap-3 text-[13px]">
        <Link
          href="/admin/notifications?tab=inbox"
          className={unreadOnly ? "text-dim hover:text-ink" : "text-ink"}
        >
          All
        </Link>
        <span className="text-line2">·</span>
        <Link
          href="/admin/notifications?tab=inbox&filter=unread"
          className={unreadOnly ? "text-ink" : "text-dim hover:text-ink"}
        >
          Unread
        </Link>
        <form action={markAllReadAction} className="ml-auto">
          <Button variant="outline" size="sm">Mark all read</Button>
        </form>
      </div>

      {items.length === 0 ? (
        <Empty
          title={unreadOnly ? "Nothing unread" : "No notifications yet"}
          body="Platform events — orders, tickets, bookings, failed refunds — land here."
        />
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const spec = specFor(n.kind);
            return (
              <li
                key={n.id}
                className={`rounded-md border p-3 ${
                  n.readAt ? "border-line bg-surface" : "border-line2 bg-base"
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
                      <span className="text-[13px] font-medium text-ink">{n.title}</span>
                      <Badge tone={badgeTone(n.severity)}>{spec.label}</Badge>
                    </div>
                    <p className="mt-1 text-[13px] text-dim">{n.body}</p>
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-dim">
                      <span>{n.createdAt.toLocaleString()}</span>
                      {n.link && (
                        <Link href={n.link} className="text-accent hover:underline">
                          Open
                        </Link>
                      )}
                    </div>
                  </div>
                  {!n.readAt && (
                    <form action={markReadAction}>
                      <input type="hidden" name="id" value={n.id} />
                      <Button variant="outline" size="sm">Mark read</Button>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
