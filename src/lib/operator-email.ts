import "server-only";
import { SendGridEmailProvider, sendGridConfigFromEnv } from "@/lib/email-sendgrid";

/**
 * Transactional email to an *operator* (admin/owner), not a diner.
 *
 * `lib/email.ts` is the one door for customer email and enforces the CAN-SPAM
 * opt-out rules at it — none of which apply here. A password-reset link is a
 * transactional message to an account holder about their own account; it has
 * no `Customer`, no consent status, and must never be gated on one. So this is
 * a deliberately separate, much smaller path: it renders a plain message and
 * hands it to the same SendGrid provider `lib/email.ts` uses.
 *
 * Until SendGrid is configured (`SENDGRID_API_KEY`), there is no provider and
 * every call is a no-op that logs the link to the server console. That keeps
 * the whole forgot-password flow exercisable today — the token is minted, the
 * row is written, the reset page works — with the single missing piece being
 * the wire, which lights up the moment the key is set. Nothing else changes.
 */

const FROM_NAME = "EZ Orders";

function fromAddress(): string {
  return process.env.EMAIL_FROM || "no-reply@ezorders.app";
}

export type OperatorEmail = {
  to: string;
  subject: string;
  /** Plain text. A minimal HTML wrapper is generated from it. */
  text: string;
};

function toHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const body = escaped
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;line-height:1.6">${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;color:#111;max-width:520px">${body}</div>`;
}

/**
 * Best-effort send. Returns whether it actually left the building — callers
 * never branch on this for the *user-facing* result (that would leak whether
 * an address exists), only for logging.
 */
export async function sendOperatorEmail(msg: OperatorEmail): Promise<{ sent: boolean }> {
  const cfg = sendGridConfigFromEnv();

  if (!cfg) {
    // No provider yet. Log so the flow is testable end to end before SendGrid
    // is wired — a developer or admin can copy the link out of the logs.
    console.log(
      `[operator-email] SendGrid not configured; would send to ${msg.to}\n` +
        `  subject: ${msg.subject}\n` +
        msg.text
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")
    );
    return { sent: false };
  }

  const provider = new SendGridEmailProvider(cfg);
  const result = await provider.send({
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: toHtml(msg.text),
    sender: {
      fromEmail: cfg.fallbackFrom || fromAddress(),
      fromName: FROM_NAME,
      replyTo: null,
      tenantSender: false,
    },
    unsubscribeUrl: null,
  });

  if (!result.ok) {
    console.error(`[operator-email] send failed to ${msg.to}: ${result.error}`);
  }
  return { sent: result.ok };
}
