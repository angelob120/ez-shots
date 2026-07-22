/**
 * The legal document registry — one door for every policy the product links to.
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
 * `updated` is the date the text last changed and is shown on the page. Change
 * it whenever you change wording — a policy page with a stale date is worse
 * evidence than one with no date, because it asserts something false.
 *
 * The shared half (COMPANY, the types, the date formatter) lives in
 * `legal-base.ts` so the documents can import it without an import cycle.
 */

import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY, formatLegalDate } from "@/lib/legal-base";

export * from "@/lib/legal-base";

/* ── Registry ───────────────────────────────────────────────────────────── */

import { termsDoc } from "@/content/legal/terms";
import { privacyDoc } from "@/content/legal/privacy";
import { refundsDoc } from "@/content/legal/refunds";
import { messagingDoc } from "@/content/legal/messaging";
import { cookiesDoc } from "@/content/legal/cookies";
import { acceptableUseDoc } from "@/content/legal/acceptable-use";
import { merchantDoc } from "@/content/legal/merchant";
import { subprocessorsDoc } from "@/content/legal/subprocessors";
import { accessibilityDoc } from "@/content/legal/accessibility";
import { ipPolicyDoc } from "@/content/legal/ip-policy";

export const LEGAL_DOCS: LegalDoc[] = [
  termsDoc,
  privacyDoc,
  refundsDoc,
  messagingDoc,
  cookiesDoc,
  acceptableUseDoc,
  merchantDoc,
  subprocessorsDoc,
  accessibilityDoc,
  ipPolicyDoc,
];

export function legalDoc(slug: string): LegalDoc | null {
  return LEGAL_DOCS.find((d) => d.slug === slug) ?? null;
}

export function legalPath(slug: string): string {
  return `/legal/${slug}`;
}

/**
 * The subset shown in the marketing footer. Not all of them — a footer listing
 * ten policies reads as a dark pattern and buries the two anyone wants.
 */
export const FOOTER_LEGAL_SLUGS = ["terms", "privacy", "refunds", "messaging"] as const;

/**
 * The subset a *customer* is bound by, linked from the storefront footer and
 * the checkout disclosure. Deliberately excludes the merchant agreement: a
 * diner has no relationship with us as a merchant and linking it there implies
 * they do.
 */
export const STOREFRONT_LEGAL_SLUGS = ["terms", "privacy", "refunds", "messaging"] as const;

/**
 * Render a document to plain text — for an email reply, a support attachment,
 * or an archived copy of what a page said on a given date.
 */
export function legalToPlainText(doc: LegalDoc): string {
  const out: string[] = [
    doc.title.toUpperCase(),
    `${COMPANY.name} — last updated ${formatLegalDate(doc.updated)}`,
    "",
    doc.summary,
    "",
  ];
  for (const s of doc.sections) {
    out.push(s.heading.toUpperCase(), "");
    for (const b of s.blocks) {
      if (b.kind === "p" || b.kind === "callout") out.push(b.text, "");
      else if (b.kind === "list") out.push(...b.items.map((i) => `  - ${i}`), "");
      else if (b.kind === "steps") out.push(...b.items.map((i, n) => `  ${n + 1}. ${i}`), "");
      else {
        out.push(`  ${b.head.join(" | ")}`);
        out.push(...b.rows.map((r) => `  ${r.join(" | ")}`), "");
      }
    }
  }
  return out.join("\n");
}
