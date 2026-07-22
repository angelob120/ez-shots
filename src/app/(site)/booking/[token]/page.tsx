import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { bookingByToken, meetingUrlFor } from "@/lib/bookings";
import { formatFullInZone } from "@/lib/booking-slots";
import { cancelBookingAction } from "./actions";

export const dynamic = "force-dynamic";

// Never indexed. The URL contains the only credential protecting a real
// person's name, email and phone number, and a search engine that crawls one
// publishes it. Same reasoning as the order status page.
export const metadata: Metadata = {
  title: "Your booking - EZ Orders",
  robots: { index: false, follow: false },
};

/**
 * Confirmation, and the manage page — the same page.
 *
 * Two URLs for "your booking is confirmed" and "change your booking" would mean
 * the confirmation is a dead end the moment it's been read, and the email link
 * would have to point at a third thing. One page that reads differently
 * depending on the state is fewer moving parts and no worse to look at.
 */
export default async function BookingPage({ params }: { params: { token: string } }) {
  const booking = await bookingByToken(params.token);
  if (!booking) notFound();

  // Shown in the zone the booker was looking at when they booked, falling back
  // to the host's. Re-deriving from the browser would be more accurate for
  // someone who has since travelled, and would also mean the page can't be
  // rendered without JavaScript — a bad trade for a page people open from an
  // email on a phone.
  const zone = booking.bookerTimezone ?? booking.type.timezone;
  const when = formatFullInZone(booking.startsAt, zone);
  const meetingUrl = meetingUrlFor(booking, booking.type);
  const past = booking.endsAt.getTime() < Date.now();
  const canceled = booking.status === "CANCELED";
  // A restaurant that booked from its own onboarding and hasn't finished yet.
  const onboardingReturn = Boolean(booking.restaurantId && !booking.restaurant?.onboardedAt);

  return (
    <section>
      <div className="mx-auto max-w-[640px] px-6 py-16">
        {canceled ? (
          <>
            <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              That booking is canceled.
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-dim">
              Nothing else to do. If you still want to talk,{" "}
              <Link
                href={`/book/${booking.type.slug}`}
                className="text-accent underline underline-offset-2"
              >
                pick a new time
              </Link>
              .
            </p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2.5">
              <span className="h-px w-6 bg-accentDim" />
              <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
                {past ? "This call has passed" : "You're booked"}
              </span>
            </div>

            <h1 className="mt-4 text-[32px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {booking.type.name}
            </h1>

            <p className="mt-3 text-[18px] font-medium text-ink">{when}</p>
            <p className="mt-1 text-[13px] text-dim">
              {booking.name} · {booking.email}
            </p>

            {meetingUrl && !past && (
              <a
                href={meetingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-6 inline-block rounded-sm bg-accent px-4 py-2.5 text-[14px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Join the call
              </a>
            )}

            {!meetingUrl && !past && (
              <p className="mt-6 rounded-sm border border-line bg-surface px-4 py-3 text-[13px] leading-relaxed text-dim">
                We&apos;ll email you a link to join before the call.
              </p>
            )}

            {/* An owner who booked from onboarding needs to know exactly what
                happens next — this is a partnership, not a self-serve launch,
                so their page doesn't go live until we've talked. Only shown
                while they're still mid-setup. */}
            {onboardingReturn && !past && (
              <div className="mt-8 rounded-md border border-accentDim/40 bg-accent/5 p-5">
                <p className="text-[13px] font-semibold text-ink">What happens next</p>
                <ol className="mt-3 space-y-2.5 text-[13px] leading-relaxed text-dim">
                  <li className="flex gap-2.5">
                    <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                      1
                    </span>
                    <span>
                      <span className="text-ink">Go back and finish your setup</span> — it takes
                      thirty seconds. Your page is saved for review after that.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                      2
                    </span>
                    <span>
                      <span className="text-ink">We meet at the time above.</span> We&apos;ll look
                      over your menu and hours together and answer anything.
                    </span>
                  </li>
                  <li className="flex gap-2.5">
                    <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-line2 text-[9px] text-mute">
                      3
                    </span>
                    <span>
                      <span className="text-ink">We switch your account on.</span> Right after the
                      call your ordering page goes live and starts taking orders.
                    </span>
                  </li>
                </ol>
                <Link
                  href="/onboarding"
                  className="mt-4 inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
                >
                  Go back and finish setup
                </Link>
              </div>
            )}

            {booking.note && (
              <div className="mt-8 border-t border-line pt-6">
                <p className="text-[11px] uppercase tracking-[0.12em] text-dim">What you told us</p>
                <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink">
                  {booking.note}
                </p>
              </div>
            )}

            {!past && (
              <div className="mt-10 flex items-center gap-4 border-t border-line pt-6">
                <Link
                  href={`/book/${booking.type.slug}`}
                  className="text-[13px] text-accent underline underline-offset-2"
                >
                  Pick a different time
                </Link>
                <form action={cancelBookingAction}>
                  <input type="hidden" name="token" value={booking.publicToken} />
                  <button className="text-[13px] text-dim underline underline-offset-2 transition-colors hover:text-danger">
                    Cancel this booking
                  </button>
                </form>
              </div>
            )}
          </>
        )}

        <p className="mt-10 text-[12px] leading-relaxed text-dim">
          Keep this link — it&apos;s how you change or cancel the booking later.
        </p>
      </div>
    </section>
  );
}
