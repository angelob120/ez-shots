import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

/**
 * The subprocessor list. Kept as its own page rather than a paragraph inside
 * the privacy policy because it changes on a different cadence — adding a
 * vendor is a routine engineering decision, and it needs to be publishable
 * without reissuing the privacy policy and resetting its date.
 *
 * Add a row here in the same change that adds the vendor. A subprocessor in
 * production and not on this page is the exact gap an enterprise customer's
 * security review is looking for.
 */
export const subprocessorsDoc: LegalDoc = {
  slug: "subprocessors",
  title: "Subprocessors",
  summary: "Every third party that processes data on our behalf, and what each one receives.",
  updated: "2026-07-20",
  audience: "restaurants",
  sections: [
    {
      id: "list",
      heading: "1. Current subprocessors",
      blocks: [
        {
          kind: "table",
          head: ["Provider", "What it does", "Data it receives", "Location"],
          rows: [
            ["Stripe, Inc.", "Card payments, payouts, refunds", "Card details, order amount, restaurant account details", "United States"],
            ["Railway Corp.", "Application hosting and the primary database", "All application data", "United States"],
            ["Cloudflare, Inc.", "DNS, TLS certificates for custom domains, edge routing", "Request metadata, IP addresses", "Global edge network"],
            ["Twilio Inc.", "Text message delivery", "Recipient phone number, message body", "United States"],
            ["Google LLC", "Sign in with Google, where a user chooses it", "Name, email address, account identifier", "United States"],
            ["Apple Inc.", "Sign in with Apple, where a user chooses it", "Name, email or relay address, account identifier", "United States"],
            ["S3-compatible object storage", "Menu photographs, logos, uploaded images", "Uploaded image files", "United States"],
          ],
        },
        {
          kind: "p",
          text: "We do not use third-party analytics, advertising, or session-recording vendors. Storefront analytics are collected and stored by us.",
        },
      ],
    },
    {
      id: "changes",
      heading: "2. Changes",
      blocks: [
        {
          kind: "p",
          text: `Each subprocessor is under a written agreement requiring confidentiality and security appropriate to the data. We update this page when the list changes; the date at the top moves with it. Restaurants who want notice in advance can ask at ${COMPANY.privacyEmail}.`,
        },
      ],
    },
  ],
};
