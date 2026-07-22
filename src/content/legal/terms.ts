import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

/**
 * The platform terms. Covers both audiences deliberately: a diner ordering
 * through a storefront and an owner running one are both using the same
 * service, and splitting the document means the diner is handed a contract
 * about Stripe payouts. The merchant-specific obligations live in the separate
 * Restaurant Agreement and are referenced, not repeated.
 */
export const termsDoc: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  summary:
    "The agreement between you and EZ Orders for using our ordering platform, whether you are placing an order or running a restaurant on it.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "who-we-are",
      heading: "1. Who you are contracting with",
      blocks: [
        {
          kind: "p",
          text: `${COMPANY.name} provides software that independent restaurants use to take pickup and delivery orders from their own customers. These Terms are between you and ${COMPANY.legalName} ("we", "us"). By using the service you agree to them.`,
        },
        {
          kind: "callout",
          text: "We are not the restaurant. We do not prepare, sell, or deliver food. Every order you place is a contract between you and the restaurant whose page you ordered from — including what is in the food, when it is ready, and whether it is right.",
        },
        {
          kind: "p",
          text: "This distinction is the practical answer to most questions. A cold meal, a missing item, an allergen, a wrong pickup time: the restaurant owns all of it. What we own is the software, the payment flow, and the messages sent through us.",
        },
      ],
    },
    {
      id: "eligibility",
      heading: "2. Eligibility and accounts",
      blocks: [
        {
          kind: "p",
          text: "You must be at least 13 to use the service and at least 18 to place a paid order or hold a restaurant account. If you create an account for a business, you confirm you are authorised to bind that business.",
        },
        {
          kind: "p",
          text: "You may sign in with an email and password or with a Google or Apple account. Where you use a third-party sign-in, we receive only your name, email address and a stable identifier from that provider, and we never receive your password. Signing in with a provider does not give that provider access to your order history with us.",
        },
        {
          kind: "p",
          text: "You are responsible for what happens under your account. Tell us at " + COMPANY.supportEmail + " if you believe it has been used without your permission.",
        },
      ],
    },
    {
      id: "orders",
      heading: "3. Placing an order",
      blocks: [
        {
          kind: "p",
          text: "Prices, availability, hours, and pickup times are set by the restaurant and can change without notice. An order is not accepted until the restaurant accepts it; we will tell you if it is rejected, and you are not charged for a rejected order.",
        },
        {
          kind: "p",
          text: "Allergen and dietary information comes from the restaurant. If you have a food allergy, contact the restaurant directly before ordering. We do not verify menu descriptions and cannot vouch for them.",
        },
      ],
    },
    {
      id: "fees",
      heading: "4. The service fee",
      blocks: [
        {
          kind: "callout",
          text: "A service fee is added to your order and is shown as its own line before you pay. It goes to us, not to the restaurant. We never add it silently and never fold it into item prices.",
        },
        {
          kind: "p",
          text: "The fee is a small flat amount per order, disclosed at checkout in the currency you are charged. Sales tax, and any tip you choose to leave, are separate and set by the restaurant. Your card statement may show the restaurant's name rather than ours, because the charge is made on the restaurant's own payment account.",
        },
        {
          kind: "p",
          text: "Whether the service fee is returned on a refund is described in the Refund and Cancellation Policy.",
        },
      ],
    },
    {
      id: "payments",
      heading: "5. Payments",
      blocks: [
        {
          kind: "p",
          text: "Card payments are processed by Stripe. We never see or store your full card number. Your payment is made to the restaurant's connected Stripe account, and by paying you also agree to Stripe's terms as they apply to you.",
        },
        {
          kind: "p",
          text: "Some restaurants accept cash at pickup instead of, or as well as, card. Where they do, the arrangement is entirely between you and them.",
        },
      ],
    },
    {
      id: "messages",
      heading: "6. Texts and notifications",
      blocks: [
        {
          kind: "p",
          text: "We send order updates by text message on the restaurant's behalf. Marketing texts are sent only if you separately ticked the box agreeing to them, and you can stop them at any time by replying STOP. Full detail, including what STOP does and does not stop, is in the Messaging Terms.",
        },
      ],
    },
    {
      id: "acceptable-use",
      heading: "7. What you may not do",
      blocks: [
        {
          kind: "p",
          text: "The Acceptable Use Policy is part of these Terms. In short: do not place fraudulent orders, do not attempt to reach data belonging to another customer or another restaurant, do not scrape or resell the service, and do not use it to send messages people did not ask for.",
        },
      ],
    },
    {
      id: "our-content",
      heading: "8. Ownership",
      blocks: [
        {
          kind: "p",
          text: "We own the software and everything we put into it. Restaurants own their menus, photographs, branding and customer lists — a restaurant that leaves takes its customer list with it, and we do not claim rights over it beyond what we need to run the service.",
        },
        {
          kind: "p",
          text: "You keep the rights to anything you submit, and you give us permission to use it as far as is necessary to run the service — for example, showing your name to the restaurant fulfilling your order.",
        },
      ],
    },
    {
      id: "availability",
      heading: "9. Availability",
      blocks: [
        {
          kind: "p",
          text: "We do not promise the service will be uninterrupted. We may change, suspend, or withdraw features, and we may suspend an individual restaurant's access for the reasons set out in the Restaurant Agreement.",
        },
      ],
    },
    {
      id: "disclaimer",
      heading: "10. Disclaimers and limits on liability",
      blocks: [
        {
          kind: "p",
          text: "The service is provided as-is. To the fullest extent the law allows, we exclude implied warranties of merchantability, fitness for a particular purpose, and non-infringement.",
        },
        {
          kind: "p",
          text: "To the fullest extent the law allows, our total liability to you for any claim relating to the service is limited to the greater of the fees you paid us in the twelve months before the claim, or one hundred US dollars. We are not liable for indirect or consequential loss, or for lost profits or goodwill.",
        },
        {
          kind: "callout",
          text: "Nothing here limits liability that cannot be limited by law — including for death or personal injury caused by negligence, or for fraud. Some jurisdictions do not allow these exclusions, in which case they do not apply to you.",
        },
        {
          kind: "p",
          text: "Claims about the food itself — its quality, safety, description, or preparation — are claims against the restaurant, and this limit does not extend our responsibility for them.",
        },
      ],
    },
    {
      id: "indemnity",
      heading: "11. Indemnity",
      blocks: [
        {
          kind: "p",
          text: "If you use the service in breach of these Terms and that causes a claim against us, you agree to cover our reasonable costs in dealing with it. This does not apply to ordinary consumer use of the service to buy food.",
        },
      ],
    },
    {
      id: "termination",
      heading: "12. Ending this agreement",
      blocks: [
        {
          kind: "p",
          text: "You may stop using the service at any time and ask us to delete your account. We may suspend or end your access if you breach these Terms, if we are required to by law, or if continuing would expose us or a restaurant to fraud or carrier sanction.",
        },
      ],
    },
    {
      id: "disputes",
      heading: "13. Governing law and disputes",
      blocks: [
        {
          kind: "p",
          text: `These Terms are governed by the laws of ${COMPANY.governingLaw}, without regard to conflict-of-law rules. Before filing anything, email ${COMPANY.legalEmail} — nearly everything is a misunderstanding about who charged what, and it is faster to just ask.`,
        },
        {
          kind: "p",
          text: "Nothing in this section removes any right you have to bring a claim in your local small-claims court, or any consumer right that cannot be waived where you live.",
        },
      ],
    },
    {
      id: "changes",
      heading: "14. Changes",
      blocks: [
        {
          kind: "p",
          text: "We may update these Terms. The date at the top of this page changes when we do. If a change materially reduces your rights we will give notice through the service before it takes effect, and continuing to use the service afterwards means you accept it.",
        },
      ],
    },
    {
      id: "contact",
      heading: "15. Contact",
      blocks: [
        {
          kind: "p",
          text: `Questions about these Terms: ${COMPANY.legalEmail}. Anything else: ${COMPANY.supportEmail}, or the contact form on this site.`,
        },
      ],
    },
  ],
};
