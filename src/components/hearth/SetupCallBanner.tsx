import Link from "next/link";
import { formatFullInZone } from "@/lib/booking-slots";

/**
 * The setup-call banner: book one, or here's the one you booked.
 *
 * Two states in one component because they are one thing — "where does the
 * onboarding call stand" — and splitting them across two banners is how a
 * dashboard ends up rendering both at once during the second between booking
 * and revalidating.
 *
 * ─── Why it nags rather than blocks ───────────────────────────────────────
 *
 * The same rule as `SetupGaps`, and for a sharper reason. The other required
 * steps are things an owner can do alone at 11pm; a call needs *us*, and we
 * are asleep, or booked out, or on holiday. Making launch wait on the host's
 * calendar means a restaurant that finished its menu on Sunday cannot open
 * until Tuesday for reasons that have nothing to do with them being ready.
 * That is a gate whose cost falls on the wrong person.
 *
 * So booking is strongly encouraged and never required, and
 * `lib/onboarding.ts` is deliberately untouched by any of this — the call is
 * not a wizard step and `blockingSteps` does not know it exists.
 *
 * ─── Why it lingers ───────────────────────────────────────────────────────
 *
 * It has no dismiss button, for the reason written on `SetupGaps`: a dismiss
 * on "you haven't booked your setup call" removes the knowledge rather than
 * the problem. It stops rendering on its own once a call has been *attended*,
 * which is the only honest trigger — a booked call that nobody turned up to
 * has not onboarded anybody, and the banner going quiet at booking time would
 * hide exactly the tenants most worth chasing.
 */
export default function SetupCallBanner({
  booking,
  bookHref,
}: {
  booking: {
    startsAt: Date;
    typeName: string;
    meetingUrl: string | null;
    publicToken: string;
    hostTimezone: string;
  } | null;
  bookHref: string;
}) {
  if (!booking) {
    return (
      <div className="mb-6 rounded-md border border-accentDim/40 bg-accent/5 px-4 py-3.5" role="status">
        <h2 className="text-[13px] font-semibold text-ink">Book your setup call</h2>
        <p className="mt-1.5 max-w-[640px] text-[12.5px] leading-relaxed text-dim">
          Twenty minutes with us to check your menu, your hours, and how orders reach your kitchen.
          It&apos;s the fastest way to find the thing that would otherwise go wrong on your first
          busy night.
        </p>
        <Link
          href={bookHref}
          className="mt-3 inline-flex h-8 items-center rounded-sm bg-accent px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
        >
          Pick a time
        </Link>
      </div>
    );
  }

  // Rendered in the host's zone on the server, which is at least a zone that
  // exists — the browser's would be better and would cost this banner a
  // hydration boundary on every dashboard page. The label names the zone, so a
  // reader in another one can tell what they're looking at rather than being
  // quietly an hour out.
  const when = formatFullInZone(booking.startsAt, booking.hostTimezone);

  return (
    <div className="mb-6 rounded-md border border-accentDim/40 bg-accent/5 px-4 py-3.5" role="status">
      <h2 className="text-[13px] font-semibold text-ink">{booking.typeName} booked</h2>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-dim">{when}</p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        {booking.meetingUrl && (
          <a
            href={booking.meetingUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center rounded-sm bg-accent px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Join the call
          </a>
        )}
        <Link
          href={`/booking/${booking.publicToken}`}
          className="text-[12.5px] text-dim underline underline-offset-2 transition-colors hover:text-ink"
        >
          Reschedule or cancel
        </Link>
      </div>
    </div>
  );
}
