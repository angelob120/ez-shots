"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { createTicketFromForm, ownerReply, type SupportResult } from "@/lib/support";

/**
 * Owner-side support actions.
 *
 * Thin wrappers, exactly like the domain routes over `lib/domain-ops.ts`: they
 * supply the auth scope and nothing else. Every one of them derives
 * `restaurantId` from `requireOwner()` and passes it to the library, which
 * filters on it in the same query that loads the row — so a hand-crafted post
 * carrying somebody else's ticket id finds nothing rather than finding a
 * record and failing an afterthought check.
 */

async function owner() {
  const { session, restaurantId } = await requireOwner();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, email: true },
  });

  return {
    restaurantId,
    // An impersonating admin is not the filer. Attributing a ticket to them
    // would make "who reported this" answer with us, and the reply-to address
    // would be ours — so the ticket would be filed on the tenant's behalf and
    // then routed straight back to the person who filed it.
    userId: session.impersonating ? null : user?.id ?? null,
    name: (session.impersonating ? null : user?.name) ?? "Owner",
    email: user?.email ?? session.email,
  };
}

export async function fileTicketAction(
  _prev: SupportResult | undefined,
  formData: FormData
): Promise<SupportResult> {
  const ctx = await owner();
  const res = await createTicketFromForm(ctx, formData);

  if (res.id) {
    revalidatePath("/dashboard/support");
    redirect(`/dashboard/support/${res.id}`);
  }
  return res;
}

export async function ownerReplyAction(
  _prev: SupportResult | undefined,
  formData: FormData
): Promise<SupportResult> {
  const ctx = await owner();
  const ticketId = String(formData.get("ticketId") ?? "");
  const res = await ownerReply(ctx.restaurantId, ticketId, ctx.name, String(formData.get("body") ?? ""));

  if (res.ok) revalidatePath(`/dashboard/support/${ticketId}`);
  return res;
}
