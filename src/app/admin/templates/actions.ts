"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth";
import { parseGraph, starterGraph, type TriggerKind } from "@/lib/automations";
import {
  coerceVisibility,
  createTemplate,
  publishTemplate,
  retireTemplate,
  saveTemplateDraft,
} from "@/lib/automation-templates";
import type { TemplateSyncPolicy } from "@prisma/client";

/**
 * Admin-side template actions, all behind `requireAdmin()`.
 *
 * Unscoped by design — a template belongs to the platform, not to a tenant.
 * That is also why every one of these is more dangerous than its owner-side
 * equivalent: a publish here writes into other people's accounts, and a broken
 * graph is forty restaurants with a journey that stops halfway. The validation
 * that guards it lives in `publishTemplate`, not in this file.
 */

type Result = { ok?: string; error?: string } | undefined;

function readGraph(fd: FormData) {
  try {
    return parseGraph(JSON.parse(String(fd.get("graph") ?? "{}")));
  } catch {
    return parseGraph(null);
  }
}

function slugify(v: string): string {
  return v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

export async function createTemplateAction(_prev: Result, fd: FormData): Promise<Result> {
  await requireAdmin();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Name it." };

  const template = await createTemplate({
    name,
    slug: slugify(name) || `template-${Date.now()}`,
    triggerType: "FIRST_ORDER",
    graph: starterGraph("FIRST_ORDER"),
  });

  redirect(`/admin/templates/${template.id}`);
}

export async function saveTemplateAction(_prev: Result, fd: FormData): Promise<Result> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const graph = readGraph(fd);
  const trigger = graph.nodes.find((n) => n.kind === "TRIGGER");

  const res = await saveTemplateDraft(id, {
    name: String(fd.get("name") ?? ""),
    slug: "",
    blurb: String(fd.get("blurb") ?? "") || null,
    visibility: coerceVisibility(String(fd.get("visibility") ?? "")),
    syncPolicy: String(fd.get("syncPolicy") ?? "AUTO_UNLESS_CUSTOMIZED") as TemplateSyncPolicy,
    triggerType: (trigger?.config.trigger as TriggerKind) ?? "FIRST_ORDER",
    triggerConfig: {
      tagSlug: trigger?.config.tagSlug ?? null,
      lapsedDays: trigger?.config.lapsedDays ?? null,
      anniversaryDays: trigger?.config.anniversaryDays ?? null,
    },
    graph,
  });

  revalidatePath(`/admin/templates/${id}`);
  return res;
}

export async function publishTemplateAction(_prev: Result, fd: FormData): Promise<Result> {
  const session = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const res = await publishTemplate(id, String(fd.get("notes") ?? "") || null, session.userId);
  revalidatePath(`/admin/templates/${id}`);
  return { ok: res.ok, error: res.error };
}

export async function retireTemplateAction(_prev: Result, fd: FormData): Promise<Result> {
  await requireAdmin();
  const res = await retireTemplate(String(fd.get("id") ?? ""));
  revalidatePath("/admin/templates");
  return res;
}
