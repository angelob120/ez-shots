import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";
import { OPT_IN_TEXT } from "@/lib/consent";

/**
 * The SMS terms. Carriers ask for a public page at a stable URL as part of A2P
 * 10DLC registration, and they check that it names the message types, the
 * frequency, the STOP and HELP keywords, and the rate disclaimer. This page is
 * that artefact as much as it is a policy — a campaign gets rejected without
 * it.
 *
 * `OPT_IN_TEXT` is imported rather than retyped on purpose. The wording shown
 * at the checkbox and the wording quoted here have to be the same string, or
 * the consent record we keep does not match the page we point an auditor at.
 */
export const messagingDoc: LegalDoc = {
  slug: "messaging",
  title: "Text Messaging Terms",
  summary:
    "What texts we send, how often, how to stop them, and what consent we keep a record of.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "program",
      heading: "1. The messaging program",
      blocks: [
        {
          kind: "p",
          text: `${COMPANY.name} sends text messages on behalf of the restaurants that use our platform. There are two kinds and they are governed by different rules.`,
        },
        {
          kind: "table",
          head: ["Kind", "Examples", "Consent needed"],
          rows: [
            [
              "Transactional",
              "Order received, order accepted, food ready for pickup, running late, refund issued, problem resolved",
              "Placing an order — you gave the number so the restaurant could reach you about it",
            ],
            [
              "Marketing",
              "Specials, a reminder when you have not ordered in a while, a rewards balance",
              "A separate tick box at checkout, which is never pre-ticked",
            ],
          ],
        },
      ],
    },
    {
      id: "consent",
      heading: "2. What you agreed to",
      blocks: [
        {
          kind: "p",
          text: "If you opted in to marketing texts, this is the exact wording you were shown, word for word:",
        },
        { kind: "callout", text: OPT_IN_TEXT },
        {
          kind: "p",
          text: "We store that wording against your record along with the time you agreed and where you agreed it, because consent that cannot be evidenced is not consent. Ticking the box is never required in order to place an order.",
        },
      ],
    },
    {
      id: "frequency",
      heading: "3. Frequency and cost",
      blocks: [
        {
          kind: "p",
          text: "Order updates: as many as your order needs, typically two to four per order. Marketing: message frequency varies by restaurant and is typically no more than a few messages per month.",
        },
        {
          kind: "p",
          text: "Message and data rates may apply. We do not charge you for texts; your mobile carrier may. Carriers are not liable for delayed or undelivered messages.",
        },
      ],
    },
    {
      id: "stop",
      heading: "4. Stopping messages",
      blocks: [
        {
          kind: "p",
          text: "Reply STOP to any message. STOPALL, UNSUBSCRIBE, CANCEL, END and QUIT work too. You will get one final confirmation and then nothing more.",
        },
        {
          kind: "callout",
          text: "STOP stops everything from that restaurant, including order updates — not just marketing. We treat it that way on purpose: a sender that keeps texting after STOP gets filtered by the carriers, and that takes down every legitimate message to every other customer with it. If you still want order updates, ask the restaurant to add you back rather than replying STOP.",
        },
        {
          kind: "p",
          text: "To rejoin, reply START, or tick the box again next time you order.",
        },
      ],
    },
    {
      id: "help",
      heading: "5. Help",
      blocks: [
        {
          kind: "p",
          text: `Reply HELP to any message for contact information, or email ${COMPANY.supportEmail}. For questions about an order, contact the restaurant directly — their number is on your order status page.`,
        },
      ],
    },
    {
      id: "carriers",
      heading: "6. Carriers and delivery",
      blocks: [
        {
          kind: "p",
          text: "Messages are sent through a licensed messaging provider over US carrier networks. Delivery is not guaranteed. Supported carriers include AT&T, Verizon, T-Mobile, US Cellular and most regional carriers; support can change without notice and carriers are not liable for delayed or undelivered messages.",
        },
      ],
    },
    {
      id: "privacy",
      heading: "7. Your number",
      blocks: [
        {
          kind: "callout",
          text: "Phone numbers collected for messaging are never sold, rented, or shared with third parties for their own marketing, and consent to receive messages is never shared between restaurants. Opting in at one restaurant opts you in at that restaurant only.",
        },
        {
          kind: "p",
          text: "Numbers are shared only with the messaging provider that delivers the message, and only for that purpose. See the Privacy Policy and the Subprocessors page.",
        },
      ],
    },
    {
      id: "restaurants",
      heading: "8. For restaurants",
      blocks: [
        {
          kind: "p",
          text: "You may only send to numbers that opted in through our checkout. Importing a list does not grant consent, and no setting in the product will convert an imported number into a consented one — that is enforced in code, not by policy. Sending to a cold list produces spam complaints, gets your sending number filtered by carriers, and stops your order notifications reaching anyone. See the Restaurant Agreement.",
        },
      ],
    },
  ],
};
