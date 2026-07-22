import "server-only";

import { randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { isSuspended } from "@/lib/entitlements";
import { queueMessage } from "@/lib/sms";
import { queueEmail } from "@/lib/email";
import { renderMergeFields } from "@/lib/campaign-format";
import { hostnameIsBlocked } from "@/lib/net-guard";
import type { EnrollmentStatus, Prisma } from "@prisma/client";

import {
  MAX_STEPS_PER_ENROLLMENT,
  MAX_STEPS_PER_PASS,
  assignVariant,
  durationMs,
  evaluateCondition,
  findNode,
  isTimeTrigger,
  nextNodeId,
  nextSendTimeMs,
  parseGraph,
  triggerNode,
  validateGraph,
  type EvalInput,
  type FlowContext,
  type FlowCustomer,
  type FlowNode,
  type Graph,
  type TriggerKind,
} from "@/lib/automation-flow";

/**
 * Re-exported so a server caller has one import for the whole feature. The
 * split exists for the browser's sake (see lib/automation-flow.ts), not to make
 * callers here think about which half they need.
 */
export * from "@/lib/automation-flow";

/**
 * The automation runtime: enrollment, advancing a journey, and the drain.
 *
 * ─── The rule this module exists under ────────────────────────────────────
 *
 * **An automation decides when to send. It never sends.** Every SEND node in
 * here ends in `queueMessage` or `queueEmail`, which re-run the consent gate
 * against current data and write a `Message` row either way.
 *
 * That indirection matters more here than it does for campaigns, and the
 * difference is elapsed time. A campaign is composed and sent the same
 * afternoon by someone who just looked at their audience. An automation queues
 * a message *weeks* after the owner drew the box — long after a STOP may have
 * arrived, an address bounced, or the platform suspended the tenant. There is
 * no version of "check consent when the automation is saved" that is correct.
 *
 * ─── One door, and this is not it ─────────────────────────────────────────
 *
 * `advanceEnrollment` is the only function that moves a journey, and every
 * writer of `AutomationEnrollment.status` or `currentNodeId` goes through it.
 * It takes the same optimistic lock every writer in `lib/orders.ts` takes: the
 * value that was read goes in the WHERE of an `updateMany`, and a zero-row
 * result means another pass got there first. Two overlapping sweep runs must
 * not both walk the same person to the same SEND node.
 *
 * ─── Inert without the cron ───────────────────────────────────────────────
 *
 * `drainAutomations` is wired into `scripts/sweep.ts` and nothing else calls it
 * on a schedule. Until the Railway service in `docs/deploy-sweep.md` exists, an
 * automation enrolls people and never advances them. The manual drain button in
 * `/admin/tools` is there so the path is testable today; it is **not** the cron
 * and its existence must not make the cron look optional.
 */

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listAutomations(restaurantId: string) {
  return prisma.automation.findMany({
    where: { restaurantId, status: { not: "ARCHIVED" } },
    orderBy: { createdAt: "desc" },
    include: { template: { select: { id: true, name: true, syncPolicy: true } } },
  });
}

export async function automationDetail(restaurantId: string | null, id: string) {
  const automation = await prisma.automation.findFirst({
    where: { id, ...(restaurantId ? { restaurantId } : {}) },
    include: {
      template: true,
      activeVersion: true,
      versions: { orderBy: { version: "desc" }, take: 10 },
    },
  });
  if (!automation) return null;

  const counts = await prisma.automationEnrollment.groupBy({
    by: ["status"],
    where: { automationId: id },
    _count: { _all: true },
  });

  // Why messages didn't go out, grouped — the panel that makes the consent gate
  // legible on a journey nobody is watching. Without it an owner sees "200
  // entered, 40 texted" and has no way to learn that 150 never opted in.
  const skipReasons = await prisma.message.groupBy({
    by: ["error"],
    where: { automationId: id, status: "SKIPPED" },
    _count: { _all: true },
  });

  return { automation, counts, skipReasons };
}

/** The graph an owner is editing. Falls back to the active version so opening
 *  an automation that was activated elsewhere shows what is actually running. */
export function editableGraph(automation: {
  draftGraph: Prisma.JsonValue | null;
  activeVersion?: { graph: Prisma.JsonValue } | null;
}): Graph {
  return parseGraph(automation.draftGraph ?? automation.activeVersion?.graph ?? null);
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type AutomationInput = {
  name: string;
  triggerType: string;
  triggerConfig?: Prisma.InputJsonValue | null;
  graph: Graph;
  reentry?: "ONCE" | "ONCE_PER_TRIGGER" | "COOLDOWN" | "ALWAYS";
  reentryDays?: number;
  quietStartMin?: number;
  quietEndMin?: number;
};

export async function createAutomation(restaurantId: string, input: AutomationInput, actorId?: string | null) {
  return prisma.automation.create({
    data: {
      restaurantId,
      name: input.name.trim() || "Untitled journey",
      triggerType: input.triggerType,
      triggerConfig: (input.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      draftGraph: input.graph as unknown as Prisma.InputJsonValue,
      reentry: input.reentry ?? "ONCE",
      reentryDays: input.reentryDays ?? 30,
      quietStartMin: input.quietStartMin ?? 540,
      quietEndMin: input.quietEndMin ?? 1200,
      createdByUserId: actorId ?? null,
    },
  });
}

/**
 * Saves the draft.
 *
 * Editing never touches what is running. The draft is a separate column and an
 * activation is what promotes it, so an owner half-way through redrawing a live
 * journey has not changed what anybody receives — which is the behaviour they
 * assume and the opposite of what "save the graph in place" would do.
 *
 * An edit to an automation adopted from a template may sever the template link.
 * That decision belongs to `lib/automation-templates.ts`, which owns the sync
 * policies; this calls into it rather than reimplementing the rule.
 */
export async function saveDraft(
  restaurantId: string,
  id: string,
  input: AutomationInput,
): Promise<{ ok?: string; error?: string }> {
  const existing = await prisma.automation.findFirst({
    where: { id, restaurantId },
    select: { id: true, templateId: true, template: { select: { syncPolicy: true } } },
  });
  if (!existing) return { error: "Journey not found." };

  // A read-only template is read-only server-side, not just in the UI. Hiding
  // a control is a courtesy; this is the enforcement, same pairing as
  // `setCardPaymentsAction` refusing to switch cards on while suspended.
  if (existing.templateId && existing.template?.syncPolicy === "ALWAYS") {
    return {
      error: "This journey is managed by us and stays in step with the template. Make a copy to change it.",
    };
  }

  await prisma.automation.update({
    where: { id },
    data: {
      name: input.name.trim() || "Untitled journey",
      triggerType: input.triggerType,
      triggerConfig: (input.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      draftGraph: input.graph as unknown as Prisma.InputJsonValue,
      reentry: input.reentry ?? "ONCE",
      reentryDays: input.reentryDays ?? 30,
      quietStartMin: input.quietStartMin ?? 540,
      quietEndMin: input.quietEndMin ?? 1200,
      // The fork marker. Under AUTO_UNLESS_CUSTOMIZED this is what stops a
      // future publish overwriting the owner's own wording; under OPT_IN it is
      // a record, and under ALWAYS we never get here.
      ...(existing.templateId ? { templateForkedAt: new Date() } : {}),
    },
  });

  return { ok: "Saved." };
}

/**
 * Freezes the draft as a version and starts the journey.
 *
 * The version is the thing enrollments pin to. Publishing on activate rather
 * than on save is what makes "an enrollment runs the graph it entered on" true:
 * an owner's Tuesday edits are invisible to everyone already mid-journey and
 * apply to everyone who enters afterwards.
 */
export async function activateAutomation(
  restaurantId: string,
  id: string,
): Promise<{ ok?: string; error?: string; errors?: ReturnType<typeof validateGraph> }> {
  const automation = await prisma.automation.findFirst({
    where: { id, restaurantId },
    include: { restaurant: { select: { name: true } }, activeVersion: true },
  });
  if (!automation) return { error: "Journey not found." };

  const graph = editableGraph(automation);
  const errors = validateGraph(graph, automation.restaurant.name);
  if (errors.length) return { error: errors[0].message, errors };

  const trigger = triggerNode(graph);
  const triggerType = trigger?.config.trigger ?? automation.triggerType;

  // The platform's own switch, checked before the journey can start rather than
  // once it is running. The send gate would catch each message and record a
  // wall of SKIPPED rows — correct, useless to look at, and it would leave the
  // owner with a journey that appears to be working.
  const [smsSuspended, emailSuspended] = await Promise.all([
    isSuspended(restaurantId, "SMS"),
    isSuspended(restaurantId, "EMAIL"),
  ]);
  const sendsSms = graph.nodes.some((n) => n.kind === "SEND_SMS");
  const sendsEmail = graph.nodes.some((n) => n.kind === "SEND_EMAIL");
  if (sendsSms && smsSuspended) return { error: "Text messaging is suspended for this account." };
  if (sendsEmail && emailSuspended) return { error: "Email is suspended for this account." };

  const last = await prisma.automationVersion.findFirst({
    where: { automationId: id },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const version = await prisma.automationVersion.create({
    data: {
      automationId: id,
      version: (last?.version ?? 0) + 1,
      graph: graph as unknown as Prisma.InputJsonValue,
      triggerType,
      triggerConfig: (automation.triggerConfig ?? undefined) as Prisma.InputJsonValue | undefined,
      templateVersionId: automation.templateVersionId,
    },
  });

  await prisma.automation.update({
    where: { id },
    data: {
      status: "ACTIVE",
      triggerType,
      activeVersionId: version.id,
      activatedAt: automation.activatedAt ?? new Date(),
      // A WEBHOOK trigger needs a URL to exist before anyone can call it. Minted
      // here rather than at creation so a draft that never becomes a webhook
      // journey never has a live endpoint sitting on it.
      ...(triggerType === "WEBHOOK" && !automation.hookToken
        ? { hookToken: randomBytes(20).toString("hex") }
        : {}),
    },
  });

  return { ok: "Live. New customers will start entering it." };
}

export async function pauseAutomation(restaurantId: string, id: string) {
  const res = await prisma.automation.updateMany({
    where: { id, restaurantId, status: "ACTIVE" },
    data: { status: "PAUSED" },
  });
  if (res.count === 0) return { error: "That journey isn't running." };
  // People mid-journey are deliberately left alone. Pausing stops new entrants;
  // it does not abandon somebody who is three steps into a sequence and waiting
  // on a message the owner already promised them.
  return { ok: "Paused. Nobody new will enter — people already in it carry on." };
}

export async function resumeAutomation(restaurantId: string, id: string) {
  const res = await prisma.automation.updateMany({
    where: { id, restaurantId, status: "PAUSED" },
    data: { status: "ACTIVE" },
  });
  if (res.count === 0) return { error: "That journey isn't paused." };
  return { ok: "Running again." };
}

/**
 * Archives, and ends everyone in flight.
 *
 * Unlike pause, this *does* end live enrollments — an archived journey with
 * people still walking it is a message arriving from something the owner
 * believes they deleted. The rows stay, carrying the reason, because "who was
 * in this and where did they stop" is the question asked afterwards.
 */
export async function archiveAutomation(restaurantId: string, id: string) {
  const res = await prisma.automation.updateMany({
    where: { id, restaurantId, status: { not: "ARCHIVED" } },
    data: { status: "ARCHIVED" },
  });
  if (res.count === 0) return { error: "Journey not found." };

  await prisma.automationEnrollment.updateMany({
    where: { automationId: id, status: { in: ["ACTIVE", "WAITING"] } },
    data: { status: "CANCELED", exitReason: "automation_archived", endedAt: new Date(), resumeAt: null },
  });

  return { ok: "Archived. Anyone still in it has been taken out." };
}

// ---------------------------------------------------------------------------
// Enrollment
// ---------------------------------------------------------------------------

export type EnrollResult = "enrolled" | "already_in" | "reentry_blocked" | "not_active" | "no_version";

/**
 * Puts one customer into one automation.
 *
 * The re-entry rules are checked here, and the **database is what enforces the
 * important one**: a partial unique index on `(automationId, customerId) WHERE
 * status IN ('ACTIVE','WAITING')`. The check below is the courtesy that
 * produces a readable answer; the index is what survives two order events a
 * second apart, which is exactly how somebody gets enrolled twice and texted
 * twice. The read here is stale the moment it returns, same as everything in
 * `lib/orders.ts`.
 */
export async function enroll(
  automationId: string,
  customerId: string,
  context: FlowContext = {},
): Promise<EnrollResult> {
  const automation = await prisma.automation.findUnique({
    where: { id: automationId },
    select: {
      id: true,
      restaurantId: true,
      status: true,
      activeVersionId: true,
      reentry: true,
      reentryDays: true,
    },
  });
  if (!automation || automation.status !== "ACTIVE") return "not_active";
  if (!automation.activeVersionId) return "no_version";

  const prior = await prisma.automationEnrollment.findMany({
    where: { automationId, customerId },
    orderBy: { enteredAt: "desc" },
    select: { status: true, enteredAt: true, context: true },
    take: 5,
  });

  if (prior.some((p) => p.status === "ACTIVE" || p.status === "WAITING")) return "already_in";

  if (prior.length > 0) {
    if (automation.reentry === "ONCE") return "reentry_blocked";
    if (automation.reentry === "COOLDOWN") {
      const cutoff = Date.now() - automation.reentryDays * 86_400_000;
      if (prior[0].enteredAt.getTime() > cutoff) return "reentry_blocked";
    }
    if (automation.reentry === "ONCE_PER_TRIGGER") {
      // "Once per thing that happened" — a customer may come back through a
      // journey for a *different* order, but not twice for the same one.
      const key = String(context.triggerKey ?? "");
      const seen = prior.some((p) => {
        const c = (p.context ?? {}) as FlowContext;
        return key !== "" && String(c.triggerKey ?? "") === key;
      });
      if (seen) return "reentry_blocked";
    }
  }

  try {
    await prisma.automationEnrollment.create({
      data: {
        automationId,
        restaurantId: automation.restaurantId,
        customerId,
        versionId: automation.activeVersionId,
        status: "ACTIVE",
        currentNodeId: null,
        resumeAt: new Date(),
        context: context as Prisma.InputJsonValue,
      },
    });
  } catch {
    // The partial unique index firing. Not an error condition — it is the
    // guard doing its job on a race the check above cannot close.
    return "already_in";
  }

  await refreshAutomationCounts(automationId);
  return "enrolled";
}

/**
 * Fires an event trigger across a tenant.
 *
 * Called from the code that caused the thing — an order transitioning, a tag
 * being applied. Deliberately swallows its own errors and logs: an automation
 * failing to enroll somebody must never fail the order that triggered it. The
 * customer's food matters and the follow-up text does not.
 */
export async function fireTrigger(
  restaurantId: string,
  trigger: TriggerKind,
  customerId: string | null,
  context: FlowContext = {},
): Promise<number> {
  if (!customerId) return 0;

  try {
    const automations = await prisma.automation.findMany({
      where: { restaurantId, status: "ACTIVE", triggerType: trigger },
      select: { id: true, triggerConfig: true },
    });

    let started = 0;
    for (const a of automations) {
      const cfg = (a.triggerConfig ?? {}) as { tagSlug?: string };
      // A tag trigger only fires for its own tag. Checked here rather than in
      // the query because the config is JSON and a tenant has a handful of
      // automations, not thousands.
      if ((trigger === "TAG_ADDED" || trigger === "TAG_REMOVED") && cfg.tagSlug) {
        if (String(context.tagSlug ?? "") !== cfg.tagSlug) continue;
      }
      const res = await enroll(a.id, customerId, { ...context, trigger });
      if (res === "enrolled") started++;
    }
    return started;
  } catch (err) {
    console.error("[automations] trigger failed", restaurantId, trigger, err);
    return 0;
  }
}

/** Bulk enrollment from the customer list, for MANUAL journeys. */
export async function enrollMany(
  restaurantId: string,
  automationId: string,
  customerIds: string[],
): Promise<{ enrolled: number; skipped: number }> {
  const automation = await prisma.automation.findFirst({
    where: { id: automationId, restaurantId },
    select: { id: true },
  });
  if (!automation) return { enrolled: 0, skipped: customerIds.length };

  // Re-scoped to the tenant rather than trusted from the form. The ids came
  // through a browser, and an automation is a thing that texts people.
  const owned = await prisma.customer.findMany({
    where: { id: { in: customerIds }, restaurantId },
    select: { id: true },
  });

  let enrolled = 0;
  for (const c of owned) {
    if ((await enroll(automationId, c.id, { trigger: "MANUAL" })) === "enrolled") enrolled++;
  }
  return { enrolled, skipped: customerIds.length - enrolled };
}

// ---------------------------------------------------------------------------
// Running a journey
// ---------------------------------------------------------------------------

type LoadedEnrollment = {
  id: string;
  automationId: string;
  restaurantId: string;
  customerId: string;
  status: EnrollmentStatus;
  currentNodeId: string | null;
  steps: number;
  variant: string | null;
  context: Prisma.JsonValue | null;
};

async function logStep(
  enrollmentId: string,
  node: FlowNode,
  outcome: string,
  detail?: string | null,
  messageId?: string | null,
) {
  await prisma.automationStep.create({
    data: {
      enrollmentId,
      nodeId: node.id,
      nodeKind: node.kind,
      outcome,
      detail: detail ?? null,
      messageId: messageId ?? null,
    },
  });
}

async function endEnrollment(id: string, status: EnrollmentStatus, reason: string, goal = false) {
  await prisma.automationEnrollment.updateMany({
    where: { id, status: { in: ["ACTIVE", "WAITING"] } },
    data: {
      status,
      exitReason: reason,
      endedAt: new Date(),
      resumeAt: null,
      currentNodeId: null,
      ...(goal ? { goalMetAt: new Date() } : {}),
    },
  });
}

/** The customer, flattened to what a condition may read. */
async function loadFlowCustomer(customerId: string): Promise<FlowCustomer | null> {
  const c = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      name: true,
      email: true,
      phone: true,
      optInStatus: true,
      emailOptOutAt: true,
      cohort: true,
      orderCount: true,
      lifetimeCts: true,
      firstOrderAt: true,
      lastOrderAt: true,
      tags: { select: { tag: { select: { slug: true } } } },
    },
  });
  if (!c) return null;

  return {
    name: c.name,
    email: c.email,
    phone: c.phone,
    optInStatus: c.optInStatus,
    emailSubscribed: c.emailOptOutAt === null,
    cohort: c.cohort,
    orderCount: c.orderCount,
    lifetimeCts: c.lifetimeCts,
    firstOrderAtMs: c.firstOrderAt?.getTime() ?? null,
    lastOrderAtMs: c.lastOrderAt?.getTime() ?? null,
    tagSlugs: c.tags.map((t: { tag: { slug: string } }) => t.tag.slug),
  };
}

/**
 * Walks one enrollment forward until it has to wait, or ends.
 *
 * Bounded twice, and both bounds matter. `MAX_STEPS_PER_PASS` stops one
 * pathological journey starving every other tenant's in a single sweep;
 * `MAX_STEPS_PER_ENROLLMENT` is the belt on the acyclic validator — a cycle
 * that got in through a template import or a hand-edited blob is an infinite
 * loop that sends a message every time round, and the budget turns that into a
 * stuck enrollment somebody notices instead of a phone ringing all night.
 */
export async function advanceEnrollment(enrollmentId: string): Promise<"waiting" | "ended" | "stepped"> {
  const e = (await prisma.automationEnrollment.findUnique({
    where: { id: enrollmentId },
    select: {
      id: true,
      automationId: true,
      restaurantId: true,
      customerId: true,
      status: true,
      currentNodeId: true,
      steps: true,
      variant: true,
      context: true,
    },
  })) as LoadedEnrollment | null;

  if (!e || (e.status !== "ACTIVE" && e.status !== "WAITING")) return "ended";

  const automation = await prisma.automation.findUnique({
    where: { id: e.automationId },
    select: {
      id: true,
      status: true,
      quietStartMin: true,
      quietEndMin: true,
      restaurant: { select: { name: true, timezone: true } },
    },
  });
  if (!automation) {
    await endEnrollment(e.id, "CANCELED", "automation_archived");
    return "ended";
  }
  if (automation.status === "ARCHIVED") {
    await endEnrollment(e.id, "CANCELED", "automation_archived");
    return "ended";
  }

  const version = await prisma.automationEnrollment
    .findUnique({ where: { id: e.id } })
    .version({ select: { graph: true } });
  const graph = parseGraph(version?.graph ?? null);

  const customer = await loadFlowCustomer(e.customerId);
  if (!customer) {
    // A customer deleted mid-journey. Ended rather than left waiting, because a
    // WAITING row pointing at nothing is a permanent resident of the drain
    // query and there is nobody left to message.
    await endEnrollment(e.id, "EXITED", "customer_removed");
    return "ended";
  }

  const quiet = {
    startMin: automation.quietStartMin,
    endMin: automation.quietEndMin,
    timezone: automation.restaurant.timezone || "America/New_York",
  };

  let nodeId = e.currentNodeId ?? triggerNode(graph)?.id ?? null;
  let steps = e.steps;
  let variant = e.variant;
  const context = (e.context ?? {}) as FlowContext;

  for (let pass = 0; pass < MAX_STEPS_PER_PASS; pass++) {
    if (!nodeId) {
      await endEnrollment(e.id, "COMPLETED", "completed");
      await refreshAutomationCounts(e.automationId);
      return "ended";
    }

    if (steps >= MAX_STEPS_PER_ENROLLMENT) {
      await endEnrollment(e.id, "FAILED", "step_budget");
      console.error("[automations] step budget exhausted", e.id, e.automationId);
      return "ended";
    }

    const node = findNode(graph, nodeId);
    if (!node) {
      // The graph changed underneath an enrollment that isn't pinned to it —
      // which should be impossible, because versions are immutable. Ended
      // loudly rather than silently, because if this ever fires the pinning
      // has broken and that is worth finding out about.
      await endEnrollment(e.id, "FAILED", "failed");
      console.error("[automations] node vanished", e.id, nodeId);
      return "ended";
    }

    const evalInput: EvalInput = { customer, context, variant, nowMs: Date.now() };
    steps++;

    // ── The trigger node is a label, not an action ───────────────────────
    if (node.kind === "TRIGGER") {
      nodeId = nextNodeId(graph, node.id);
      continue;
    }

    // ── Waits ────────────────────────────────────────────────────────────
    if (node.kind === "WAIT") {
      // The deadline is kept in the context and the enrollment is parked *on
      // this node*, not on the next one. Parking on the next node would work
      // right up until that node is a send, at which point a restart between
      // the two would fire it immediately; parking here and re-checking makes
      // the wait idempotent, which is the property every resume needs.
      const key = `waitUntil_${node.id}`;
      const deadlineMs =
        typeof context[key] === "number"
          ? (context[key] as number)
          : Date.now() + durationMs(node.config.amount, node.config.unit);

      if (Date.now() >= deadlineMs) {
        delete context[key];
        nodeId = nextNodeId(graph, node.id);
        continue;
      }

      context[key] = deadlineMs;
      await logStep(e.id, node, "waiting", `Waiting ${node.config.amount} ${node.config.unit ?? "days"}`);
      await parkAt(e.id, node.id, new Date(deadlineMs), steps, variant, context);
      return "waiting";
    }

    if (node.kind === "WAIT_UNTIL") {
      if (evaluateCondition(node.config.condition, evalInput)) {
        await logStep(e.id, node, "ok", "They did it.");
        nodeId = nextNodeId(graph, node.id, "met");
        continue;
      }
      const deadlineMs =
        e.currentNodeId === node.id && typeof context[`deadline_${node.id}`] === "number"
          ? (context[`deadline_${node.id}`] as number)
          : Date.now() + durationMs(node.config.timeoutAmount, node.config.timeoutUnit);

      if (Date.now() >= deadlineMs) {
        await logStep(e.id, node, "timeout", "Time ran out.");
        nodeId = nextNodeId(graph, node.id, "timeout");
        continue;
      }

      context[`deadline_${node.id}`] = deadlineMs;
      // Re-checked on a cadence rather than on an event, because the conditions
      // it can watch (order count, tags, lifetime value) have no single event
      // behind them. An hour is a compromise: fine enough that "they came back"
      // is noticed the same day, coarse enough that a thousand waiting
      // enrollments aren't re-evaluated every two minutes.
      const nextCheck = Math.min(deadlineMs, Date.now() + 3_600_000);
      await parkAt(e.id, node.id, new Date(nextCheck), steps, variant, context);
      return "waiting";
    }

    // ── Logic ────────────────────────────────────────────────────────────
    if (node.kind === "IF_ELSE") {
      const yes = evaluateCondition(node.config.condition, evalInput);
      await logStep(e.id, node, yes ? "branch_true" : "branch_false");
      nodeId = nextNodeId(graph, node.id, yes ? "true" : "false");
      continue;
    }

    if (node.kind === "SPLIT") {
      // Assigned once and recorded. A re-run after a crashed pass has to land
      // in the same place, or a retry silently moves somebody from A to B and
      // corrupts the comparison the split exists to make.
      variant = variant ?? assignVariant(e.id, node.config.weightA, node.config.weightB);
      await logStep(e.id, node, "ok", `Variant ${variant.toUpperCase()}`);
      nodeId = nextNodeId(graph, node.id, variant);
      continue;
    }

    if (node.kind === "GOAL") {
      await logStep(e.id, node, "ok", "Goal reached.");
      await endEnrollment(e.id, "COMPLETED", "goal", true);
      await refreshAutomationCounts(e.automationId);
      return "ended";
    }

    if (node.kind === "EXIT") {
      await logStep(e.id, node, "ok", node.config.exitReason ?? null);
      await endEnrollment(e.id, "EXITED", "exit_block");
      await refreshAutomationCounts(e.automationId);
      return "ended";
    }

    // ── Sends ────────────────────────────────────────────────────────────
    if (node.kind === "SEND_SMS" || node.kind === "SEND_EMAIL") {
      // Quiet hours, applied before the send rather than after. An automation's
      // wait can land at 3am; a campaign's cannot, because a person pressed the
      // button. Deferred rather than dropped — the owner asked for the message
      // to go, not for it to go at exactly that minute.
      const when = node.kind === "SEND_SMS" ? nextSendTimeMs(Date.now(), quiet) : Date.now();
      if (when > Date.now() + 60_000) {
        await logStep(e.id, node, "deferred", "Held until the journey's sending hours.");
        await parkAt(e.id, node.id, new Date(when), steps - 1, variant, context);
        return "waiting";
      }

      const body = renderMergeFields(node.config.body ?? "", {
        customerName: customer.name,
        restaurantName: automation.restaurant.name,
      });

      // **This is the whole point of the module boundary.** The consent gate is
      // in lib/sms.ts and lib/email.ts and it runs now, weeks after the owner
      // drew this box. A SKIPPED row is written either way, carrying the reason,
      // and the journey carries on — a customer who can't be texted still
      // belongs in the rest of the sequence, which may reach them by email.
      const msg =
        node.kind === "SEND_SMS"
          ? await queueMessage({
              restaurantId: e.restaurantId,
              customerId: e.customerId,
              kind: "AUTOMATION",
              body,
              automationId: e.automationId,
              enrollmentId: e.id,
            })
          : await queueEmail({
              restaurantId: e.restaurantId,
              customerId: e.customerId,
              kind: "AUTOMATION",
              subject: renderMergeFields(node.config.subject ?? "", {
                customerName: customer.name,
                restaurantName: automation.restaurant.name,
              }),
              body,
              automationId: e.automationId,
              enrollmentId: e.id,
            });

      await logStep(
        e.id,
        node,
        msg.status === "SKIPPED" ? "skipped" : msg.status === "FAILED" ? "failed" : "ok",
        msg.status === "SKIPPED" ? msg.error : null,
        msg.id,
      );

      nodeId = nextNodeId(graph, node.id);
      continue;
    }

    // ── Actions ──────────────────────────────────────────────────────────
    if (node.kind === "ADD_TAG" || node.kind === "REMOVE_TAG") {
      const slug = (node.config.tagSlug ?? "").trim();
      const tag = slug
        ? await prisma.customerTag.findFirst({
            where: { restaurantId: e.restaurantId, slug },
            select: { id: true },
          })
        : null;

      if (!tag) {
        await logStep(e.id, node, "skipped", "That tag no longer exists.");
      } else if (node.kind === "ADD_TAG") {
        await prisma.customerTagLink.createMany({
          data: [{ tagId: tag.id, customerId: e.customerId }],
          skipDuplicates: true,
        });
        await logStep(e.id, node, "ok", `Tagged ${slug}`);
        customer.tagSlugs = [...new Set([...customer.tagSlugs, slug])];
      } else {
        await prisma.customerTagLink.deleteMany({ where: { tagId: tag.id, customerId: e.customerId } });
        await logStep(e.id, node, "ok", `Untagged ${slug}`);
        customer.tagSlugs = customer.tagSlugs.filter((s) => s !== slug);
      }

      nodeId = nextNodeId(graph, node.id);
      continue;
    }

    if (node.kind === "NOTIFY_OWNER") {
      await notifyOwner(e.restaurantId, node, customer, automation.restaurant.name);
      await logStep(e.id, node, "ok", "Emailed you.");
      nodeId = nextNodeId(graph, node.id);
      continue;
    }

    if (node.kind === "WEBHOOK_OUT") {
      const detail = await callWebhook(node, e, customer);
      await logStep(e.id, node, detail.ok ? "ok" : "failed", detail.detail);
      // The journey continues either way, deliberately. A third-party endpoint
      // being down must not strand a customer halfway through a sequence the
      // restaurant promised them.
      nodeId = nextNodeId(graph, node.id);
      continue;
    }

    // An unreachable default in practice — every kind is handled above — but a
    // graph from a newer version of the vocabulary would land here, and walking
    // past it is better than stranding somebody.
    nodeId = nextNodeId(graph, node.id);
  }

  // Out of pass budget with more to do. Parked for the next sweep rather than
  // looped, so one long journey can't hold the drain.
  await parkAt(e.id, nodeId, new Date(), steps, variant, context);
  return "stepped";
}

/**
 * Writes where a journey stopped and when to look again.
 *
 * The optimistic lock is the point: `currentNodeId` goes in the WHERE, so two
 * overlapping sweep passes cannot both advance the same person. A zero-row
 * result means the other pass won, and this one silently does nothing — which
 * is the correct outcome, not an error.
 */
async function parkAt(
  id: string,
  nodeId: string | null,
  resumeAt: Date,
  steps: number,
  variant: string | null,
  context?: FlowContext,
) {
  await prisma.automationEnrollment.updateMany({
    where: { id, status: { in: ["ACTIVE", "WAITING"] } },
    data: {
      status: "WAITING",
      currentNodeId: nodeId,
      resumeAt,
      steps,
      variant,
      ...(context ? { context: context as Prisma.InputJsonValue } : {}),
    },
  });
}

async function notifyOwner(
  restaurantId: string,
  node: FlowNode,
  customer: FlowCustomer,
  restaurantName: string,
) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { emailReplyTo: true, emailFrom: true },
  });

  // Reply-to first: it is the inbox the owner actually reads, where `emailFrom`
  // may be a no-reply on a sending domain. The owner's login is the fallback
  // rather than the first choice, because a tenant with several staff accounts
  // has no single "the owner".
  const owner = restaurant?.emailReplyTo
    ? null
    : await prisma.user.findFirst({
        where: { restaurantId, role: "OWNER" },
        select: { email: true },
        orderBy: { createdAt: "asc" },
      });

  const to = restaurant?.emailReplyTo || owner?.email || restaurant?.emailFrom || null;
  if (!to) return;

  // TRANSACTIONAL, and not because it dodges a gate — this is mail to the
  // business about its own account, which is what that kind means. It carries
  // no `customerId`, so nothing here can be confused for contacting a diner.
  await queueEmail({
    restaurantId,
    kind: "TRANSACTIONAL",
    to,
    subject: `${restaurantName}: ${node.config.note?.slice(0, 80) || "a customer reached a step in your journey"}`,
    body:
      `${node.config.note ?? "A customer reached this step in one of your journeys."}\n\n` +
      `Customer: ${customer.name ?? "no name on file"} (${customer.phone ?? customer.email ?? "no contact"})\n` +
      `Orders: ${customer.orderCount}\n`,
  });
}

async function callWebhook(
  node: FlowNode,
  e: LoadedEnrollment,
  customer: FlowCustomer,
): Promise<{ ok: boolean; detail: string }> {
  const raw = (node.config.url ?? "").trim();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, detail: "That URL isn't valid." };
  }
  if (url.protocol !== "https:") return { ok: false, detail: "Webhook URLs have to be https." };

  // The SSRF fence. A URL an owner typed becoming a request that originates
  // inside our network is exactly what `lib/net-guard.ts` exists for, and the
  // form-level check in the validator is a courtesy rather than the boundary.
  if (hostnameIsBlocked(url.hostname)) {
    return { ok: false, detail: "That address isn't allowed." };
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Deliberately not the whole customer row. A webhook is a third party,
      // and the tenant's list is the asset this product exists to protect.
      body: JSON.stringify({
        enrollmentId: e.id,
        automationId: e.automationId,
        customer: { name: customer.name, orderCount: customer.orderCount },
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return res.ok
      ? { ok: true, detail: `Called, ${res.status}.` }
      : { ok: false, detail: `They answered ${res.status}.` };
  } catch (err) {
    return { ok: false, detail: `Couldn't reach it: ${(err as Error).message.slice(0, 120)}` };
  }
}

// ---------------------------------------------------------------------------
// The drain
// ---------------------------------------------------------------------------

export const DRAIN_BATCH = 200;

export type AutomationDrainResult = {
  advanced: number;
  ended: number;
  enrolled: number;
};

/**
 * The sweep entry point. Two jobs:
 *
 *   1. Enroll anyone who now qualifies for a time-based trigger. There is no
 *      event behind "hasn't ordered in 60 days" — the thing that happened is
 *      that time passed — so it has to be found by scanning.
 *   2. Advance every enrollment whose timer has expired.
 *
 * Ordered so an enrollment created by (1) is advanced by (2) in the same pass,
 * which makes a journey whose first node is a send actually send on the sweep
 * the owner is watching rather than the one two minutes later.
 */
export async function drainAutomations(limit = DRAIN_BATCH): Promise<AutomationDrainResult> {
  const result: AutomationDrainResult = { advanced: 0, ended: 0, enrolled: 0 };

  result.enrolled = await enrollTimeTriggers();

  const due = await prisma.automationEnrollment.findMany({
    where: { status: { in: ["ACTIVE", "WAITING"] }, resumeAt: { lte: new Date() } },
    orderBy: { resumeAt: "asc" },
    select: { id: true },
    take: limit,
  });

  for (const row of due) {
    try {
      const outcome = await advanceEnrollment(row.id);
      if (outcome === "ended") result.ended++;
      else result.advanced++;
    } catch (err) {
      console.error("[automations] advance failed", row.id, err);
      await prisma.automationEnrollment.updateMany({
        where: { id: row.id, status: { in: ["ACTIVE", "WAITING"] } },
        data: { status: "FAILED", exitReason: "failed", endedAt: new Date(), resumeAt: null },
      });
      result.ended++;
    }
  }

  return result;
}

/**
 * Finds people who now qualify for LAPSED and ANNIVERSARY journeys.
 *
 * Bounded per automation, because a tenant with 50,000 customers activating a
 * LAPSED journey qualifies most of them at once. The cap means the first sweep
 * after activation takes a slice and the next one takes the next — slower, and
 * survivable, which the alternative is not.
 */
async function enrollTimeTriggers(perAutomation = 200): Promise<number> {
  const automations = await prisma.automation.findMany({
    where: { status: "ACTIVE", triggerType: { in: ["LAPSED", "ANNIVERSARY"] } },
    select: { id: true, restaurantId: true, triggerType: true, triggerConfig: true },
    take: 100,
  });

  let enrolled = 0;

  for (const a of automations) {
    const cfg = (a.triggerConfig ?? {}) as { lapsedDays?: number; anniversaryDays?: number };

    let where: Prisma.CustomerWhereInput;
    if (a.triggerType === "LAPSED") {
      const days = Number(cfg.lapsedDays) > 0 ? Number(cfg.lapsedDays) : 60;
      // `lastOrderAt: not null` matters. A customer who has never ordered has
      // not lapsed — they were never here — and sweeping them into a win-back
      // journey aimed at regulars is the same NULL mistake the "lapsed" filter
      // in lib/customers.ts is careful about.
      where = {
        restaurantId: a.restaurantId,
        lastOrderAt: { not: null, lt: new Date(Date.now() - days * 86_400_000) },
      };
    } else {
      const days = Number(cfg.anniversaryDays) > 0 ? Number(cfg.anniversaryDays) : 365;
      const target = new Date(Date.now() - days * 86_400_000);
      where = {
        restaurantId: a.restaurantId,
        firstOrderAt: {
          not: null,
          gte: new Date(target.getTime() - 43_200_000),
          lt: new Date(target.getTime() + 43_200_000),
        },
      };
    }

    // Anyone already in it is excluded in the query rather than rejected one at
    // a time, so a tenant whose whole list qualified last week doesn't spend
    // the entire budget being told "already_in".
    const candidates = await prisma.customer.findMany({
      where: {
        ...where,
        enrollments: { none: { automationId: a.id, status: { in: ["ACTIVE", "WAITING"] } } },
      },
      select: { id: true },
      take: perAutomation,
    });

    for (const c of candidates) {
      if ((await enroll(a.id, c.id, { trigger: a.triggerType })) === "enrolled") enrolled++;
    }
  }

  return enrolled;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/**
 * Recomputed, never incremented — the rule `Order.refundedCts` taught this
 * repo. A drifting counter here is an owner told a journey reached 300 people
 * when it reached 90, which is a decision they would make differently.
 */
export async function refreshAutomationCounts(automationId: string) {
  const grouped = await prisma.automationEnrollment.groupBy({
    by: ["status"],
    where: { automationId },
    _count: { _all: true },
  });

  const total = grouped.reduce((n: number, g: { _count: { _all: number } }) => n + g._count._all, 0);
  const completed = grouped.find((g: { status: string }) => g.status === "COMPLETED")?._count._all ?? 0;
  const goal = await prisma.automationEnrollment.count({
    where: { automationId, goalMetAt: { not: null } },
  });

  await prisma.automation.update({
    where: { id: automationId },
    data: { enteredCount: total, completedCount: completed, goalCount: goal },
  });
}

// ---------------------------------------------------------------------------
// The journey inspector
// ---------------------------------------------------------------------------

export async function listEnrollments(
  restaurantId: string,
  automationId: string,
  status?: EnrollmentStatus,
  take = 50,
) {
  return prisma.automationEnrollment.findMany({
    where: { restaurantId, automationId, ...(status ? { status } : {}) },
    orderBy: { enteredAt: "desc" },
    take,
    include: { customer: { select: { id: true, name: true, phone: true, email: true } } },
  });
}

export async function enrollmentDetail(restaurantId: string, id: string) {
  return prisma.automationEnrollment.findFirst({
    where: { id, restaurantId },
    include: {
      customer: { select: { id: true, name: true, phone: true, email: true } },
      stepLog: { orderBy: { createdAt: "asc" } },
      automation: { select: { id: true, name: true } },
    },
  });
}

/** Takes one person out of a journey. Owner-initiated, recorded, never silent. */
export async function cancelEnrollment(restaurantId: string, id: string) {
  const res = await prisma.automationEnrollment.updateMany({
    where: { id, restaurantId, status: { in: ["ACTIVE", "WAITING"] } },
    data: { status: "CANCELED", exitReason: "canceled_by_owner", endedAt: new Date(), resumeAt: null },
  });
  return res.count > 0 ? { ok: "Taken out of the journey." } : { error: "They're not in it." };
}

/** Whether a trigger is one the sweep looks for rather than one an event fires.
 *  Re-exported shape used by the builder to explain the difference on screen. */
export { isTimeTrigger };
