import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

export const cookiesDoc: LegalDoc = {
  slug: "cookies",
  title: "Cookies and Local Storage",
  summary:
    "Every cookie and browser value we set, what it is for, and how long it lasts. There are no advertising cookies.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "summary",
      heading: "1. The short version",
      blocks: [
        {
          kind: "callout",
          text: "We set no advertising cookies and run no third-party trackers. Everything below is either required to make the site work or is first-party measurement a restaurant uses to understand its own page. That is why you do not see a consent banner on our US pages.",
        },
      ],
    },
    {
      id: "list",
      heading: "2. What we set",
      blocks: [
        {
          kind: "table",
          head: ["Name", "Type", "What it does", "Lifetime"],
          rows: [
            ["hearth_session", "Cookie, essential", "Keeps a restaurant owner or admin signed in. Signed and HTTP-only, so page scripts cannot read it.", "14 days"],
            ["hearth_customer", "Cookie, essential", "Keeps a customer signed in to a restaurant's ordering page, where they created an account.", "30 days"],
            ["hearth_theme", "Cookie, preference", "Remembers whether the dashboard is in light or dark mode. Absent means follow the device setting.", "1 year"],
            ["hearth_oauth_state", "Cookie, essential", "A short-lived value that proves a Google or Apple sign-in came back from where it was sent. Deleted as soon as sign-in finishes.", "10 minutes"],
            ["Cart contents", "Local storage", "Your basket on a restaurant's page, so it survives a refresh. Never leaves your browser until you check out.", "Until you clear it"],
            ["Analytics visitor id", "Local storage", "A random value, different for every restaurant, that groups your page views into one visit. Not linked to your name, number, or orders.", "13 months"],
          ],
        },
      ],
    },
    {
      id: "control",
      heading: "3. Turning them off",
      blocks: [
        {
          kind: "p",
          text: "Your browser can block or clear all of these. Blocking the essential ones will sign you out and empty your cart; blocking the analytics value only means a restaurant counts your visits separately rather than together.",
        },
        {
          kind: "p",
          text: "We honour Global Privacy Control on our own site. Because we do not sell or share personal information for advertising, there is nothing further for it to switch off.",
        },
        {
          kind: "p",
          text: `Questions: ${COMPANY.privacyEmail}.`,
        },
      ],
    },
  ],
};
