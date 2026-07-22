"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireOwner, getSession } from "@/lib/auth";
import {
  activateAutomation,
  archiveAutomation,
  cancelEnrollment,
  createAutomation,
  enrollMany,
  parseGraph,
  pauseAutomation,
  resumeAutomation,
  saveDraft,
  starterGraph,
} from "@/lib/automations";
import {
  acceptTemplateUpdate,
  adoptTemplate,
  detachFromTemplate,
  dismissTemplateUpdate,
} from "@/lib/automation-templates";

/**
 * Owner-side automation actions.
 *
 * Every one re-derives `restaurantId` from `requireOwner()` and passes it as a
 * scope. No action here accepts a restaurant id from the form, and the library
 * functions take the scope as a required parameter rather than defaulting — so
 * an automation id posted from another tenant's page finds nothing rather than
 * starting a journey that texts that tenant's customers.
 */

type Result = { ok?: string; error?: string } | undefined;

function readGraph(fd: FormData) {
  // Parsed through the same tolerant reader the server uses everywhere else. A
  // hand-edited or truncated blob degrades into a graph the validator can
  // explain rather than throwing a 500 at somebody mid-edit.
  try {
    return parseGraph(JSON.parse(String(fd.get("graph") ?? "{}")));
  } catch {
    return parseGraph(null);
  }
}

function readMinutes(fd: FormData, key: string, fallback: number): number {
  const raw = String(fd.get(key) ?? "");
  const [h, m] = raw.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return fallback;
  return h * 60 + m;
}

export async function createAutomationAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const name = String(fd.get("name") ?? "").trim();
  if (!name) return { error: "Give the journey a name." };

  const automation = await createAutomation(
    restaurantId,
    { name, triggerType: "FIRST_ORDER", graph: starterGraph("FIRST_ORDER") },
    session.userId,
  );

  redirect(`/dashboard/marketing/automations/${automation.id}`);
}

export async function saveAutomationAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const graph = readGraph(fd);

  // The trigger lives on the trigger node, and the column mirrors it. One of
  // them has to be authoritative and it is the node, because that is what the
  // owner edited — the column exists so the event fan-out can be an indexed
  // query instead of a scan through every graph.
  const trigger = graph.nodes.find((n) => n.kind === "TRIGGER");
  const triggerType = trigger?.config.trigger ?? "FIRST_ORDER";

  const res = await saveDraft(restaurantId, id, {
    name: String(fd.get("name") ?? ""),
    triggerType,
    triggerConfig: {
      tagSlug: trigger?.config.tagSlug ?? null,
      lapsedDays: trigger?.config.lapsedDays ?? null,
      anniversaryDays: trigger?.config.anniversaryDays ?? null,
    },
    graph,
    reentry: (String(fd.get("reentry") ?? "ONCE") as "ONCE" | "ONCE_PER_TRIGGER" | "COOLDOWN" | "ALWAYS"),
    reentryDays: Number(fd.get("reentryDays")) || 30,
    quietStartMin: readMinutes(fd, "quietStart", 540),
    quietEndMin: readMinutes(fd, "quietEnd", 1200),
  });

  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return res;
}

export async function activateAutomationAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const res = await activateAutomation(restaurantId, id);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return { ok: res.ok, error: res.error };
}

export async function pauseAutomationAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const res = await pauseAutomation(restaurantId, id);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return res;
}

export async function resumeAutomationAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const res = await resumeAutomation(restaurantId, id);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return res;
}

export async function archiveAutomationAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await archiveAutomation(restaurantId, String(fd.get("id") ?? ""));
  revalidatePath("/dashboard/marketing/automations");
  return res;
}

export async function adoptTemplateAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const session = await getSession();
  const res = await adoptTemplate(restaurantId, String(fd.get("templateId") ?? ""), session?.userId ?? null);
  if (res.automationId) redirect(`/dashboard/marketing/automations/${res.automationId}`);
  return { ok: res.ok, error: res.error };
}

export async function acceptUpdateAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const res = await acceptTemplateUpdate(restaurantId, id);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return res;
}

export async function dismissUpdateAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const res = await dismissTemplateUpdate(restaurantId, id);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return res;
}

export async function detachAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const res = await detachFromTemplate(restaurantId, id);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return res;
}

export async function cancelEnrollmentAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await cancelEnrollment(restaurantId, String(fd.get("enrollmentId") ?? ""));
  revalidatePath(`/dashboard/marketing/automations/${String(fd.get("id") ?? "")}`);
  return res;
}

/**
 * Bulk enrollment for MANUAL journeys.
 *
 * The ids are re-scoped to the tenant inside `enrollMany` rather than trusted
 * from the form — the same rule `tagMatching` follows, and for a sharper
 * reason: the thing on the other end of this is a text message.
 */
export async function enrollCustomersAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("id") ?? "");
  const ids = String(fd.get("customerIds") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (ids.length === 0) return { error: "Nobody selected." };

  const res = await enrollMany(restaurantId, id, ids);
  revalidatePath(`/dashboard/marketing/automations/${id}`);
  return {
    ok: `${res.enrolled} added${res.skipped ? `, ${res.skipped} skipped (already in it, or blocked by the re-entry rule)` : ""}.`,
  };
}
