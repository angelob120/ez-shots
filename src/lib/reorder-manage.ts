import "server-only";

import { prisma } from "@/lib/prisma";
import {
  activateAutomation,
  pauseAutomation,
  resumeAutomation,
} from "@/lib/automations";
import { adoptTemplate } from "@/lib/automation-templates";
import {
  reorderConfigFor,
  reorderTemplateSlug,
  ALL_REORDER_SLUGS,
  MODE_LABEL,
  coerceMode,
  type ReorderMode,
} from "@/lib/reorder";
import { reorderReentryDays } from "@/lib/reorder-templates";

/**
 * The one door between the owner's reordering choice and the machinery.
 *
 * The dial does not run journeys itself — it turns the platform's reordering
 * templates on and off for a tenant, reusing the exact same adopt / activate /
 * pause primitives an owner uses by hand in the builder. So there is no second
 * enrollment path and no second sending path: a reordering message is an
 * ordinary automation send, subject to the ordinary consent gate.
 *
 * ─── The rule that isn't obvious ──────────────────────────────────────────
 *
 * **Switching levels never yanks anyone mid-journey.** Turning the dial down,
 * or off, *pauses* the old level's automation — it does not archive it. Pause
 * stops new entrants; everyone already three texts into a sequence finishes it.
 * That is what makes "dial it down when trade is heavy" safe: it slows what
 * happens next without cancelling a message already promised. Archiving would
 * be the yank, and this deliberately never does it.
 *
 * Idempotent by design. Re-applying the same choice is a no-op; re-enabling a
 * level a tenant used before *resumes* the existing paused automation rather
 * than adopting a second copy, so a tenant accumulates at most one automation
 * per level however many times they flip the dial.
 */

export type ReorderApplyResult = { ok?: string; error?: string };

/** A tenant's reordering automations, whatever state they're in. */
async function reorderAutomations(restaurantId: string) {
  return prisma.automation.findMany({
    where: {
      restaurantId,
      status: { not: "ARCHIVED" },
      template: { slug: { in: ALL_REORDER_SLUGS } },
    },
    select: { id: true, status: true, template: { select: { slug: true } } },
  });
}

export async function applyReorderChoice(
  restaurantId: string,
  choice: { enabled: boolean; mode: ReorderMode },
): Promise<ReorderApplyResult> {
  const existing = await reorderAutomations(restaurantId);

  // Off: pause anything running, leave in-flight enrollments to finish.
  if (!choice.enabled) {
    for (const a of existing) if (a.status === "ACTIVE") await pauseAutomation(restaurantId, a.id);
    return { ok: "Reordering is off. Anyone already in a sequence will finish it." };
  }

  const targetSlug = reorderTemplateSlug(choice.mode);

  // Pause any *other* level that's running, so exactly one is live at a time.
  for (const a of existing) {
    if (a.status === "ACTIVE" && a.template?.slug !== targetSlug) {
      await pauseAutomation(restaurantId, a.id);
    }
  }

  const target = existing.find((a) => a.template?.slug === targetSlug);

  if (target) {
    if (target.status === "ACTIVE") return { ok: `Reordering is on (${MODE_LABEL[choice.mode]}).` };
    if (target.status === "PAUSED") {
      const r = await resumeAutomation(restaurantId, target.id);
      return r.error ? { error: r.error } : { ok: `Reordering is on (${MODE_LABEL[choice.mode]}).` };
    }
    // DRAFT (adopted but never started) — publish and start it.
    const r = await activateAutomation(restaurantId, target.id);
    return r.error ? { error: r.error } : { ok: `Reordering is on (${MODE_LABEL[choice.mode]}).` };
  }

  // First time on this level: adopt the template, set the frequency cap, start.
  const template = await prisma.automationTemplate.findUnique({
    where: { slug: targetSlug },
    select: { id: true },
  });
  if (!template) {
    // The templates haven't been seeded on this environment yet. Not the
    // owner's problem to solve, and not a reason to lose their choice — the
    // preference columns are already saved; this only failed to start the
    // journey. See seedReorderTemplates.
    return { error: "Reordering isn't available yet on this account. Your choice is saved." };
  }

  const adopted = await adoptTemplate(restaurantId, template.id);
  if (adopted.error || !adopted.automationId) {
    return { error: adopted.error ?? "Couldn't set up reordering." };
  }

  // A reordering journey re-enrolls a customer after a cooldown — that gap is
  // the frequency cap the level promises. adoptTemplate lands on the ONCE
  // default, which would let each customer be won back exactly once ever; wrong
  // for a standing win-back.
  await prisma.automation.update({
    where: { id: adopted.automationId },
    data: {
      reentry: "COOLDOWN",
      reentryDays: reorderReentryDays(choice.mode),
      name: `Bring customers back — ${MODE_LABEL[choice.mode]}`,
    },
  });

  const started = await activateAutomation(restaurantId, adopted.automationId);
  if (started.error) return { error: started.error };
  return { ok: `Reordering is on (${MODE_LABEL[choice.mode]}).` };
}

export type ReorderStatus = {
  enabled: boolean;
  mode: ReorderMode;
  /** Whether a matching automation is actually live right now — which can lag
   *  the preference if the templates aren't seeded or messaging is suspended. */
  running: boolean;
  /** How many customers this level's journey has ever entered. */
  enteredCount: number;
  /** How many are mid-sequence right now. */
  inFlight: number;
};

/**
 * What the dashboard card shows. Reads the preference through the choke point
 * and joins it to the live automation, so the card can tell the truth when the
 * owner's choice and the running state disagree (e.g. "On, but paused because
 * messaging is suspended").
 */
export async function reorderStatusFor(restaurantId: string): Promise<ReorderStatus> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { reorderCampaigns: true, reorderMode: true },
  });
  const cfg = reorderConfigFor({
    reorderCampaigns: r?.reorderCampaigns ?? false,
    reorderMode: r?.reorderMode ?? null,
  });

  const targetSlug = reorderTemplateSlug(cfg.mode);
  const automation = await prisma.automation.findFirst({
    where: { restaurantId, template: { slug: targetSlug }, status: { not: "ARCHIVED" } },
    select: {
      status: true,
      enteredCount: true,
      _count: { select: { enrollments: { where: { status: { in: ["ACTIVE", "WAITING"] } } } } },
    },
  });

  return {
    enabled: cfg.enabled,
    mode: cfg.mode,
    running: automation?.status === "ACTIVE",
    enteredCount: automation?.enteredCount ?? 0,
    inFlight: automation?._count.enrollments ?? 0,
  };
}

/**
 * Persist a dashboard change to the dial and apply it. The owner-facing twin of
 * onboarding's saveReorderAction: writes the two columns and the timestamp,
 * then reconciles the machinery. Callers pass an already-validated mode; this
 * coerces once more so a bad value can't reach the column.
 */
export async function setReorderChoice(
  restaurantId: string,
  enabled: boolean,
  modeInput: string,
): Promise<ReorderApplyResult> {
  const mode = coerceMode(modeInput);
  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { reorderCampaigns: enabled, reorderMode: mode, reorderChoiceAt: new Date() },
  });
  return applyReorderChoice(restaurantId, { enabled, mode });
}
