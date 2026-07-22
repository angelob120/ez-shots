import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { availableSlots, bookingTypeBySlug } from "@/lib/bookings";
import { countSlots } from "@/lib/booking-slots";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import BookingForm from "./BookingForm";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const type = await bookingTypeBySlug(params.slug);
  if (!type) return { title: "Book a call - EZ Orders" };
  return {
    title: `${type.name} - EZ Orders`,
    description: type.blurb ?? "Book a time to talk to the person who builds the thing.",
  };
}

/**
 * The booking page.
 *
 * Server-rendered slots, one small client component to relabel them in the
 * visitor's timezone. Everything else — the copy, the day tabs, the empty
 * state — is plain markup, which matters here more than on most pages: this is
 * the first thing a restaurant owner who found us through a Google result ever
 * loads, often on a phone in a kitchen.
 *
 * An owner who is signed in gets their details prefilled and their booking
 * linked to their tenant. That link is what makes the dashboard banner work,
 * and it is made from the **session**, never from the page — see actions.ts.
 */
export default async function BookPage({ params }: { params: { slug: string } }) {
  const type = await bookingTypeBySlug(params.slug);
  if (!type) notFound();

  const days = await availableSlots(type);
  const total = countSlots(days);

  // Prefill for a signed-in owner. Best effort: a stranger sees empty fields,
  // which is the common case and fine.
  const session = await getSession();
  const restaurant = session?.restaurantId
    ? await prisma.restaurant.findUnique({
        where: { id: session.restaurantId },
        select: { name: true, phone: true },
      })
    : null;
  const prefillEmail = session?.email ?? null;

  const wire = days.map((d) => ({
    date: d.date,
    slots: d.slots.map((s) => s.startsAt.toISOString()),
  }));

  return (
    <section>
      <div className="mx-auto max-w-[760px] px-6 py-16">
        <div className="flex items-center gap-2.5">
          <span className="h-px w-6 bg-accentDim" />
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
            {type.durationMins} minutes
          </span>
        </div>

        <h1 className="mt-4 text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[44px]">
          {type.name}
        </h1>

        {type.blurb && (
          <p className="mt-4 max-w-[560px] text-[16px] leading-relaxed text-dim">{type.blurb}</p>
        )}

        <div className="mt-10 rounded-md border border-line bg-surface p-6">
          <BookingForm
            typeSlug={type.slug}
            days={wire}
            hostTimezone={type.timezone}
            restaurantId={session?.restaurantId ?? null}
            prefill={{ name: restaurant?.name ?? null, email: prefillEmail, phone: restaurant?.phone ?? null }}
          />
        </div>

        {total === 0 && (
          <p className="mt-6 text-[13px] text-dim">
            Nothing on the calendar?{" "}
            <Link href="/contact" className="text-accent underline underline-offset-2">
              Send a message
            </Link>{" "}
            and we&apos;ll sort a time out directly.
          </p>
        )}

        <p className="mt-8 text-[12px] leading-relaxed text-dim">
          You&apos;ll get a link to reschedule or cancel as soon as you book. No account needed.
        </p>
      </div>
    </section>
  );
}
