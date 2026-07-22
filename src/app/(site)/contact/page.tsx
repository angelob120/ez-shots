import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "./ContactForm";
import BookingForm from "../book/[slug]/BookingForm";
import { availableSlots, bookingTypeBySlug } from "@/lib/bookings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Contact - EZ Orders",
  description:
    "Questions about pricing, moving your menu over, or whether this fits your restaurant. A person reads every message.",
};

/**
 * Answers to the things people ask before they'll fill in a form. Each one is
 * a reason not to send a message — which is the point: a contact page that
 * converts every visitor into an enquiry is a contact page generating work
 * that a paragraph could have handled.
 */
const ANSWERS: Array<[string, string]> = [
  [
    "How long does it take to go live?",
    "Most restaurants are taking orders the same week. If you send a menu we'll load it for you rather than leaving you to type it in.",
  ],
  [
    "Do I need to change my card processor?",
    "No. Payments run on your own Stripe account and payouts land where they already do. Nothing routes through us.",
  ],
  [
    "What does it cost?",
    "Nothing per month on the plan almost everyone picks — a small service fee rides on the customer's ticket instead. The other two plans are on the pricing page.",
  ],
  [
    "I'm already a customer and something is broken.",
    "Log in and use the Support tab on your dashboard. Tickets filed there arrive attached to your account and your order history, which is quite a lot faster than starting from scratch here.",
  ],
];

export default async function ContactPage() {
  // The intro call, rendered inline. Best effort: if the type is missing or has
  // no availability set, the section simply doesn't render and the page is the
  // message form it always was. That degradation matters — this is the most
  // linked-to page on the marketing site and it must not depend on a calendar
  // being configured.
  const chatType = await bookingTypeBySlug("chat");
  const chatDays = chatType ? await availableSlots(chatType) : [];
  const wireDays = chatDays.map((d) => ({
    date: d.date,
    slots: d.slots.map((s) => s.startsAt.toISOString()),
  }));

  return (
    <>
      <section className="border-b border-line">
        <div className="mx-auto max-w-[1140px] px-6 py-20">
          <div className="flex items-center gap-2.5">
            <span className="h-px w-6 bg-accentDim" />
            <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-accent">
              Contact
            </span>
          </div>
          <h1 className="mt-4 max-w-[720px] text-[40px] font-semibold leading-[1.05] tracking-[-0.03em] text-ink sm:text-[52px]">
            Talk to the person who
            <br />
            <span className="text-accent">builds the thing.</span>
          </h1>
          <p className="mt-5 max-w-[560px] text-[16px] leading-relaxed text-dim">
            There&apos;s no support tier and no queue to escalate through. Send a message and
            you&apos;ll get an answer from someone who can actually change the product.
          </p>
        </div>
      </section>

      {/* Booking above the message form, and inline rather than behind a link.
          Somebody on this page is deciding whether to talk to us; a booked call
          gets an answer in minutes where a message waits on a reply. The form
          stays below in full, because plenty of people would rather write than
          meet — and because an empty calendar has to degrade to something.

          Rendered only when there are actually times going. A picker that says
          "no times available" as the first thing on the contact page reads as a
          company that isn't taking enquiries. */}
      {chatType && wireDays.length > 0 && (
        <section id="book" className="border-b border-line">
          <div className="mx-auto max-w-[1140px] px-6 py-16">
            <div className="max-w-[560px]">
              <h2 className="text-[22px] font-semibold tracking-[-0.02em] text-ink">
                Book {chatType.durationMins} minutes
              </h2>
              <p className="mt-2 text-[14px] leading-relaxed text-dim">
                {chatType.blurb ??
                  "No pitch. Tell us what you're running and we'll tell you straight whether this is a fit."}
              </p>
            </div>

            <div className="mt-8 max-w-[760px] rounded-md border border-line bg-surface p-6">
              <BookingForm
                typeSlug={chatType.slug}
                days={wireDays}
                hostTimezone={chatType.timezone}
              />
            </div>
          </div>
        </section>
      )}

      <section className="border-b border-line">
        <div className="mx-auto grid max-w-[1140px] gap-14 px-6 py-16 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <h2 className="mb-6 text-[22px] font-semibold tracking-[-0.02em] text-ink">
              Send a message
            </h2>
            <ContactForm />
          </div>

          <div>
            <h2 className="mb-6 text-[22px] font-semibold tracking-[-0.02em] text-ink">
              Probably already answered
            </h2>
            <dl className="space-y-6">
              {ANSWERS.map(([q, a]) => (
                <div key={q}>
                  <dt className="text-[14px] font-medium text-ink">{q}</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-relaxed text-dim">{a}</dd>
                </div>
              ))}
            </dl>

            {/* Points back up at the inline picker when one rendered, and at
                the standalone page when it didn't — so the offer to talk
                survives an unconfigured calendar instead of vanishing with it. */}
            <div className="mt-8 rounded-md border border-accentDim/40 bg-accent/5 p-5">
              <div className="text-[13px] font-medium text-ink">Rather just talk?</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Ten minutes, no pitch. Pick a time that suits and we&apos;ll tell you straight
                whether this fits what you&apos;re running.
              </p>
              <Link
                href={wireDays.length > 0 ? "#book" : "/book/chat"}
                className="mt-3 inline-flex h-9 items-center rounded-sm bg-accent px-4 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              >
                Book a 10 minute call
              </Link>
            </div>

            <div className="mt-4 rounded-md border border-line bg-surface p-5">
              <div className="text-[13px] font-medium text-ink">Already have an account?</div>
              <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
                Support tickets from your dashboard reach us with your restaurant, menu, and order
                history attached.
              </p>
              <Link
                href="/login"
                className="mt-3 inline-flex h-9 items-center rounded-sm border border-line2 px-4 text-[13px] text-ink transition-colors hover:bg-surface2"
              >
                Log in
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-[1140px] px-6 py-16 text-center">
          <p className="text-[14px] text-dim">
            Would rather just read the numbers first?{" "}
            <Link href="/pricing" className="text-accent hover:underline">
              See pricing
            </Link>
            .
          </p>
        </div>
      </section>
    </>
  );
}
