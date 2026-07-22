import Link from "next/link";
import { listBookingTypes } from "@/lib/bookings";

/**
 * "Book a call with us" — the escape hatch at the end of the support ladder.
 *
 * Reads the existing booking types rather than introducing a second calendar.
 * There is one slot engine (`lib/booking-slots.ts`) and one writer
 * (`lib/bookings.ts`), and a support-specific calendar alongside them would be
 * a second way to double-book the same hour of the same person — which the
 * database index in migration 30 prevents only because everything goes through
 * the one table.
 *
 * Renders nothing when no active type exists. That is the honest answer: this
 * codebase's recurring failure is a surface that looks finished and is wired to
 * something nobody set up, and a "Book a call" button leading to a calendar
 * with no availability is exactly that shape. Create a booking type in
 * `/admin/calendar` and the card appears on its own.
 */
export default async function BookACall() {
  const types = (await listBookingTypes()).filter((t) => t.active);
  if (types.length === 0) return null;

  return (
    <div className="rounded-sm border border-line bg-surface/40 px-5 py-4">
      <h3 className="text-[14px] font-semibold text-ink">Still stuck? Book a call.</h3>
      <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-dim">
        Some things are faster said than typed — a menu that won&apos;t import the way you want, a
        setup you&apos;d rather walk through with someone. Pick a time and we&apos;ll be there.
      </p>
      <div className="mt-3.5 flex flex-wrap gap-2">
        {types.map((t) => (
          <Link
            key={t.slug}
            href={`/book/${t.slug}`}
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-line2 bg-surface2 px-3.5 text-[13px] font-medium text-ink transition-colors hover:bg-surface"
          >
            {t.name}
            <span className="text-[11px] font-normal text-mute">{t.durationMins} min</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
