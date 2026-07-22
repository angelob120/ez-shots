import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/money";
import { recordOptIn, recordOptOut } from "@/lib/sms";
import { readTwilioWebhook, twiml } from "@/lib/sms-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/sms/inbound — a customer texted one of our numbers.
 *
 * Almost all of this traffic is one word. STOP and HELP are carrier
 * requirements: a sender that doesn't honour them gets filtered, and the
 * filtering isn't appealable in any timeframe a restaurant can survive.
 *
 * Twilio also enforces STOP on its own suppression list, so a message to an
 * opted-out number fails with 21610 rather than being delivered. That is a
 * backstop, not a substitute — it's per-Twilio-account, it doesn't tell the
 * tenant's dashboard anything, and relying on it means the consent record in
 * our own database is quietly wrong.
 *
 * Anything that isn't a keyword is a real person replying to an order text.
 * There is no inbox to route it to yet, so it's stored as a message against
 * the customer and acknowledged honestly rather than silently dropped.
 */

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke"]);
const START_WORDS = new Set(["start", "unstop", "yes"]);
const HELP_WORDS = new Set(["help", "info"]);

export async function POST(req: Request) {
  const read = await readTwilioWebhook(req);
  if (!read.ok) return new Response(read.reason, { status: read.status });

  const { From, To, Body } = read.params;
  const from = normalizePhone(From ?? "");
  const to = normalizePhone(To ?? "");
  if (!from || !to) return twiml();

  // `To` is the tenant's own number, and it's the only thing tying this reply
  // to a restaurant — see the smsFrom comment in the schema.
  const restaurant = await prisma.restaurant.findUnique({
    where: { smsFrom: to },
    select: { id: true, name: true, phone: true },
  });

  // A reply to the shared platform number can't be attributed to a tenant.
  // Honour it as far as possible — silence is the wrong answer to STOP — but
  // there is no customer record to write, so say so plainly.
  if (!restaurant) return twiml("This number isn't monitored. Please contact the restaurant directly.");

  const word = (Body ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");

  if (STOP_WORDS.has(word)) {
    await recordOptOut(restaurant.id, from);
    // Twilio's own STOP handling already sends the carrier-mandated
    // confirmation, so replying here would send it twice.
    return twiml();
  }

  if (START_WORDS.has(word)) {
    await recordOptIn(restaurant.id, from);
    return twiml(`${restaurant.name}: you'll get order updates again. Reply STOP to opt out.`);
  }

  if (HELP_WORDS.has(word)) {
    return twiml(
      `${restaurant.name}: order updates and offers.${restaurant.phone ? ` Call ${restaurant.phone}.` : ""} Reply STOP to opt out.`
    );
  }

  // Not a keyword. Record it so the conversation isn't lost, and don't pretend
  // anyone is reading it — an unanswered "is my order ready?" that appears to
  // have been received is worse than an honest bounce.
  const customer = await prisma.customer.findUnique({
    where: { restaurantId_phone: { restaurantId: restaurant.id, phone: from } },
    select: { id: true },
  });

  await prisma.message.create({
    data: {
      restaurantId: restaurant.id,
      customerId: customer?.id ?? null,
      kind: "TRANSACTIONAL",
      body: Body ?? "",
      to,
      status: "SKIPPED",
      error: "inbound",
      provider: "twilio",
    },
  });

  return twiml(
    `${restaurant.name}: this number doesn't take replies.${restaurant.phone ? ` Please call ${restaurant.phone}.` : ""}`
  );
}
