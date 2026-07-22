"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cancelBooking, createAdminBooking, markBookingOutcome } from "@/lib/bookings";
import { parseAvailabilityForm } from "@/lib/booking-slots";

/**
 * Admin writes against the calendar.
 *
 * Every one takes `requireAdmin()` first. That is not ceremony: these actions
 * cancel other people's bookings and rewrite when the host is available, and
 * the booking page itself is deliberately public and unauthenticated. The two
 * live in the same feature and only one of them may be reached by a stranger.
 */

/**
 * Write down a call that was agreed somewhere else.
 *
 * Goes through `createAdminBooking`, which skips the availability grid on
 * purpose — see the note on it. The double-booking guard still applies, so a
 * conflict comes back as an error rather than being forced through.
 *
 * Failures are surfaced through the URL rather than returned, because the form
 * is a plain server-action `<form>` with no client state. A redirect back with
 * `?err=` keeps the page renderable without JavaScript, which is worth more
 * here than preserving the typed fields on the rare bad submit.
 */
export async function createAdminBookingAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const at = String(formData.get("at") ?? ""); // "YYYY-MM-DDTHH:MM" from datetime-local
  const [date, time] = at.split("T");
  const [h, m] = (time ?? "").split(":").map(Number);

  if (!date || !Number.isFinite(h) || !Number.isFinite(m)) {
    redirect("/admin/calendar?tab=new&err=Pick+a+date+and+time.");
  }

  const result = await createAdminBooking({
    typeSlug: String(formData.get("typeSlug") ?? ""),
    date,
    minutes: h * 60 + m,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    note: String(formData.get("note") ?? "") || null,
    restaurantId: String(formData.get("restaurantId") ?? "") || null,
    meetingUrl: String(formData.get("meetingUrl") ?? "") || null,
  });

  if (!result.ok) {
    redirect(`/admin/calendar?tab=new&err=${encodeURIComponent(result.message)}`);
  }

  revalidatePath("/admin/calendar");
  revalidatePath("/dashboard");

  // The "outside your usual hours" note rides back on the URL too. It is not
  // an error — the booking was made — but it is the one thing worth a second
  // look, because the commonest way to land there is a mistyped date.
  redirect(
    result.outsideAvailability
      ? "/admin/calendar?tab=upcoming&note=outside"
      : "/admin/calendar?tab=upcoming",
  );
}

export async function markOutcomeAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  const outcome = String(formData.get("outcome") ?? "");
  if (!id || (outcome !== "ATTENDED" && outcome !== "NO_SHOW")) return;

  await markBookingOutcome(id, outcome);
  revalidatePath("/admin/calendar");
  // The owner's dashboard banner keys off an *attended* call, so marking one
  // is what finally stops that tenant being nagged. Revalidated here so it
  // stops on their next page load rather than whenever the cache felt like it.
  revalidatePath("/dashboard");
}

export async function adminCancelBookingAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await cancelBooking(id);
  revalidatePath("/admin/calendar");
}

/**
 * Save the host's weekly availability.
 *
 * Stored per booking type rather than globally, because the two types are not
 * the same product — an onboarding call with a paying tenant deserves more of
 * the week than a cold sales chat. `busyBetween` is what stops them
 * double-booking each other; see the note on it.
 *
 * An empty grid is saved as an empty object and means "not taking calls",
 * which is a legitimate thing to say. The slot engine fails closed, so that is
 * safe — see the header of `lib/booking-slots.ts` for why that default is the
 * opposite of `lib/hours.ts` and why the difference matters.
 */
export async function saveAvailabilityAction(formData: FormData): Promise<void> {
  await requireAdmin();

  const typeId = String(formData.get("typeId") ?? "");
  if (!typeId) return;

  const { availability } = parseAvailabilityForm(formData);

  const timezone = String(formData.get("timezone") ?? "").trim() || "America/New_York";
  const meetingUrl = String(formData.get("meetingUrl") ?? "").trim() || null;

  const num = (name: string, fallback: number, min: number, max: number) => {
    const raw = Number(formData.get(name));
    if (!Number.isFinite(raw)) return fallback;
    return Math.min(Math.max(Math.round(raw), min), max);
  };

  await prisma.bookingType.update({
    where: { id: typeId },
    data: {
      availabilityJson: availability,
      timezone,
      meetingUrl,
      // Clamped rather than trusted. A zero-minute duration makes the slot
      // engine emit nothing and looks like the calendar is broken; a
      // thousand-day horizon fills the picker with times nobody will honour.
      durationMins: num("durationMins", 20, 5, 240),
      bufferMins: num("bufferMins", 5, 0, 120),
      minNoticeMins: num("minNoticeMins", 120, 0, 20_160),
      maxDaysAhead: num("maxDaysAhead", 21, 1, 120),
      active: formData.get("active") === "on",
    },
  });

  revalidatePath("/admin/calendar");
}
