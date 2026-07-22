import { prisma } from "@/lib/prisma";
import { readTwilioWebhook } from "@/lib/sms-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sms/status — Twilio reporting what became of a message.
 *
 * The send call only tells us Twilio accepted the message. Whether a handset
 * ever saw it arrives here, seconds to minutes later, and it's the difference
 * between "we sent it" and "they got it" — which is the entire content of the
 * support call that starts "I never heard anything".
 *
 * Terminal statuses only. `queued` and `sending` are noise; `sent` is what the
 * send path already recorded.
 */

const TERMINAL: Record<string, "DELIVERED" | "UNDELIVERED"> = {
  delivered: "DELIVERED",
  undelivered: "UNDELIVERED",
  failed: "UNDELIVERED",
};

export async function POST(req: Request) {
  const read = await readTwilioWebhook(req);
  if (!read.ok) return new Response(read.reason, { status: read.status });

  const { MessageSid, MessageStatus, ErrorCode } = read.params;
  const status = TERMINAL[(MessageStatus ?? "").toLowerCase()];
  if (!MessageSid || !status) return new Response(null, { status: 204 });

  // updateMany rather than update: the SID may belong to a message this
  // deployment never wrote (a replayed callback, a restored database), and a
  // webhook that 500s because a row is missing gets retried forever.
  await prisma.message.updateMany({
    where: { providerRef: MessageSid },
    data: {
      status,
      deliveredAt: status === "DELIVERED" ? new Date() : null,
      // Preserve the send-time error if the callback carries none of its own.
      ...(ErrorCode ? { error: `twilio_${ErrorCode}` } : {}),
    },
  });

  return new Response(null, { status: 204 });
}
