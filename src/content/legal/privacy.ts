import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

/**
 * The privacy policy. The structurally unusual part of this product is that
 * we are a **processor** for the restaurant's customer list and a
 * **controller** for our own platform data, and those roles have different
 * answers to "who do I ask to delete my data". Section 2 says so explicitly,
 * because getting it wrong sends every deletion request to the wrong party.
 */
export const privacyDoc: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  summary:
    "What we collect, why, who it is shared with, and how to get a copy of it or have it deleted.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "scope",
      heading: "1. What this covers",
      blocks: [
        {
          kind: "p",
          text: `This policy covers ${COMPANY.name} — our marketing site, the ordering pages we host for restaurants, the order status pages, and the dashboards restaurants use. It does not cover a restaurant's own website, its social accounts, or anything it does with your details outside our service.`,
        },
      ],
    },
    {
      id: "roles",
      heading: "2. Who is responsible for your data",
      blocks: [
        {
          kind: "p",
          text: "Two different answers, depending on which data you mean.",
        },
        {
          kind: "table",
          head: ["Data", "Who decides what happens to it", "Our role"],
          rows: [
            [
              "Your order, phone number, name, and messaging consent at a restaurant",
              "That restaurant",
              "We process it on their instructions",
            ],
            [
              "Your account with us, our billing records, security logs, and aggregate platform statistics",
              "Us",
              "We decide",
            ],
          ],
        },
        {
          kind: "callout",
          text: "If you want a restaurant to forget you, ask the restaurant — it is their list, and we will help them do it. If you want us to delete your platform account, ask us.",
        },
        {
          kind: "p",
          text: "The customer list belongs to the restaurant. We do not sell it, rent it, share it with other restaurants on the platform, or use it to market anything of our own to you.",
        },
      ],
    },
    {
      id: "collect",
      heading: "3. What we collect",
      blocks: [
        {
          kind: "list",
          items: [
            "Order details — items, notes, totals, pickup or delivery time, and the restaurant you ordered from.",
            "Contact details — your phone number always, because that is how an order update reaches you; your name and email if you give them.",
            "Messaging consent — whether you agreed to marketing texts, the exact wording you were shown, and the time you agreed. We keep this because consent has to be provable, and it is the record that protects you as much as us.",
            "Payment status — whether a charge succeeded, the amount, and the last four digits and brand of the card. We never receive or store your full card number; Stripe handles the card itself.",
            "Account details — if you sign in with Google or Apple, the name, email address and stable identifier those providers return. We never receive your password with them.",
            "Usage analytics — pages viewed on a restaurant's ordering page, how long a visit lasted, and whether it ended in an order. See section 5.",
            "Support messages — anything you send us through the contact form or a support ticket.",
            "Technical data — IP address, browser and device type, and timestamps, kept for security and fraud prevention.",
          ],
        },
        {
          kind: "callout",
          text: "We do not collect precise device location, we do not use third-party advertising trackers, and we do not sell personal information or share it for cross-context behavioural advertising as those terms are defined under US state privacy laws.",
        },
      ],
    },
    {
      id: "why",
      heading: "4. Why we use it",
      blocks: [
        {
          kind: "table",
          head: ["Purpose", "Data used", "Basis"],
          rows: [
            ["Taking and fulfilling your order", "Order, contact, payment status", "Performance of a contract"],
            ["Order updates by text", "Phone number, order", "Performance of a contract"],
            ["Marketing texts from a restaurant", "Phone number, consent record", "Your consent, which you can withdraw"],
            ["Fraud prevention and platform security", "Technical data, order patterns", "Our legitimate interests"],
            ["Improving the product and reporting to restaurants", "Usage analytics, aggregated", "Our legitimate interests"],
            ["Tax, accounting and dispute records", "Order and payment records", "Legal obligation"],
          ],
        },
      ],
    },
    {
      id: "analytics",
      heading: "5. Analytics, and what we deliberately do not do",
      blocks: [
        {
          kind: "p",
          text: "We measure how restaurant ordering pages are used so owners can see which items get looked at and where people give up. Three limits are built into how this works, not just promised here:",
        },
        {
          kind: "steps",
          items: [
            "The identifier used to group a visit is random, generated in your browser, different for every restaurant, and never joined to your customer record. It tells a restaurant that one person visited four times rather than four people visited once, and nothing else. It is not a fingerprint and we do not attempt device fingerprinting.",
            "Analytics events carry a fixed set of typed fields. There is no free-form field, deliberately, so a phone number or an order note cannot end up in an analytics table and from there into every backup.",
            "Restaurants see their own numbers. We see platform totals and per-restaurant summaries. No restaurant can see another restaurant's data.",
          ],
        },
      ],
    },
    {
      id: "sharing",
      heading: "6. Who we share it with",
      blocks: [
        {
          kind: "list",
          items: [
            "The restaurant you ordered from — your order, name and contact details, so they can make and hand over your food.",
            "Service providers who run parts of the platform for us. The current list, and what each one receives, is on the Subprocessors page.",
            "Law enforcement or regulators, where we are legally required to, and only to the extent required.",
            "A buyer, if the business is sold or merged — with notice to you beforehand, and with this policy continuing to apply until it is replaced.",
          ],
        },
        {
          kind: "p",
          text: "That is the whole list. We do not share your data with advertisers, data brokers, or other restaurants.",
        },
      ],
    },
    {
      id: "retention",
      heading: "7. How long we keep it",
      blocks: [
        {
          kind: "table",
          head: ["Data", "Kept for"],
          rows: [
            ["Order and payment records", "7 years, for tax and dispute purposes"],
            ["Messaging consent and opt-out records", "As long as the number is on the list, then 4 years after opt-out — an opt-out record has to outlive the consent it revokes, or the number gets re-added"],
            ["Analytics visits and events", "13 months, then deleted"],
            ["Support tickets and contact messages", "3 years"],
            ["Security and access logs", "12 months"],
            ["Your account", "Until you delete it, then 30 days"],
          ],
        },
      ],
    },
    {
      id: "rights",
      heading: "8. Your rights",
      blocks: [
        {
          kind: "p",
          text: "Depending on where you live, you can ask for a copy of your data, ask us to correct it, ask us to delete it, object to some uses, or ask us not to sell or share it — which is straightforward for us, because we do neither.",
        },
        {
          kind: "p",
          text: `Email ${COMPANY.privacyEmail} and say which restaurant you ordered from. We answer within 45 days, usually much sooner, and we will not treat you differently for asking. If you ask us to delete data a restaurant controls, we pass the request to them and confirm when it is done.`,
        },
        {
          kind: "p",
          text: "If you are in the EU or UK: our legal bases are in section 4, you may lodge a complaint with your supervisory authority, and where data is transferred outside your region we rely on Standard Contractual Clauses.",
        },
      ],
    },
    {
      id: "children",
      heading: "9. Children",
      blocks: [
        {
          kind: "p",
          text: `The service is not directed at children under 13 and we do not knowingly collect their data. If you believe a child has given us information, email ${COMPANY.privacyEmail} and we will delete it.`,
        },
      ],
    },
    {
      id: "security",
      heading: "10. Security",
      blocks: [
        {
          kind: "p",
          text: "Data is encrypted in transit and at rest. Passwords are stored hashed, never in a recoverable form. Access to production data is limited to staff who need it and is logged. Each restaurant's data is separated at the query layer so one cannot read another's.",
        },
        {
          kind: "p",
          text: `No system is perfect. If you find a vulnerability, email ${COMPANY.abuseEmail} rather than disclosing it publicly, and we will not pursue you for a good-faith report.`,
        },
      ],
    },
    {
      id: "changes",
      heading: "11. Changes",
      blocks: [
        {
          kind: "p",
          text: "We update this page when what we do changes. The date at the top changes with it. Material changes get notice through the service before they take effect.",
        },
      ],
    },
  ],
};
