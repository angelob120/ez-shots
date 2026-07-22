import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

export const acceptableUseDoc: LegalDoc = {
  slug: "acceptable-use",
  title: "Acceptable Use Policy",
  summary: "What may not be sold, sent, or done through the platform.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "conduct",
      heading: "1. Prohibited conduct",
      blocks: [
        {
          kind: "list",
          items: [
            "Placing orders you do not intend to pay for, or with a card you are not authorised to use.",
            "Attempting to access data belonging to another customer, another restaurant, or the platform itself.",
            "Probing, scanning, or load-testing the service without written permission. Good-faith security research reported to " + COMPANY.abuseEmail + " is welcome and is not a breach of this rule.",
            "Scraping, mirroring, or reselling the service or the data in it.",
            "Interfering with the service — flooding it with requests, circumventing rate limits, or forging identifiers.",
            "Harassing restaurant staff or other users through order notes, support tickets, or replies to messages.",
            "Uploading anything unlawful, deceptive, or that infringes someone else's rights.",
          ],
        },
      ],
    },
    {
      id: "listings",
      heading: "2. What restaurants may not sell",
      blocks: [
        {
          kind: "list",
          items: [
            "Anything that requires a licence you do not hold — alcohol, cannabis, tobacco, nicotine, prescription medicines.",
            "Items misdescribed as to ingredients, allergens, weight, or origin.",
            "Anything you are not permitted to sell for off-premises consumption under your local health rules.",
            "Goods that are not food or drink prepared by your establishment, where doing so would misrepresent the transaction.",
          ],
        },
        {
          kind: "p",
          text: "You are responsible for holding every licence, permit, and food-safety certification your jurisdiction requires. We do not verify them and their absence is your liability, not ours.",
        },
      ],
    },
    {
      id: "messaging",
      heading: "3. Messaging",
      blocks: [
        {
          kind: "p",
          text: "Sending marketing messages to numbers that did not opt in through our checkout is the most serious breach in this document, because the damage is not limited to the sender — carrier filtering takes down delivery for other tenants sharing infrastructure. It results in immediate suspension of messaging.",
        },
        {
          kind: "p",
          text: "Also prohibited: messages about anything on the carrier-restricted list, including loans, gambling, firearms, and controlled substances; and any message designed to evade filtering.",
        },
      ],
    },
    {
      id: "enforcement",
      heading: "4. What happens if you breach it",
      blocks: [
        {
          kind: "p",
          text: `Depending on severity: a warning, withdrawal of a single capability such as messaging or card payments, suspension of the account, or termination and a report to law enforcement. Report a breach to ${COMPANY.abuseEmail}.`,
        },
        {
          kind: "p",
          text: "Where we withdraw a capability from a restaurant, we record what was withdrawn and why, and the record is kept rather than deleted when it is lifted — because that record is what answers the billing question afterwards.",
        },
      ],
    },
  ],
};
