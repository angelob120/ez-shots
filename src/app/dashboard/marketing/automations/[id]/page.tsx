import Link from "next/link";
import { notFound } from "next/navigation";

import { requireOwner } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  automationDetail,
  editableGraph,
  exitReasonLabel,
  isTimeTrigger,
  listEnrollments,
} from "@/lib/automations";
// Lives in campaign-format, not automations: it labels a *send* that the
// consent gate declined, which is the same vocabulary for a campaign and an
// automation because both end at queueMessage. lib/automations re-exports
// automation-flow only, so this one has to come from its own module.
import { skipReasonLabel } from "@/lib/campaign-format";
import { listTags } from "@/lib/customers";
import { Badge, Card, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import { TRIGGER_LABELS } from "@/lib/automation-flow";
import { AutomationEditor } from "./Editor";
import {
  CancelEnrollmentButton,
  DetachButton,
  LifecycleControls,
  TemplateUpdateBanner,
} from "../Forms";

export const dynamic = "force-dynamic";

/**
 * One journey: the builder, its lifecycle controls, and what it has actually
 * done.
 *
 * The results sit under the canvas on the same page rather than behind a tab,
 * because the question an owner has after drawing a journey is "is it
 * working", and the honest answer to that is the skip breakdown — a journey
 * that enrolled 400 people and sent 90 texts is working, and the only way
 * anybody believes that is to see the reasons.
 */
export default async function AutomationPage({ params }: { params: { id: string } }) {
  const { restaurantId } = await requireOwner();

  const detail = await automationDetail(restaurantId, params.id);
  if (!detail) notFound();

  const { automation, counts, skipReasons } = detail;

  const [tags, restaurant, enrollments, updateVersion] = await Promise.all([
    listTags(restaurantId),
    prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { name: true } }),
    listEnrollments(restaurantId, automation.id, undefined, 25),
    automation.templateUpdateAvailableVersionId
      ? prisma.automationTemplateVersion.findUnique({
          where: { id: automation.templateUpdateAvailableVersionId },
          select: { notes: true },
        })
      : null,
  ]);

  const graph = editableGraph(automation);
  const readOnly = !!automation.templateId && automation.template?.syncPolicy === "ALWAYS";

  const liveCount = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;

  return (
    <>
      <SectionTitle
        title={automation.name}
        subtitle={`${TRIGGER_LABELS[automation.triggerType] ?? automation.triggerType}${
          isTimeTrigger(automation.triggerType) ? " — checked periodically rather than fired by an event." : ""
        }`}
        action={
          <Link href="/dashboard/marketing/automations" className="text-[13px] text-dim hover:underline">
            All journeys
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={automation.status === "ACTIVE" ? "good" : automation.status === "PAUSED" ? "warn" : "neutral"}>
          {automation.status.toLowerCase()}
        </Badge>
        <LifecycleControls id={automation.id} status={automation.status} />
      </div>

      {automation.templateUpdateAvailableVersionId ? (
        <div className="mb-4">
          <TemplateUpdateBanner id={automation.id} notes={updateVersion?.notes ?? null} />
        </div>
      ) : null}

      {automation.templateId ? (
        <Card className="mb-4">
          <p className="text-[12px] text-dim">
            {readOnly
              ? "This journey is one of ours and stays in step with the template, so it can't be edited here."
              : automation.templateForkedAt
                ? "Started from one of our templates and edited since, so it's yours — our updates won't overwrite it."
                : "Started from one of our templates. Editing it makes it yours."}
          </p>
          <div className="mt-2">
            <DetachButton id={automation.id} />
          </div>
        </Card>
      ) : null}

      {automation.triggerType === "WEBHOOK" && automation.hookToken ? (
        <Card className="mb-4">
          <p className="text-[12px] font-medium text-ink">Webhook URL</p>
          <p className="mt-1 break-all font-mono text-[12px] text-dim">
            POST /api/automations/hook/{automation.hookToken}
          </p>
          <p className="mt-1 text-[11px] text-mute">
            Send <code>{`{"phone": "..."}`}</code> or <code>{`{"email": "..."}`}</code>. It enrolls an existing
            customer — it can&rsquo;t create one, and it can&rsquo;t grant permission to message anybody.
          </p>
        </Card>
      ) : null}

      <AutomationEditor
        id={automation.id}
        name={automation.name}
        graph={graph}
        tags={tags.map((t) => ({ id: t.id, slug: t.slug, name: t.name }))}
        restaurantName={restaurant?.name ?? "the restaurant"}
        reentry={automation.reentry}
        reentryDays={automation.reentryDays}
        quietStartMin={automation.quietStartMin}
        quietEndMin={automation.quietEndMin}
        readOnly={readOnly}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="mb-2 text-[13px] font-medium text-ink">Where people are</p>
          <dl className="space-y-1 text-[12px]">
            {[
              ["In it now", liveCount("ACTIVE") + liveCount("WAITING")],
              ["Finished", liveCount("COMPLETED")],
              ["Left early", liveCount("EXITED")],
              ["Taken out", liveCount("CANCELED")],
              ["Stopped by a problem", liveCount("FAILED")],
            ].map(([label, n]) => (
              <div key={String(label)} className="flex justify-between">
                <dt className="text-dim">{label}</dt>
                <dd className="tabular-nums text-ink">{n}</dd>
              </div>
            ))}
            <div className="flex justify-between border-t border-line pt-1">
              <dt className="text-dim">Reached the goal</dt>
              <dd className="tabular-nums text-accent">{automation.goalCount}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <p className="text-[13px] font-medium text-ink">Messages this journey didn&rsquo;t send</p>
          <p className="mb-2 mt-1 text-[12px] text-dim">
            Not a fault. These are the people the consent rules say can&rsquo;t be contacted on that channel.
          </p>
          {skipReasons.length === 0 ? (
            <p className="text-[12px] text-mute">Nothing skipped yet.</p>
          ) : (
            <dl className="space-y-1 text-[12px]">
              {skipReasons.map((r) => (
                <div key={r.error ?? "unknown"} className="flex justify-between gap-4">
                  <dt className="text-dim">{skipReasonLabel(r.error)}</dt>
                  <dd className="tabular-nums text-ink">{r._count._all}</dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[13px] font-medium text-ink">Recent people</p>
        <Table>
          <thead>
            <tr>
              <Th>Customer</Th>
              <Th>Entered</Th>
              <Th>Status</Th>
              <Th>Where they stopped</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {enrollments.length === 0 ? (
              <tr>
                <Td className="text-mute">Nobody has entered this journey yet.</Td>
                <Td /><Td /><Td /><Td />
              </tr>
            ) : (
              enrollments.map((e) => (
                <tr key={e.id}>
                  <Td>
                    <Link href={`/dashboard/customers/${e.customer.id}`} className="text-ink hover:underline">
                      {e.customer.name ?? e.customer.phone ?? e.customer.email ?? "Unnamed"}
                    </Link>
                  </Td>
                  <Td className="text-dim">{e.enteredAt.toLocaleDateString()}</Td>
                  <Td className="text-dim">{e.status.toLowerCase()}</Td>
                  <Td className="text-dim">{e.exitReason ? exitReasonLabel(e.exitReason) : (e.currentNodeId ?? "just started")}</Td>
                  <Td>
                    {e.status === "ACTIVE" || e.status === "WAITING" ? (
                      <CancelEnrollmentButton id={automation.id} enrollmentId={e.id} />
                    ) : null}
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </Table>
      </div>
    </>
  );
}
