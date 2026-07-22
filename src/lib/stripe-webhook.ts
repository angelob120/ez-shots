import crypto from "node:crypto";

/**
 * Stripe webhook verification, done by hand rather than through the SDK — the
 * same call the rest of the Stripe integration makes.
 *
 * A webhook is a public URL that mutates state (a restaurant's Connect
 * readiness, an order's payment status) authenticated by nothing but Stripe's
 * signature. So verification is mandatory, and it is the whole security model
 * of the endpoint.
 *
 * The signing secret differs between test and live, and an event doesn't say
 * which until it's already been trusted — so we try every configured secret and
 * accept the event if any one verifies. That also lets a single endpoint serve
 * both modes, which is what the platform toggle needs.
 */

export type StripeEvent = {
  id: string;
  type: string;
  livemode: boolean;
  data: { object: Record<string, unknown> };
};

export type WebhookResult =
  | { ok: true; event: StripeEvent }
  | { ok: false; status: number; reason: string };

function signingSecrets(): string[] {
  return [
    process.env.STRIPE_WEBHOOK_SECRET_TEST,
    process.env.STRIPE_WEBHOOK_SECRET_LIVE,
    process.env.STRIPE_WEBHOOK_SECRET,
  ].filter((s): s is string => !!s);
}

/**
 * Verify a `Stripe-Signature` header against the raw body. The header is
 * `t=<ts>,v1=<hmac>[,v1=<hmac>...]`; the signed payload is `<ts>.<body>`, HMAC
 * SHA-256 with the endpoint secret. Rejects timestamps older than the tolerance
 * to blunt replay.
 */
export function verifyStripeSignature(
  payload: string,
  header: string | null,
  secrets: string[],
  toleranceSec = 300
): boolean {
  if (!header || secrets.length === 0) return false;

  const parts = Object.fromEntries(
    header.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const t = parts["t"];
  const v1 = parts["v1"];
  if (!t || !v1) return false;

  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return false;

  const signed = `${t}.${payload}`;
  const provided = Buffer.from(v1, "hex");

  for (const secret of secrets) {
    const expected = crypto.createHmac("sha256", secret).update(signed, "utf8").digest();
    if (expected.length === provided.length && crypto.timingSafeEqual(expected, provided)) {
      return true;
    }
  }
  return false;
}

/** Read + verify a Stripe webhook request. Body must be read raw for the HMAC. */
export async function readStripeWebhook(req: Request): Promise<WebhookResult> {
  const secrets = signingSecrets();
  if (secrets.length === 0) return { ok: false, status: 503, reason: "no_webhook_secret" };

  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();

  if (!verifyStripeSignature(raw, sig, secrets)) {
    return { ok: false, status: 403, reason: "bad_signature" };
  }

  try {
    return { ok: true, event: JSON.parse(raw) as StripeEvent };
  } catch {
    return { ok: false, status: 400, reason: "bad_json" };
  }
}
