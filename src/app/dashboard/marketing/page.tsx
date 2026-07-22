import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { channelReadiness, listCampaigns } from "@/lib/campaigns";
import { reorderStatusFor } from "@/lib/reorder-manage";
import { Badge, Card, Empty, LinkButton, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import ReorderCard from "./ReorderCard";
import type { CampaignStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The campaign list.
 *
 * Results-first: the columns an owner actually asks about after a send are
 * "how many got it" and "how many didn't", and the second one is the column
 * this product exists to explain. A list showing only "sent 90" invites the
 * question "why only 90"; a list showing "90 sent, 310 skipped" with the
 * breakdown one click away answers it before it's asked.
 */

const STATUS_TONE: Record<CampaignStatus, "neutral" | "good" | "warn" | "bad"> = {
  DRAFT: "neutral",
  SCHEDULED: "warn",
  SENDING: "warn",
  SENT: "good",
  CANCELED: "neutral",
  FAILED: "bad",
};

export default async function MarketingPage() {
  const { restaurantId } = await requireOwner();

  const [campaigns, readiness, reachable, reorder] = await Promise.all([
    listCampaigns(restaurantId),
    channelReadiness(restaurantId),
    Promise.all([
      prisma.customer.count({
        where: { restaurantId, optInStatus: "OPTED_IN", optOutAt: null, cohort: { not: "HOLDOUT" } },
      }),
      prisma.customer.count({
        where: { restaurantId, email: { not: null }, emailOptOutAt: null, cohort: { not: "HOLDOUT" } },
      }),
      prisma.customer.count({ where: { restaurantId } }),
    ]),
    reorderStatusFor(restaurantId),
  ]);

  const [smsReach, emailReach, total] = reachable;

  return (
    <>
      <SectionTitle
        title="Marketing"
        subtitle="Text and email your customers. Every send goes only to people you're allowed to contact."
        action={<LinkButton href="/dashboard/marketing/new" variant="primary">New campaign</LinkButton>}
      />

      {/* Done-for-you reordering, before the manual tools. It's the thing that
          runs without the owner, so it belongs at the top where they can check
          and adjust it — the manual campaign list is what they scroll to when
          they want to do something by hand. */}
      <ReorderCard
        enabled={reorder.enabled}
        mode={reorder.mode}
        running={reorder.running}
        enteredCount={reorder.enteredCount}
        inFlight={reorder.inFlight}
      />

      {/* Reach, before anything else on the page.
          An owner about to write a campaign needs to know how many people can
          receive it, and on which channel, because that decides what they
          write. Burying this under the campaign list would mean the number that
          changes the plan arrives after the plan. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <ChannelCard
          title="Text message"
          reach={smsReach}
          total={total}
          live={readiness.sms.live && readiness.sms.hasSender}
          suspended={readiness.sms.suspended}
          note={
            readiness.sms.suspended
              ? "Text messaging is suspended on this account. Contact support."
              : !readiness.sms.live
                ? "Texts are recorded but not delivered yet — carrier registration is still in progress."
                : "Only customers who opted in at checkout. This is the number to grow."
          }
        />
        <ChannelCard
          title="Email"
          reach={emailReach}
          total={total}
          live={readiness.email.live}
          suspended={readiness.email.suspended}
          note={
            readiness.email.suspended
              ? "Email is suspended on this account. Contact support."
              : !readiness.email.live
                ? "Email is recorded but not delivered yet — sending isn't switched on."
                : readiness.email.tenantSender
                  ? "Sending from your own address."
                  : "Sending under your name from our address. Set up your own on the Sender tab."
          }
        />
      </div>

      <div className="mb-4 flex items-center gap-3">
        {/* A campaign is one message sent once; a journey is a standing
            instruction. Linked from here rather than given its own nav item
            because owners arrive at both with the same intent — "message my
            customers" — and splitting them across the sidebar is how one of
            the two becomes the page nobody opens. */}
        <Link href="/dashboard/marketing/automations" className="text-[12px] text-dim underline-offset-2 hover:text-ink hover:underline">
          Journeys (automations)
        </Link>
        <Link href="/dashboard/marketing/sender" className="text-[12px] text-dim underline-offset-2 hover:text-ink hover:underline">
          Email sender settings
        </Link>
        <Link href="/dashboard/customers" className="text-[12px] text-dim underline-offset-2 hover:text-ink hover:underline">
          Manage audiences
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <Empty
          title="No campaigns yet"
          body="A campaign is one message to a group of your customers — a Tuesday special, a win-back for people you haven't seen in a month."
        />
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Campaign</Th>
                <Th>Channel</Th>
                <Th>Status</Th>
                <Th className="text-right">Sent</Th>
                <Th className="text-right">Skipped</Th>
                <Th className="text-right">Failed</Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/dashboard/marketing/${c.id}`} className="text-ink hover:text-accent">
                      {c.name}
                    </Link>
                    <span className="ml-2 text-[11px] text-mute">
                      {c.completedAt
                        ? c.completedAt.toLocaleDateString()
                        : c.scheduledFor
                          ? `scheduled ${c.scheduledFor.toLocaleString()}`
                          : c.createdAt.toLocaleDateString()}
                    </span>
                  </Td>
                  <Td>{c.channel === "SMS" ? "Text" : "Email"}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[c.status]}>{c.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-right font-mono">{c.sentCount}</Td>
                  <Td className="text-right font-mono text-mute">{c.skippedCount}</Td>
                  <Td className="text-right font-mono">{c.failedCount || ""}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function ChannelCard({
  title,
  reach,
  total,
  live,
  suspended,
  note,
}: {
  title: string;
  reach: number;
  total: number;
  live: boolean;
  suspended: boolean;
  note: string;
}) {
  const pct = total > 0 ? Math.round((reach / total) * 100) : 0;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-[13px] font-medium text-ink">{title}</h3>
          <p className="mt-2 font-mono text-[26px] leading-none text-ink">{reach.toLocaleString()}</p>
          <p className="mt-1.5 text-[11px] text-mute">
            of {total.toLocaleString()} customers ({pct}%)
          </p>
        </div>
        <Badge tone={suspended ? "bad" : live ? "good" : "warn"}>
          {suspended ? "suspended" : live ? "live" : "not sending"}
        </Badge>
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-mute">{note}</p>
    </Card>
  );
}
