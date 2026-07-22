"use server";

import { redirect } from "next/navigation";
import { createBooking, bookingPath } from "@/lib/bookings";
import { getSession } from "@/lib/auth";

export type BookingFormState = { ok: false; message: string };

/**
 * Take a booking.
 *
 * Public and unauthenticated by design — the whole point is that a stranger who
 * has never signed up can put a call in the calendar. It is therefore the
 * second unauthenticated writer in the product after `ContactSubmission`, and
 * the same caution applies: nothing here trusts a value from the form except
 * the ones a person actually typed.
 *
 * In particular `restaurantId` arrives as a hidden field and is **not** taken
 * from it. It's re-read from the session, because a hidden field is a text box
 * anybody can edit and honouring one would let a stranger attach their booking
 * to somebody else's restaurant — which puts their name, email and phone on
 * that owner's dashboard banner. The field exists in the markup only so the
 * form shape is the same in both places; the server ignores it.
 */
export async function createBookingAction(formData: FormData): Promise<BookingFormState> {
  const typeSlug = String(formData.get("typeSlug") ?? "");
  const rawStart = String(formData.get("startsAt") ?? "");

  const startsAt = new Date(rawStart);
  if (!rawStart || Number.isNaN(startsAt.getTime())) {
    return { ok: false, message: "Pick a time first." };
  }

  // The only source of truth for which tenant this belongs to. An owner
  // booking from their own onboarding gets linked; everyone else gets null.
  const session = await getSession();
  const restaurantId = session?.restaurantId ?? null;

  const result = await createBooking({
    typeSlug,
    startsAt,
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    phone: String(formData.get("phone") ?? "") || null,
    note: String(formData.get("note") ?? "") || null,
    bookerTimezone: String(formData.get("bookerTimezone") ?? "") || null,
    restaurantId,
    source: "web",
  });

  if (!result.ok) return { ok: false, message: result.message };

  // Redirect rather than render a confirmation inline, so the booking has a URL
  // the booker can come back to, forward, or bookmark — and so a refresh can't
  // resubmit. The token is the auth on that page, exactly as it is for /o/.
  redirect(bookingPath(result.booking.publicToken));
}
