/**
 * The pure half of the support system: labels, limits, the status machine, and
 * the validators.
 *
 * Split out of `lib/support.ts` for one concrete reason — that module is
 * `server-only`, and the ticket form is a client component that needs the
 * category and priority lists to render its dropdowns. Importing the server
 * module from a client one is a build error, and the tempting fix (dropping the
 * `server-only` marker) would trade a compile-time guarantee that Prisma never
 * reaches the browser for nothing.
 *
 * So the rule is: **anything a client component needs lives here, and nothing
 * here touches the database.** `lib/support.ts` re-exports all of it, so server
 * code can keep importing from the one door and callers don't have to know
 * which half a given name came from.
 */

import type { SupportCategory, SupportPriority, SupportStatus } from "@prisma/client";

// ── Labels ────────────────────────────────────────────────────────────────

export const CATEGORY_LABELS: Record<SupportCategory, string> = {
  BUG: "Something is broken",
  BILLING: "Billing or payouts",
  MENU: "Menu and photos",
  ORDERS: "Orders and refunds",
  MESSAGING: "Texts to customers",
  ACCOUNT: "Account and access",
  OTHER: "Something else",
};

/**
 * Consequences, not severities.
 *
 * The person choosing this is the one losing the money. "High" means nothing to
 * them and gets picked at random; "costing me orders" is a question a restaurant
 * owner can actually answer, which is the only thing that makes this field worth
 * sorting the queue on.
 */
export const PRIORITY_LABELS: Record<SupportPriority, string> = {
  LOW: "Whenever",
  NORMAL: "Normal",
  HIGH: "Costing me orders",
  URGENT: "I can't take orders",
};

export const STATUS_LABELS: Record<SupportStatus, string> = {
  OPEN: "Open",
  WAITING: "Waiting on you",
  RESOLVED: "Resolved",
  ARCHIVED: "Archived",
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as SupportCategory[];
export const PRIORITIES = Object.keys(PRIORITY_LABELS) as SupportPriority[];

/** The statuses that still want somebody's attention. */
export const LIVE_STATUSES: SupportStatus[] = ["OPEN", "WAITING"];

// ── Limits ────────────────────────────────────────────────────────────────

export const MAX_SUBJECT = 140;
export const MAX_BODY = 8000;
export const MAX_NAME = 120;

// ── Validation ────────────────────────────────────────────────────────────

/**
 * Deliberately shallow. Anything stricter than "has an @ with something either
 * side and a dot after it" rejects addresses that genuinely deliver, and the
 * cost of a wrong reject here is a restaurant that can't reach us — which is
 * worse than a reply that bounces. See `scripts/support.test.ts` for the
 * odd-looking-but-real addresses this accepts on purpose.
 */
export function isEmailish(v: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

// ── The status machine ────────────────────────────────────────────────────

/**
 * Which moves are legal.
 *
 * Two rules are worth stating out loud. A resolved ticket can be *reopened* —
 * "that didn't fix it" is the single most common thing an owner says next, and
 * making them file a second ticket loses the history that explains the first.
 * An archived one cannot: archive is the terminal state, and a queue where the
 * bottom of the pile can climb back out is a queue you have to re-read.
 */
const ALLOWED: Record<SupportStatus, SupportStatus[]> = {
  OPEN: ["WAITING", "RESOLVED", "ARCHIVED"],
  WAITING: ["OPEN", "RESOLVED", "ARCHIVED"],
  RESOLVED: ["OPEN", "ARCHIVED"],
  ARCHIVED: [],
};

export function canTransition(from: SupportStatus, to: SupportStatus) {
  return ALLOWED[from].includes(to);
}

/**
 * The timestamp columns implied by landing in a status.
 *
 * Kept beside `canTransition` rather than at each call site, because a status
 * written in one place and its date written in another is how you get a board
 * showing three resolved tickets and a report counting two.
 *
 * Reopening clears `resolvedAt`. Leaving it set would make "how long did this
 * take" answer with the time it was *first* declared fixed, which is precisely
 * the number that flatters us and misleads everyone.
 */
export function stampsFor(to: SupportStatus, now: Date) {
  switch (to) {
    case "RESOLVED":
      return { resolvedAt: now, archivedAt: null };
    case "ARCHIVED":
      return { archivedAt: now };
    case "OPEN":
    case "WAITING":
      return { resolvedAt: null, archivedAt: null };
  }
}
