"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getSession, requireOwner } from "@/lib/auth";
import { isOAuthProvider, PROVIDER_LABEL } from "@/lib/oauth";

/**
 * Disconnect a linked Google or Apple account.
 *
 * There is no matching "connect" action, deliberately: connecting is the normal
 * sign-in flow started from `/api/auth/[provider]/start`, and a second code
 * path that writes an `OAuthIdentity` without going through the provider would
 * be a way to attach an arbitrary subject to an account. Linking happens
 * exactly where sign-in happens.
 *
 * Unlinking is safe by comparison — it only ever removes a way in.
 */
export async function unlinkProviderAction(
  _prev: { ok?: string; error?: string } | undefined,
  formData: FormData
): Promise<{ ok?: string; error?: string }> {
  // The tenant scope isn't used by the query below, which is keyed on the
  // session's own user id — but the guard is what establishes there *is* a
  // session at all.
  await requireOwner();
  const session = await getSession();
  if (!session) return { error: "Sign in again to change this." };

  // An admin viewing an owner's dashboard must not be able to detach that
  // owner's login. Impersonation is for seeing what they see, not for changing
  // how they get in.
  if (session.impersonating) {
    return { error: "Not available while viewing another account." };
  }

  const provider = String(formData.get("provider") ?? "");
  if (!isOAuthProvider(provider)) return { error: "Unknown sign-in method." };

  // Scoped to this user's own rows. `deleteMany` rather than `delete` so a
  // second click is a no-op instead of a "record not found" error page.
  const removed = await prisma.oAuthIdentity.deleteMany({
    where: { userId: session.userId, provider },
  });

  if (removed.count === 0) {
    return { error: `${PROVIDER_LABEL[provider]} wasn't connected.` };
  }

  revalidatePath("/dashboard/sign-in");
  return {
    ok: `${PROVIDER_LABEL[provider]} disconnected. You can connect it again at any time by signing in with it.`,
  };
}
