"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  addNote,
  adminReply,
  setContactStatus,
  setTicketStatus,
  type SupportResult,
} from "@/lib/support";
import type { SupportStatus } from "@prisma/client";

/**
 * Admin-side support actions. Thin wrappers over `lib/support.ts` that supply
 * `requireAdmin()` and nothing else — the same relationship the owner actions
 * have to the same module, and the reason there's only one status machine.
 */

const STATUSES: SupportStatus[] = ["OPEN", "WAITING", "RESOLVED", "ARCHIVED"];

function statusFrom(form: FormData): SupportStatus | null {
  const v = String(form.get("status") ?? "");
  return STATUSES.includes(v as SupportStatus) ? (v as SupportStatus) : null;
}

export async function adminReplyAction(
  _prev: SupportResult | undefined,
  formData: FormData
): Promise<SupportResult> {
  const session = await requireAdmin();
  const ticketId = String(formData.get("ticketId") ?? "");

  const res = await adminReply(
    ticketId,
    // The owner sees "EZ Orders" as the sender either way — this is only what
    // gets stored, so a future support hire's replies remain attributable.
    session.email,
    String(formData.get("body") ?? "")
  );

  if (res.ok) {
    revalidatePath(`/admin/support/${ticketId}`);
    revalidatePath("/admin/support");
    revalidatePath("/admin");
  }
  return res;
}

export async function setTicketStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const ticketId = String(formData.get("ticketId") ?? "");
  const status = statusFrom(formData);
  if (!status) return;

  await setTicketStatus(ticketId, status);
  revalidatePath(`/admin/support/${ticketId}`);
  revalidatePath("/admin/support");
  revalidatePath("/admin");
}

export async function setContactStatusAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const status = statusFrom(formData);
  if (!status) return;

  await setContactStatus(id, status);
  revalidatePath("/admin/support");
  revalidatePath("/admin");
}

export async function addTicketNoteAction(
  _prev: SupportResult | undefined,
  formData: FormData
): Promise<SupportResult> {
  const session = await requireAdmin();
  const ticketId = String(formData.get("ticketId") ?? "");

  const res = await addNote(
    { ticketId },
    { id: session.userId, email: session.email },
    String(formData.get("body") ?? "")
  );

  if (res.ok) revalidatePath(`/admin/support/${ticketId}`);
  return res;
}

export async function addContactNoteAction(
  _prev: SupportResult | undefined,
  formData: FormData
): Promise<SupportResult> {
  const session = await requireAdmin();

  const res = await addNote(
    { contactId: String(formData.get("contactId") ?? "") },
    { id: session.userId, email: session.email },
    String(formData.get("body") ?? "")
  );

  if (res.ok) revalidatePath("/admin/support");
  return res;
}
