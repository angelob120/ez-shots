import "server-only";
import { TwilioSmsProvider, twilioConfigFromEnv } from "@/lib/sms-twilio";

/**
 * Transactional SMS to an *operator* (admin/owner), not a diner.
 *
 * `lib/sms.ts` is the one door for customer SMS and enforces the opt-in consent
 * gate at it — none of which applies here, for the same reason as
 * `lib/operator-email.ts`: an operator asking to be texted about their own
 * account is transactional, has no `Customer` row and no `optInStatus`, and
 * must never be gated on one. So this is a deliberately separate, much smaller
 * path that hands the message straight to the Twilio provider.
 *
 * It goes out on the platform messaging service (an empty tenant id makes
 * `senderFor` fall back to it) because an operator alert is the platform
 * speaking, not a restaurant. Until Twilio is configured
 * (`SMS_PROVIDER=twilio` plus credentials) there is no provider and every call
 * is a no-op that logs — the same "exercisable today, lights up when the wire
 * is connected" contract as the operator email.
 */
export async function sendOperatorSms(to: string, body: string): Promise<{ sent: boolean }> {
  const cfg = twilioConfigFromEnv();

  if (!cfg) {
    console.log(`[operator-sms] Twilio not configured; would text ${to}: ${body}`);
    return { sent: false };
  }

  const provider = new TwilioSmsProvider(cfg);
  // Empty restaurantId → the platform messaging service, not a tenant number.
  const result = await provider.send({ restaurantId: "", kind: "TRANSACTIONAL", to, body });

  if (!result.ok) {
    console.error(`[operator-sms] send failed to ${to}: ${result.error}`);
  }
  return { sent: result.ok };
}
