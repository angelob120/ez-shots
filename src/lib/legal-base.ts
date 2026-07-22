/**
 * Shared foundations for the legal documents — company details, the document
 * shape, and the formatting helpers.
 *
 * Policies are data, not JSX, for two reasons that matter later:
 *
 * 1. **A policy has to be quotable.** When a carrier audits an A2P campaign or
 *    a chargeback arrives, the question is "what exactly did this page say on
 *    that date". Structured sections render to HTML, to plain text for an
 *    email reply, and to a printable page from the same source. Hand-written
 *    JSX gives you only the first.
 * 2. **There is exactly one list of documents.** The footer, the sitemap, the
 *    consent checkbox at checkout and the onboarding acceptance step all read
 *    `LEGAL_DOCS`. A policy that exists but is linked from nowhere is the
 *    normal failure here, and it is invisible.
 *
 * This is deliberately a separate module from `lib/legal.ts`. The registry
 * there imports every document, and every document needs `COMPANY` — so if
 * both lived in one file the cycle would resolve with `COMPANY` still in its
 * temporal dead zone and every policy page would throw at import time. Splitting
 * the shared half out is the fix; do not merge them back.
 */

/** Who we are, in the words that have to appear identically on every policy. */
export const COMPANY = {
  /** Trading name shown to customers. */
  name: "EZ Orders",
  /**
   * Registered entity. This is a placeholder until the entity is formed —
   * `LEGAL_REVIEW_REQUIRED` stays true while it is, because a policy naming a
   * company that does not exist is not enforceable by anyone.
   */
  legalName: "EZ Orders",
  jurisdiction: "the United States",
  /** Governing law for disputes with us. */
  governingLaw: "the State of Delaware, United States",
  supportEmail: "hello@ezorders.app",
  privacyEmail: "privacy@ezorders.app",
  legalEmail: "legal@ezorders.app",
  abuseEmail: "abuse@ezorders.app",
  /** Postal address is required by CAN-SPAM on any marketing email we send. */
  address: "Address on file — see /contact",
} as const;

/**
 * Set false only once a lawyer has reviewed the text and the entity details
 * above are real. While true, every policy page renders a visible banner
 * saying so.
 *
 * This flag is deliberately awkward to remove. Shipping generated policy text
 * as though it were reviewed advice is the one failure mode here that costs
 * real money, and it costs it silently — nobody notices until the dispute.
 */
export const LEGAL_REVIEW_REQUIRED = true;

/* ── Document shape ─────────────────────────────────────────────────────── */

export type LegalBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  /** A numbered list, for enumerated obligations that get cited by number. */
  | { kind: "steps"; items: string[] }
  /** Set apart visually. Use for the sentence a reader must not miss. */
  | { kind: "callout"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export type LegalSection = {
  /** Stable anchor id. Never renumber these — they get linked to. */
  id: string;
  heading: string;
  blocks: LegalBlock[];
};

export type LegalDoc = {
  slug: string;
  title: string;
  /** One sentence, used in the index and as the meta description. */
  summary: string;
  /** ISO date. The date the wording last changed, not the date of deploy. */
  updated: string;
  /**
   * Where this document is surfaced. Drives the index grouping, and is the
   * check that answers "does a customer ever actually see this".
   */
  audience: "everyone" | "customers" | "restaurants";
  sections: LegalSection[];
};

/**
 * Format an ISO date for display. Fixed to UTC on purpose: a policy date that
 * renders as the 3rd on the server and the 2nd in a Hawaii browser is the kind
 * of discrepancy that gets pointed at in a dispute.
 */
export function formatLegalDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}
