"use server";

import { redirect } from "next/navigation";
import { authenticate, clearSession, setSession } from "@/lib/auth";
import { recordLogin } from "@/lib/activity";

export async function loginAction(_prev: { error?: string } | undefined, formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "");

  if (!email || !password) return { error: "Email and password are required." };

  const user = await authenticate(email, password);
  if (!user) return { error: "Those credentials don't match an active account." };

  await setSession({
    userId: user.id,
    email: user.email,
    role: user.role,
    restaurantId: user.restaurantId,
  });
  await recordLogin({ userId: user.id, method: "PASSWORD" });

  const dest = next && next.startsWith("/") ? next : user.role === "ADMIN" ? "/admin" : "/dashboard";
  redirect(dest);
}

export async function logoutAction() {
  await clearSession();
  redirect("/login");
}
