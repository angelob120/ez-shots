import "server-only";

import { prisma } from "@/lib/prisma";
import { isSuspended } from "@/lib/entitlements";
import { customerWhere, paramsToFilters, readCustomerParams } from "@/lib/customers";
import { deliverQueuedMessage } from "@/lib/sms";
import { deliverQueuedEmail, emailProviderConfigured, normalizeEmail } from "@/lib/email";
import type { MessageChannel, Prisma } from "@prisma/client";

import {
  MAX_SMS_SEGMENTS,
  canTransition,
  isEditable,
  renderMergeFields,
  validateCampaign,
  type CampaignDraft,
} from "@/lib/campaign-format";

/**
 * Re-exported so a server caller has one import for the whole feature. The
 * split exists for the browser's sake (see lib/campaign-format.ts), not to
 * make callers here think about which half they need.
 */
export * from "@/lib/campaign-format";
export { MAX_SMS_SEGMENTS, canTransition, isEditable, renderMergeFields, validateCampaign };

/**
 * Owner-composed marketing campaigns, over SMS and email.
 *
 * ─── The rule this module exists under ────────────────────────────────────
 *
 * **Building an audience is not obtaining consent.** `lib/customers.ts` says
 * this already and it is worth saying again here, because this is the file
 * where breaking it would be most convenient. An audience decides who is
 * *considered*. `lib/sms.ts` and `lib/email.ts` decide who is *contacted*, and
 * they read consent columns and nothing else.
 *
 * The visible consequence is that a campaign aimed at 400 customers routinely
 * reaches 90 over SMS. That gap is not a bug and must not be "fixed" by
 * loosening the gate — it is the difference between a list a restaurant may
 * legally text and a list of everyone it has ever served. The UI shows both
 * numbers precisely so nobody is tempted.
 *
 * ─── Why recipients are Message rows ──────────────────────────────────────
 *
 * There is no CampaignRecipient table. A recipient is a `Message` carrying a
 * `campaignId`. That means a campaign send inherits the existing outbox, the
 * existing retry sweep, the existing delivery receipts, and — the point — the
 * existing consent gate. A parallel recipient table would be a second sending
 * path, and a second sending path is a second place for the consent rules to
 * be almost right.
 *
 * ─── Why sending is queued rather than immediate ──────────────────────────
 *
 * A campaign materialises QUEUED rows and returns. A sweep drains them in
 * batches. This is not gold-plating:
 *
 *   - A 2,000-recipient list is 2,000 sequential provider calls. That is
 *     minutes, and a server action does not have minutes. An immediate send
 *     times out somewhere in the middle, and the owner has no way to know
 *     where — they press the button again and half their customers get it
 *     twice.
 *   - Providers rate-limit. Draining in bounded batches is the only shape that
 *     backs off without losing the queue.
 *   - A restart mid-send is survivable, because the queue is in the database
 *     rather than in a promise.
 *
 * **This is inert until something calls `drainCampaigns` on a schedule.** It is
 * wired into `scripts/sweep.ts`, which still needs the Railway cron service
 * that `docs/deploy-sweep.md` describes and that does not yet exist. There is
 * also a manual drain button in `/admin/tools`, which exists so the path is
 * testable today — it is **not** the cron, and its existence must not make the
 * cron look optional.
 */

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/**
 * The extra `where` that makes a customer *reachable* on a channel.
 *
 * Pure and exported so it is tested and so it is readable in one place. Note
 * what each one is:
 *
 *   - **SMS**: opted in, not opted out, not in the holdout cohort, and has a
 *     number. This mirrors `lib/sms.ts` exactly, and it has to — an estimate
 *     built from looser rules than the gate produces an owner who is told
 *     "400 people" and sees 90 delivered with no explanation.
 *   - **EMAIL**: has an address, hasn't unsubscribed, not in the holdout.
 *     Opt-in is deliberately absent; email is opt-out. See the Customer
 *     comments in schema.prisma for why the two channels differ.
 *
 * **This duplicates the gate rather than replacing it.** The gate still runs at
 * send time, because the world changes between an owner pressing Send and a
 * message reaching the wire — a STOP arriving in that window has to win.
 */
export function reachableWhere(channel: MessageChannel): Prisma.CustomerWhereInput {
  if (channel === "SMS") {
    return {
      optInStatus: "OPTED_IN",
      optOutAt: null,
      cohort: { not: "HOLDOUT" },
    };
  }
  return {
    email: { not: null },
    emailOptOutAt: null,
    cohort: { not: "HOLDOUT" },
  };
}

export type AudienceEstimate = {
  /** Everyone the filter matched. */
  matched: number;
  /** How many of them may actually be contacted on this channel. */
  reachable: number;
  /** matched − reachable. Surfaced, never hidden. */
  unreachable: number;
};

function whereForAudience(
  restaurantId: string,
  audienceQuery: string,
  channel: MessageChannel | null,
): Prisma.CustomerWhereInput {
  // Parsed back through the same reader every URL goes through, so a campaign
  // saved before a filter existed ignores it rather than failing — the same
  // contract CustomerSegment.query carries.
  const params = readCustomerParams(Object.fromEntries(new URLSearchParams(audienceQuery)));
  const base = customerWhere(paramsToFilters(restaurantId, params));
  if (!channel) return base;

  // Composed as AND rather than spread, for the reason customerWhere spells
  // out: a spread lets the reachability clause clobber a filter constraining
  // the same column, and the result answers a different question rather than
  // returning nothing.
  return { AND: [base, reachableWhere(channel)] };
}

export async function estimateAudience(
  restaurantId: string,
  audienceQuery: string,
  channel: MessageChannel,
): Promise<AudienceEstimate> {
  const [matched, reachable] = await Promise.all([
    prisma.customer.count({ where: whereForAudience(restaurantId, audienceQuery, null) }),
    prisma.customer.count({ where: whereForAudience(restaurantId, audienceQuery, channel) }),
  ]);
  return { matched, reachable, unreachable: Math.max(0, matched - reachable) };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export type CampaignInput = CampaignDraft & {
  restaurantId: string;
  segmentId?: string | null;
  scheduledFor?: Date | null;
  actorId?: string | null;
};

export async function createCampaign(input: CampaignInput) {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: { name: true },
  });

  const errors = validateCampaign(input, restaurant?.name ?? "the restaurant");
  if (errors.length) return { errors };

  const campaign = await prisma.campaign.create({
    data: {
      restaurantId: input.restaurantId,
      name: input.name.trim(),
      channel: input.channel,
      subject: input.channel === "EMAIL" ? (input.subject ?? "").trim() : null,
      body: input.body.trim(),
      audienceQuery: input.audienceQuery ?? "",
      segmentId: input.segmentId ?? null,
      scheduledFor: input.scheduledFor ?? null,
      status: input.scheduledFor ? "SCHEDULED" : "DRAFT",
      createdByUserId: input.actorId ?? null,
    },
  });

  // Stored on the draft so the list can show "≈ 240 people" without running
  // every campaign's audience query on page load. Refreshed on edit and again
  // at launch, because the list moves underneath a draft that sits for a week.
  const est = await estimateAudience(campaign.restaurantId, campaign.audienceQuery, campaign.channel);
  await prisma.campaign.update({
    where: { id: campaign.id },
    data: { audienceCount: est.matched },
  });

  return { campaign };
}

export async function updateCampaign(
  restaurantId: string,
  id: string,
  input: CampaignDraft & { segmentId?: string | null; scheduledFor?: Date | null },
) {
  const existing = await prisma.campaign.findFirst({
    where: { id, restaurantId },
    select: { status: true },
  });
  if (!existing) return { errors: [{ field: "", message: "Campaign not found." }] };

  // Not "the UI hides the button": a form posted after a campaign started, or
  // by someone with the page open in another tab, must not rewrite the message
  // that is currently going out to people.
  if (!isEditable(existing.status)) {
    return {
      errors: [
        { field: "", message: `A campaign that is ${existing.status.toLowerCase()} can't be edited.` },
      ],
    };
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });
  const errors = validateCampaign(input, restaurant?.name ?? "the restaurant");
  if (errors.length) return { errors };

  const est = await estimateAudience(restaurantId, input.audienceQuery ?? "", input.channel);

  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      name: input.name.trim(),
      channel: input.channel,
      subject: input.channel === "EMAIL" ? (input.subject ?? "").trim() : null,
      body: input.body.trim(),
      audienceQuery: input.audienceQuery ?? "",
      segmentId: input.segmentId ?? null,
      scheduledFor: input.scheduledFor ?? null,
      status: input.scheduledFor ? "SCHEDULED" : "DRAFT",
      audienceCount: est.matched,
    },
  });

  return { campaign };
}

/**
 * Deletes a draft. Never anything else.
 *
 * A campaign that has sent is a record of who was contacted and on what basis,
 * and it is the thing that answers a carrier or ISP complaint months later.
 * The `Message` rows survive a delete anyway — the foreign key is SET NULL —
 * but they lose the attribution, which is most of their value.
 */
export async function deleteCampaign(restaurantId: string, id: string) {
  const existing = await prisma.campaign.findFirst({
    where: { id, restaurantId },
    select: { status: true },
  });
  if (!existing) return { error: "Campaign not found." };
  if (existing.status !== "DRAFT") {
    return { error: "Only drafts can be deleted. Cancel it instead — the record of what was sent has to stay." };
  }

  await prisma.campaign.delete({ where: { id } });
  return { ok: "Draft deleted." };
}

// ---------------------------------------------------------------------------
// Launch
// ---------------------------------------------------------------------------

/**
 * How many recipients are materialised per pass. Bounded because a tenant with
 * 50,000 customers must not turn one server action into a 50,000-row insert
 * that holds a connection open.
 */
const MATERIALISE_BATCH = 500;

/**
 * Moves a campaign to SENDING and writes a QUEUED Message row per reachable
 * recipient.
 *
 * The optimistic lock is the same shape every writer in `lib/orders.ts` takes,
 * and it is here for the same reason: two tabs, or a double-tapped button, must
 * not both materialise the audience. The status that was read goes in the
 * WHERE of an `updateMany`, and a zero-row result means somebody else got there
 * first — at which point we stop, rather than queueing a second copy of the
 * message to everybody.
 */
export async function launchCampaign(
  restaurantId: string,
  id: string,
): Promise<{ ok?: string; error?: string; queued?: number }> {
  const campaign = await prisma.campaign.findFirst({ where: { id, restaurantId } });
  if (!campaign) return { error: "Campaign not found." };

  if (!canTransition(campaign.status, "SENDING")) {
    return { error: `A campaign that is ${campaign.status.toLowerCase()} can't be sent.` };
  }

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { name: true },
  });
  const errors = validateCampaign(campaign, restaurant?.name ?? "the restaurant");
  if (errors.length) return { error: errors[0].message };

  // The platform's own switch, checked before anything is written. The send
  // gate would catch this too and record a wall of SKIPPED rows — technically
  // correct, useless to look at, and it would leave the campaign reading as
  // "sent to 0 people" rather than "we've turned this off for you".
  const service = campaign.channel === "SMS" ? "SMS" : "EMAIL";
  if (await isSuspended(restaurantId, service)) {
    return { error: `${service === "SMS" ? "Text messaging" : "Email"} is currently suspended for this account.` };
  }

  const claimed = await prisma.campaign.updateMany({
    where: { id, status: campaign.status },
    data: { status: "SENDING", startedAt: new Date(), error: null },
  });
  if (claimed.count === 0) return { error: "Someone else started this campaign a moment ago." };

  try {
    const queued = await materialiseRecipients(campaign.id);
    await refreshCampaignCounts(campaign.id);

    // An audience that resolved to nobody is finished, not sending. Leaving it
    // in SENDING would put a campaign in the drain queue forever that has
    // nothing to drain, and show the owner a spinner that never resolves.
    if (queued === 0) {
      await prisma.campaign.updateMany({
        where: { id, status: "SENDING" },
        data: { status: "SENT", completedAt: new Date() },
      });
      return { ok: "Nobody in that audience can be contacted on this channel right now.", queued: 0 };
    }

    return { ok: `Queued for ${queued} ${queued === 1 ? "person" : "people"}.`, queued };
  } catch (err) {
    // A campaign that fell over partway has real rows behind it, so it is
    // FAILED rather than rolled back — and the owner is told, because the
    // alternative is a campaign that half-sent and looks like it never ran.
    await prisma.campaign.updateMany({
      where: { id, status: "SENDING" },
      data: { status: "FAILED", error: (err as Error).message.slice(0, 400) },
    });
    console.error("[campaigns] materialise failed", id, err);
    return { error: "Something went wrong queueing that campaign. Nothing further will send." };
  }
}

/**
 * Writes the QUEUED rows.
 *
 * Merge fields are rendered **here, at queue time**, not at send time, and that
 * is deliberate: the body stored on each Message row is then exactly what that
 * person received. Rendering at send would leave the outbox showing a template
 * rather than the message, which is the wrong answer to "what did you actually
 * text my customer".
 *
 * `skipDuplicates` guards the one race the optimistic lock can't: a retry of a
 * partially-completed materialise pass.
 */
async function materialiseRecipients(campaignId: string): Promise<number> {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return 0;

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: campaign.restaurantId },
    select: { name: true },
  });
  const restaurantName = restaurant?.name ?? "";

  const where = whereForAudience(campaign.restaurantId, campaign.audienceQuery, campaign.channel);

  let cursor: string | undefined;
  let total = 0;

  for (;;) {
    const batch = await prisma.customer.findMany({
      where,
      select: { id: true, name: true, phone: true, email: true },
      orderBy: { id: "asc" },
      take: MATERIALISE_BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (batch.length === 0) break;

    const rows = batch
      .map((c) => {
        const to = campaign.channel === "SMS" ? c.phone : normalizeEmail(c.email);
        if (!to) return null;
        return {
          restaurantId: campaign.restaurantId,
          customerId: c.id,
          campaignId: campaign.id,
          channel: campaign.channel,
          kind: "CAMPAIGN" as const,
          status: "QUEUED" as const,
          subject: campaign.subject,
          body: renderMergeFields(campaign.body, {
            customerName: c.name,
            restaurantName,
          }),
          to,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (rows.length) {
      const res = await prisma.message.createMany({ data: rows, skipDuplicates: true });
      total += res.count;
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < MATERIALISE_BATCH) break;
  }

  return total;
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

/**
 * Stops a campaign. From SENDING this stops the *remainder* — anything already
 * on the wire is gone, and the campaign says so.
 *
 * Undelivered QUEUED rows are marked SKIPPED with reason `campaign_canceled`
 * rather than deleted, because "we decided not to send this" is a different
 * answer to a support question than "this was never queued", and the outbox is
 * the only place either is recorded.
 */
export async function cancelCampaign(
  restaurantId: string,
  id: string,
): Promise<{ ok?: string; error?: string }> {
  const campaign = await prisma.campaign.findFirst({ where: { id, restaurantId } });
  if (!campaign) return { error: "Campaign not found." };
  if (!canTransition(campaign.status, "CANCELED")) {
    return { error: `A campaign that is ${campaign.status.toLowerCase()} can't be canceled.` };
  }

  const claimed = await prisma.campaign.updateMany({
    where: { id, status: campaign.status },
    data: { status: "CANCELED", canceledAt: new Date() },
  });
  if (claimed.count === 0) return { error: "That campaign changed while you were looking at it." };

  const stopped = await prisma.message.updateMany({
    where: { campaignId: id, status: "QUEUED" },
    data: { status: "SKIPPED", error: "campaign_canceled" },
  });

  await refreshCampaignCounts(id);

  const alreadySent = campaign.sentCount;
  return {
    ok:
      stopped.count > 0
        ? `Canceled. ${stopped.count} message${stopped.count === 1 ? "" : "s"} stopped${
            alreadySent > 0 ? `, ${alreadySent} had already gone out` : ""
          }.`
        : "Canceled.",
  };
}

// ---------------------------------------------------------------------------
// Draining
// ---------------------------------------------------------------------------

/**
 * How many messages one drain pass sends.
 *
 * Small on purpose. The sweep runs every two minutes, so 100 per pass is
 * 3,000 an hour — fast enough for an independent restaurant's list and slow
 * enough that a new sending domain isn't sending its first thousand emails in
 * ninety seconds, which is what a reputation system reads as a spam cannon.
 */
export const DRAIN_BATCH = 100;

export type DrainResult = {
  started: number;
  sent: number;
  failed: number;
  skipped: number;
  completed: number;
};

/**
 * The sweep entry point. Three jobs, in order:
 *
 *   1. Promote SCHEDULED campaigns whose time has come.
 *   2. Send a bounded batch of QUEUED messages.
 *   3. Mark SENDING campaigns with nothing left as SENT.
 *
 * Each message goes out through `deliverQueuedMessage` / `deliverQueuedEmail`,
 * which re-run the full consent gate against current data. Not a formality: a
 * customer who texted STOP between the owner pressing Send and this pass
 * running must not be texted, and the queued row was written before that STOP
 * existed.
 */
export async function drainCampaigns(limit = DRAIN_BATCH): Promise<DrainResult> {
  const result: DrainResult = { started: 0, sent: 0, failed: 0, skipped: 0, completed: 0 };

  // ── 1. Due schedules ────────────────────────────────────────────────────
  const due = await prisma.campaign.findMany({
    where: { status: "SCHEDULED", scheduledFor: { lte: new Date() } },
    select: { id: true, restaurantId: true },
    take: 20,
  });
  for (const c of due) {
    const res = await launchCampaign(c.restaurantId, c.id);
    if (res.queued !== undefined) result.started++;
  }

  // ── 2. The queue ────────────────────────────────────────────────────────
  //
  // Ordered oldest first so a campaign launched an hour ago finishes before one
  // launched a minute ago starts — a queue that interleaves leaves every
  // campaign perpetually half-sent, which is the state an owner finds hardest
  // to interpret.
  const queued = await prisma.message.findMany({
    where: { status: "QUEUED", campaignId: { not: null }, campaign: { status: "SENDING" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, channel: true },
    take: limit,
  });

  for (const msg of queued) {
    const outcome =
      msg.channel === "SMS" ? await deliverQueuedMessage(msg.id) : await deliverQueuedEmail(msg.id);
    if (outcome === "sent") result.sent++;
    else if (outcome === "skipped") result.skipped++;
    else result.failed++;
  }

  // ── 3. Finished campaigns ───────────────────────────────────────────────
  //
  // "Nothing left QUEUED" rather than "sent + skipped + failed === queued":
  // the counters are a cache and the queue is the truth, and a campaign that
  // hangs in SENDING forever because two numbers disagree is worse than one
  // that completes a pass early.
  const sending = await prisma.campaign.findMany({
    where: { status: "SENDING" },
    select: { id: true },
    take: 100,
  });
  for (const c of sending) {
    const remaining = await prisma.message.count({
      where: { campaignId: c.id, status: "QUEUED" },
    });
    await refreshCampaignCounts(c.id);
    if (remaining === 0) {
      const done = await prisma.campaign.updateMany({
        where: { id: c.id, status: "SENDING" },
        data: { status: "SENT", completedAt: new Date() },
      });
      if (done.count) result.completed++;
    }
  }

  return result;
}

/**
 * Recomputes the denormalised counters from the Message rows.
 *
 * Recomputed, never incremented. `Order.refundedCts` taught this repo what
 * read-then-increment costs, and a counter that drifts here is an owner told
 * their campaign reached 300 people when it reached 90 — which is a decision
 * they'd make differently.
 */
export async function refreshCampaignCounts(campaignId: string) {
  const grouped = await prisma.message.groupBy({
    by: ["status"],
    where: { campaignId },
    _count: { _all: true },
  });

  const count = (s: string) => grouped.find((g) => g.status === s)?._count._all ?? 0;

  // DELIVERED is a carrier receipt on a message that was already SENT, so it
  // belongs in the sent total rather than beside it — an owner reading "200
  // sent, 140 delivered" reasonably concludes 60 vanished.
  const sent = count("SENT") + count("DELIVERED");
  const failed = count("FAILED") + count("UNDELIVERED");

  await prisma.campaign.update({
    where: { id: campaignId },
    data: {
      queuedCount: count("QUEUED"),
      sentCount: sent,
      failedCount: failed,
      skippedCount: count("SKIPPED"),
    },
  });
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export async function listCampaigns(restaurantId: string, take = 50) {
  return prisma.campaign.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "desc" },
    take,
  });
}

export async function campaignDetail(restaurantId: string | null, id: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, ...(restaurantId ? { restaurantId } : {}) },
  });
  if (!campaign) return null;

  // Why messages didn't send, grouped. This is the panel that makes the
  // consent gate legible — without it an owner sees "reached 90 of 400" and
  // has no way to learn that 280 never opted into texts and 30 unsubscribed.
  const skipReasons = await prisma.message.groupBy({
    by: ["error"],
    where: { campaignId: id, status: "SKIPPED" },
    _count: { _all: true },
  });

  const recent = await prisma.message.findMany({
    where: { campaignId: id },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { customer: { select: { name: true, phone: true, email: true } } },
  });

  return { campaign, skipReasons, recent };
}

/** Whether the platform can actually send on a channel right now. */
export async function channelReadiness(restaurantId: string) {
  const [smsSuspended, emailSuspended, restaurant] = await Promise.all([
    isSuspended(restaurantId, "SMS"),
    isSuspended(restaurantId, "EMAIL"),
    prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { smsFrom: true, emailFrom: true, emailSenderVerifiedAt: true },
    }),
  ]);

  return {
    sms: {
      suspended: smsSuspended,
      // The stub records and sends nothing. Owners are told, because a campaign
      // that reports "sent to 240 people" while nothing left the building is
      // the single worst thing this feature could do quietly.
      live: process.env.SMS_PROVIDER === "twilio",
      hasSender: !!restaurant?.smsFrom || !!process.env.TWILIO_MESSAGING_SERVICE_SID,
    },
    email: {
      suspended: emailSuspended,
      live: emailProviderConfigured(),
      hasSender: !!restaurant?.emailSenderVerifiedAt || !!process.env.EMAIL_FROM,
      tenantSender: !!restaurant?.emailSenderVerifiedAt,
    },
  };
}
