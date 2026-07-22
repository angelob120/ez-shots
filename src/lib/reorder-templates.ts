import "server-only";

import { prisma } from "@/lib/prisma";
import { validateGraph, type Graph } from "@/lib/automation-flow";
import {
  REORDER_TEMPLATE_SLUGS,
  MODE_LABEL,
  MODE_BLURB,
  REORDER_MODES,
  type ReorderMode,
} from "@/lib/reorder";
import type { Prisma } from "@prisma/client";

/**
 * The three reordering journeys, as admin-authored templates.
 *
 * These are the starting point, not a straitjacket: once seeded they open in
 * the builder at `/admin/templates` like any other template, and you tune the
 * copy and timing there. This module exists only so the three exist to begin
 * with — an owner who says "run it for me" on their first night needs a
 * published template to adopt, and it can't be one nobody has drawn yet.
 *
 * Each level is a LAPSED journey whose `lapsedDays` matches the dial's reach
 * (Light waits longest, Heavy shortest), with one to three texts spaced by the
 * level's rhythm. Every send is a SEND_SMS, so `queueMessage` enforces consent
 * at the moment it fires — the dial decides who is considered, never who is
 * contacted. See docs/reorder-dfy.md.
 *
 * Sync policy is ALWAYS: a reordering template is ours, its correctness is our
 * problem, and an owner who wants their own wording writes their own journey in
 * the builder rather than editing the one the platform runs for everyone.
 */

type LevelSpec = {
  mode: ReorderMode;
  lapsedDays: number;
  /** The SMS bodies, in order. Each is a separate touch; the gaps sit between
   *  them. `{{name}}` and `{{restaurant}}` are merged per recipient at send. */
  texts: string[];
  /** Days between one text and the next. Length is `texts.length - 1`. */
  gapsDays: number[];
  /** COOLDOWN re-entry gap: the minimum days before the same customer can be
   *  swept back in. This is the frequency cap the "dial it down" promise rests
   *  on, applied by the enrollment sweep via ReentryPolicy. */
  reentryDays: number;
};

/**
 * The cadence, per level. The one place these numbers live now — they used to
 * be in `reorder.ts`, but the whole point of templates-in-the-builder is that
 * timing is data you can change without a deploy, so they belong with the
 * journey. Keep the ordering monotone (Light reaches least and waits longest).
 */
const LEVELS: Record<ReorderMode, LevelSpec> = {
  LIGHT: {
    mode: "LIGHT",
    lapsedDays: 60,
    reentryDays: 45,
    texts: [
      "Hi {{name}}, it's {{restaurant}} — we've missed you! Come see us again soon.",
    ],
    gapsDays: [],
  },
  MEDIUM: {
    mode: "MEDIUM",
    lapsedDays: 30,
    reentryDays: 21,
    texts: [
      "Hi {{name}}, it's {{restaurant}} — it's been a while! We'd love to have you back.",
      "Still thinking of you at {{restaurant}}, {{name}}. Order anytime — we'll be ready.",
    ],
    gapsDays: [4],
  },
  HEAVY: {
    mode: "HEAVY",
    lapsedDays: 21,
    reentryDays: 14,
    texts: [
      "Hey {{name}}, {{restaurant}} here — we've missed you! Come grab your favourite.",
      "{{name}}, it's not the same without you at {{restaurant}}. Order whenever you like.",
      "Last nudge, {{name}} — {{restaurant}} would love to see you back soon.",
    ],
    gapsDays: [3, 3],
  },
};

/**
 * Build the graph for a level: TRIGGER(LAPSED) → SMS → [WAIT → SMS]… → EXIT.
 *
 * A straight line on purpose — a reordering nudge that branches is harder to
 * read than it is worth, and the goal (they order again) ends the enrollment
 * through the sweep's re-entry rules rather than a GOAL node here.
 */
export function reorderGraph(mode: ReorderMode): Graph {
  const spec = LEVELS[mode];
  const nodes: Graph["nodes"] = [
    { id: "trigger", kind: "TRIGGER", x: 80, y: 80, config: { trigger: "LAPSED", lapsedDays: spec.lapsedDays } },
  ];
  const edges: Graph["edges"] = [];

  let prev = "trigger";
  let y = 80;
  spec.texts.forEach((body, i) => {
    // A wait before every text except the first — the first fires when the
    // customer qualifies, the rest are spaced by the level's rhythm.
    if (i > 0) {
      y += 120;
      const waitId = `wait${i}`;
      nodes.push({ id: waitId, kind: "WAIT", x: 80, y, config: { amount: spec.gapsDays[i - 1], unit: "days" } });
      edges.push({ id: `e-${prev}-${waitId}`, from: prev, port: "out", to: waitId });
      prev = waitId;
    }
    y += 120;
    const smsId = `sms${i + 1}`;
    nodes.push({ id: smsId, kind: "SEND_SMS", x: 80, y, config: { body } });
    edges.push({ id: `e-${prev}-${smsId}`, from: prev, port: "out", to: smsId });
    prev = smsId;
  });

  y += 120;
  nodes.push({ id: "exit", kind: "EXIT", x: 80, y, config: { exitReason: "sequence_complete" } });
  edges.push({ id: `e-${prev}-exit`, from: prev, port: "out", to: "exit" });

  return { nodes, edges };
}

/** The COOLDOWN re-entry gap for a level, read by the enrollment sweep. */
export function reorderReentryDays(mode: ReorderMode): number {
  return LEVELS[mode].reentryDays;
}

/**
 * Create or refresh the three reordering templates, published and ready to
 * adopt. Idempotent by slug — safe to run on every deploy, and re-running after
 * editing `LEVELS` republishes with the new graph.
 *
 * **This does not touch a single tenant.** Publishing a template with an ALWAYS
 * sync policy repoints live adopters through `applyPublishToAdopters`, which is
 * the intended way to roll a copy fix out to everyone; but seeding only
 * guarantees the templates exist. Turning one on for a tenant is the owner's
 * choice, applied in `lib/reorder-manage.ts`.
 */
export async function seedReorderTemplates(): Promise<{ seeded: number }> {
  let seeded = 0;

  for (const mode of REORDER_MODES) {
    const slug = REORDER_TEMPLATE_SLUGS[mode];
    const graph = reorderGraph(mode);

    // Refuse to seed a graph that wouldn't pass the same gate an owner's adopt
    // runs. A broken reordering template is worse than none — it looks
    // installed and silently never sends.
    const errors = validateGraph(graph, "the restaurant");
    if (errors.length) throw new Error(`reorder template ${slug} is invalid: ${errors[0].message}`);

    const graphJson = graph as unknown as Prisma.InputJsonValue;
    const triggerConfig = { lapsedDays: LEVELS[mode].lapsedDays } as Prisma.InputJsonValue;

    const existing = await prisma.automationTemplate.findUnique({ where: { slug } });

    const template = existing
      ? await prisma.automationTemplate.update({
          where: { slug },
          data: {
            name: `Bring customers back — ${MODE_LABEL[mode]}`,
            blurb: MODE_BLURB[mode],
            visibility: "PRESET",
            syncPolicy: "ALWAYS",
            triggerType: "LAPSED",
            triggerConfig,
            draftGraph: graphJson,
          },
        })
      : await prisma.automationTemplate.create({
          data: {
            name: `Bring customers back — ${MODE_LABEL[mode]}`,
            slug,
            blurb: MODE_BLURB[mode],
            visibility: "PRESET",
            syncPolicy: "ALWAYS",
            triggerType: "LAPSED",
            triggerConfig,
            draftGraph: graphJson,
          },
        });

    // Publish a fresh version so the template is adoptable and any live copies
    // (ALWAYS policy) move to the latest graph.
    const last = await prisma.automationTemplateVersion.findFirst({
      where: { templateId: template.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = await prisma.automationTemplateVersion.create({
      data: {
        templateId: template.id,
        version: (last?.version ?? 0) + 1,
        graph: graphJson,
        triggerType: "LAPSED",
        triggerConfig,
        notes: "Seeded/updated by seedReorderTemplates.",
      },
    });
    await prisma.automationTemplate.update({
      where: { id: template.id },
      data: { status: "PUBLISHED", publishedVersionId: version.id },
    });

    seeded++;
  }

  return { seeded };
}
