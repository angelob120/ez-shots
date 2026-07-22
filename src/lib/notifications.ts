import "server-only";
import type { Notification, NotificationKind, NotificationSeverity, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sendOperatorEmail } from "@/lib/operator-email";
import { sendOperatorSms } from "@/lib/operator-sms";
import {
  NOTIFICATION_CATALOG,
  resolveChannels,
  type Channels,
} from "@/lib/notification-format";

/**
 * The one door for platform notifications. Everything that raises an alert —
 * a new order, a failed refund, a booked call, an admin's hand-written
 * announcement — comes through `notify()`, and everything that delivers one
 * off-platform (operator email, operator SMS) is decided and performed here.
 *
 * Why one door, restated for the reason it matters: delivery is governed by the
 * recipient's saved preference, and a second path that wrote a Notification row
 * or sent an operator email directly would be a second place for that
 * preference to be almost right — the same argument as `lib/sms.ts` and
 * `lib/email.ts`. The catalog defaults and the override resolution live in the
 * pure `lib/notification-format.ts` so the preferences UI and this sender agree
 * on which channels a kind reaches.
 *
 * A notify() call is best-effort and must never break the flow that raised it.
 * Callers wrap it in nothing; it swallows its own failures and logs, because a
 * refund that succeeded must not be reported as failed to the customer just
 * because the alert email bounced.
 */

/** Who receives a notification. Resolved to a concrete user list at send. */
export type NotifyAudience =
  | { to: "ADMINS" }
  | { to: "USER"; userId: string }
  /** The owner logins of one tenant. */
  | { to: "OWNERS_OF"; restaurantId: string }
  /** Every owner login on the platform — the broadcast case. */
  | { to: "ALL_OWNERS" };

export type NotifyInput = {
  kind: NotificationKind;
  audience: NotifyAudience;
  title: string;
  body: string;
  link?: string | null;
  /** Overrides the catalog default severity when set. */
  severity?: NotificationSeverity;
  /** The tenant this concerns, for the reader's context. Not an auth field. */
  restaurantId?: string | null;
  /**
   * Collapses duplicates per recipient. The same key twice to the same user is
   * dropped by the partial unique index rather than stacking — pass something
   * stable and event-scoped, e.g. `order:${orderId}`.
   */
  dedupeKey?: string | null;
  /** Future = a reminder; hidden and undelivered until the clock passes. */
  scheduledFor?: Date | null;
  /** The admin who composed a BROADCAST/REMINDER, for provenance. */
  createdById?: string | null;
};

/** Resolve an audience to the set of recipient user ids. */
async function recipientsFor(audience: NotifyAudience): Promise<string[]> {
  switch (audience.to) {
    case "USER":
      return [audience.userId];
    case "ADMINS": {
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { id: true },
      });
      return admins.map((u) => u.id);
    }
    case "OWNERS_OF": {
      const owners = await prisma.user.findMany({
        where: { role: "OWNER", restaurantId: audience.restaurantId },
        select: { id: true },
      });
      return owners.map((u) => u.id);
    }
    case "ALL_OWNERS": {
      const owners = await prisma.user.findMany({
        where: { role: "OWNER" },
        select: { id: true },
      });
      return owners.map((u) => u.id);
    }
  }
}

/** Fetch each recipient's saved channel overrides for this kind, keyed by user. */
async function prefsFor(
  userIds: string[],
  kind: NotificationKind
): Promise<Map<string, { inApp: boolean; email: boolean; sms: boolean }>> {
  if (userIds.length === 0) return new Map();
  const rows = await prisma.notificationPref.findMany({
    where: { kind, userId: { in: userIds } },
    select: { userId: true, inApp: true, email: true, sms: true },
  });
  const map = new Map<string, { inApp: boolean; email: boolean; sms: boolean }>();
  for (const r of rows) map.set(r.userId, { inApp: r.inApp, email: r.email, sms: r.sms });
  return map;
}

/**
 * Deliver one notification to one already-resolved recipient. Writes the in-app
 * row when the recipient's `inApp` channel is on, and performs the outbound
 * channels when the notification is due (not a future reminder). Every failure
 * is swallowed and logged.
 */
async function deliverOne(
  userId: string,
  input: NotifyInput,
  channels: Channels,
  severity: NotificationSeverity,
  due: boolean
): Promise<void> {
  let row: Notification | null = null;

  if (channels.inApp) {
    const data: Prisma.NotificationUncheckedCreateInput = {
      userId,
      kind: input.kind,
      severity,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      restaurantId: input.restaurantId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      scheduledFor: input.scheduledFor ?? null,
      createdById: input.createdById ?? null,
      // Mark the outbound pass as run now only when the row is due; a future
      // reminder is left for the drain.
      deliveredAt: due ? new Date() : null,
    };
    try {
      row = await prisma.notification.create({ data });
    } catch (err) {
      // The partial unique index on (userId, dedupeKey) rejects a duplicate.
      // That is the dedupe working, not an error — stop here, the recipient
      // already has this alert.
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        return;
      }
      console.error(`[notifications] failed to write in-app row for ${userId}:`, err);
    }
  }

  // A scheduled reminder does not go out over email/SMS until it is due — the
  // drain re-enters here with `due` true once the clock passes.
  if (!due) return;

  if (channels.email) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      if (user?.email) {
        const res = await sendOperatorEmail({
          to: user.email,
          subject: input.title,
          text: input.link ? `${input.body}\n\n${input.link}` : input.body,
        });
        if (res.sent && row) {
          await prisma.notification.update({ where: { id: row.id }, data: { emailedAt: new Date() } });
        }
      }
    } catch (err) {
      console.error(`[notifications] email delivery failed for ${userId}:`, err);
    }
  }

  if (channels.sms) {
    try {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
      if (user?.phone) {
        const res = await sendOperatorSms(user.phone, `${input.title}: ${input.body}`);
        if (res.sent && row) {
          await prisma.notification.update({ where: { id: row.id }, data: { smsedAt: new Date() } });
        }
      }
    } catch (err) {
      console.error(`[notifications] SMS delivery failed for ${userId}:`, err);
    }
  }
}

/**
 * Raise a notification. Fans out to every resolved recipient, applying each
 * one's channel preferences. Best-effort throughout — never throws.
 */
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const severity = input.severity ?? NOTIFICATION_CATALOG[input.kind].defaultSeverity;
    const now = Date.now();
    const due = !input.scheduledFor || input.scheduledFor.getTime() <= now;

    const userIds = await recipientsFor(input.audience);
    if (userIds.length === 0) return;

    const prefs = await prefsFor(userIds, input.kind);

    await Promise.all(
      userIds.map((userId) => {
        const channels = resolveChannels(input.kind, prefs.get(userId) ?? null);
        // Nothing to do for a recipient who muted every channel.
        if (!channels.inApp && !channels.email && !channels.sms) return Promise.resolve();
        return deliverOne(userId, input, channels, severity, due);
      })
    );
  } catch (err) {
    console.error("[notifications] notify failed:", err);
  }
}

// ── Reading (the inbox and the bell) ───────────────────────────────────────

/** Unread, currently-visible notifications for a user. Excludes future reminders. */
export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      userId,
      readAt: null,
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
  });
}

export type InboxFilter = { unreadOnly?: boolean; kind?: NotificationKind };

/** The inbox: visible notifications for a user, newest first. */
export async function listNotifications(
  userId: string,
  filter: InboxFilter = {},
  limit = 100
): Promise<Notification[]> {
  return prisma.notification.findMany({
    where: {
      userId,
      ...(filter.unreadOnly ? { readAt: null } : {}),
      ...(filter.kind ? { kind: filter.kind } : {}),
      OR: [{ scheduledFor: null }, { scheduledFor: { lte: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

/** Mark one notification read. Scoped to the owner so no one reads another's inbox. */
export async function markRead(userId: string, id: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { id, userId, readAt: null },
    data: { readAt: new Date() },
  });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId, readAt: null },
    data: { readAt: new Date() },
  });
}

// ── Preferences ────────────────────────────────────────────────────────────

export async function getPrefs(userId: string) {
  return prisma.notificationPref.findMany({ where: { userId } });
}

/** Upsert one kind's channel preference for a user. */
export async function setPref(
  userId: string,
  kind: NotificationKind,
  channels: { inApp: boolean; email: boolean; sms: boolean }
): Promise<void> {
  await prisma.notificationPref.upsert({
    where: { userId_kind: { userId, kind } },
    create: { userId, kind, ...channels },
    update: channels,
  });
}

// ── Scheduled reminders drain ──────────────────────────────────────────────

/**
 * Deliver scheduled reminders whose time has come. Called by the sweep (the
 * same Railway cron everything else in this repo queues behind — until it
 * exists, a future reminder shows in-app the moment its clock passes on any
 * page load, but its email/SMS wait for this). Bounded per run.
 *
 * Each row is claimed by stamping `deliveredAt` in an atomic `updateMany`
 * before any wire call, so a second overlapping drain can't send it twice —
 * the same optimistic-claim pattern as the refund and message retries.
 */
export async function drainScheduledNotifications(batch = 100): Promise<number> {
  const now = new Date();
  const rows = await prisma.notification.findMany({
    where: { deliveredAt: null, scheduledFor: { not: null, lte: now } },
    orderBy: { scheduledFor: "asc" },
    take: batch,
  });

  let sent = 0;
  for (const row of rows) {
    // Claim it. Zero rows means another drain got there first.
    const claim = await prisma.notification.updateMany({
      where: { id: row.id, deliveredAt: null },
      data: { deliveredAt: now },
    });
    if (claim.count === 0) continue;

    const pref = await prisma.notificationPref.findUnique({
      where: { userId_kind: { userId: row.userId, kind: row.kind } },
      select: { inApp: true, email: true, sms: true },
    });
    const channels = resolveChannels(row.kind, pref);

    if (channels.email) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: row.userId },
          select: { email: true },
        });
        if (user?.email) {
          const res = await sendOperatorEmail({
            to: user.email,
            subject: row.title,
            text: row.link ? `${row.body}\n\n${row.link}` : row.body,
          });
          if (res.sent) {
            await prisma.notification.update({ where: { id: row.id }, data: { emailedAt: now } });
          }
        }
      } catch (err) {
        console.error(`[notifications] scheduled email failed for ${row.userId}:`, err);
      }
    }

    if (channels.sms) {
      try {
        const user = await prisma.user.findUnique({
          where: { id: row.userId },
          select: { phone: true },
        });
        if (user?.phone) {
          const res = await sendOperatorSms(user.phone, `${row.title}: ${row.body}`);
          if (res.sent) {
            await prisma.notification.update({ where: { id: row.id }, data: { smsedAt: now } });
          }
        }
      } catch (err) {
        console.error(`[notifications] scheduled SMS failed for ${row.userId}:`, err);
      }
    }

    sent += 1;
  }

  return sent;
}
