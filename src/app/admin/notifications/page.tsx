import { SectionTitle } from "@/components/hearth/ui";
import { requireAdmin } from "@/lib/auth";
import { unreadCount } from "@/lib/notifications";
import NotifTabs, { type NotifTab } from "./NotifTabs";
import InboxTab from "./InboxTab";
import PrefsTab from "./PrefsTab";
import ComposeForm from "./ComposeForm";

export const dynamic = "force-dynamic";

/**
 * The notifications centre, on one page under three tabs — the inbox, per-kind
 * delivery preferences, and a compose box for announcements and reminders.
 * URL-driven tabs, matching `/admin/support`.
 */

const SUBTITLES: Record<NotifTab, string> = {
  inbox: "Platform events routed to you, newest first.",
  preferences: "How each kind of event reaches you — in-app, email, SMS.",
  compose: "Send an announcement to owners or admins, or set yourself a reminder.",
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: { tab?: string; filter?: string };
}) {
  const session = await requireAdmin();

  const tab = (["inbox", "preferences", "compose"].includes(searchParams.tab ?? "")
    ? searchParams.tab
    : "inbox") as NotifTab;

  const unread = await unreadCount(session.userId);

  return (
    <>
      <SectionTitle title="Notifications" subtitle={SUBTITLES[tab]} />

      <NotifTabs tab={tab} unread={unread} />

      {tab === "inbox" && (
        <InboxTab userId={session.userId} unreadOnly={searchParams.filter === "unread"} />
      )}
      {tab === "preferences" && <PrefsTab userId={session.userId} />}
      {tab === "compose" && <ComposeForm />}
    </>
  );
}
