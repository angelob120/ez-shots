"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  markAllRead,
  markRead,
  notify,
  setPref,
  type NotifyAudience,
} from "@/lib/notifications";
import { KIND_ORDER } from "@/lib/notification-format";
import type { NotificationKind } from "@prisma/client";

/**
 * Admin notification actions. Thin wrappers over `lib/notifications.ts` that
 * supply `requireAdmin()` — the same relationship the support actions have to
 * `lib/support.ts`. Nothing here writes a Notification row or sends directly;
 * it all goes through the one door.
 */

export async function markReadAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (id) await markRead(session.userId, id);
  revalidatePath("/admin/notifications");
}

export async function markAllReadAction(): Promise<void> {
  const session = await requireAdmin();
  await markAllRead(session.userId);
  revalidatePath("/admin/notifications");
}

export async function savePrefsAction(formData: FormData): Promise<void> {
  const session = await requireAdmin();
  // The form posts a checkbox per (kind, channel); absent means off. We upsert
  // every kind so unchecking persists rather than falling back to the default.
  for (const kind of KIND_ORDER) {
    await setPref(session.userId, kind as NotificationKind, {
      inApp: formData.get(`${kind}.inApp`) === "on",
      email: formData.get(`${kind}.email`) === "on",
      sms: formData.get(`${kind}.sms`) === "on",
    });
  }
  revalidatePath("/admin/notifications");
}

export type ComposeResult = { ok: boolean; message: string };

export async function composeAction(
  _prev: ComposeResult | undefined,
  formData: FormData
): Promise<ComposeResult> {
  const session = await requireAdmin();

  const title = String(formData.get("title") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  const to = String(formData.get("audience") ?? "");
  const whenRaw = String(formData.get("scheduledFor") ?? "").trim();

  if (!title || !body) {
    return { ok: false, message: "A title and a message are both required." };
  }

  let audience: NotifyAudience;
  if (to === "admins") audience = { to: "ADMINS" };
  else if (to === "owners") audience = { to: "ALL_OWNERS" };
  else if (to === "me") audience = { to: "USER", userId: session.userId };
  else return { ok: false, message: "Pick who this goes to." };

  // A datetime-local value is wall-clock with no zone; new Date() reads it in
  // the server's zone, which is good enough for an operator setting their own
  // reminder. Past or empty means "now".
  let scheduledFor: Date | null = null;
  if (whenRaw) {
    const d = new Date(whenRaw);
    if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) scheduledFor = d;
  }

  // A self-addressed future note is a REMINDER; anything sent to others is a
  // BROADCAST announcement.
  const kind: NotificationKind = to === "me" ? "REMINDER" : "BROADCAST";

  await notify({
    kind,
    audience,
    title,
    body,
    scheduledFor,
    createdById: session.userId,
  });

  const whenNote = scheduledFor ? ` It will surface ${scheduledFor.toLocaleString()}.` : "";
  const whoNote = to === "me" ? "yourself" : to === "admins" ? "all admins" : "all owners";
  revalidatePath("/admin/notifications");
  return { ok: true, message: `Sent to ${whoNote}.${whenNote}` };
}
