import Link from "next/link";

import { requireOwner } from "@/lib/auth";
import { listAutomations } from "@/lib/automations";
import { listPublishedTemplates } from "@/lib/automation-templates";
import { Badge, Card, Empty, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import { TRIGGER_LABELS } from "@/lib/automation-flow";
import { NewAutomationForm, AdoptButton } from "./Forms";
import type { AutomationStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The journeys list, and the gallery of ones we wrote.
 *
 * The gallery sits above the list on an empty account and below it once the
 * owner has journeys of their own — a preset is the answer to "I don't know
 * where to start", and once they do know, it's clutter in front of the thing
 * they came for.
 */

const STATUS_TONE: Record<AutomationStatus, "neutral" | "good" | "warn" | "bad"> = {
  DRAFT: "neutral",
  ACTIVE: "good",
  PAUSED: "warn",
  ARCHIVED: "neutral",
};

export default async function AutomationsPage() {
  const { restaurantId } = await requireOwner();

  const [automations, templates] = await Promise.all([
    listAutomations(restaurantId),
    listPublishedTemplates(),
  ]);

  const gallery = (
    <Card>
      <p className="text-[13px] font-medium text-ink">Ready-made journeys</p>
      <p className="mb-3 mt-1 text-[12px] text-dim">
        Written by us, added to your account as a draft so you can read the wording before anything goes out.
      </p>

      {templates.length === 0 ? (
        <p className="text-[12px] text-mute">Nothing published yet.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <div key={t.id} className="rounded-sm border border-line p-3">
              <p className="text-[13px] text-ink">{t.name}</p>
              <p className="mt-0.5 text-[12px] text-dim">{t.blurb ?? TRIGGER_LABELS[t.triggerType] ?? t.triggerType}</p>
              <div className="mt-2">
                <AdoptButton templateId={t.id} />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );

  return (
    <>
      <SectionTitle
        title="Journeys"
        subtitle="Standing instructions: when this happens to a customer, wait, then message them. Every send still passes the same consent rules."
      />

      {automations.length === 0 ? (
        <div className="space-y-4">
          {gallery}
          <Card>
            <Empty
              title="No journeys yet"
              body="Start one from scratch, or take one of the ready-made ones above."
            />
            <NewAutomationForm />
          </Card>
        </div>
      ) : (
        <div className="space-y-4">
          <Card>
            <Table>
              <thead>
                <tr>
                  <Th>Journey</Th>
                  <Th>Starts when</Th>
                  <Th>Status</Th>
                  <Th>Entered</Th>
                  <Th>Finished</Th>
                </tr>
              </thead>
              <tbody>
                {automations.map((a) => (
                  <tr key={a.id}>
                    <Td>
                      <Link href={`/dashboard/marketing/automations/${a.id}`} className="text-ink hover:underline">
                        {a.name}
                      </Link>
                      {a.templateUpdateAvailableVersionId ? (
                        <span className="ml-2 text-[11px] text-accent">update available</span>
                      ) : null}
                    </Td>
                    <Td className="text-dim">{TRIGGER_LABELS[a.triggerType] ?? a.triggerType}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[a.status]}>{a.status.toLowerCase()}</Badge>
                    </Td>
                    <Td className="tabular-nums">{a.enteredCount}</Td>
                    <Td className="tabular-nums">{a.completedCount}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <NewAutomationForm />
          </Card>

          {gallery}
        </div>
      )}
    </>
  );
}
