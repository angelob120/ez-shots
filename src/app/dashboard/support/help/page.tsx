import Link from "next/link";
import { requireOwner } from "@/lib/auth";
import { SectionTitle } from "@/components/hearth/ui";
import HelpBrowser from "./HelpBrowser";
import BookACall from "../BookACall";

export const dynamic = "force-dynamic";

/**
 * The owner help centre.
 *
 * Behind `requireOwner()` like the rest of the dashboard. The articles contain
 * no tenant data and would be safe to serve publicly, but a public copy would
 * be a second surface to keep in step and the audience is owners either way.
 *
 * The page is a ladder, deliberately in this order: search the answers, then
 * ask us in writing, then book a call. Each rung is more of our time than the
 * one above it, and the point of the top rung is that the bottom two get used
 * for the things that actually need a person.
 */
export default async function HelpCenterPage() {
  await requireOwner();

  return (
    <>
      <SectionTitle
        title="Help"
        subtitle="The answers to the things owners ask most. If none of it fits, the bottom of this page has a person on it."
        action={
          <Link
            href="/dashboard/support"
            className="inline-flex h-9 items-center rounded-sm border border-line2 bg-surface2 px-3.5 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Your tickets
          </Link>
        }
      />

      <HelpBrowser />

      <div className="mt-8 space-y-4">
        <div className="rounded-sm border border-line px-5 py-4">
          <h3 className="text-[14px] font-semibold text-ink">Didn&apos;t find it?</h3>
          <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-dim">
            File a ticket and it goes straight to a person. If an order is involved, include the
            order number — it lets us read the exact timeline of what the system did, which is
            usually the difference between an answer today and a conversation. If money is
            involved, say so and mark it urgent.
          </p>
          <Link
            href="/dashboard/support"
            className="mt-3.5 inline-flex h-9 items-center rounded-sm border border-line2 bg-surface2 px-3.5 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Open a ticket
          </Link>
        </div>

        <BookACall />
      </div>
    </>
  );
}
