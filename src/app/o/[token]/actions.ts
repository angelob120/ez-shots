"use server";

import { revalidatePath } from "next/cache";
import { customerCancelOrder, orderPath, reportIssue, ISSUE_LABELS } from "@/lib/orders";
import { checkRateLimit } from "@/lib/rate-limit";

export type CustomerResult = { ok: boolean; message: string };

/**
 * Both actions below are authenticated purely by possession of the token in
 * the URL — there is no account behind a pickup order. That is why the token
 * is 160 random bits, and why neither action will do anything the holder of
 * the link shouldn't be able to do: cancel their own pending order, or report
 * a problem with it. Neither one can move money on its own.
 *
 * Token possession isn't a rate limit, though — nothing previously stopped
 * the same link being replayed as fast as a script could post to it. Each
 * action is throttled per-token, independently of the other, so a burst on
 * one doesn't spend the other's budget.
 */

const TOO_MANY_MESSAGE = "Too many attempts — please wait a few minutes and try again.";

export async function cancelOrderAction(
  _prev: CustomerResult | null,
  formData: FormData
): Promise<CustomerResult> {
  const token = String(formData.get("token") ?? "");
  const note = String(formData.get("note") ?? "").slice(0, 300);

  const limit = checkRateLimit(`cancel:${token}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return { ok: false, message: TOO_MANY_MESSAGE };
  }

  const res = await customerCancelOrder({ token, note: note || undefined });
  revalidatePath(orderPath(token));

  return res.ok
    ? {
        ok: true,
        message:
          "Canceled. Your refund is on its way back to your card — it usually lands in 3–5 days.",
      }
    : { ok: false, message: res.error };
}

export async function reportIssueAction(
  _prev: CustomerResult | null,
  formData: FormData
): Promise<CustomerResult> {
  const token = String(formData.get("token") ?? "");
  const kind = String(formData.get("kind") ?? "OTHER");
  const body = String(formData.get("body") ?? "");

  if (!(kind in ISSUE_LABELS)) {
    return { ok: false, message: "Pick what went wrong." };
  }

  const limit = checkRateLimit(`report:${token}`, 5, 10 * 60 * 1000);
  if (!limit.allowed) {
    return { ok: false, message: TOO_MANY_MESSAGE };
  }

  const res = await reportIssue({ token, kind, body });
  revalidatePath(orderPath(token));

  return res.ok
    ? {
        ok: true,
        message: "Sent. The restaurant can see this now and will get back to you.",
      }
    : { ok: false, message: res.error };
}
