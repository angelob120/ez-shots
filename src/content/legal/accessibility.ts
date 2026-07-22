import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

export const accessibilityDoc: LegalDoc = {
  slug: "accessibility",
  title: "Accessibility Statement",
  summary: "What we target, what we have verified, and what we know is not there yet.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "commitment",
      heading: "1. What we aim for",
      blocks: [
        {
          kind: "p",
          text: "We aim to meet WCAG 2.1 Level AA across the ordering pages, order status pages, and the restaurant dashboard.",
        },
      ],
    },
    {
      id: "done",
      heading: "2. What is in place",
      blocks: [
        {
          kind: "list",
          items: [
            "Text contrast is checked automatically against the real stylesheet on every build, for every text colour against every background, in both light and dark themes. That check is why two contrast failures already live in dark mode were found and fixed.",
            "The ordering page works without JavaScript for reading a menu, and the dashboard's charts are server-rendered so their data is present in the page rather than drawn only after scripts run.",
            "Filters and views are plain links and forms with real URLs, so they work with keyboard navigation and can be bookmarked.",
            "Light and dark themes both honour the operating system setting by default.",
          ],
        },
      ],
    },
    {
      id: "gaps",
      heading: "3. What we know is not there yet",
      blocks: [
        {
          kind: "p",
          text: "Stating these is more useful than claiming full conformance:",
        },
        {
          kind: "list",
          items: [
            "The interactive chart crosshair on analytics pages is pointer-driven; the underlying figures are available in the accompanying tables and CSV export, which are the accessible path to the same data.",
            "We have not completed a full screen-reader audit of the dashboard.",
            "Menu photographs uploaded by restaurants may lack alternative text, because it is the restaurant that writes it.",
          ],
        },
      ],
    },
    {
      id: "feedback",
      heading: "4. Telling us about a problem",
      blocks: [
        {
          kind: "p",
          text: `Email ${COMPANY.supportEmail} with the page and what went wrong. Accessibility reports go to the top of the queue, and if something blocks you from placing an order we will find another way to get it placed while we fix it.`,
        },
      ],
    },
  ],
};
