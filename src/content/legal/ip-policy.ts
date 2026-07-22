import type { LegalDoc } from "@/lib/legal-base";
import { COMPANY } from "@/lib/legal-base";

export const ipPolicyDoc: LegalDoc = {
  slug: "ip-policy",
  title: "Copyright and Trademark Policy",
  summary: "How to report content on a restaurant's page that infringes your rights.",
  updated: "2026-07-20",
  audience: "everyone",
  sections: [
    {
      id: "scope",
      heading: "1. Scope",
      blocks: [
        {
          kind: "p",
          text: `Restaurants upload their own photographs, logos and menu text. ${COMPANY.name} does not review it in advance. If something on a page we host infringes your copyright or trademark, tell us and we will act.`,
        },
      ],
    },
    {
      id: "notice",
      heading: "2. Sending a notice",
      blocks: [
        {
          kind: "p",
          text: `Email ${COMPANY.legalEmail} with the subject line "Copyright notice" and include all of the following. An incomplete notice is not actionable and we will have to come back to you.`,
        },
        {
          kind: "steps",
          items: [
            "Your physical or electronic signature.",
            "Identification of the work you say is infringed.",
            "The exact URL of the material you want removed.",
            "Your name, address, telephone number and email address.",
            "A statement that you believe in good faith the use is not authorised by the owner, its agent, or the law.",
            "A statement, under penalty of perjury, that the information is accurate and you are the owner or authorised to act for them.",
          ],
        },
      ],
    },
    {
      id: "counter",
      heading: "3. Counter-notice",
      blocks: [
        {
          kind: "p",
          text: "If your material was removed and you believe that was a mistake or a misidentification, you may send a counter-notice with your signature, identification of the removed material and where it appeared, a statement under penalty of perjury to that effect, and your contact details plus consent to the jurisdiction of the federal court for your district. We may restore the material after ten business days unless the original complainant files an action.",
        },
      ],
    },
    {
      id: "repeat",
      heading: "4. Repeat infringers",
      blocks: [
        {
          kind: "p",
          text: "Accounts that repeatedly infringe are terminated. Knowingly sending a false notice carries liability for damages, including costs and legal fees.",
        },
      ],
    },
  ],
};
