"use server";

import { headers } from "next/headers";
import { submitContact, type SupportResult } from "@/lib/support";

/**
 * The public contact endpoint.
 *
 * This is the only unauthenticated writer in the support system, so the throttle
 * key has to come from somewhere the submitter doesn't control. `x-forwarded-for`
 * is set by Railway's proxy in front of us; the leftmost entry is the client and
 * the rest are hops, which is why only the first is taken. A spoofed header
 * behind that proxy gets overwritten, and with no header at all every caller
 * shares one bucket — the safe direction to fail, since the cost is a stranger
 * being told to wait rather than a stranger getting through.
 *
 * The path is read here rather than passed from the form for the same reason
 * the analytics beacon resolves a slug server-side: a client-supplied field
 * that lands in a database is a client-supplied field, whatever it's called.
 */
export async function submitContactAction(
  _prev: SupportResult | undefined,
  formData: FormData
): Promise<SupportResult> {
  const h = headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  const throttleKey = forwarded || h.get("x-real-ip") || "unknown";

  return submitContact(formData, {
    throttleKey,
    sourcePath: h.get("referer")?.slice(0, 200) ?? null,
  });
}
