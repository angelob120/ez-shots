import "server-only";

import { prisma } from "./prisma";
import { notify } from "./notifications";
import { parseWeeklyHours } from "./hours";
import { platformOrigin } from "./domains";
import {
  generateSlots,
  isSlotBookable,
  wallClockToInstant,
  type BookingRules,
  type Busy,
  type SlotDay,
} from "./booking-slots";

/**
 * Booking calls, and the one door every one of them goes through.
 *
 * The same arrangement as `lib/orders.ts`: this module is the only place a
 * `Booking` row is created, canceled, or moved between statuses. `lib/booking-slots.ts`
 * holds the pure arithmetic — which times exist — and this holds everything
 * that touches the database, because the interesting rules are all about
 * collisions and a collision is a fact about stored rows.
 *
 * ─── Why this is not TidyCal ──────────────────────────────────────────────
 *
 * The first version of this was going to be a TidyCal link with a Zapier sync.
 * It was replaced because the calendar has to know about tenants. An onboarding
 * call belongs to a restaurant, shows on that owner's dashboard until it
 * happens, and disappears when it does — none of which an external scheduler
 * can do without a sync job whose failure mode is an owner staring at a banner
 * for a call they already had, or worse, a booking the product never hears
 * about at all. TidyCal also has no webhooks, so that sync would have been
 * polling, and a polled calendar is wrong for however long the poll interval is.
 *
 * Reminders are still going out through Zapier, and that's the right split:
 * *who booked what* is product state and lives here, *tell them an hour before*
 * is plumbing and doesn't need to.
 *
 * ─── The race, and what actually closes it ────────────────────────────────
 *
 * Two people can hit Confirm on the same 2pm within the same second. Checking
 * for a conflict and then inserting cannot fix that — the read is stale the
 * moment it returns, which is the identical bug class the optimistic locks in
 * `lib/orders.ts` exist for.
 *
 * What closes it is the **partial unique index** on `(typeId, startsAt) WHERE
 * status = 'SCHEDULED'` in migration 30. The second INSERT fails, Prisma raises
 * P2002, and `createBooking` turns that into `slot_taken` rather than a 500.
 * The pre-check in `isSlotBookable` is still worth doing, because it gives the
 * common case a decent message instead of an error page — but it is the
 * courtesy and the index is the enforcement. **Do not remove the index because
 * the check looks sufficient.**
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BookingTypeRow = {
  id: string;
  slug: string;
  name: string;
  blurb: string | null;
  durationMins: number;
  bufferMins: number;
  minNoticeMins: number;
  maxDaysAhead: number;
  availabilityJson: unknown;
  timezone: string;
  meetingUrl: string | null;
  active: boolean;
};

export type CreateBookingInput = {
  typeSlug: string;
  startsAt: Date;
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
  /** Set when an onboarding owner books; null for a stranger from /contact. */
  restaurantId?: string | null;
  /** The zone the picker was showing, so we can speak in their terms later. */
  bookerTimezone?: string | null;
  source?: "web" | "admin";
};

export type CreateBookingResult =
  | { ok: true; booking: { id: string; publicToken: string; startsAt: Date } }
  | { ok: false; reason: "no_such_type" | "slot_taken" | "slot_unavailable" | "invalid"; message: string };

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The rules half of a type row, in the shape the pure engine wants. */
export function rulesFor(t: BookingTypeRow): BookingRules {
  return {
    availability: parseWeeklyHours(t.availabilityJson),
    timezone: t.timezone,
    durationMins: t.durationMins,
    bufferMins: t.bufferMins,
    minNoticeMins: t.minNoticeMins,
    maxDaysAhead: t.maxDaysAhead,
  };
}

export async function bookingTypeBySlug(slug: string): Promise<BookingTypeRow | null> {
  return prisma.bookingType.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      blurb: true,
      durationMins: true,
      bufferMins: true,
      minNoticeMins: true,
      maxDaysAhead: true,
      availabilityJson: true,
      timezone: true,
      meetingUrl: true,
      active: true,
    },
  });
}

export async function listBookingTypes(): Promise<BookingTypeRow[]> {
  return prisma.bookingType.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      blurb: true,
      durationMins: true,
      bufferMins: true,
      minNoticeMins: true,
      maxDaysAhead: true,
      availabilityJson: true,
      timezone: true,
      meetingUrl: true,
      active: true,
    },
  });
}

/**
 * What's already taken, across **every** type.
 *
 * Deliberately not scoped to one type. There is one host, and a 2pm sales call
 * blocks the 2pm setup call just as thoroughly as another setup call would.
 * Scoping this to `typeId` would let the two bookable types double-book each
 * other, which is the sort of bug that only ever shows up as the host on two
 * calls at once.
 *
 * Note this makes the unique index a *narrower* guard than this function —
 * the index only catches same-type collisions. That's the right split: the
 * index closes the race that needs a database to close, and the cross-type
 * check runs a moment earlier where a stale read is merely unlucky rather than
 * corrupting. A cross-type double-book is possible in theory, in the width of
 * one transaction, with one host and two strangers. Worth knowing; not worth a
 * table lock.
 */
export async function busyBetween(from: Date, to: Date): Promise<Busy[]> {
  const rows = await prisma.booking.findMany({
    where: {
      status: "SCHEDULED",
      startsAt: { gte: from, lt: to },
    },
    select: { startsAt: true, endsAt: true },
  });
  return rows;
}

/** Every bookable slot for a type, ready to render. */
export async function availableSlots(
  t: BookingTypeRow,
  now: Date = new Date(),
): Promise<SlotDay[]> {
  const rules = rulesFor(t);
  if (!t.active) return [];

  const horizonEnd = new Date(now.getTime() + (rules.maxDaysAhead + 2) * 86_400_000);
  const busy = await busyBetween(new Date(now.getTime() - 86_400_000), horizonEnd);

  return generateSlots(rules, busy, now);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/**
 * The manage-your-booking key.
 *
 * 160 bits from the CSPRNG, the same as `newOrderToken` and for the same
 * reason: a stranger who booked a sales call has no account, so this link is
 * the only thing standing between the internet and their name, email and
 * phone number.
 */
export function newBookingToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bookingPath(token: string): string {
  return `/booking/${token}`;
}

export function bookingUrl(token: string): string {
  const origin = platformOrigin();
  return origin ? `${origin}${bookingPath(token)}` : bookingPath(token);
}

/**
 * Where the call happens.
 *
 * A per-booking URL wins when something upstream made one — that's the hook
 * for Zapier creating a Zoom room per booking later. Otherwise the type's
 * static room. Resolved here rather than at each render, so the banner, the
 * confirmation page and the admin calendar cannot disagree about the link.
 */
export function meetingUrlFor(
  booking: { meetingUrl: string | null },
  type: { meetingUrl: string | null },
): string | null {
  return booking.meetingUrl ?? type.meetingUrl ?? null;
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

/**
 * Alert admins to a new booking and schedule a reminder an hour before it.
 * Best-effort — notify() swallows its own failures, so a booked call is never
 * lost because the alert couldn't be raised. Shared by the public and admin
 * booking paths so both behave the same.
 */
async function notifyBooking(
  typeName: string,
  bookerName: string,
  bookingId: string,
  startsAt: Date
): Promise<void> {
  const when = startsAt.toLocaleString();
  await notify({
    kind: "BOOKING_CREATED",
    audience: { to: "ADMINS" },
    title: `New booking: ${typeName}`,
    body: `${bookerName} booked ${typeName} for ${when}.`,
    link: "/admin/calendar",
    dedupeKey: `booking:${bookingId}`,
  });

  const remindAt = new Date(startsAt.getTime() - 60 * 60_000);
  if (remindAt.getTime() > Date.now()) {
    await notify({
      kind: "BOOKING_REMINDER",
      audience: { to: "ADMINS" },
      title: `Call in an hour: ${typeName}`,
      body: `${bookerName} — ${typeName} at ${when}.`,
      link: "/admin/calendar",
      scheduledFor: remindAt,
      dedupeKey: `booking-reminder:${bookingId}`,
    });
  }
}

export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) return { ok: false, reason: "invalid", message: "Please tell us your name." };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, reason: "invalid", message: "That email address doesn't look right." };
  }

  const type = await bookingTypeBySlug(input.typeSlug);
  if (!type || !type.active) {
    return { ok: false, reason: "no_such_type", message: "That kind of call isn't bookable." };
  }

  const rules = rulesFor(type);
  const now = new Date();

  // Re-derived server-side rather than trusted from the form. The slot the
  // booker clicked was generated when the page loaded, and they may have sat
  // on it for ten minutes — or edited it, since it arrives as a hidden field.
  const horizonEnd = new Date(now.getTime() + (rules.maxDaysAhead + 2) * 86_400_000);
  const busy = await busyBetween(new Date(now.getTime() - 86_400_000), horizonEnd);

  if (!isSlotBookable(rules, busy, input.startsAt, now)) {
    return {
      ok: false,
      reason: "slot_unavailable",
      message: "That time isn't available any more. Pick another and we'll get you in.",
    };
  }

  const endsAt = new Date(input.startsAt.getTime() + type.durationMins * 60_000);
  const publicToken = newBookingToken();

  try {
    const booking = await prisma.booking.create({
      data: {
        typeId: type.id,
        restaurantId: input.restaurantId ?? null,
        name,
        email,
        phone: input.phone?.trim() || null,
        note: input.note?.trim() || null,
        startsAt: input.startsAt,
        endsAt,
        bookerTimezone: input.bookerTimezone ?? null,
        publicToken,
        source: input.source ?? "web",
      },
      select: { id: true, publicToken: true, startsAt: true },
    });
    await notifyBooking(type.name, name, booking.id, booking.startsAt);
    return { ok: true, booking };
  } catch (err: unknown) {
    // P2002 is the partial unique index doing its job — someone else took this
    // slot between the check above and this insert. The only correct answer is
    // to tell them and let them pick again; retrying automatically would put
    // them on a time they never chose.
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return {
        ok: false,
        reason: "slot_taken",
        message: "Someone just took that slot. Pick another and we'll get you in.",
      };
    }
    throw err;
  }
}

export type AdminBookingInput = {
  typeSlug: string;
  /** Wall-clock "YYYY-MM-DD" in the type's own timezone. */
  date: string;
  /** Minutes from local midnight, in the type's own timezone. */
  minutes: number;
  name: string;
  email: string;
  phone?: string | null;
  note?: string | null;
  restaurantId?: string | null;
  meetingUrl?: string | null;
};

export type AdminBookingResult =
  | { ok: true; booking: { id: string; publicToken: string; startsAt: Date }; outsideAvailability: boolean }
  | { ok: false; reason: "no_such_type" | "slot_taken" | "invalid"; message: string };

/**
 * Create a booking by hand, from the admin console.
 *
 * **This deliberately does not check availability**, and that is the whole
 * reason it is a separate function rather than a flag on `createBooking`.
 *
 * The two doors answer different questions. The public one asks "is this a
 * time we are offering?", which has to be enforced or the grid means nothing.
 * This one is a call that was *already agreed* — on the phone, over email, in
 * a reply to a support ticket — and is being written down. Refusing to record
 * a 7pm Saturday call because Saturday isn't on the availability grid would
 * mean the calendar disagrees with reality, and a calendar that disagrees with
 * reality is worse than no calendar. The admin is the authority here; the grid
 * is a convenience for strangers.
 *
 * What it does **not** get to override is the double-booking guard. The
 * partial unique index applies to every insert regardless of who made it, so
 * an admin typing a time that's already taken gets `slot_taken` exactly as a
 * stranger would. That one is a fact about the host being in two places at
 * once, not a policy.
 *
 * `outsideAvailability` comes back on success so the UI can say "note: this is
 * outside your usual hours" — worth surfacing, since the commonest reason to
 * land there is a typo in the date rather than a deliberate favour.
 */
export async function createAdminBooking(input: AdminBookingInput): Promise<AdminBookingResult> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) return { ok: false, reason: "invalid", message: "A name is required." };
  if (!EMAIL_RE.test(email)) {
    return { ok: false, reason: "invalid", message: "That email address doesn't look right." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    return { ok: false, reason: "invalid", message: "Pick a date." };
  }

  const type = await bookingTypeBySlug(input.typeSlug);
  if (!type) return { ok: false, reason: "no_such_type", message: "Unknown call type." };

  // Interpreted in the *host's* zone, not the server's. An admin typing 2pm
  // means 2pm where they are, and the server is on UTC.
  const startsAt = wallClockToInstant(input.date, input.minutes, type.timezone);
  const endsAt = new Date(startsAt.getTime() + type.durationMins * 60_000);

  const rules = rulesFor(type);
  const now = new Date();
  const busy = await busyBetween(
    new Date(startsAt.getTime() - 86_400_000),
    new Date(startsAt.getTime() + 86_400_000),
  );

  // Advisory only — see the header. Computed with zero notice and a horizon
  // wide enough to reach the target, because "is this inside your usual
  // hours" is a different question from "may a stranger book it now".
  const outsideAvailability = !isSlotBookable(
    { ...rules, minNoticeMins: 0, maxDaysAhead: 365 },
    [],
    startsAt,
    new Date(Math.min(now.getTime(), startsAt.getTime() - 60_000)),
  );

  // A conflict *is* refused, unlike an availability miss. Checked here for a
  // decent message; the index below is what actually enforces it.
  const conflict = busy.some(
    (b) => startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < endsAt.getTime(),
  );
  if (conflict) {
    return {
      ok: false,
      reason: "slot_taken",
      message: "That overlaps a booking you already have.",
    };
  }

  try {
    const booking = await prisma.booking.create({
      data: {
        typeId: type.id,
        restaurantId: input.restaurantId || null,
        name,
        email,
        phone: input.phone?.trim() || null,
        note: input.note?.trim() || null,
        startsAt,
        endsAt,
        bookerTimezone: type.timezone,
        meetingUrl: input.meetingUrl?.trim() || null,
        publicToken: newBookingToken(),
        source: "admin",
      },
      select: { id: true, publicToken: true, startsAt: true },
    });
    await notifyBooking(type.name, name, booking.id, booking.startsAt);
    return { ok: true, booking, outsideAvailability };
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002") {
      return { ok: false, reason: "slot_taken", message: "That slot is already booked." };
    }
    throw err;
  }
}

/**
 * Cancel a booking.
 *
 * Sets `canceledAt` and moves the status rather than deleting, which is what
 * frees the slot — the partial unique index only counts SCHEDULED rows, so a
 * canceled 2pm becomes bookable again with no other bookkeeping. Keeping the
 * row is also what lets the calendar answer "did they cancel or did they never
 * book", which is a different conversation.
 */
export async function cancelBooking(id: string): Promise<boolean> {
  // Guarded like every other status move in this codebase: the status that was
  // read goes in the WHERE, so a double-tapped Cancel updates one row and the
  // second attempt reports honestly that there was nothing to do.
  const res = await prisma.booking.updateMany({
    where: { id, status: "SCHEDULED" },
    data: { status: "CANCELED", canceledAt: new Date() },
  });
  return res.count === 1;
}

export async function cancelBookingByToken(token: string): Promise<boolean> {
  const found = await prisma.booking.findUnique({
    where: { publicToken: token },
    select: { id: true },
  });
  if (!found) return false;
  return cancelBooking(found.id);
}

/**
 * How the call actually went.
 *
 * Both are admin-only and both are judgements — the system cannot tell a
 * no-show from a call that ran on a phone instead. Recorded because "did this
 * tenant get onboarded" is the question the whole feature exists to answer,
 * and an un-marked booking in the past is indistinguishable from one that
 * never happened.
 */
export async function markBookingOutcome(
  id: string,
  outcome: "ATTENDED" | "NO_SHOW",
): Promise<boolean> {
  const res = await prisma.booking.updateMany({
    where: { id, status: { in: ["SCHEDULED", "ATTENDED", "NO_SHOW"] } },
    data: {
      status: outcome,
      attendedAt: outcome === "ATTENDED" ? new Date() : null,
    },
  });
  return res.count === 1;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export type OwnerBookingView = {
  id: string;
  publicToken: string;
  startsAt: Date;
  endsAt: Date;
  typeName: string;
  meetingUrl: string | null;
  hostTimezone: string;
};

/**
 * The tenant's next call, for the dashboard banner.
 *
 * Only SCHEDULED and only in the future — a call that has happened should stop
 * nagging on its own, without anyone remembering to dismiss it. That is the
 * same principle as `SetupGaps`: the banner goes away when the thing is done,
 * and there is no button that removes the knowledge instead of the problem.
 *
 * Returns null when there is nothing booked, which is what makes the *other*
 * banner render — the one asking them to book. One query answers both.
 */
export async function nextBookingForRestaurant(
  restaurantId: string,
  now: Date = new Date(),
): Promise<OwnerBookingView | null> {
  const row = await prisma.booking.findFirst({
    where: { restaurantId, status: "SCHEDULED", startsAt: { gte: now } },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      publicToken: true,
      startsAt: true,
      endsAt: true,
      meetingUrl: true,
      type: { select: { name: true, meetingUrl: true, timezone: true } },
    },
  });
  if (!row) return null;

  return {
    id: row.id,
    publicToken: row.publicToken,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    typeName: row.type.name,
    meetingUrl: meetingUrlFor(row, row.type),
    hostTimezone: row.type.timezone,
  };
}

/** Has this tenant ever been on a call with us? Decides whether to keep asking. */
export async function hasAttendedBooking(restaurantId: string): Promise<boolean> {
  const n = await prisma.booking.count({ where: { restaurantId, status: "ATTENDED" } });
  return n > 0;
}

export type CalendarEntry = {
  id: string;
  publicToken: string;
  name: string;
  email: string;
  phone: string | null;
  note: string | null;
  startsAt: Date;
  endsAt: Date;
  status: "SCHEDULED" | "CANCELED" | "ATTENDED" | "NO_SHOW";
  bookerTimezone: string | null;
  meetingUrl: string | null;
  typeName: string;
  typeSlug: string;
  source: string;
  restaurant: { id: string; name: string; slug: string; onboardedAt: Date | null } | null;
};

/**
 * The admin calendar.
 *
 * One query for a window, ordered by time, with the tenant joined when there is
 * one. Bookings with no tenant are returned as-is rather than filtered out —
 * a stranger booking from `/contact` is a lead, and hiding leads because they
 * don't have a foreign key is how the contact form becomes a page nobody reads.
 */
export async function calendarBetween(
  from: Date,
  to: Date,
  opts: { includeCanceled?: boolean } = {},
): Promise<CalendarEntry[]> {
  const rows = await prisma.booking.findMany({
    where: {
      startsAt: { gte: from, lt: to },
      ...(opts.includeCanceled ? {} : { status: { not: "CANCELED" } }),
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      publicToken: true,
      name: true,
      email: true,
      phone: true,
      note: true,
      startsAt: true,
      endsAt: true,
      status: true,
      bookerTimezone: true,
      meetingUrl: true,
      source: true,
      type: { select: { name: true, slug: true, meetingUrl: true } },
      restaurant: { select: { id: true, name: true, slug: true, onboardedAt: true } },
    },
  });

  return rows.map((r) => ({
    id: r.id,
    publicToken: r.publicToken,
    name: r.name,
    email: r.email,
    phone: r.phone,
    note: r.note,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    status: r.status as CalendarEntry["status"],
    bookerTimezone: r.bookerTimezone,
    meetingUrl: meetingUrlFor(r, r.type),
    typeName: r.type.name,
    typeSlug: r.type.slug,
    source: r.source,
    restaurant: r.restaurant,
  }));
}

export async function bookingByToken(token: string) {
  return prisma.booking.findUnique({
    where: { publicToken: token },
    select: {
      id: true,
      publicToken: true,
      name: true,
      email: true,
      note: true,
      startsAt: true,
      endsAt: true,
      status: true,
      bookerTimezone: true,
      meetingUrl: true,
      restaurantId: true,
      // Whether the booker is a restaurant still mid-onboarding, so the
      // confirmation page can close the loop back to the wizard. onboardedAt
      // null = they still have the "finish setup" step waiting.
      restaurant: { select: { onboardedAt: true } },
      type: { select: { name: true, slug: true, blurb: true, meetingUrl: true, timezone: true } },
    },
  });
}

/**
 * Counts for the admin home card.
 *
 * `unattended` is the one worth looking at: calls that have finished and were
 * never marked attended or no-show. It is the calendar's equivalent of a
 * failed refund — a small number that should be zero, and a growing one means
 * the record of who actually got onboarded has stopped being true.
 */
export async function bookingCounts(now: Date = new Date()) {
  const in7 = new Date(now.getTime() + 7 * 86_400_000);
  const [upcoming, unattended] = await Promise.all([
    prisma.booking.count({
      where: { status: "SCHEDULED", startsAt: { gte: now, lt: in7 } },
    }),
    prisma.booking.count({
      where: { status: "SCHEDULED", endsAt: { lt: now } },
    }),
  ]);
  return { upcoming, unattended };
}
