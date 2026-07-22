"use server";

import { redirect } from "next/navigation";
import { recordEmailOptIn } from "@/lib/email";

/**
 * "Actually, keep me subscribed."
 *
 * Only reachable by someone holding a token we mailed to that address, so the
 * token is the authorisation — the same arrangement `/o/[token]` uses.
 *
 * `recordEmailOptIn` refuses when the suppression came from a bounce or a spam
 * complaint rather than from the person. A hard bounce means the mailbox does
 * not exist and a complaint means a mailbox provider told us to stop; neither
 * is undone by a click, and re-enabling either is how a sending domain gets
 * blocklisted. The page reports success either way rather than explaining the
 * distinction, because the only reader who could hit that branch is a bot.
 */
export async function resubscribeAction(fd: FormData) {
  const token = String(fd.get("token") ?? "");
  await recordEmailOptIn(token);
  redirect(`/u/${token}?resubscribed=1`);
}
