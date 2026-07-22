"use server";

import { requestPasswordReset } from "@/lib/password-reset";

/**
 * Always returns the same success shape, whether or not the email matched an
 * account. Telling the two apart would turn this into an account-enumeration
 * oracle; the page renders "check your email" either way. See
 * lib/password-reset.ts.
 */
export async function requestResetAction(
  _prev: { done?: boolean; error?: string } | undefined,
  formData: FormData
): Promise<{ done?: boolean; error?: string }> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email address for your account." };

  await requestPasswordReset(email);
  return { done: true };
}
