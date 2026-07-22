import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

/**
 * The refund policy. Written to answer the question people actually arrive
 * with — "who do I ask" — in the first sentence, because the honest answer is
 * "not us" and burying it produces a support ticket for every order that goes
 * wrong.
 */
export const refundsDoc: LegalDoc = {
  slug: "refunds",
  title: "Refund and Cancellation Policy",
  summary:
    "Who decides a refund, how the service fee is treated, and how long money takes to come back.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "who",
      heading: "1. Who decides",
      blocks: [
        {
          kind: "callout",
          text: "The restaurant decides. They made the food and they hold the money — every charge is made on their own payment account. We provide the button they press, and we cannot refund an order over their heads.",
        },
        {
          kind: "p",
          text: "So the fastest route is always to contact the restaurant directly. Their phone number is on the order status page we texted you. If you cannot reach them, or you believe you were charged for an order that was never accepted, contact us and we will help — see section 6.",
        },
      ],
    },
    {
      id: "before-accepted",
      heading: "2. Before a restaurant accepts your order",
      blocks: [
        {
          kind: "p",
          text: "You are not charged until an order is accepted. If a restaurant rejects an order, or does not respond and the order expires, any authorisation on your card is released. Depending on your bank that can take a few business days to disappear from your statement, even though nothing was taken.",
        },
      ],
    },
    {
      id: "after-accepted",
      heading: "3. After a restaurant accepts your order",
      blocks: [
        {
          kind: "p",
          text: "Once food is being made, a cancellation is at the restaurant's discretion. Most will refund without argument if you catch them early. Things they can do:",
        },
        {
          kind: "list",
          items: [
            "Refund the whole order.",
            "Refund part of it — for example one item that was out of stock, while the rest of the order goes ahead.",
            "Mark specific items unavailable, which refunds those lines automatically.",
            "Refund an order after pickup, if something was wrong with it.",
          ],
        },
        {
          kind: "p",
          text: "A restaurant cannot refund more than you paid, and cannot refund an order twice. Those limits are enforced by the software, not by policy.",
        },
      ],
    },
    {
      id: "service-fee",
      heading: "4. The service fee on a refund",
      blocks: [
        {
          kind: "p",
          text: "The service fee is ours, not the restaurant's, so who funds its return depends on why the refund happened.",
        },
        {
          kind: "table",
          head: ["Situation", "Food refunded", "Service fee refunded"],
          rows: [
            ["Restaurant rejected or never accepted the order", "Not charged", "Not charged"],
            ["Restaurant cancelled before pickup", "Yes", "Yes"],
            ["Item unavailable, partial refund", "That item", "Proportionally, at the restaurant's choice"],
            ["You changed your mind after acceptance", "At the restaurant's discretion", "At the restaurant's discretion"],
            ["Order was made and you did not collect it", "At the restaurant's discretion", "Usually not"],
          ],
        },
        {
          kind: "p",
          text: "Where the table says the restaurant chooses, the choice is a single explicit setting on the refund they issue — it is not a hidden default, and the amount you get back is shown on your order status page.",
        },
      ],
    },
    {
      id: "timing",
      heading: "5. How long money takes to come back",
      blocks: [
        {
          kind: "p",
          text: "A refund is submitted to your card network immediately. Card networks typically take 5 to 10 business days to post it, and we have no way to make that faster. You will see the refund on your order status page as soon as it is issued, which is usually well before your bank shows it.",
        },
        {
          kind: "p",
          text: "Occasionally a refund fails at the payment processor — an expired card is the usual reason. When that happens the restaurant is told loudly and the refund is retried automatically; it is not quietly dropped.",
        },
      ],
    },
    {
      id: "chargebacks",
      heading: "6. Disputes and chargebacks",
      blocks: [
        {
          kind: "p",
          text: `Please try the restaurant first, then us at ${COMPANY.supportEmail}, before disputing a charge with your bank. A chargeback takes months, costs the restaurant a fee on top of the refund, and usually ends with the same outcome you would have got by asking.`,
        },
        {
          kind: "p",
          text: "If you do dispute, we and the restaurant will provide the order record, timestamps, and the pickup status to your bank. If the charge was genuinely wrong, you get your money back either way.",
        },
      ],
    },
    {
      id: "restaurants",
      heading: "7. For restaurants",
      blocks: [
        {
          kind: "p",
          text: "Refunds you issue come from your own Stripe balance. Card processing fees on the original charge are not returned by the card networks on a refund, so a refunded order costs you the processing fee. Whether our service fee is returned is your choice per refund. Excessive chargeback rates can put your payment processing at risk — see the Restaurant Agreement.",
        },
      ],
    },
  ],
};
