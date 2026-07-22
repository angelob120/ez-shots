"use server";

import { completePasswordReset } from "@/lib/password-reset";

export async function completeResetAction(
  _prev: { error?: string; done?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; done?: boolean }> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  const result = await completePasswordReset(token, password, confirm);
  if (!result.ok) return { error: result.message };
  return { done: true };
}
