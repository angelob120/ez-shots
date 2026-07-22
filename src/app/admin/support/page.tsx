import { SectionTitle } from "@/components/hearth/ui";
import { supportInbox } from "@/lib/support";
import SupportTabs, { type SupportTab } from "./SupportTabs";
import TicketsTab from "./TicketsTab";
import ContactTab from "./ContactTab";
import LoadTab from "./LoadTab";

export const dynamic = "force-dynamic";

/**
 * Everything support, on one page under three tabs.
 *
 * Tickets and contact enquiries are separate tables for good reasons (see the
 * schema), but they are the same job — somebody is waiting on us — and putting
 * them behind two nav entries would repeat the mistake `/admin/test-mode`
 * corrected: one question asked on two pages means one of the two is the page
 * you didn't open. Support load joins them because it's the same question from
 * the other end: this is what all that arriving work cost.
 *
 * Tabs are URL-driven, so a specific view is a link.
 */

const SUBTITLES: Record<SupportTab, string> = {
  tickets: "Problems owners reported from their dashboard, longest wait first.",
  contact: "Enquiries from the public contact form. No account behind these — reply by email.",
  load: "Hours per account per week — the number that decides whether 40–60 accounts is a cash cow or a full-time job.",
};

export default async function SupportPage({
  searchParams,
}: {
  searchParams: { tab?: string; status?: string };
}) {
  const tab = (["tickets", "contact", "load"].includes(searchParams.tab ?? "")
    ? searchParams.tab
    : "tickets") as SupportTab;

  // Fetched on every tab so the counts stay honest while you're on Load. A
  // badge that only updates on the tab it belongs to is a badge you learn to
  // distrust.
  const inbox = await supportInbox();

  return (
    <>
      <SectionTitle title="Support" subtitle={SUBTITLES[tab]} />

      <SupportTabs
        tab={tab}
        counts={{ tickets: inbox.openTickets, contact: inbox.openContacts }}
      />

      {tab === "tickets" && <TicketsTab filter={searchParams.status ?? "LIVE"} />}
      {tab === "contact" && <ContactTab filter={searchParams.status ?? "LIVE"} />}
      {tab === "load" && <LoadTab />}
    </>
  );
}
