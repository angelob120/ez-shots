import type { CampaignStatus, MessageChannel } from "@prisma/client";

/**
 * The pure half of campaigns: the status machine, the composition limits, the
 * segment arithmetic, the merge fields and the validator.
 *
 * **Split from `lib/campaigns.ts` because that module is `server-only` and this
 * half has to run in the browser.** The composer needs the segment counter to
 * update as the owner types — an SMS cost that is only revealed after sending
 * is not a cost anybody can act on — and a `server-only` import in a client
 * component is a build error rather than a subtle one.
 *
 * The same split pays a second time in tests: everything here is exercised by
 * `scripts/campaigns.test.ts` with no database and no Prisma stub, which is
 * the arrangement `lib/onboarding.ts` and `lib/oauth.ts` already use for their
 * decision logic. These functions are where the bugs live — a validator that
 * lets a blank subject through, or a segment count that under-reports by one,
 * is real money across a whole customer list.
 *
 * `lib/campaigns.ts` re-exports all of this, so server callers have one import.
 */

// ---------------------------------------------------------------------------
// The status machine — pure
// ---------------------------------------------------------------------------

/**
 * Legal transitions. The edges that are absent are the interesting ones.
 *
 * Nothing returns from `SENT`, `CANCELED` or `FAILED`. In particular there is
 * no `SENDING → DRAFT`: once recipient rows exist and some of them have left
 * the building, "put it back in drafts" is a lie about what happened. Cancel
 * from `SENDING` stops the remainder and is recorded as `CANCELED`; it does
 * not and cannot unsend.
 *
 * `SCHEDULED → DRAFT` is allowed because nothing has been sent yet — the owner
 * is un-scheduling, which is an ordinary thing to want.
 */
const EDGES: Record<CampaignStatus, CampaignStatus[]> = {
  DRAFT: ["SCHEDULED", "SENDING", "CANCELED"],
  SCHEDULED: ["DRAFT", "SENDING", "CANCELED"],
  SENDING: ["SENT", "CANCELED", "FAILED"],
  SENT: [],
  CANCELED: [],
  FAILED: [],
};

export function canTransition(from: CampaignStatus, to: CampaignStatus): boolean {
  return EDGES[from]?.includes(to) ?? false;
}

/** A campaign an owner may still edit. */
export function isEditable(status: CampaignStatus): boolean {
  return status === "DRAFT" || status === "SCHEDULED";
}

/** A campaign that has stopped moving. */
export function isTerminal(status: CampaignStatus): boolean {
  return EDGES[status].length === 0;
}

// ---------------------------------------------------------------------------
// Composition limits — pure
// ---------------------------------------------------------------------------

/**
 * The GSM-7 character set. Anything outside it forces the whole message into
 * UCS-2, which halves the per-segment budget — so a single curly apostrophe
 * pasted from a word processor can turn a one-segment text into two and double
 * the tenant's bill without changing a visible character. That is exactly the
 * kind of invisible cost the composer has to surface.
 */
const GSM7 =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?" +
  "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT = "^{}\\[~]|€";

export function isGsm7(body: string): boolean {
  for (const ch of body) {
    if (!GSM7.includes(ch) && !GSM7_EXT.includes(ch)) return false;
  }
  return true;
}

export type SmsLength = {
  chars: number;
  segments: number;
  encoding: "GSM-7" | "UCS-2";
  /** The character that forced UCS-2, when one did. Shown to the owner. */
  nonGsmSample: string | null;
};

/**
 * Segment arithmetic, as the carrier does it.
 *
 * Single-segment budgets are 160 (GSM-7) and 70 (UCS-2). Concatenated messages
 * spend 6 or 7 characters per segment on a header, dropping the budgets to 153
 * and 67 — which is why 161 characters is two segments rather than one plus a
 * one-character remainder.
 */
export function smsLength(body: string): SmsLength {
  const gsm = isGsm7(body);
  // Extended characters occupy two septets each; ignoring that undercounts a
  // message full of braces or euro signs.
  const chars = gsm
    ? Array.from(body).reduce((n, ch) => n + (GSM7_EXT.includes(ch) ? 2 : 1), 0)
    : Array.from(body).length;

  const single = gsm ? 160 : 70;
  const multi = gsm ? 153 : 67;
  const segments = chars === 0 ? 0 : chars <= single ? 1 : Math.ceil(chars / multi);

  let nonGsmSample: string | null = null;
  if (!gsm) {
    for (const ch of body) {
      if (!GSM7.includes(ch) && !GSM7_EXT.includes(ch)) {
        nonGsmSample = ch;
        break;
      }
    }
  }

  return { chars, segments, encoding: gsm ? "GSM-7" : "UCS-2", nonGsmSample };
}

/**
 * Where the composer stops an owner rather than warning them.
 *
 * Four segments is roughly 600 characters — long past the point where a
 * marketing text is read, and four times the cost. Not a carrier limit; a
 * judgement that an owner who has written this much has made a mistake, and
 * that a bill four times what they expected across their whole list is a bad
 * way to find out.
 */
export const MAX_SMS_SEGMENTS = 4;
export const MAX_EMAIL_SUBJECT = 150;
export const MAX_EMAIL_BODY = 20_000;
export const MAX_CAMPAIGN_NAME = 80;

// ---------------------------------------------------------------------------
// Merge fields — pure
// ---------------------------------------------------------------------------

export type MergeContext = {
  customerName: string | null;
  restaurantName: string;
};

/**
 * A deliberately tiny vocabulary: `{{name}}` and `{{restaurant}}`.
 *
 * Small because every field added is a field that can be empty, and an empty
 * merge field in a text message is a customer receiving "Hi , we miss you".
 * `{{name}}` falls back to a generic greeting rather than to an empty string
 * for exactly that reason — a name is null for most customers who arrived
 * through checkout, which is most customers.
 *
 * The fallback is applied at render time and not stored, so the same campaign
 * body produces a personal greeting for the people we can name and a natural
 * one for everybody else.
 */
export const MERGE_FIELDS = [
  { token: "{{name}}", label: "Customer's first name", note: "Falls back to “there”." },
  { token: "{{restaurant}}", label: "Your restaurant's name", note: "" },
] as const;

export function renderMergeFields(body: string, ctx: MergeContext): string {
  const first = (ctx.customerName ?? "").trim().split(/\s+/)[0] || "there";
  return body
    .replace(/\{\{\s*name\s*\}\}/gi, first)
    .replace(/\{\{\s*restaurant\s*\}\}/gi, ctx.restaurantName);
}

/**
 * The longest a body can render to, for segment counting.
 *
 * Counting segments against the raw body with `{{name}}` in it understates the
 * cost, because a nine-character token can render to a longer name. Estimating
 * against a plausibly-long substitution is the honest version — an owner who
 * is told "1 segment" and billed for 2 across 3,000 customers has been
 * misinformed about real money.
 */
export function worstCaseBody(body: string, restaurantName: string): string {
  return renderMergeFields(body, {
    customerName: "Christopher",
    restaurantName,
  });
}

// ---------------------------------------------------------------------------
// Validation — pure
// ---------------------------------------------------------------------------

export type CampaignDraft = {
  name: string;
  channel: MessageChannel;
  subject?: string | null;
  body: string;
  audienceQuery?: string;
};

export type ValidationError = { field: string; message: string };

/**
 * Everything a campaign must satisfy before it may be sent. Pure, so every
 * branch is tested without a database — and every branch is a way for a
 * message to go out under a restaurant's name.
 */
export function validateCampaign(
  draft: CampaignDraft,
  restaurantName = "the restaurant",
): ValidationError[] {
  const errors: ValidationError[] = [];

  const name = draft.name.trim();
  if (!name) errors.push({ field: "name", message: "Give the campaign a name so you can find it later." });
  if (name.length > MAX_CAMPAIGN_NAME) {
    errors.push({ field: "name", message: `Keep the name under ${MAX_CAMPAIGN_NAME} characters.` });
  }

  const body = draft.body.trim();
  if (!body) errors.push({ field: "body", message: "The message is empty." });

  if (draft.channel === "SMS") {
    const len = smsLength(worstCaseBody(body, restaurantName));
    if (len.segments > MAX_SMS_SEGMENTS) {
      errors.push({
        field: "body",
        message: `That's ${len.segments} text segments — the limit is ${MAX_SMS_SEGMENTS}. You're charged per segment, per person.`,
      });
    }
    if (draft.subject?.trim()) {
      errors.push({ field: "subject", message: "Text messages don't have subject lines." });
    }
  }

  if (draft.channel === "EMAIL") {
    const subject = (draft.subject ?? "").trim();
    if (!subject) {
      // Not defaulted. A subject we invented is a message the owner didn't
      // write going out under their name — and a blank one is the strongest
      // spam signal a young sending domain can emit.
      errors.push({ field: "subject", message: "Email needs a subject line." });
    }
    if (subject.length > MAX_EMAIL_SUBJECT) {
      errors.push({ field: "subject", message: `Keep the subject under ${MAX_EMAIL_SUBJECT} characters.` });
    }
    if (body.length > MAX_EMAIL_BODY) {
      errors.push({ field: "body", message: "That email is too long." });
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Skip reasons
// ---------------------------------------------------------------------------

/**
 * Owner-facing wording for a skip reason.
 *
 * Every reason is spelled out rather than collapsed into "not contactable",
 * because these are the sentences that stop an owner asking us to "just send it
 * anyway". A number with no explanation reads as the platform being broken; a
 * number attached to "never agreed to receive texts" reads as the law.
 */
export const SKIP_REASON_LABELS: Record<string, string> = {
  no_opt_in: "Never agreed to receive texts",
  opted_out: "Replied STOP",
  unsubscribed: "Unsubscribed from email",
  bounced: "Email address bounced",
  complained: "Marked a previous email as spam",
  holdout_cohort: "In the holdout group (kept aside to measure results)",
  no_destination: "No usable phone number or email address",
  no_subject: "No subject line",
  service_suspended: "Sending is suspended for this account",
  campaign_canceled: "Campaign was canceled before this one sent",
  customer_not_found: "Customer record was removed",
  restaurant_not_found: "Restaurant record was removed",
};

export function skipReasonLabel(reason: string | null): string {
  if (!reason) return "Unknown";
  return SKIP_REASON_LABELS[reason] ?? reason;
}
