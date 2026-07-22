import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

/**
 * The restaurant-side agreement. Split from the main Terms because the two
 * audiences need different documents: a diner does not need to read about
 * Stripe Connect payout timing, and burying the merchant obligations inside a
 * consumer document is how they end up unread by the party they bind.
 */
export const merchantDoc: LegalDoc = {
  slug: "restaurant-agreement",
  title: "Restaurant Agreement",
  summary:
    "The terms for restaurants using EZ Orders — fees, payouts, your customer list, messaging obligations, and suspension.",
  updated: "2026-07-20",
  audience: "restaurants",
  sections: [
    {
      id: "service",
      heading: "1. What we provide",
      blocks: [
        {
          kind: "p",
          text: `${COMPANY.name} provides you with an ordering page, an order board, menu and hours management, a customer list, analytics, and messaging. You remain the seller of the food in every transaction. We are your software provider, not your agent, employer, or franchisor.`,
        },
      ],
    },
    {
      id: "fees",
      heading: "2. What it costs you",
      blocks: [
        {
          kind: "callout",
          text: "There is no monthly fee and we take no commission from your food revenue. We are paid by a small flat service fee added to your customer's bill and disclosed to them as its own line before they pay.",
        },
        {
          kind: "p",
          text: "That fee is collected as a platform fee on the charge and never touches your food revenue. Card processing fees are charged by Stripe against your balance in the normal way, because the charge is made on your account rather than ours.",
        },
        {
          kind: "p",
          text: "We set the service fee amount and will give you notice through the dashboard before changing it. You set your own sales tax rate, and you are responsible for it being correct.",
        },
      ],
    },
    {
      id: "payouts",
      heading: "3. Payments and payouts",
      blocks: [
        {
          kind: "p",
          text: "Card payments run through your own connected Stripe account. You must complete Stripe's onboarding and keep your details current; payouts, their timing, and any reserve Stripe applies are between you and Stripe, and we cannot release funds Stripe is holding.",
        },
        {
          kind: "p",
          text: "Refunds and chargebacks come out of your balance. Card processing fees on the original charge are not returned when you refund. A high chargeback rate can cause Stripe to restrict your account, which stops card payments on your ordering page.",
        },
      ],
    },
    {
      id: "your-data",
      heading: "4. Your customer list",
      blocks: [
        {
          kind: "callout",
          text: "The customer list is yours. We do not sell it, do not share it with other restaurants on the platform, do not market to it ourselves, and will export it to you in full on request — including if you leave.",
        },
        {
          kind: "p",
          text: "For that data you are the controller and we are your processor. You are responsible for having a lawful basis for what you do with it and for handling privacy requests from your own customers; we will help you action them.",
        },
      ],
    },
    {
      id: "your-obligations",
      heading: "5. What you are responsible for",
      blocks: [
        {
          kind: "steps",
          items: [
            "Holding every licence, permit and food-safety certification your jurisdiction requires, and complying with them.",
            "The accuracy of your menu — prices, descriptions, allergens and ingredients. We display what you enter and do not verify it.",
            "Keeping your hours and availability current, and honouring orders you accept.",
            "Collecting and remitting your own taxes.",
            "Only sending marketing messages to customers who opted in through our checkout.",
            "The conduct of anyone you give access to your dashboard.",
          ],
        },
      ],
    },
    {
      id: "messaging",
      heading: "6. Messaging obligations",
      blocks: [
        {
          kind: "p",
          text: "Text messaging in the US is regulated by the TCPA and gated by carrier registration. Two consequences you should plan around:",
        },
        {
          kind: "list",
          items: [
            "Consent must be provable. Our checkout records the exact wording shown, when it was agreed and by whom. An imported list carries no consent and the product will not let you treat it as though it does — this is enforced in code and is not a setting.",
            "A customer who replies STOP is blocked from every message from you, including order updates. This is not a preference we let you override, because a sender that ignores STOP gets carrier-filtered and that takes your whole list with it.",
          ],
        },
        {
          kind: "p",
          text: "Sending to non-consented numbers is grounds for immediate withdrawal of messaging and, for a repeat, termination.",
        },
      ],
    },
    {
      id: "suspension",
      heading: "7. Suspension",
      blocks: [
        {
          kind: "p",
          text: "We may withdraw an individual capability — card payments, messaging, email, or delivery — rather than shutting off your whole account, where that is the proportionate response. We will tell you what was withdrawn and why.",
        },
        {
          kind: "p",
          text: "Reasons include: unpaid amounts owed to us, breach of the Acceptable Use Policy, fraud or a chargeback rate that puts processing at risk, a legal or carrier requirement, or a credible report of a food-safety or licensing problem.",
        },
        {
          kind: "p",
          text: "A withdrawal we make is not something your own settings can reverse, and the record of it is kept after it is lifted rather than deleted.",
        },
      ],
    },
    {
      id: "term",
      heading: "8. Term and termination",
      blocks: [
        {
          kind: "p",
          text: "There is no minimum term and no cancellation fee. You may leave at any time from your dashboard or by emailing us. On termination we stop taking new orders on your page, help you fulfil any outstanding ones, and give you a full export of your menu and customer list. We keep order and payment records for the period in the Privacy Policy because tax and dispute rules require it.",
        },
        {
          kind: "p",
          text: "If you have a custom domain pointed at us, point it elsewhere before you leave — otherwise your customers reach a dead page with your name on it.",
        },
      ],
    },
    {
      id: "liability",
      heading: "9. Liability",
      blocks: [
        {
          kind: "p",
          text: "The disclaimers and liability limits in the Terms of Service apply to you as well. In addition: we are not liable for lost sales resulting from downtime, from a payment provider restricting your account, or from carrier filtering of messages. Our aggregate liability to you is limited to the service fees we collected on your orders in the twelve months before the claim.",
        },
        {
          kind: "p",
          text: "You indemnify us against claims arising from the food you sell, your licensing, your tax position, and messages you sent.",
        },
      ],
    },
    {
      id: "contact",
      heading: "10. Contact",
      blocks: [
        { kind: "p", text: `Account questions: ${COMPANY.supportEmail}. Legal notices: ${COMPANY.legalEmail}.` },
      ],
    },
  ],
};
