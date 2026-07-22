"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireOwner, getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  cancelCampaign,
  createCampaign,
  deleteCampaign,
  estimateAudience,
  launchCampaign,
  updateCampaign,
} from "@/lib/campaigns";
import { normalizeEmail } from "@/lib/email";
import { setReorderChoice } from "@/lib/reorder-manage";
import type { MessageChannel } from "@prisma/client";

/**
 * The owner's dashboard dial for done-for-you reordering. Turns the platform's
 * reordering journey on/off and sets its intensity, then reconciles the
 * machinery through the one door. Returns the apply result so the card can show
 * "on, but paused because messaging is suspended" honestly rather than claiming
 * success the runtime didn't deliver.
 */
export async function setReorderAction(
  _prev: { ok?: string; error?: string } | undefined,
  fd: FormData,
): Promise<{ ok?: string; error?: string }> {
  const { restaurantId } = await requireOwner();
  const enabled = String(fd.get("enabled") ?? "") === "on";
  const mode = String(fd.get("mode") ?? "MEDIUM");
  const res = await setReorderChoice(restaurantId, enabled, mode);
  revalidatePath("/dashboard/marketing");
  return res;
}

/**
 * Owner-side campaign actions.
 *
 * Every one of these re-derives `restaurantId` from `requireOwner()` and passes
 * it into the library call as a scope. No action here accepts a restaurant id
 * from the form, and `lib/campaigns.ts` takes the scope as a required parameter
 * rather than defaulting — so a campaign id posted from another tenant's page
 * finds nothing rather than sending that tenant's customers a message.
 */

type Result = { ok?: string; error?: string } | undefined;

function readChannel(fd: FormData): MessageChannel {
  return fd.get("channel") === "EMAIL" ? "EMAIL" : "SMS";
}

/**
 * Parses the schedule field.
 *
 * A `datetime-local` value has no zone, and the owner means their own wall
 * clock. We can't reconstruct that server-side from the string alone, so the
 * form posts the browser's offset alongside it — the same problem
 * `lib/hours.ts` solves by storing a tenant timezone, but a scheduled send is
 * a one-off act by a person at a keyboard rather than a property of the
 * restaurant, so the browser is the right authority here.
 *
 * A time in the past is treated as "send now" rather than rejected: the owner
 * pressed the button, and arguing with them about thirty seconds of clock skew
 * is worse than sending.
 */
function readSchedule(fd: FormData): Date | null {
  const raw = String(fd.get("scheduledFor") ?? "").trim();
  if (!raw) return null;

  const offsetRaw = Number(fd.get("tzOffset"));
  const offsetMins = Number.isFinite(offsetRaw) ? offsetRaw : 0;

  const parsed = new Date(`${raw}:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  const when = new Date(parsed.getTime() + offsetMins * 60_000);
  return when.getTime() <= Date.now() ? null : when;
}

export async function createCampaignAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const session = await getSession();

  const res = await createCampaign({
    restaurantId,
    name: String(fd.get("name") ?? ""),
    channel: readChannel(fd),
    subject: String(fd.get("subject") ?? ""),
    body: String(fd.get("body") ?? ""),
    audienceQuery: String(fd.get("audienceQuery") ?? ""),
    segmentId: (fd.get("segmentId") as string) || null,
    scheduledFor: readSchedule(fd),
    actorId: session?.userId ?? null,
  });

  if (res.errors?.length) return { error: res.errors[0].message };

  revalidatePath("/dashboard/marketing");
  // Straight to the campaign so the owner lands on the audience breakdown
  // before pressing Send, rather than on a list where the draft is one row
  // among many and the reachable count isn't visible.
  redirect(`/dashboard/marketing/${res.campaign!.id}`);
}

export async function updateCampaignAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("campaignId") ?? "");

  const res = await updateCampaign(restaurantId, id, {
    name: String(fd.get("name") ?? ""),
    channel: readChannel(fd),
    subject: String(fd.get("subject") ?? ""),
    body: String(fd.get("body") ?? ""),
    audienceQuery: String(fd.get("audienceQuery") ?? ""),
    segmentId: (fd.get("segmentId") as string) || null,
    scheduledFor: readSchedule(fd),
  });

  if (res.errors?.length) return { error: res.errors[0].message };

  revalidatePath(`/dashboard/marketing/${id}`);
  return { ok: "Saved." };
}

export async function launchCampaignAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("campaignId") ?? "");

  // The typed confirmation. Not theatre: this is the one control in the
  // dashboard that contacts every customer a restaurant has, it cannot be
  // undone, and it costs money per recipient. A misfired click here is a
  // different order of mistake from a misfired click anywhere else on this
  // page, so it takes a deliberate act rather than a dialog people learn to
  // dismiss.
  if (String(fd.get("confirm") ?? "").trim().toUpperCase() !== "SEND") {
    return { error: 'Type SEND to confirm.' };
  }

  const res = await launchCampaign(restaurantId, id);
  revalidatePath(`/dashboard/marketing/${id}`);
  revalidatePath("/dashboard/marketing");
  return res;
}

export async function cancelCampaignAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(fd.get("campaignId") ?? "");
  const res = await cancelCampaign(restaurantId, id);
  revalidatePath(`/dashboard/marketing/${id}`);
  revalidatePath("/dashboard/marketing");
  return res;
}

export async function deleteCampaignAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await deleteCampaign(restaurantId, String(fd.get("campaignId") ?? ""));
  if (res.error) return res;
  revalidatePath("/dashboard/marketing");
  redirect("/dashboard/marketing");
}

/**
 * Live audience count for the composer.
 *
 * A server action rather than an API route because it's a form-shaped question
 * with an owner-scoped answer, and routing it through `requireOwner()` here
 * means there's no unauthenticated endpoint that will count another tenant's
 * customers for anybody who guesses an id.
 */
export async function estimateAudienceAction(
  audienceQuery: string,
  channel: MessageChannel,
): Promise<{ matched: number; reachable: number; unreachable: number }> {
  const { restaurantId } = await requireOwner();
  return estimateAudience(restaurantId, audienceQuery, channel);
}

/**
 * Saves the tenant's email sender identity.
 *
 * Note what this does **not** set: `emailSenderVerifiedAt`. Verification is
 * ours to write — it mirrors provider state, and an owner who could mark their
 * own domain verified would be setting the from-line to an address that fails
 * DMARC at every recipient. The address is stored; the from-line keeps using
 * the platform sender until verification lands. See lib/email.ts.
 */
export async function saveEmailSenderAction(_prev: Result, fd: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const from = String(fd.get("emailFrom") ?? "").trim();
  const replyTo = String(fd.get("emailReplyTo") ?? "").trim();

  if (from && !normalizeEmail(from)) return { error: "That doesn't look like an email address." };
  if (replyTo && !normalizeEmail(replyTo)) return { error: "That reply-to address doesn't look right." };

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      emailFrom: normalizeEmail(from),
      emailFromName: String(fd.get("emailFromName") ?? "").trim().slice(0, 78) || null,
      emailReplyTo: normalizeEmail(replyTo),
      emailFooterAddress: String(fd.get("emailFooterAddress") ?? "").trim().slice(0, 200) || null,
    },
  });

  revalidatePath("/dashboard/marketing/sender");
  return {
    ok: from
      ? "Saved. We'll verify the sending domain before mail goes out under this address."
      : "Saved.",
  };
}
