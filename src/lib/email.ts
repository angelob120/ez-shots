import { prisma } from "@/lib/prisma";
import { isSuspended } from "@/lib/entitlements";
import { platformOrigin } from "@/lib/domains";
import { SendGridEmailProvider, sendGridConfigFromEnv } from "@/lib/email-sendgrid";
import type { MessageKind, Prisma } from "@prisma/client";

/**
 * Email seam. The counterpart to `lib/sms.ts`, and deliberately the same shape:
 * one door, consent enforced at it, every attempt written to `Message` whether
 * or not it left the building.
 *
 * ─── Why this is a separate module from lib/sms.ts ────────────────────────
 *
 * The record of what happened is shared — one `Message` table, one `channel`
 * column — but the *rules* are not, and merging them would force the rules
 * together:
 *
 *   - **SMS is opt-in.** `optInStatus` starts UNKNOWN, only checkout can move
 *     it, and an import never can. A STOP blocks every kind including
 *     transactional, because a sender that ignores STOP gets carrier-filtered
 *     and takes the tenant's order notifications down with it.
 *   - **Email is opt-out.** CAN-SPAM requires honest headers, a physical
 *     address and a working unsubscribe; it does not require prior consent. A
 *     restaurant emailing its own customer list is the ordinary legal case.
 *
 * A shared `queueMessage` would need a channel branch at every consent check,
 * which is the same thing as two modules with worse ergonomics and one more
 * place to get the branch backwards. See the Customer comments in
 * schema.prisma for the full argument.
 *
 * ─── The rule stated once more ────────────────────────────────────────────
 *
 * Nothing outside this file decides whether an email may be sent. A tag, a
 * segment, a filter and a campaign audience all decide who is *considered*.
 * This module reads `emailOptOutAt`, `email` and the EMAIL suspension, and
 * nothing else.
 */

export type EmailSendInput = {
  restaurantId: string;
  customerId?: string | null;
  kind: MessageKind;
  subject: string;
  /** Plain text. HTML is generated from it — see renderEmail below. */
  body: string;
  /** Explicit destination. Rarely passed; with a customerId it's resolved. */
  to?: string | null;
  campaignId?: string | null;

  /**
   * Attribution, when an automation decided to send this. Recorded on the
   * SKIPPED row as well as the sent one — "the journey declined to email this
   * person, and why" is exactly what the enrollment inspector shows, and a
   * skip with no automation on it is invisible there.
   */
  automationId?: string | null;
  enrollmentId?: string | null;
};

export type ResolvedSender = {
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  /** True when the tenant's own verified address was used. */
  tenantSender: boolean;
};

export type ProviderEmailInput = {
  to: string;
  subject: string;
  text: string;
  html: string;
  sender: ResolvedSender;
  /**
   * The RFC 8058 one-click unsubscribe URL, when there is one. Handed to the
   * provider as a header rather than only living in the footer: Gmail and
   * Yahoo both require it for bulk senders now, and the mailbox-provider
   * unsubscribe button is the thing that stops a reader reaching for "report
   * spam" instead — which is the outcome that actually damages a sending
   * domain.
   */
  unsubscribeUrl?: string | null;
};

export type EmailSendResult = {
  ok: boolean;
  ref?: string;
  error?: string;
  /**
   * Same distinction lib/sms.ts draws, and it matters more here. A 4xx from a
   * mailbox provider ("mailbox full", "try later") is transient; a 5xx hard
   * bounce means the address does not exist and never will. Retrying a hard
   * bounce is precisely how a sending domain's reputation is destroyed, and
   * unlike SMS the damage is shared with every other tenant on the IP pool.
   */
  retryable?: boolean;
};

export interface EmailProvider {
  readonly name: string;
  send(input: ProviderEmailInput): Promise<EmailSendResult>;
}

/**
 * Logs and does not send. The default, for the same reason the SMS stub is:
 * moving a tenant's customers from silence to real mail is a decision someone
 * makes by setting EMAIL_PROVIDER, not something that happens because a deploy
 * shipped.
 */
class StubEmailProvider implements EmailProvider {
  readonly name = "stub";
  async send(): Promise<EmailSendResult> {
    return { ok: true, ref: `logged_${Date.now().toString(36)}` };
  }
}

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
  if (provider) return provider;

  if (process.env.EMAIL_PROVIDER === "sendgrid") {
    const cfg = sendGridConfigFromEnv();
    if (cfg) {
      provider = new SendGridEmailProvider(cfg);
      return provider;
    }
    console.error(
      "[email] EMAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is unset — falling back to the stub. NO EMAIL WILL BE SENT."
    );
  }

  provider = new StubEmailProvider();
  return provider;
}

export function setEmailProvider(p: EmailProvider) {
  provider = p;
}

/** Whether a real provider is configured, for status surfaces. */
export function emailProviderConfigured(): boolean {
  return process.env.EMAIL_PROVIDER === "sendgrid" && !!sendGridConfigFromEnv();
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/**
 * Deliberately permissive, and the same judgement `lib/support.ts` records for
 * its own check: the authoritative test of an email address is whether mail to
 * it is accepted, and every stricter regex written in the last thirty years has
 * rejected somebody's real address. A tightened version here doesn't prevent
 * bad mail, it silently drops a customer from an audience — which looks exactly
 * like the customer not existing.
 */
export function looksLikeEmail(v: string): boolean {
  const s = v.trim();
  if (!s || s.length > 254) return false;
  if (/\s/.test(s)) return false;
  const at = s.lastIndexOf("@");
  if (at <= 0 || at === s.length - 1) return false;
  const domain = s.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
}

export function normalizeEmail(input: string | null | undefined): string | null {
  const s = (input ?? "").trim().toLowerCase();
  return looksLikeEmail(s) ? s : null;
}

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

/**
 * 160 bits, base36. Same budget as an invite token, for a weaker reason —
 * nobody gets an account from guessing this — but the cost of collisions or
 * enumeration is somebody else's mail being silently suppressed, which is
 * invisible to both parties until a customer asks why they stopped hearing
 * from their restaurant.
 */
function mintUnsubToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Returns the customer's unsubscribe token, minting it on first use.
 *
 * Lazy rather than at customer creation, because most customers are never
 * emailed and a column of unused secrets is a liability with no upside. Once
 * minted it never changes: a link in a message from last year has to keep
 * working, and a dead unsubscribe link is the specific thing that converts an
 * annoyed reader into a spam complaint.
 */
export async function ensureUnsubToken(customerId: string): Promise<string> {
  const existing = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { emailUnsubToken: true },
  });
  if (existing?.emailUnsubToken) return existing.emailUnsubToken;

  const token = mintUnsubToken();
  await prisma.customer.update({
    where: { id: customerId },
    data: { emailUnsubToken: token },
  });
  return token;
}

/**
 * Always on the platform origin, never the tenant's custom domain.
 *
 * This is one of the three origins `lib/domains.ts` keeps apart, and this is a
 * `platformOrigin()` case rather than a `canonicalOrigin()` one even though the
 * mail is from the restaurant. The reason is durability: an unsubscribe link
 * has to work for years, including after the owner lets their domain lapse or
 * leaves the platform, and a suppression request we cannot honour because the
 * hostname stopped resolving is a CAN-SPAM violation with our name on it.
 */
export function unsubscribeUrl(token: string): string {
  return `${platformOrigin()}/u/${token}`;
}

/**
 * Records a suppression. Idempotent, and it keeps the timestamp of the *first*
 * request — that's the one that matters if the record is ever questioned, the
 * same rule `recordOptOut` follows for STOP.
 *
 * Note this deliberately does **not** touch `optInStatus`. Unsubscribing from
 * email is not a STOP, and silently killing someone's order-ready texts because
 * they didn't want a newsletter would be a worse outcome than the one they
 * asked to avoid.
 */
export async function recordEmailOptOut(
  token: string,
  reason = "unsubscribed",
): Promise<{ id: string; restaurantId: string; email: string | null } | null> {
  const customer = await prisma.customer.findUnique({
    where: { emailUnsubToken: token },
    select: { id: true, restaurantId: true, email: true, emailOptOutAt: true },
  });
  if (!customer) return null;
  if (customer.emailOptOutAt) return customer;

  await prisma.customer.update({
    where: { id: customer.id },
    data: { emailOptOutAt: new Date(), emailOptOutReason: reason },
  });
  return customer;
}

/**
 * Undoes a suppression — the "actually, resubscribe me" link on the
 * confirmation page.
 *
 * Only reachable with the token, so only by someone holding a link we sent to
 * that address. Refuses when the suppression came from a bounce or a complaint
 * rather than the person: a hard bounce means the mailbox does not exist, and
 * a complaint means a mailbox provider told us to stop. Neither is undone by a
 * click, and re-enabling either is how a sending domain gets blocklisted.
 */
export async function recordEmailOptIn(token: string) {
  const customer = await prisma.customer.findUnique({
    where: { emailUnsubToken: token },
    select: { id: true, emailOptOutAt: true, emailOptOutReason: true },
  });
  if (!customer || !customer.emailOptOutAt) return customer;
  if (customer.emailOptOutReason && customer.emailOptOutReason !== "unsubscribed") return customer;

  return prisma.customer.update({
    where: { id: customer.id },
    data: { emailOptOutAt: null, emailOptOutReason: null },
  });
}

/**
 * Suppresses by address, for provider webhooks. Bounces and complaints arrive
 * addressed to an email, not to a token.
 */
export async function suppressEmailAddress(
  restaurantId: string,
  email: string,
  reason: "bounced" | "complained" | "admin",
) {
  const to = normalizeEmail(email);
  if (!to) return null;

  return prisma.customer.updateMany({
    where: { restaurantId, email: to, emailOptOutAt: null },
    data: { emailOptOutAt: new Date(), emailOptOutReason: reason },
  });
}

// ---------------------------------------------------------------------------
// Sender identity
// ---------------------------------------------------------------------------

export type SenderRestaurant = {
  id: string;
  name: string;
  emailFrom: string | null;
  emailFromName: string | null;
  emailReplyTo: string | null;
  emailSenderVerifiedAt: Date | null;
};

/**
 * Who the mail claims to be from.
 *
 * The tenant's own address when it's verified, ours otherwise — and when it's
 * ours, the from-*name* is still the restaurant's. That combination is the
 * honest one: "Sal's Pizza <no-reply@ezorders.app>" tells the reader who wrote
 * it and tells the mailbox provider who actually sent it, and neither party is
 * misled. Putting the restaurant's unverified address in the from-line instead
 * would be a DMARC failure that lands the mail in spam, and forging it is the
 * thing SPF exists to stop.
 */
export function resolveSender(restaurant: SenderRestaurant): ResolvedSender {
  const verified = !!restaurant.emailSenderVerifiedAt && !!restaurant.emailFrom;
  const platformFrom = process.env.EMAIL_FROM || "no-reply@example.invalid";
  const name = (restaurant.emailFromName || restaurant.name).slice(0, 78);

  return {
    fromEmail: verified ? restaurant.emailFrom! : platformFrom,
    fromName: name,
    replyTo: normalizeEmail(restaurant.emailReplyTo),
    tenantSender: verified,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type EmailFooter = {
  restaurantName: string;
  /** Physical postal address — required by CAN-SPAM in every marketing email. */
  address: string | null;
  unsubscribeUrl: string | null;
};

/**
 * Plain text in, {text, html} out.
 *
 * **Owners compose plain text and this generates the HTML**, rather than
 * offering a rich editor or accepting markup. Two reasons, and the second is
 * the real one:
 *
 *   - Email HTML is not web HTML. It is tables, inline styles and a decade of
 *     client quirks, and anything an owner pastes from a word processor
 *     arrives as markup that renders differently in every client at once.
 *   - A plain-text part that actually matches the HTML part is worth real
 *     deliverability. Bulk mail with an empty or mismatched text part is a
 *     spam signal, and the only reliable way to keep them in sync is to
 *     generate one from the other.
 *
 * When templates land (they're planned), they build on this: a template picks
 * the wrapper, the owner still writes the words.
 */
export function renderEmail(body: string, footer: EmailFooter): { text: string; html: string } {
  const parts = body.trim().split(/\n{2,}/);

  const textFooterLines = [
    "",
    "—",
    footer.restaurantName,
    footer.address ?? "",
    footer.unsubscribeUrl ? `Unsubscribe: ${footer.unsubscribeUrl}` : "",
  ].filter(Boolean);

  const text = `${body.trim()}\n${textFooterLines.join("\n")}\n`;

  const paragraphs = parts
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  // Inline styles only, and a table-free single column. Deliberately plain:
  // this has to render in Outlook, and a layout that survives Outlook is worth
  // more to an independent restaurant than one that looks designed in Gmail.
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f6f6f6">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;color:#1a1a1a;background:#ffffff">
${paragraphs}
<hr style="border:none;border-top:1px solid #e5e5e5;margin:28px 0 16px">
<div style="font-size:12px;color:#777;line-height:1.5">
<div>${escapeHtml(footer.restaurantName)}</div>
${footer.address ? `<div>${escapeHtml(footer.address)}</div>` : ""}
${
  footer.unsubscribeUrl
    ? `<div style="margin-top:8px"><a href="${escapeHtml(footer.unsubscribeUrl)}" style="color:#777">Unsubscribe</a></div>`
    : ""
}
</div>
</div>
</body></html>`;

  return { text, html };
}

// ---------------------------------------------------------------------------
// The door
// ---------------------------------------------------------------------------

/**
 * Records the message, then attempts a send.
 *
 * Five reasons an email is recorded and not sent, checked in this order:
 *
 *   0. The platform has suspended EMAIL for this tenant. Ours, not the
 *      customer's, and it outranks everything below it.
 *   1. The customer unsubscribed. Marketing only — a suppression is a request
 *      to stop being marketed to, and CAN-SPAM neither requires nor expects it
 *      to stop a receipt or an order notification. **This is the one place the
 *      email rules are looser than the SMS ones, and it is not an oversight:**
 *      an SMS STOP is a carrier-level instruction that blocks everything,
 *      because ignoring it gets the sending number filtered. An email
 *      unsubscribe has no such mechanism behind it.
 *   2. Marketing to the holdout cohort, which exists to measure lift.
 *   3. No address to send to.
 *
 * Each writes a SKIPPED row carrying the reason. "We chose not to" and "we
 * tried and failed" are different answers to a support question, and this table
 * is the only place either one is recorded.
 *
 * Note what is **not** checked: `optInStatus`. That column is the SMS consent
 * record and has no bearing on email. A customer who never opted into texts is
 * a perfectly ordinary recipient of their restaurant's newsletter, and gating
 * email on it would make the channel useless for exactly the imported lists it
 * is most valuable for.
 */
export async function queueEmail(input: EmailSendInput) {
  const marketing = input.kind !== "TRANSACTIONAL";

  const skip = (reason: string, to?: string | null) =>
    prisma.message.create({
      data: {
        restaurantId: input.restaurantId,
        customerId: input.customerId ?? null,
        campaignId: input.campaignId ?? null,
        automationId: input.automationId ?? null,
        enrollmentId: input.enrollmentId ?? null,
        channel: "EMAIL",
        kind: input.kind,
        subject: input.subject,
        body: input.body,
        to: to ?? null,
        status: "SKIPPED",
        error: reason,
      },
    });

  if (await isSuspended(input.restaurantId, "EMAIL")) return skip("service_suspended", input.to);

  const customer = input.customerId
    ? await prisma.customer.findUnique({ where: { id: input.customerId } })
    : null;

  if (input.customerId && !customer) return skip("customer_not_found");

  if (marketing) {
    if (customer?.emailOptOutAt) {
      return skip(customer.emailOptOutReason ?? "unsubscribed", customer.email);
    }
    if (customer?.cohort === "HOLDOUT") return skip("holdout_cohort", customer.email);
  }

  const to = normalizeEmail(input.to ?? customer?.email ?? null);
  if (!to) return skip("no_destination", input.to ?? customer?.email);

  const subject = input.subject.trim();
  // A blank subject is the single strongest spam signal a young sending domain
  // can emit, and it is trivially reachable from an empty form field. Refused
  // here rather than defaulted, because a subject we invented is a message the
  // owner didn't write going out under their name.
  if (!subject) return skip("no_subject", to);

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      emailFrom: true,
      emailFromName: true,
      emailReplyTo: true,
      emailSenderVerifiedAt: true,
      emailFooterAddress: true,
    },
  });
  if (!restaurant) return skip("restaurant_not_found", to);

  // Marketing mail carries an unsubscribe link; transactional mail does not,
  // because "unsubscribe from your order receipt" is not an offer we can honour
  // and pretending otherwise is worse than omitting it.
  const unsub =
    marketing && customer ? unsubscribeUrl(await ensureUnsubToken(customer.id)) : null;

  const { text, html } = renderEmail(input.body, {
    restaurantName: restaurant.name,
    address:
      restaurant.emailFooterAddress ||
      [restaurant.address, restaurant.city].filter(Boolean).join(", ") ||
      null,
    unsubscribeUrl: unsub,
  });

  const sender = resolveSender(restaurant);
  const res = await getEmailProvider().send({ to, subject, text, html, sender, unsubscribeUrl: unsub });

  return prisma.message.create({
    data: {
      restaurantId: input.restaurantId,
      customerId: input.customerId ?? null,
      campaignId: input.campaignId ?? null,
      automationId: input.automationId ?? null,
      enrollmentId: input.enrollmentId ?? null,
      channel: "EMAIL",
      kind: input.kind,
      subject,
      body: input.body,
      to,
      status: res.ok ? "SENT" : "FAILED",
      provider: getEmailProvider().name,
      providerRef: res.ref ?? null,
      error: res.error ?? null,
      sentAt: res.ok ? new Date() : null,
      attempts: 1,
      retryable: res.ok ? null : res.retryable ?? false,
    },
  });
}

/**
 * Sends a row that already exists, updating it in place.
 *
 * The campaign path needs this and `queueMessage`-style creation would be
 * wrong for it: a campaign materialises its recipients as QUEUED rows up front
 * so the work survives a restart, and the drain has to turn *those* rows into
 * sends rather than writing a second set. Two rows per recipient would make
 * the outbox — the only record of what a tenant sent — count everything twice.
 *
 * **The consent gate runs again here, against current data.** That is the
 * entire reason this lives in this module rather than in lib/campaigns.ts. The
 * queued row was written when the owner pressed Send; an unsubscribe that
 * arrived in the minutes since has to win, and the only way to guarantee it
 * does is for the check to be at the door rather than at the caller.
 *
 * Returns what happened so the drain can count without re-reading the row.
 */
export async function deliverQueuedEmail(
  messageId: string,
): Promise<"sent" | "failed" | "skipped"> {
  // The claim. Same optimistic lock every writer in lib/orders.ts takes, and
  // here it is what stops two overlapping sweep runs — a slow pass and the
  // one that starts two minutes later — from both sending the same message.
  const claimed = await prisma.message.updateMany({
    where: { id: messageId, status: "QUEUED" },
    data: { status: "FAILED", error: "in_flight", retryable: true },
  });
  if (claimed.count === 0) return "skipped";

  const msg = await prisma.message.findUnique({ where: { id: messageId } });
  if (!msg) return "failed";

  const finish = async (
    data: Prisma.MessageUpdateInput,
    outcome: "sent" | "failed" | "skipped",
  ) => {
    await prisma.message.update({ where: { id: messageId }, data });
    return outcome;
  };

  const skip = (reason: string) =>
    finish({ status: "SKIPPED", error: reason, retryable: null }, "skipped");

  if (await isSuspended(msg.restaurantId, "EMAIL")) return skip("service_suspended");

  const marketing = msg.kind !== "TRANSACTIONAL";

  const customer = msg.customerId
    ? await prisma.customer.findUnique({ where: { id: msg.customerId } })
    : null;
  if (msg.customerId && !customer) return skip("customer_not_found");

  if (marketing) {
    if (customer?.emailOptOutAt) return skip(customer.emailOptOutReason ?? "unsubscribed");
    if (customer?.cohort === "HOLDOUT") return skip("holdout_cohort");
  }

  const to = normalizeEmail(msg.to ?? customer?.email ?? null);
  if (!to) return skip("no_destination");

  const subject = (msg.subject ?? "").trim();
  if (!subject) return skip("no_subject");

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: msg.restaurantId },
    select: {
      id: true,
      name: true,
      address: true,
      city: true,
      emailFrom: true,
      emailFromName: true,
      emailReplyTo: true,
      emailSenderVerifiedAt: true,
      emailFooterAddress: true,
    },
  });
  if (!restaurant) return skip("restaurant_not_found");

  const unsub = marketing && customer ? unsubscribeUrl(await ensureUnsubToken(customer.id)) : null;

  const { text, html } = renderEmail(msg.body, {
    restaurantName: restaurant.name,
    address:
      restaurant.emailFooterAddress ||
      [restaurant.address, restaurant.city].filter(Boolean).join(", ") ||
      null,
    unsubscribeUrl: unsub,
  });

  const res = await getEmailProvider().send({
    to,
    subject,
    text,
    html,
    sender: resolveSender(restaurant),
    unsubscribeUrl: unsub,
  });

  return finish(
    {
      to,
      status: res.ok ? "SENT" : "FAILED",
      provider: getEmailProvider().name,
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
 * How many times the sweep re-sends a transient email failure.
 *
 * Lower than the SMS cap. A mailbox that refuses mail three times in a row is
 * telling us something, and unlike a phone number the reputational cost of
 * being wrong is shared with every other tenant sending from the same domain.
 */
export const MAX_EMAIL_RETRIES = 3;

/**
 * Unattended retry for email that failed on a transient error. The counterpart
 * to `retryFailedMessages` in lib/sms.ts, scoped to the EMAIL channel.
 *
 * Re-checks suppression each pass rather than trusting the verdict from when
 * the row was written: an unsubscribe that arrived between attempts has to win.
 */
export async function retryFailedEmails(restaurantId?: string): Promise<number> {
  const failed = await prisma.message.findMany({
    where: {
      channel: "EMAIL",
      status: "FAILED",
      retryable: true,
      ...(restaurantId ? { restaurantId } : {}),
    },
    take: 200,
  });

  let sent = 0;
  const suspendedTenants = new Map<string, boolean>();
  const emailSuspended = async (id: string) => {
    const cached = suspendedTenants.get(id);
    if (cached !== undefined) return cached;
    const v = await isSuspended(id, "EMAIL");
    suspendedTenants.set(id, v);
    return v;
  };

  for (const msg of failed) {
    if ((msg.attempts ?? 0) >= MAX_EMAIL_RETRIES) continue;

    // Left retryable: service may come back, and unlike a hard bounce this is
    // not a permanent verdict on the address.
    if (await emailSuspended(msg.restaurantId)) continue;

    if (!msg.to) {
      await prisma.message.update({
        where: { id: msg.id },
        data: { retryable: false, error: "no_destination" },
      });
      continue;
    }

    if (msg.customerId && msg.kind !== "TRANSACTIONAL") {
      const customer = await prisma.customer.findUnique({ where: { id: msg.customerId } });
      if (customer?.emailOptOutAt) {
        await prisma.message.update({
          where: { id: msg.id },
          data: { retryable: false, error: customer.emailOptOutReason ?? "unsubscribed" },
        });
        continue;
      }
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: msg.restaurantId },
      select: {
        id: true,
        name: true,
        address: true,
        city: true,
        emailFrom: true,
        emailFromName: true,
        emailReplyTo: true,
        emailSenderVerifiedAt: true,
        emailFooterAddress: true,
      },
    });
    if (!restaurant) continue;

    const unsub =
      msg.kind !== "TRANSACTIONAL" && msg.customerId
        ? unsubscribeUrl(await ensureUnsubToken(msg.customerId))
        : null;

    const { text, html } = renderEmail(msg.body, {
      restaurantName: restaurant.name,
      address:
        restaurant.emailFooterAddress ||
        [restaurant.address, restaurant.city].filter(Boolean).join(", ") ||
        null,
      unsubscribeUrl: unsub,
    });

    const res = await getEmailProvider().send({
      to: msg.to,
      subject: msg.subject ?? "",
      text,
      html,
      sender: resolveSender(restaurant),
      unsubscribeUrl: unsub,
    });

    await prisma.message.update({
      where: { id: msg.id },
      data: {
        attempts: { increment: 1 },
        status: res.ok ? "SENT" : "FAILED",
        provider: getEmailProvider().name,
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
