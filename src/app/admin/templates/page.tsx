import Link from "next/link";

import { requireAdmin } from "@/lib/auth";
import { listAllTemplates } from "@/lib/automation-templates";
import { Badge, Card, Empty, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import { TRIGGER_LABELS } from "@/lib/automation-flow";
import { NewTemplateForm } from "./Forms";
import type { TemplateStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

/**
 * The template library.
 *
 * Two columns carry most of the weight here and both are about blast radius:
 * how many tenants are running each template, and what a publish does to them.
 * A publish is the one action in the console that writes into other people's
 * accounts, and the person about to press it should be able to see the number
 * of restaurants it lands in without opening anything.
 */

const STATUS_TONE: Record<TemplateStatus, "neutral" | "good" | "warn"> = {
  DRAFT: "neutral",
  PUBLISHED: "good",
  RETIRED: "warn",
};

const POLICY_LABELS: Record<string, string> = {
  ALWAYS: "Always updates adopters",
  AUTO_UNLESS_CUSTOMIZED: "Updates untouched copies",
  OPT_IN: "Adopters choose",
};

export default async function TemplatesPage() {
  await requireAdmin();
  const templates = await listAllTemplates();

  return (
    <>
      <SectionTitle
        title="Journey templates"
        subtitle="Preset automations owners can adopt. Publishing writes into their accounts, so the sync policy is per template."
      />

      {templates.length === 0 ? (
        <Card>
          <Empty title="No templates yet" body="Build one, publish it, and it appears in every owner's gallery." />
          <NewTemplateForm />
        </Card>
      ) : (
        <div className="space-y-4">
          <Table>
            <thead>
              <tr>
                <Th>Template</Th>
                <Th>Trigger</Th>
                <Th>Status</Th>
                <Th>On publish</Th>
                <Th>Adopted by</Th>
                <Th>Version</Th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id}>
                  <Td>
                    <Link href={`/admin/templates/${t.id}`} className="text-ink hover:underline">
                      {t.name}
                    </Link>
                    {t.blurb ? <div className="text-[12px] text-mute">{t.blurb}</div> : null}
                  </Td>
                  <Td className="text-dim">{TRIGGER_LABELS[t.triggerType] ?? t.triggerType}</Td>
                  <Td>
                    <Badge tone={STATUS_TONE[t.status]}>{t.status.toLowerCase()}</Badge>
                  </Td>
                  <Td className="text-dim">{POLICY_LABELS[t.syncPolicy]}</Td>
                  <Td className="tabular-nums">{t.adoptionCount}</Td>
                  <Td className="text-dim">
                    {t.publishedVersion ? `v${t.publishedVersion.version}` : "never published"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <Card>
            <NewTemplateForm />
          </Card>
        </div>
      )}
    </>
  );
}
