import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { editableTemplateGraph, templateDetail } from "@/lib/automation-templates";
import { Badge, Card, SectionTitle, Table, Td, Th } from "@/components/hearth/ui";
import { PublishForm, RetireForm, TemplateEditor } from "../Forms";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: { id: string } }) {
  await requireAdmin();

  const template = await templateDetail(params.id);
  if (!template) notFound();

  const graph = editableTemplateGraph(template);

  // Who is actually running this, and on which version. The interesting number
  // is the forked one: those are the tenants a publish will not reach, and
  // "why didn't my fix land" is otherwise a mystery answerable only in SQL.
  const adopters = await prisma.automation.findMany({
    where: { templateId: template.id },
    select: {
      id: true,
      name: true,
      status: true,
      templateForkedAt: true,
      templateVersionId: true,
      restaurant: { select: { id: true, name: true } },
    },
    take: 100,
  });

  const versionNumber = new Map(template.versions.map((v) => [v.id, v.version]));

  return (
    <>
      <SectionTitle
        title={template.name}
        subtitle={template.blurb ?? undefined}
        action={
          <Link href="/admin/templates" className="text-[13px] text-dim hover:underline">
            All templates
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Badge tone={template.status === "PUBLISHED" ? "good" : "neutral"}>{template.status.toLowerCase()}</Badge>
        <span className="text-[12px] text-dim">
          {template.publishedVersion ? `Published v${template.publishedVersion.version}` : "Never published"}
        </span>
        <RetireForm id={template.id} />
      </div>

      <TemplateEditor
        id={template.id}
        name={template.name}
        blurb={template.blurb}
        visibility={template.visibility}
        syncPolicy={template.syncPolicy}
        graph={graph}
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <PublishForm id={template.id} adoptionCount={adopters.length} />

        <Card>
          <p className="mb-2 text-[13px] font-medium text-ink">Version history</p>
          {template.versions.length === 0 ? (
            <p className="text-[12px] text-mute">Nothing published yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {template.versions.map((v) => (
                <li key={v.id} className="text-[12px]">
                  <span className="text-ink">v{v.version}</span>{" "}
                  <span className="text-mute">{v.publishedAt.toLocaleDateString()}</span>
                  {v.notes ? <span className="block text-dim">{v.notes}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[13px] font-medium text-ink">Running this</p>
        <Table>
          <thead>
            <tr>
              <Th>Restaurant</Th>
              <Th>Journey</Th>
              <Th>Status</Th>
              <Th>On version</Th>
              <Th>Follows updates</Th>
            </tr>
          </thead>
          <tbody>
            {adopters.length === 0 ? (
              <tr>
                <Td className="text-mute">Nobody has adopted this yet.</Td>
                <Td /><Td /><Td /><Td />
              </tr>
            ) : (
              adopters.map((a) => (
                <tr key={a.id}>
                  <Td>
                    <Link href={`/admin/restaurants/${a.restaurant.id}`} className="text-ink hover:underline">
                      {a.restaurant.name}
                    </Link>
                  </Td>
                  <Td className="text-dim">{a.name}</Td>
                  <Td className="text-dim">{a.status.toLowerCase()}</Td>
                  <Td className="text-dim">
                    {a.templateVersionId ? `v${versionNumber.get(a.templateVersionId) ?? "?"}` : "—"}
                  </Td>
                  <Td className="text-dim">
                    {template.syncPolicy === "ALWAYS"
                      ? "yes — read-only"
                      : a.templateForkedAt
                        ? "no — they edited it"
                        : template.syncPolicy === "OPT_IN"
                          ? "only if they accept"
                          : "yes"}
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
