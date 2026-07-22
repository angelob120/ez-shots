import type { EmailProvider, EmailSendResult, ProviderEmailInput } from "@/lib/email";

/**
 * SendGrid behind the EmailProvider seam.
 *
 * Talks to the v3 REST API over fetch rather than pulling in `@sendgrid/mail`.
 * The surface used here is one endpoint; the SDK is a large dependency that
 * would mostly be carried, not used — the same call `lib/sms-twilio.ts` makes
 * about the Twilio SDK.
 *
 * Nothing in this file decides *whether* to send. Suppression, cohort, sender
 * identity and the unsubscribe link are all settled in lib/email.ts before a
 * provider is reached. This only knows how to put a message on the wire and
 * how to describe what went wrong afterwards.
 */

const API = "https://api.sendgrid.com/v3/mail/send";

/**
 * SendGrid responses that will fail identically on every retry.
 *
 * The distinction is worth more here than it is for SMS. Retrying a hard
 * bounce is the canonical way to destroy a sending domain's reputation, and
 * because tenants share an IP pool the damage is not confined to the tenant
 * that caused it.
 *
 * 401/403 are permanent in the sense that matters — a bad API key or an
 * unverified sender will not start working on the next attempt, and hammering
 * either produces nothing but rate-limit noise.
 */
function classify(status: number, body: string): { error: string; retryable: boolean } {
  if (status === 401 || status === 403) {
    return {
      error: `sendgrid_auth_${status}: ${body.slice(0, 200)}`,
      retryable: false,
    };
  }
  // 400 from SendGrid is a malformed request or an invalid address. Neither is
  // fixed by waiting.
  if (status === 400) {
    return { error: `sendgrid_rejected: ${body.slice(0, 200)}`, retryable: false };
  }
  // 413 — payload too large. Same message, same result, forever.
  if (status === 413) {
    return { error: "sendgrid_payload_too_large", retryable: false };
  }
  // 429 and 5xx are the transient family: rate limits and provider trouble.
  return { error: `sendgrid_${status}: ${body.slice(0, 200)}`, retryable: true };
}

export type SendGridConfig = {
  apiKey: string;
  /**
   * Fallback sender for tenants without a verified address of their own. Must
   * be verified with SendGrid — an unverified sender is rejected at the API,
   * which is the good outcome; the bad one is a domain that passes SendGrid and
   * fails DMARC at the recipient, landing every message in spam silently.
   */
  fallbackFrom?: string;
  /**
   * Sandbox mode. Validates the request end to end and delivers nothing.
   * Useful precisely because it exercises the real credential path — a stub
   * cannot tell you your API key is wrong.
   */
  sandbox: boolean;
};

export function sendGridConfigFromEnv(): SendGridConfig | null {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return null;

  return {
    apiKey,
    fallbackFrom: process.env.EMAIL_FROM,
    sandbox: process.env.SENDGRID_SANDBOX === "1",
  };
}

export class SendGridEmailProvider implements EmailProvider {
  readonly name = "sendgrid";

  constructor(private cfg: SendGridConfig) {}

  async send(input: ProviderEmailInput): Promise<EmailSendResult> {
    const personalization: Record<string, unknown> = {
      to: [{ email: input.to }],
    };

    const payload: Record<string, unknown> = {
      personalizations: [personalization],
      from: { email: input.sender.fromEmail, name: input.sender.fromName },
      subject: input.subject,
      content: [
        // Order matters to the RFC and to SendGrid: text/plain first, then
        // text/html. A client that prefers plain text picks the first part it
        // understands, and a message whose text part is missing or is a
        // stripped-down afterthought is a documented spam signal.
        { type: "text/plain", value: input.text },
        { type: "text/html", value: input.html },
      ],
      // Our own tracking would need a redirect domain per tenant to avoid a
      // shared link domain dragging everybody's reputation down together, and
      // that is a bigger decision than this feature. Off until then.
      tracking_settings: {
        click_tracking: { enable: false },
        open_tracking: { enable: false },
      },
    };

    if (input.sender.replyTo) {
      payload.reply_to = { email: input.sender.replyTo };
    }

    if (input.unsubscribeUrl) {
      // RFC 8058 one-click. Gmail and Yahoo require this of bulk senders, and
      // the mailbox-provider unsubscribe button is what stops a reader reaching
      // for "report spam" instead — which is the action that actually damages
      // a sending domain. The List-Unsubscribe-Post header is what makes it
      // one-click rather than a link the provider merely surfaces.
      payload.headers = {
        "List-Unsubscribe": `<${input.unsubscribeUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
    }

    if (this.cfg.sandbox) {
      payload.mail_settings = { sandbox_mode: { enable: true } };
    }

    let res: Response;
    try {
      res = await fetch(API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.cfg.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        // A send that hangs must not hold a campaign drain open. Retryable by
        // classification below, so an abort costs a later attempt, not a lost
        // message.
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      // Network failure or timeout — the transient family by definition.
      return {
        ok: false,
        error: `sendgrid_network: ${(err as Error).message}`.slice(0, 240),
        retryable: true,
      };
    }

    if (res.status === 202) {
      // SendGrid returns 202 with an empty body and the id in a header. Absent
      // is survivable — the Message row is the record that matters — but it is
      // what a bounce webhook joins on later, so it's worth keeping.
      return { ok: true, ref: res.headers.get("x-message-id") ?? undefined };
    }

    const body = await res.text().catch(() => "");
    const { error, retryable } = classify(res.status, body);
    return { ok: false, error, retryable };
  }
}
