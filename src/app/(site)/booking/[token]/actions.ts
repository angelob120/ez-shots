"use server";

import { revalidatePath } from "next/cache";
import { cancelBookingByToken, bookingPath } from "@/lib/bookings";

/**
 * Cancel from the manage page.
 *
 * The token is the auth, exactly as it is on `/o/[token]` — a stranger who
 * booked a sales call has no account, and requiring one to cancel guarantees
 * no-shows instead of cancellations. A no-show costs the host the slot *and*
 * the wait; a cancellation frees it. Making the easy path the one that helps
 * is the whole design.
 */
export async function cancelBookingAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!token) return;

  await cancelBookingByToken(token);
  revalidatePath(bookingPath(token));
}
