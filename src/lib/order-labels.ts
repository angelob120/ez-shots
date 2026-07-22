/**
 * The customer-facing wording for the problems a diner can report.
 *
 * Split out of `lib/orders.ts` so a **client** component can import it.
 *
 * That module is now genuinely server-side — it reaches Prisma, the payment
 * providers, and (since automations) the send doors — and a client component
 * importing anything from it drags all of that into the browser bundle. The
 * build says so loudly once anything in that graph is marked `server-only`,
 * which is exactly what happened when the automation triggers were wired into
 * `transitionOrder`: the status page, a client component that wanted eight
 * strings, failed the production build.
 *
 * The same split `lib/campaign-format.ts` and `lib/automation-flow.ts` make,
 * for the same reason and with the same rule: **nothing here may import
 * anything that touches a database.** If a label needs a lookup, it isn't a
 * label.
 */
export const ISSUE_LABELS: Record<string, string> = {
  MISSING_ITEM: "Something was missing",
  WRONG_ITEM: "I got the wrong item",
  QUALITY: "Problem with the food",
  LONG_WAIT: "It took much longer than promised",
  CLOSED_ON_ARRIVAL: "They were closed when I arrived",
  NEVER_RECEIVED: "I never got my order",
  CHARGED_WRONG: "I was charged the wrong amount",
  OTHER: "Something else",
};
