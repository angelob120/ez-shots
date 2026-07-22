import type { NotificationKind, NotificationSeverity } from "@prisma/client";

/**
 * The pure half of platform notifications — shared by the one door
 * (`lib/notifications.ts`, which sends) and the browser (the inbox, the bell
 * badge, the preferences form). No `server-only`, no Prisma client, no I/O, so
 * the picture and the runtime cannot disagree about what a kind means or which
 * channels it reaches.
 *
 * The enum in schema.prisma owns *which kinds exist*. This catalog owns the two
 * strings and three booleans a human reads and tunes for each — the same split
 * as the onboarding checklist. Delivery is *decided* here (defaults + the
 * recipient's saved override) and *performed* at the one door.
 */

export type Channels = { inApp: boolean; email: boolean; sms: boolean };

export type KindSpec = {
  /** Short label for the preferences table and the inbox filter. */
  label: string;
  /** One line explaining when it fires, shown under the label. */
  detail: string;
  defaultSeverity: NotificationSeverity;
  /** Grouping in the preferences UI. */
  group: "Operations" | "Platform" | "Personal";
  /** Who normally receives it — display only, informs the prefs layout. */
  audience: "Admins" | "Owners" | "Anyone";
  /**
   * Where it goes when the recipient has set no preference. In-app is on for
   * everything (the inbox is the floor); email/SMS default on only for the
   * kinds worth interrupting someone who isn't logged in — money and people
   * waiting. A menu submission can wait for the next visit.
   */
  defaults: Channels;
};

/**
 * Ordered so the preferences page reads top-to-bottom by urgency within each
 * group rather than by enum declaration order.
 */
export const NOTIFICATION_CATALOG: Record<NotificationKind, KindSpec> = {
  REFUND_FAILED: {
    label: "Failed refund",
    detail: "A refund we tried to issue did not go through and money is owed.",
    defaultSeverity: "URGENT",
    group: "Operations",
    audience: "Admins",
    defaults: { inApp: true, email: true, sms: true },
  },
  ORDER_PLACED: {
    label: "New order",
    detail: "A customer placed an order and paid.",
    defaultSeverity: "INFO",
    group: "Operations",
    audience: "Owners",
    defaults: { inApp: true, email: true, sms: false },
  },
  SUPPORT_TICKET: {
    label: "Support ticket",
    detail: "An owner opened a ticket from their dashboard.",
    defaultSeverity: "WARNING",
    group: "Operations",
    audience: "Admins",
    defaults: { inApp: true, email: true, sms: false },
  },
  CONTACT_FORM: {
    label: "Contact enquiry",
    detail: "A stranger sent a message through the public contact form.",
    defaultSeverity: "INFO",
    group: "Operations",
    audience: "Admins",
    defaults: { inApp: true, email: true, sms: false },
  },
  BOOKING_CREATED: {
    label: "New booking",
    detail: "Someone booked an onboarding or intro call.",
    defaultSeverity: "INFO",
    group: "Operations",
    audience: "Admins",
    defaults: { inApp: true, email: true, sms: false },
  },
  BOOKING_REMINDER: {
    label: "Call reminder",
    detail: "A booked call is coming up soon.",
    defaultSeverity: "WARNING",
    group: "Operations",
    audience: "Anyone",
    defaults: { inApp: true, email: true, sms: true },
  },
  MENU_SUBMISSION: {
    label: "Menu build request",
    detail: "An owner asked us to build their menu for them.",
    defaultSeverity: "INFO",
    group: "Operations",
    audience: "Admins",
    defaults: { inApp: true, email: false, sms: false },
  },
  NEW_OPERATOR: {
    label: "New operator",
    detail: "An invite was redeemed and a new owner login exists.",
    defaultSeverity: "INFO",
    group: "Platform",
    audience: "Admins",
    defaults: { inApp: true, email: false, sms: false },
  },
  SERVICE_SUSPENDED: {
    label: "Service suspended",
    detail: "Payments, SMS, email or delivery was withdrawn from a tenant.",
    defaultSeverity: "WARNING",
    group: "Platform",
    audience: "Admins",
    defaults: { inApp: true, email: true, sms: false },
  },
  PAYMENT_MODE_REVERTED: {
    label: "Payment mode reverted",
    detail: "The test/stub timer fired and the platform fell back on its own.",
    defaultSeverity: "URGENT",
    group: "Platform",
    audience: "Admins",
    defaults: { inApp: true, email: true, sms: true },
  },
  PLAN_CHANGED: {
    label: "Plan change",
    detail: "A tenant switched pricing plan or was dropped for non-payment.",
    defaultSeverity: "INFO",
    group: "Platform",
    audience: "Admins",
    defaults: { inApp: true, email: false, sms: false },
  },
  BROADCAST: {
    label: "Announcement",
    detail: "A message an admin sent by hand to owners or other admins.",
    defaultSeverity: "INFO",
    group: "Personal",
    audience: "Anyone",
    defaults: { inApp: true, email: true, sms: false },
  },
  REMINDER: {
    label: "Reminder",
    detail: "A note you set for yourself, surfaced at the time you chose.",
    defaultSeverity: "INFO",
    group: "Personal",
    audience: "Anyone",
    defaults: { inApp: true, email: false, sms: false },
  },
};

/** Stable display order for the preferences table and inbox filters. */
export const KIND_ORDER: NotificationKind[] = [
  "REFUND_FAILED",
  "ORDER_PLACED",
  "SUPPORT_TICKET",
  "CONTACT_FORM",
  "BOOKING_CREATED",
  "BOOKING_REMINDER",
  "MENU_SUBMISSION",
  "NEW_OPERATOR",
  "SERVICE_SUSPENDED",
  "PAYMENT_MODE_REVERTED",
  "PLAN_CHANGED",
  "BROADCAST",
  "REMINDER",
];

export function specFor(kind: NotificationKind): KindSpec {
  return NOTIFICATION_CATALOG[kind];
}

/**
 * The recipient's effective channels for a kind: their saved override when they
 * set one, the catalog default otherwise. A stored preference is authoritative
 * even when it turns *off* a channel the default turns on — the whole point of
 * the row is to let someone mute an alert.
 *
 * `pref` is the shape read off a NotificationPref row (or null / undefined when
 * none exists). Kept structural so the pure module never imports the client.
 */
export function resolveChannels(
  kind: NotificationKind,
  pref?: { inApp: boolean; email: boolean; sms: boolean } | null
): Channels {
  if (pref) return { inApp: pref.inApp, email: pref.email, sms: pref.sms };
  return { ...NOTIFICATION_CATALOG[kind].defaults };
}

const SEVERITY_RANK: Record<NotificationSeverity, number> = {
  URGENT: 3,
  WARNING: 2,
  INFO: 1,
};

export function severityRank(s: NotificationSeverity): number {
  return SEVERITY_RANK[s];
}

/** Maps a severity to the `tone` the Badge component understands. */
export function badgeTone(s: NotificationSeverity): "bad" | "warn" | "neutral" {
  if (s === "URGENT") return "bad";
  if (s === "WARNING") return "warn";
  return "neutral";
}
