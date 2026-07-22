import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listSegments } from "@/lib/customers";
import {
  campaignDetail,
  channelReadiness,
  estimateAudience,
  isEditable,
  skipReasonLabel,
} from "@/lib/campaigns";
import { displayPhone } from "@/lib/money";
import ActionForm from "@/components/hearth/ActionForm";
import { Badge, Button, Card, Input, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import Composer from "../Composer";
import {
  cancelCampaignAction,
  deleteCampaignAction,
  launchCampaignAction,
  updateCampaignAction,
} from "../actions";

export const dynamic = "force-dynamic";

/**
 * One campaign: edit it while it's a draft, watch it while it sends, read the
 * post-mortem afterwards.
 *
 * One page rather than three, because they are the same object at different
 * moments and an owner navigating between "edit" and "results" screens loses
 * track of which campaign they're looking at. What changes is which panels
 * render, driven by `isEditable`.
 *
 * **The skip breakdown is the most important thing on this page.** It is the
 * only place the platform explains why a campaign aimed at 400 people reached
 * 90, and without it the honest answer ("most of your customers never agreed
 * to receive texts") reads as the software being broken.
 */
export default async function CampaignPage({ params }: { params: { id: string } }) {
  const { restaurantId } = await requireOwner();

  const detail = await campaignDetail(restaurantId, params.id);
  if (!detail) notFound();

  const { campaign, skipReasons, recent } = detail;

  const [restaurant, segments, readiness, estimate] = await Promise.all([
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } }),
    listSegments(restaurantId),
    channelReadiness(restaurantId),
    estimateAudience(restaurantId, campaign.audienceQuery, campaign.channel),
  ]);

  const editable = isEditable(campaign.status);
  const channelLive =
    campaign.channel === "SMS"
      ? readiness.sms.live && readiness.sms.hasSender && !readiness.sms.suspended
      : readiness.email.live && !readiness.email.suspended;

  return (
    <>
      <SectionTitle
        title={campaign.name}
        subtitle={`${campaign.channel === "SMS" ? "Text message" : "Email"} · ${campaign.status.toLowerCase()}`}
        action={
          <Link href="/dashboard/marketing" className="text-[12px] text-dim hover:text-ink">
            ← All campaigns
          </Link>
        }
      />

      {editable ? (
        <>
          {/* Send lives above the editor, not below it. An owner arriving from
              the composer is here to send, and burying the button under a form
              they just filled in makes them re-read it looking for what they
              missed. */}
          <SendPanel
            campaignId={campaign.id}
            estimate={estimate}
            channel={campaign.channel}
            scheduledFor={campaign.scheduledFor}
            channelLive={channelLive}
          />

          <div className="mt-8">
            <h2 className="mb-4 text-[13px] font-medium text-ink">Edit</h2>
            <Composer
              action={updateCampaignAction}
              campaignId={campaign.id}
              restaurantName={restaurant?.name ?? ""}
              segments={segments.map((s) => ({ id: s.id, name: s.name, query: s.query }))}
              initial={{
                name: campaign.name,
                channel: campaign.channel,
                subject: campaign.subject,
                body: campaign.body,
                audienceQuery: campaign.audienceQuery,
                segmentId: campaign.segmentId,
              }}
              submitLabel="Save changes"
              smsLive={readiness.sms.live && readiness.sms.hasSender && !readiness.sms.suspended}
              emailLive={readiness.email.live && !readiness.email.suspended}
            />
          </div>

          {campaign.status === "DRAFT" && (
            <Card className="mt-8">
              <ActionForm action={deleteCampaignAction}>
                <input type="hidden" name="campaignId" value={campaign.id} />
                <Button variant="danger" size="sm">
                  Delete draft
                </Button>
              </ActionForm>
            </Card>
          )}
        </>
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-4">
            <Metric label="Audience" value={campaign.audienceCount} />
            <Metric label="Sent" value={campaign.sentCount} strong />
            <Metric label="Not sent" value={campaign.skippedCount} />
            <Metric label="Failed" value={campaign.failedCount} />
          </div>

          {campaign.status === "SENDING" && (
            <Card className="mb-6">
              <p className="text-[13px] text-ink">
                Sending — {campaign.queuedCount.toLocaleString()} left in the queue.
              </p>
              <p className="mt-1.5 text-[11px] text-mute">
                Messages go out in batches so we don&apos;t trip carrier rate limits. Refresh to see
                progress.
              </p>
              <div className="mt-3">
                <ActionForm action={cancelCampaignAction}>
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <Button variant="danger" size="sm">
                    Stop sending
                  </Button>
                  <p className="mt-1.5 text-[11px] text-mute">
                    Stops whatever hasn&apos;t gone yet. Messages already delivered can&apos;t be
                    recalled.
                  </p>
                </ActionForm>
              </div>
            </Card>
          )}

          {campaign.error && (
            <Card className="mb-6 border-badLine">
              <p className="text-[13px] text-badInk">{campaign.error}</p>
            </Card>
          )}

          {skipReasons.length > 0 && (
            <Card className="mb-6">
              <h3 className="text-[13px] font-medium text-ink">Why {campaign.skippedCount} didn&apos;t receive it</h3>
              <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
                These aren&apos;t failures. Each one is a rule that stopped a message going to
                somebody who hasn&apos;t agreed to hear from you — which is what keeps your number
                and your domain able to reach everyone who has.
              </p>
              <div className="mt-3 space-y-1.5">
                {skipReasons
                  .slice()
                  .sort((a, b) => b._count._all - a._count._all)
                  .map((r) => (
                    <div key={r.error ?? "unknown"} className="flex items-baseline justify-between">
                      <span className="text-[12px] text-dim">{skipReasonLabel(r.error)}</span>
                      <span className="font-mono text-[12px] text-mute">{r._count._all}</span>
                    </div>
                  ))}
              </div>
            </Card>
          )}
        </>
      )}

      <Card className="mt-8">
        <h3 className="text-[13px] font-medium text-ink">The message</h3>
        {campaign.subject && (
          <p className="mt-2 text-[12px] text-dim">
            <span className="text-mute">Subject: </span>
            {campaign.subject}
          </p>
        )}
        <pre className="mt-2 whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-ink">
          {campaign.body}
        </pre>
      </Card>

      {recent.length > 0 && (
        <Card className="mt-6">
          <h3 className="mb-3 text-[13px] font-medium text-ink">Recent recipients</h3>
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Sent to</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {recent.map((m) => (
                <tr key={m.id}>
                  <Td>{m.customer?.name ?? "—"}</Td>
                  <Td className="font-mono text-[12px]">
                    {m.to
                      ? campaign.channel === "SMS"
                        ? displayPhone(m.to)
                        : m.to
                      : "—"}
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        m.status === "SENT" || m.status === "DELIVERED"
                          ? "good"
                          : m.status === "SKIPPED"
                            ? "neutral"
                            : m.status === "QUEUED"
                            ? "warn"
                            : "bad"
                      }
                    >
                      {m.status === "SKIPPED" ? skipReasonLabel(m.error) : m.status.toLowerCase()}
                    </Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}

function SendPanel({
  campaignId,
  estimate,
  channel,
  scheduledFor,
  channelLive,
}: {
  campaignId: string;
  estimate: { matched: number; reachable: number; unreachable: number };
  channel: "SMS" | "EMAIL";
  scheduledFor: Date | null;
  channelLive: boolean;
}) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h3 className="text-[13px] font-medium text-ink">
            {scheduledFor ? "Scheduled" : "Ready to send"}
          </h3>
          <p className="mt-2 text-[13px] text-ink">
            <span className="font-mono text-[20px]">{estimate.reachable.toLocaleString()}</span>{" "}
            {estimate.reachable === 1 ? "person" : "people"} will receive this
            {estimate.unreachable > 0 && (
              <span className="text-mute">
                {" "}
                · {estimate.unreachable.toLocaleString()} in this audience can&apos;t be contacted by{" "}
                {channel === "SMS" ? "text" : "email"}
              </span>
            )}
          </p>
          {scheduledFor && (
            <p className="mt-1.5 text-[11px] text-mute">
              Set to go out {scheduledFor.toLocaleString()}. Sending now overrides that.
            </p>
          )}
          {!channelLive && (
            <p className="mt-2 text-[11px] text-warn">
              Sending isn&apos;t switched on for this channel yet. The campaign will be recorded and
              every recipient logged, but nothing will actually be delivered.
            </p>
          )}
        </div>

        <ActionForm action={launchCampaignAction} className="min-w-[220px]">
          <input type="hidden" name="campaignId" value={campaignId} />
          <label className="block">
            <span className="mb-1.5 block text-[11px] text-mute">
              Type <span className="font-mono text-dim">SEND</span> to confirm
            </span>
            <Input name="confirm" autoComplete="off" placeholder="SEND" />
          </label>
          <Button type="submit" className="mt-2 w-full">
            Send to {estimate.reachable.toLocaleString()}
          </Button>
          <p className="mt-1.5 text-[11px] leading-relaxed text-mute">
            This can&apos;t be undone.
          </p>
        </ActionForm>
      </div>
    </Card>
  );
}

function Metric({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <Card>
      <p className="text-[11px] text-mute">{label}</p>
      <p className={`mt-1 font-mono text-[22px] leading-none ${strong ? "text-ink" : "text-dim"}`}>
        {value.toLocaleString()}
      </p>
    </Card>
  );
}
