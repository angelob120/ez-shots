"use server";

import { redirect } from "next/navigation";
import { setSession } from "@/lib/auth";
import { recordLogin } from "@/lib/activity";
import { redeemInvite } from "@/lib/invites";
import { checkRateLimit } from "@/lib/rate-limit";

type Result = { error?: string } | undefined;

/**
 * The one unauthenticated route in the app that creates a session.
 *
 * It gets the same treatment as the order token: the secret is the auth, so the
 * throttle is a safety net rather than the boundary. Keyed per token because
 * that's the only identity available before the account exists — a per-IP key
 * would punish a whole restaurant behind one NAT.
 *
 * All the real checks live in `redeemInvite`. This is the door, not the lock.
 */
export async function acceptInviteAction(_prev: Result, formData: FormData): Promise<Result> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const name = String(formData.get("name") ?? "");

  if (!token) return { error: "Something went wrong with that link. Try opening it again." };

  const gate = checkRateLimit(`invite:${token}`, 8, 10 * 60_000);
  if (!gate.allowed) {
    return { error: "Too many attempts. Wait a few minutes and try again." };
  }

  const res = await redeemInvite({ token, password, name });
  if (!res.ok) return { error: res.error };

  await setSession({
    userId: res.value.userId,
    email: res.value.email,
    role: res.value.role,
    restaurantId: res.value.restaurantId,
  });
  await recordLogin({ userId: res.value.userId, method: "INVITE" });

  // Straight into the wizard. They arrived from an invite, which means nobody
  // has set this restaurant up yet — a dashboard full of empty panels would be
  // a worse first screen than a first question.
  redirect("/onboarding");
}
