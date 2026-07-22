import { prisma } from "@/lib/prisma";
import type { ProviderSendInput, SendResult, SmsProvider } from "@/lib/sms";
import { platformOrigin } from "@/lib/domains";

/**
 * Twilio behind the SmsProvider seam.
 *
 * Talks to the REST API over fetch rather than pulling in the `twilio` SDK.
 * The surface used here is two endpoints and a signature check; the SDK is a
 * large dependency that would mostly be carried, not used.
 *
 * Nothing in this file decides *whether* to send — consent, cohort and
 * destination are settled in lib/sms.ts before a provider is reached. This
 * only knows how to put a message on the wire and how to describe what went
 * wrong afterwards.
 */

const API = "https://api.twilio.com/2010-04-01";

/**
 * Twilio error codes that will fail identically on every retry.
 *
 * The distinction matters because a retry queue that keeps re-sending to a
 * landline burns quota forever and buries the transient failures that would
 * actually have succeeded. Anything not listed is treated as retryable, which
 * is the safer default: a message sent twice is an annoyance, a message
 * silently dropped is the failure this whole item exists to fix.
 */
const PERMANENT = new Set([
  21211, // invalid 'To' number
  21214, // 'To' number not mobile-reachable
  21217, // phone number not a valid mobile number
  21408, // permission to send to this region not enabled
  21610, // recipient has unsubscribed (STOP) — Twilio's own suppression list
  21612, // number not reachable by this sender
  21614, // 'To' number is not SMS-capable (landline)
  30003, // unreachable destination handset
  30005, // unknown destination handset
  30006, // landline or unreachable carrier
]);

type TwilioConfig = {
  /**
   * The AC… Account SID. Always used in the request URL path, regardless of how
   * the request authenticates — the Messages resource lives under the account,
   * not under whatever key signs the call.
   */
  accountSid: string;
  /**
   * Basic-auth username. An API Key SID (SK…) when one is configured, otherwise
   * the Account SID itself (the Auth Token path).
   */
  authUser: string;
  /** Basic-auth password: the API Key secret, or the Account Auth Token. */
  authPass: string;
  /** Platform-wide fallback sender when a tenant has no registered number. */
  messagingServiceSid?: string;
  /** Absolute URL Twilio posts delivery receipts to. */
  statusCallback?: string;
};

/**
 * Two ways to authenticate to Twilio, and this resolves both.
 *
 * An **API Key** (SK… SID + secret) is the credential to prefer: it is
 * revocable on its own without rotating the account, and it is what Twilio's own
 * console nudges you to create. But an API Key is *not* an Account SID — it
 * signs the request, while the URL path still has to name the AC… account the
 * Messages resource lives under. Conflating the two (putting an SK… value in the
 * URL path) is the common misconfiguration this split exists to prevent.
 *
 * The **Auth Token** path is the fallback: the Account SID is both the username
 * and the thing in the URL, and the token is the password.
 */
export function twilioConfigFromEnv(): TwilioConfig | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  if (!accountSid) return null;

  const apiKeySid = process.env.TWILIO_API_KEY_SID;
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  // Prefer the API Key when a complete pair is present; fall back to the Auth
  // Token. Either way the account SID stays in the URL path below.
  const authUser = apiKeySid && apiKeySecret ? apiKeySid : accountSid;
  const authPass = apiKeySid && apiKeySecret ? apiKeySecret : authToken;
  if (!authPass) return null;

  // Platform origin, never a tenant's canonical one: this is where Twilio posts
  // receipts, and /api/* is ours. A custom domain proxies through Cloudflare and
  // is passed through by middleware, so it would mostly work — but it would tie
  // our webhook to a hostname the owner can retire at any moment.
  const base = platformOrigin();

  return {
    accountSid,
    authUser,
    authPass,
    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
    statusCallback: base ? `${base}/api/sms/status` : undefined,
  };
}

export class TwilioSmsProvider implements SmsProvider {
  readonly name = "twilio";

  constructor(private readonly cfg: TwilioConfig) {}

  async send(input: ProviderSendInput): Promise<SendResult> {
    const from = await senderFor(input.restaurantId, this.cfg);
    if (!from) {
      // No tenant number and no platform messaging service. Permanent by
      // definition — retrying can't conjure a sender.
      return { ok: false, error: "no_sender_configured", retryable: false };
    }

    const form = new URLSearchParams({ To: input.to, Body: input.body, ...from });
    if (this.cfg.statusCallback) form.set("StatusCallback", this.cfg.statusCallback);

    let res: Response;
    try {
      res = await fetch(`${API}/Accounts/${this.cfg.accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${this.cfg.authUser}:${this.cfg.authPass}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form,
        // A status text should not hold a checkout open. Twilio is normally
        // sub-second; past ten there is something wrong worth recording as a
        // failure rather than waiting out.
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      // Network failure or timeout. Emphatically retryable — the message may
      // even have been accepted, which is what the idempotent Message row and
      // the status callback are for.
      return {
        ok: false,
        error: `network: ${err instanceof Error ? err.message : String(err)}`,
        retryable: true,
      };
    }

    const body = (await res.json().catch(() => null)) as
      | { sid?: string; code?: number; message?: string }
      | null;

    if (!res.ok) {
      const code = body?.code;
      return {
        ok: false,
        error: `${code ?? res.status}: ${body?.message ?? res.statusText}`,
        // 429 and 5xx are Twilio asking us to come back later, whatever the
        // body says.
        retryable: code ? !PERMANENT.has(code) : res.status === 429 || res.status >= 500,
      };
    }

    // `sid` is the handle every later delivery receipt arrives keyed by, so
    // losing it means losing the ability to say what happened to this message.
    return { ok: true, ref: body?.sid };
  }
}

/**
 * Picks the sender for a tenant: their own registered number if they have one,
 * the platform messaging service if not.
 *
 * A tenant on the shared service is deliverable but not properly attributed —
 * their customers see a number that isn't theirs, and inbound STOP can't be
 * routed back to them (see the smsFrom comment in the schema). It's the state
 * a restaurant occupies between going live and their 10DLC campaign clearing,
 * not a place to leave anyone.
 */
async function senderFor(
  restaurantId: string,
  cfg: TwilioConfig
): Promise<Record<string, string> | null> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { smsFrom: true },
  });

  if (restaurant?.smsFrom) return { From: restaurant.smsFrom };
  if (cfg.messagingServiceSid) return { MessagingServiceSid: cfg.messagingServiceSid };
  return null;
}

/**
 * Validates Twilio's request signature.
 *
 * The inbound webhooks are public URLs that write to the consent record and to
 * message status. Without this, anyone who learns the URL can opt a customer
 * out — or, worse, opt one back in. Reimplemented rather than imported for the
 * same reason as the send path: it's fifteen lines of HMAC.
 *
 * Twilio signs the full URL with the POST parameters appended in sorted key
 * order, HMAC-SHA1 under the auth token, base64.
 */
export async function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string,
  authToken: string
): Promise<boolean> {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join("");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  return timingSafeEqual(expected, signature);
}

/** Constant-time compare, so a forged signature can't be found a byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
