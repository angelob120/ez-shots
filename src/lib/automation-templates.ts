import "server-only";

import { prisma } from "@/lib/prisma";
import { parseGraph, tagSlugsIn, validateGraph, type Graph } from "@/lib/automation-flow";

/** Who sees a template. A String on the model, not an enum, for the same
 *  reason node kinds are — the vocabulary lives here in code. */
export const TEMPLATE_VISIBILITIES = ["PRIVATE", "OWNERS", "PRESET"] as const;
export type TemplateVisibility = (typeof TEMPLATE_VISIBILITIES)[number];

export function coerceVisibility(v: string | null | undefined): TemplateVisibility {
  return v === "PRIVATE" || v === "OWNERS" || v === "PRESET" ? v : "OWNERS";
}
import type { Prisma, TemplateSyncPolicy } from "@prisma/client";

/**
 * Preset journeys: ours to write, owners' to adopt.
 *
 * An owner staring at an empty canvas is an owner who never builds a journey.
 * A template is a working one they can turn on in a click — and, because we
 * wrote it, one whose wording and timing we can improve later for everybody who
 * took it.
 *
 * ─── The question this module exists to answer ────────────────────────────
 *
 * "I just fixed a typo in a template that forty restaurants are running. What
 * happens to them?"
 *
 * There are three legitimate answers and which is right depends on what the
 * template is, so it is a per-template setting rather than a global rule. See
 * `docs/automations.md` for the table; the short version:
 *
 *   - `ALWAYS` — the template is ours and stays ours. Owners can't edit it;
 *     they copy it if they want changes, and the copy has no link. Right for a
 *     journey whose correctness is our problem.
 *   - `AUTO_UNLESS_CUSTOMIZED` — the default. Untouched adopters move with us;
 *     an owner who edited theirs has forked it and keeps their version, and is
 *     told an update exists. Right for almost everything.
 *   - `OPT_IN` — nobody moves without pressing a button. Right for anything
 *     whose wording an owner has a legitimate opinion about.
 *
 * ─── Two rules that hold under every policy ───────────────────────────────
 *
 * **A sync never touches an in-flight enrollment.** Versions are pinned
 * (`AutomationEnrollment.versionId`), so a sync repoints the automation and the
 * *next* person to enter gets the new graph. Somebody three steps into a
 * sequence finishes the one they started, because the alternative is a customer
 * standing at a node that no longer exists.
 *
 * **A sync never activates anything.** A paused or draft automation stays
 * paused or draft. An owner who switched a journey off has made a decision, and
 * a publish on our side overriding it is us sending messages from an account
 * whose owner turned them off.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * The owner-facing gallery. Published only — a draft being visible to owners is
 * the exact failure the draft/version split exists to prevent.
 *
 * Visibility decides who sees a template. Owners see OWNERS templates (ordinary
 * DIY journeys) and PRESET templates (the done-for-you reordering ones), so a
 * hands-on owner who declined the dial can still adopt a preset by hand.
 * PRIVATE templates — admin experiments and half-built drafts — never appear
 * here. Admins see everything via `listAllTemplates`.
 */
export async function listPublishedTemplates() {
  return prisma.automationTemplate.findMany({
    where: {
      status: "PUBLISHED",
      publishedVersionId: { not: null },
      visibility: { in: ["OWNERS", "PRESET"] },
    },
    orderBy: { name: "asc" },
    include: { publishedVersion: true },
  });
}

export async function listAllTemplates() {
  return prisma.automationTemplate.findMany({
    orderBy: { updatedAt: "desc" },
    include: { publishedVersion: { select: { id: true, version: true, publishedAt: true } } },
  });
}

export async function templateDetail(id: string) {
  return prisma.automationTemplate.findUnique({
    where: { id },
    include: {
      publishedVersion: true,
      versions: { orderBy: { version: "desc" }, take: 20 },
    },
  });
}

/** What the admin is editing. Falls back to the published graph so opening a
 *  template that has never been edited shows what owners are actually running. */
export function editableTemplateGraph(t: {
  draftGraph: Prisma.JsonValue | null;
  publishedVersion?: { graph: Prisma.JsonValue } | null;
}): Graph {
  return parseGraph(t.draftGraph ?? t.publishedVersion?.graph ?? null);
}

// ---------------------------------------------------------------------------
// Admin CRUD
// ---------------------------------------------------------------------------

export type TemplateInput = {
  name: string;
  slug: string;
  blurb?: string | null;
  visibility?: TemplateVisibility;
  syncPolicy?: TemplateSyncPolicy;
  triggerType: string;
  triggerConfig?: Prisma.InputJsonValue | null;
  graph: Graph;
};

export async function createTemplate(input: TemplateInput) {
  return prisma.automationTemplate.create({
    data: {
      name: input.name.trim(),
      slug: input.slug.trim(),
      blurb: input.blurb ?? null,
      visibility: input.visibility ?? "OWNERS",
      syncPolicy: input.syncPolicy ?? "AUTO_UNLESS_CUSTOMIZED",
      triggerType: input.triggerType,
      triggerConfig: (input.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      draftGraph: input.graph as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Edits the draft only. Nothing an owner can see moves until Publish. */
export async function saveTemplateDraft(id: string, input: TemplateInput) {
  await prisma.automationTemplate.update({
    where: { id },
    data: {
      name: input.name.trim(),
      blurb: input.blurb ?? null,
      visibility: input.visibility ?? "OWNERS",
      syncPolicy: input.syncPolicy ?? "AUTO_UNLESS_CUSTOMIZED",
      triggerType: input.triggerType,
      triggerConfig: (input.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      draftGraph: input.graph as unknown as Prisma.InputJsonValue,
    },
  });
  return { ok: "Draft saved. Owners still see the published version." };
}

export type PublishResult = {
  ok?: string;
  error?: string;
  /** How many tenants' journeys were repointed, and how many were only told. */
  updated?: number;
  notified?: number;
};

/**
 * Freezes the draft as a version, points the template at it, and applies the
 * sync policy to everyone who adopted it.
 *
 * The validation is not a formality and not the same as the owner's. A template
 * publishes into *other people's* accounts — a broken graph here is forty
 * restaurants with a journey that stops halfway, and each of those is a
 * customer who was promised a follow-up. The one place we can catch it is here,
 * before the button is pressed.
 */
export async function publishTemplate(
  id: string,
  notes: string | null,
  actorId: string | null,
): Promise<PublishResult> {
  const template = await prisma.automationTemplate.findUnique({
    where: { id },
    include: { publishedVersion: true },
  });
  if (!template) return { error: "Template not found." };

  const graph = editableTemplateGraph(template);

  // "the restaurant" rather than a real name: a template's SMS bodies are
  // length-checked against a generic merge, because we don't know whose name
  // will be substituted. That understates the segment count for a restaurant
  // with a long name, which is why the owner's own validator runs again on
  // adopt — the tenant-specific check has to happen where the tenant is known.
  const errors = validateGraph(graph, "the restaurant");
  if (errors.length) return { error: errors[0].message };

  const last = await prisma.automationTemplateVersion.findFirst({
    where: { templateId: id },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const version = await prisma.automationTemplateVersion.create({
    data: {
      templateId: id,
      version: (last?.version ?? 0) + 1,
      graph: graph as unknown as Prisma.InputJsonValue,
      triggerType: template.triggerType,
      triggerConfig: (template.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      notes: notes?.trim() || null,
      publishedByUserId: actorId,
    },
  });

  await prisma.automationTemplate.update({
    where: { id },
    data: { status: "PUBLISHED", publishedVersionId: version.id },
  });

  const fanout = await applyPublishToAdopters(id, version.id, template.syncPolicy);

  return {
    ok:
      fanout.updated + fanout.notified === 0
        ? "Published."
        : `Published. ${fanout.updated} journey${fanout.updated === 1 ? "" : "s"} updated, ` +
          `${fanout.notified} told an update is available.`,
    ...fanout,
  };
}

/**
 * The fan-out. Where the three policies actually differ.
 *
 * `ALWAYS` and the untouched half of `AUTO_UNLESS_CUSTOMIZED` are *repointed*,
 * which means a new `AutomationVersion` per tenant carrying the template's
 * graph. Sharing one version row across tenants would be smaller and wrong:
 * `AutomationVersion` is what an enrollment pins to and what answers "what did
 * the journey that texted my customer say", and a row owned by nobody in
 * particular can't be tenant-scoped or deleted with a tenant.
 */
async function applyPublishToAdopters(
  templateId: string,
  templateVersionId: string,
  policy: TemplateSyncPolicy,
): Promise<{ updated: number; notified: number }> {
  const adopters = await prisma.automation.findMany({
    where: { templateId, status: { not: "ARCHIVED" } },
    select: { id: true, status: true, templateForkedAt: true, restaurantId: true },
  });

  const version = await prisma.automationTemplateVersion.findUnique({
    where: { id: templateVersionId },
  });
  if (!version) return { updated: 0, notified: 0 };

  let updated = 0;
  let notified = 0;

  for (const a of adopters) {
    const takesIt =
      policy === "ALWAYS" || (policy === "AUTO_UNLESS_CUSTOMIZED" && a.templateForkedAt === null);

    if (!takesIt) {
      await prisma.automation.update({
        where: { id: a.id },
        data: { templateUpdateAvailableVersionId: templateVersionId },
      });
      notified++;
      continue;
    }

    await applyTemplateVersion(a.id, version);
    updated++;
  }

  await prisma.automationTemplate.update({
    where: { id: templateId },
    data: { adoptionCount: adopters.length },
  });

  return { updated, notified };
}

/**
 * Writes a template version into one tenant's automation.
 *
 * Note what is *not* touched: `status`, and anything in flight. A paused
 * journey stays paused, a draft stays a draft, and everyone mid-sequence
 * finishes on the version they entered on. This function only decides what the
 * next person to enter will walk.
 */
async function applyTemplateVersion(
  automationId: string,
  templateVersion: {
    id: string;
    graph: Prisma.JsonValue;
    triggerType: string;
    triggerConfig: Prisma.JsonValue | null;
  },
) {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: { id: true, status: true },
  });
  if (!automation) return;

  const last = await prisma.automationVersion.findFirst({
    where: { automationId },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const version = await prisma.automationVersion.create({
    data: {
      automationId,
      version: (last?.version ?? 0) + 1,
      graph: templateVersion.graph as Prisma.InputJsonValue,
      triggerType: templateVersion.triggerType,
      triggerConfig: (templateVersion.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      templateVersionId: templateVersion.id,
    },
  });

  await prisma.automation.update({
    where: { id: automationId },
    data: {
      draftGraph: templateVersion.graph as Prisma.InputJsonValue,
      triggerType: templateVersion.triggerType,
      triggerConfig: (templateVersion.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      templateVersionId: templateVersion.id,
      templateUpdateAvailableVersionId: null,
      // Only a running journey gets its active version moved. A draft that took
      // an update is still a draft — activating it here would start sending
      // from an account whose owner never pressed go.
      ...(automation.status === "ACTIVE" ? { activeVersionId: version.id } : {}),
    },
  });
}

export async function retireTemplate(id: string) {
  // Existing adopters keep running. Retiring means "stop offering this", not
  // "switch it off in forty restaurants" — the second is a decision for each
  // owner, and taking it for them is how a restaurant's follow-ups vanish
  // without anybody telling them.
  await prisma.automationTemplate.update({ where: { id }, data: { status: "RETIRED" } });
  return { ok: "Retired. It's out of the gallery; anyone already running it keeps it." };
}

// ---------------------------------------------------------------------------
// Owner side
// ---------------------------------------------------------------------------

/**
 * Adopts a template into a tenant, as a **draft**.
 *
 * Never activated on adopt, deliberately. A journey that starts texting the
 * moment somebody clicks "Use this" from a gallery is a journey nobody read
 * first — and the owner has not yet seen the wording that is about to go out
 * under their name. They open it, read it, and press go.
 *
 * Tags referenced by the template are created if the tenant doesn't have them.
 * Without that, an ADD_TAG step in a preset silently does nothing on every
 * tenant that never happened to invent that tag.
 */
export async function adoptTemplate(
  restaurantId: string,
  templateId: string,
  actorId?: string | null,
): Promise<{ ok?: string; error?: string; automationId?: string }> {
  const template = await prisma.automationTemplate.findFirst({
    where: { id: templateId, status: "PUBLISHED" },
    include: { publishedVersion: true },
  });
  if (!template?.publishedVersion) return { error: "That template isn't available." };

  const version = template.publishedVersion;
  const graph = parseGraph(version.graph);

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });

  // Re-validated against this tenant's name. The publish-time check used a
  // generic one, and a restaurant called "Giuseppe's Neapolitan Pizzeria &
  // Wine Bar" can push a template's SMS over a segment boundary that the same
  // template cleared for everybody else. Better to refuse the adopt than to
  // bill them double on every send forever.
  const errors = validateGraph(graph, restaurant?.name ?? "the restaurant");
  if (errors.length) {
    return { error: `That template doesn't fit your account: ${errors[0].message}` };
  }

  await ensureTemplateTags(restaurantId, graph);

  const automation = await prisma.automation.create({
    data: {
      restaurantId,
      name: template.name,
      status: "DRAFT",
      triggerType: version.triggerType,
      triggerConfig: (version.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      draftGraph: version.graph as Prisma.InputJsonValue,
      templateId: template.id,
      templateVersionId: version.id,
      createdByUserId: actorId ?? null,
    },
  });

  await prisma.automationTemplate.update({
    where: { id: template.id },
    data: { adoptionCount: { increment: 1 } },
  });

  return { ok: "Added as a draft. Read it through, then switch it on.", automationId: automation.id };
}

/**
 * Creates any tag a template's graph refers to.
 *
 * Marked `system: false` — these become the tenant's own tags, which they may
 * rename or delete. The import tags in `lib/customer-import.ts` are `system`
 * because their name is a factual record of where rows came from; a tag a
 * journey applies is just a tag.
 */
async function ensureTemplateTags(restaurantId: string, graph: Graph) {
  for (const slug of tagSlugsIn(graph)) {
    const existing = await prisma.customerTag.findFirst({ where: { restaurantId, slug } });
    if (existing) continue;
    await prisma.customerTag.create({
      data: {
        restaurantId,
        slug,
        // Title-cased back from the slug. Approximate, and the owner can rename
        // it — better than a tag literally called "vip-2024" in their filter bar.
        name: slug.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
        color: "neutral",
      },
    });
  }
}

/**
 * Takes an update the owner was offered. Only reachable under `OPT_IN`, or for
 * a forked automation whose owner decided they'd rather have ours after all.
 */
export async function acceptTemplateUpdate(
  restaurantId: string,
  automationId: string,
): Promise<{ ok?: string; error?: string }> {
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, restaurantId },
    select: { id: true, templateUpdateAvailableVersionId: true },
  });
  if (!automation?.templateUpdateAvailableVersionId) return { error: "There's no update waiting." };

  const version = await prisma.automationTemplateVersion.findUnique({
    where: { id: automation.templateUpdateAvailableVersionId },
  });
  if (!version) return { error: "That update is no longer available." };

  await applyTemplateVersion(automationId, version);
  // Taking our version means it is no longer forked. If they edit again, it
  // forks again — the marker tracks the current state, not the history.
  await prisma.automation.update({
    where: { id: automationId },
    data: { templateForkedAt: null },
  });

  return { ok: "Updated. People already in the journey finish the version they started." };
}

export async function dismissTemplateUpdate(restaurantId: string, automationId: string) {
  await prisma.automation.updateMany({
    where: { id: automationId, restaurantId },
    data: { templateUpdateAvailableVersionId: null },
  });
  return { ok: "Dismissed. You're staying on your version." };
}

/**
 * Severs the link, keeping the graph.
 *
 * The escape hatch from `ALWAYS`, and the honest answer to "I like this one but
 * I want to change the wording": they get a copy that is entirely theirs and
 * that we will never touch again.
 */
export async function detachFromTemplate(restaurantId: string, automationId: string) {
  const res = await prisma.automation.updateMany({
    where: { id: automationId, restaurantId, templateId: { not: null } },
    data: {
      templateId: null,
      templateVersionId: null,
      templateForkedAt: null,
      templateUpdateAvailableVersionId: null,
    },
  });
  return res.count > 0
    ? { ok: "This is yours now. It won't change when we update the template." }
    : { error: "That journey isn't linked to a template." };
}
