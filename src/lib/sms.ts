import { prisma } from "@/lib/prisma";
import { isSuspended } from "@/lib/entitlements";
import { normalizePhone } from "@/lib/money";
import { TwilioSmsProvider, twilioConfigFromEnv } from "@/lib/sms-twilio";
import type { MessageKind, Prisma } from "@prisma/client";

/**
 * SMS seam.
 *
 * Every send is written to the Message table so opt-in provenance and campaign
 * attribution exist independently of whichever provider sits behind the
 * interface. That was true when the only provider was a stub that logged and
 * did not send, and it stays true now that a real one can be selected.
 *
 * The stub never needed a destination — nothing left the building, so "who is
 * this for" was answered well enough by a customer id. A real provider needs a
 * number, and resolving it belongs here rather than at each call site, because
 * the consent rules below are only enforceable at a point every message passes
 * through.
 */

export type SendInput = {
  restaurantId: string;
  customerId?: string | null;
  kind: MessageKind;
  body: string;
  /**
   * Explicit destination, E.164. Rarely passed: with a customerId the number
   * comes from the customer record. Exists for messages with no Customer row
   * behind them — verification codes, owner alerts.
   */
  to?: string | null;

  /**
   * Attribution, when an automation decided to send this. Recorded on both the
   * SKIPPED row and the sent one — "the journey declined to text this person,
   * and here is why" is the question the enrollment inspector exists to answer,
   * and a skip with no automation on it is invisible there.
   */
  automationId?: string | null;
  enrollmentId?: string | null;
};

/** What a provider is handed: destination resolved, consent already checked. */
export type ProviderSendInput = SendInput & { to: string };

export type SendResult = {
  ok: boolean;
  ref?: string;
  error?: string;
  /**
   * Whether retrying could plausibly work. A landline or a disconnected handset
   * fails identically forever; a provider timeout does not. lib/orders.ts
   * learned this distinction the hard way with refunds and messaging shouldn't
   * have to learn it again.
   */
  retryable?: boolean;
};

export interface SmsProvider {
  readonly name: string;
  send(input: ProviderSendInput): Promise<SendResult>;
}

/**
 * Logs and does not send. Still the default, deliberately: moving a tenant's
 * customers from silence to real texts is a decision someone makes by setting
 * SMS_PROVIDER, not something that happens because a deploy shipped.
 */
class StubSmsProvider implements SmsProvider {
  readonly name = "stub";
  async send(): Promise<SendResult> {
    return { ok: true, ref: `logged_${Date.now().toString(36)}` };
  }
}

let provider: SmsProvider | null = null;

/**
 * Picks the provider from env on first use, the way getStorageProvider() picks
 * its driver — there's no server entrypoint in an App Router app to do it at
 * boot, and a lazy pick keeps scripts and tests from needing a bootstrap call.
 *
 * Requires BOTH the opt-in flag and working credentials. Setting
 * SMS_PROVIDER=twilio without a token is a misconfiguration that should be
 * loud, not a silent fall back to the stub — see scripts/config-check.mjs,
 * which refuses the boot rather than letting it discover itself in production.
 */
export function getSmsProvider(): SmsProvider {
  if (provider) return provider;

  if (process.env.SMS_PROVIDER === "twilio") {
    const cfg = twilioConfigFromEnv();
    if (cfg) {
      provider = new TwilioSmsProvider(cfg);
      return provider;
    }
    console.error(
      "[sms] SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN are unset — falling back to the stub. NO MESSAGES WILL BE SENT."
    );
  }

  provider = new StubSmsProvider();
  return provider;
}

export function setSmsProvider(p: SmsProvider) {
  provider = p;
}

/**
 * Records the message, then attempts a send.
 *
 * Five reasons a message is recorded and not sent, checked in this order:
 *
 *   0. The platform has suspended SMS for this tenant. Ours, not the
 *      customer's, and it outranks everything below it.
 *   1. The customer replied STOP. This blocks *every* kind, transactional
 *      included. A carrier opt-out is not a marketing preference — continuing
 *      to text someone who said stop is how a sending number gets filtered
 *      into oblivion, and it takes the tenant's whole list down with it.
 *   2. Marketing to someone who never opted in.
 *   3. Marketing to the holdout cohort, which exists to measure lift.
 *   4. No number to dial.
 *
 * Each writes a SKIPPED row carrying the reason. "We chose not to" and "we
 * tried and failed" are different answers to a support question, and this
 * table is the only place either one is recorded.
 */
export async function queueMessage(input: SendInput) {
  const marketing = input.kind !== "TRANSACTIONAL";

  const skip = (reason: string, to?: string | null) =>
    prisma.message.create({
      data: {
        restaurantId: input.restaurantId,
        customerId: input.customerId ?? null,
        automationId: input.automationId ?? null,
        enrollmentId: input.enrollmentId ?? null,
        kind: input.kind,
        body: input.body,
        to: to ?? null,
        status: "SKIPPED",
        error: reason,
      },
    });

  // The platform's own switch, checked before anything else — a tenant we have
  // suspended sends nothing at all, transactional included. Recorded as SKIPPED
  // rather than queued: these are not messages waiting for service to come
  // back, and replaying a week of stale order confirmations after a restore is
  // its own incident.
  if (await isSuspended(input.restaurantId, "SMS")) return skip("service_suspended", input.to);

  // Loaded for every kind now, not just marketing: the opt-out check below
  // applies to transactional too, and the phone number lives here.
  const customer = input.customerId
    ? await prisma.customer.findUnique({ where: { id: input.customerId } })
    : null;

  if (input.customerId && !customer) return skip("customer_not_found");

  if (customer?.optInStatus === "OPTED_OUT") return skip("opted_out", customer.phone);

  if (marketing) {
    if (!customer || customer.optInStatus !== "OPTED_IN") return skip("no_opt_in", customer?.phone);
    if (customer.cohort === "HOLDOUT") return skip("holdout_cohort", customer.phone);
  }

  const to = normalizePhone(input.to ?? customer?.phone ?? "");

  // Previously impossible to notice: the stub returned ok whether or not
  // anyone could have received the message, so a customer with no usable
  // number looked exactly like a customer who got their text.
  if (!to) return skip("no_destination", input.to ?? customer?.phone);

  const res = await getSmsProvider().send({ ...input, to });

  return prisma.message.create({
    data: {
      restaurantId: input.restaurantId,
      customerId: input.customerId ?? null,
      automationId: input.automationId ?? null,
      enrollmentId: input.enrollmentId ?? null,
      kind: input.kind,
      body: input.body,
      to,
      status: res.ok ? "SENT" : "FAILED",
      provider: getSmsProvider().name,
      providerRef: res.ref ?? null,
      error: res.error ?? null,
      sentAt: res.ok ? new Date() : null,
      attempts: 1,
      // The verdict the retry sweep reads. Null while it stands sent; false by
      // default on a failure we can't classify, because retrying something that
      // will never work is how a sending number gets itself filtered.
      retryable: res.ok ? null : res.retryable ?? false,
    },
  });
}

/**
 * Sends a row that already exists, updating it in place.
 *
 * The counterpart to `deliverQueuedEmail` in lib/email.ts, and it exists for
 * the campaign path. A campaign materialises its recipients as QUEUED rows up
 * front so the work survives a restart, and the drain has to turn *those* rows
 * into sends rather than writing a second set — two rows per recipient would
 * make the outbox, which is the only record of what a tenant sent, count
 * everything twice.
 *
 * **The consent gate runs again here, against current data**, which is why this
 * lives in this module rather than in lib/campaigns.ts. The queued row was
 * written when the owner pressed Send; a STOP that arrived in the minutes since
 * has to win, and the only way to guarantee that is for the check to sit at the
 * door rather than at the caller. Same rule `retryFailedMessages` follows for
 * the same reason.
 */
export async function deliverQueuedMessage(
  messageId: string,
): Promise<"sent" | "failed" | "skipped"> {
  // The claim. Same optimistic lock every writer in lib/orders.ts takes: it is
  // what stops two overlapping sweep runs — a slow pass and the one that starts
  // two minutes later — from both sending the same message.
  const claimed = await prisma.message.updateMany({
    where: { id: messageId, status: "QUEUED" },
    data: { status: "FAILED", error: "in_flight", retryable: true },
  });
  if (claimed.count === 0) return "skipped";

  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) return "failed";

  const finish = async (data: Prisma.MessageUpdateInput, outcome: "sent" | "failed" | "skipped") => {
    await prisma.message.update({ where: { id: messageId }, data });
    return outcome;
  };

  const skip = (reason: string) =>
    finish({ status: "SKIPPED", error: reason, retryable: null }, "skipped");

  if (await isSuspended(msg.restaurantId, "SMS")) return skip("service_suspended");

  const marketing = msg.kind !== "TRANSACTIONAL";

  const customer = msg.customerId
    ? await prisma.customer.findUnique({ where: { id: msg.customerId } })
    : null;
  if (msg.customerId && !customer) return skip("customer_not_found");

  // Blocks every kind, transactional included — see the note on queueMessage.
  if (customer?.optInStatus === "OPTED_OUT") return skip("opted_out");

  if (marketing) {
    if (!customer || customer.optInStatus !== "OPTED_IN") return skip("no_opt_in");
    if (customer.cohort === "HOLDOUT") return skip("holdout_cohort");
  }

  const to = normalizePhone(msg.to ?? customer?.phone ?? "");
  if (!to) return skip("no_destination");

  const res = await getSmsProvider().send({
    restaurantId: msg.restaurantId,
    customerId: msg.customerId ?? null,
    kind: msg.kind,
    body: msg.body,
    to,
  });

  return finish(
    {
      to,
      status: res.ok ? "SENT" : "FAILED",
      provider: getSmsProvider().name,
      providerRef: res.ref ?? null,
      error: res.ok ? null : res.error ?? "send_failed",
      sentAt: res.ok ? new Date() : null,
      attempts: { increment: 1 },
      retryable: res.ok ? null : res.retryable ?? false,
    },
    res.ok ? "sent" : "failed",
  );
}

/**
 * How many times the sweep re-sends a transient failure before it stops.
 *
 * Lower than the refund cap: a text is worth less than a refund and a stuck
 * send is cheaper to abandon than a stuck payout. Four tries across an
 * every-two-minutes sweep covers a provider blip of a few minutes without
 * turning a bad number into a standing job.
 */
export const MAX_SEND_RETRIES = 4;

/**
 * Unattended retry for sends that failed on a transient error.
 *
 * The counterpart to the refund sweep, and the consumer `SendResult.retryable`
 * never had: a timeout or a 5xx is written `retryable: true` and picked up here;
 * a landline or a rejected number is written `false` and left alone, because
 * re-sending to a number that will never accept is exactly how a sender earns
 * carrier filtering — the failure mode the whole consent apparatus exists to
 * avoid.
 *
 * Retries in place on the same row. Unlike a refund there's no idempotency key
 * to lean on, so a send that succeeded but reported a timeout could go twice —
 * accepted, because the alternative is a customer who never hears their order
 * is ready, and a duplicate "your order is ready" is a smaller harm than
 * silence.
 *
 * Re-checks consent each pass rather than trusting the verdict from when the
 * row was written: a STOP that arrived between attempts has to win.
 */
export async function retryFailedMessages(restaurantId?: string): Promise<number> {
  const failed = await prisma.message.findMany({
    where: {
      status: "FAILED",
      retryable: true,
      ...(restaurantId ? { restaurantId } : {}),
    },
  });

  let sent = 0;

  // Suspension checked per tenant rather than per message — the sweep runs
  // unscoped across every restaurant, and a suspended one must not have its
  // backlog quietly drained by the retry path that queueMessage now blocks.
  const suspendedTenants = new Map<string, boolean>();
  const smsSuspended = async (id: string) => {
    const cached = suspendedTenants.get(id);
    if (cached !== undefined) return cached;
    const v = await isSuspended(id, "SMS");
    suspendedTenants.set(id, v);
    return v;
  };

  for (const msg of failed) {
    if ((msg.attempts ?? 0) >= MAX_SEND_RETRIES) continue;

    // Left retryable: service may come back, and unlike a STOP this is not a
    // permanent verdict on the destination.
    if (await smsSuspended(msg.restaurantId)) continue;

    if (!msg.to) {
      await prisma.message.update({
        where: { id: msg.id },
        data: { retryable: false, error: "no_destination" },
      });
      continue;
    }

    // A STOP that landed since this failed must stop the retry cold — carriers
    // don't forgive a sender that keeps texting after opt-out.
    if (msg.customerId) {
      const customer = await prisma.customer.findUnique({ where: { id: msg.customerId } });
      if (customer?.optInStatus === "OPTED_OUT") {
        await prisma.message.update({
          where: { id: msg.id },
          data: { retryable: false, error: "opted_out" },
        });
        continue;
      }
    }

    const res = await getSmsProvider().send({
      restaurantId: msg.restaurantId,
      customerId: msg.customerId ?? null,
      kind: msg.kind,
      body: msg.body,
      to: msg.to,
    });

    await prisma.message.update({
      where: { id: msg.id },
      data: {
        attempts: { increment: 1 },
        status: res.ok ? "SENT" : "FAILED",
        provider: getSmsProvider().name,
        providerRef: res.ref ?? msg.providerRef ?? null,
        error: res.ok ? null : res.error ?? "send_failed",
        sentAt: res.ok ? new Date() : null,
        retryable: res.ok ? null : res.retryable ?? false,
      },
    });

    if (res.ok) sent++;
  }

  return sent;
}

/**
 * Records a carrier opt-out and stops future sends.
 *
 * Called from the inbound webhook. Idempotent, and it keeps the timestamp of
 * the *first* STOP — that's the one that matters if the consent record is ever
 * questioned.
 */
export async function recordOptOut(restaurantId: string, phone: string) {
  const to = normalizePhone(phone);
  if (!to) return null;

  const customer = await prisma.customer.findUnique({
    where: { restaurantId_phone: { restaurantId, phone: to } },
  });
  if (!customer) return null;
  if (customer.optInStatus === "OPTED_OUT") return customer;

  return prisma.customer.update({
    where: { id: customer.id },
    data: { optInStatus: "OPTED_OUT", optOutAt: new Date() },
  });
}

/**
 * Records a re-subscribe (START / UNSTOP).
 *
 * Returns the customer to UNKNOWN rather than OPTED_IN, deliberately. Texting
 * START undoes a STOP; it is not the express written consent marketing
 * requires, and treating it as such would manufacture a consent record that
 * never happened. They get transactional messages again and nothing more until
 * they opt in properly.
 */
export async function recordOptIn(restaurantId: string, phone: string) {
  const to = normalizePhone(phone);
  if (!to) return null;

  const customer = await prisma.customer.findUnique({
    where: { restaurantId_phone: { restaurantId, phone: to } },
  });
  if (!customer || customer.optInStatus !== "OPTED_OUT") return customer;

  return prisma.customer.update({
    where: { id: customer.id },
    data: { optInStatus: "UNKNOWN", optOutAt: null },
  });
}

/**
 * Texts a carrier told us it never delivered.
 *
 * `UNDELIVERED` arrives out of band on the status callback — the send looked
 * fine, then a receipt came back saying the message bounced (a landline, a
 * disconnected number, carrier filtering). Until now that verdict was written
 * to the row and read by nobody, so "I never got a text" had an answer sitting
 * in the database that no owner could reach.
 *
 * This is diagnostic, not a debt: there's no retry here and no per-message
 * dismiss, because the fix is almost always to reach the customer another way,
 * not to resend to a number that already bounced. The window is deliberately
 * short so the panel empties itself — a bounce from last week is history, not
 * a task. Ordered newest first for the same reason failed refunds are ordered
 * oldest first: here the useful one is the order a customer is asking about
 * right now.
 */
export async function undeliveredMessages(restaurantId: string, sinceMs = 7 * 864e5) {
  return prisma.message.findMany({
    where: {
      restaurantId,
      status: "UNDELIVERED",
      createdAt: { gte: new Date(Date.now() - sinceMs) },
    },
    orderBy: { createdAt: "desc" },
    include: { customer: { select: { name: true, phone: true } } },
    take: 20,
  });
}
