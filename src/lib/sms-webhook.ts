import { verifyTwilioSignature } from "@/lib/sms-twilio";

/**
 * Shared front door for the two Twilio webhooks.
 *
 * Both are public URLs that mutate state a customer cares about — consent on
 * one, delivery record on the other — and both are authenticated by nothing
 * except Twilio's request signature. Parsing and verification are identical,
 * so they live here rather than being written twice and drifting.
 */

export type WebhookResult =
  | { ok: true; params: Record<string, string> }
  | { ok: false; status: number; reason: string };

/**
 * Reads the form body and checks the signature.
 *
 * The signed URL has to be the one Twilio actually requested, which behind
 * Cloudflare and Railway is not what `req.url` reports — the proxy rewrites
 * the host. `x-forwarded-host` and `x-forwarded-proto` reconstruct it, exactly
 * the mismatch next.config.mjs already documents for Server Actions.
 */
export async function readTwilioWebhook(req: Request): Promise<WebhookResult> {
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // No token means no way to tell Twilio from anyone else. Refuse rather than
  // process unauthenticated writes to the consent record.
  if (!authToken) return { ok: false, status: 503, reason: "sms_not_configured" };

  const signature = req.headers.get("x-twilio-signature");
  if (!signature) return { ok: false, status: 403, reason: "missing_signature" };

  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw));

  const requested = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? requested.host;
  const proto = req.headers.get("x-forwarded-proto") ?? requested.protocol.replace(":", "");
  const url = `${proto}://${host}${requested.pathname}${requested.search}`;

  const valid = await verifyTwilioSignature(url, params, signature, authToken);
  if (!valid) return { ok: false, status: 403, reason: "bad_signature" };

  return { ok: true, params };
}

/** Minimal TwiML. Twilio wants XML back and complains in the console about anything else. */
export function twiml(message?: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
