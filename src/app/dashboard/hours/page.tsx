import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { SectionTitle } from "@/components/hearth/ui";
import { checkAvailability, parseWeeklyHours } from "@/lib/hours";
import { HoursForm, ClosuresPanel } from "./HoursForm";

export const dynamic = "force-dynamic";

export default async function HoursPage() {
  const { restaurantId } = await requireOwner();

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    include: { closures: { orderBy: { startDate: "asc" } } },
  });
  if (!restaurant) notFound();

  const availability = checkAvailability(restaurant, new Date());
  const hours = parseWeeklyHours(restaurant.hoursJson);

  return (
    <>
      <SectionTitle
        title="Hours & availability"
        subtitle="The cheapest support ticket is the order you never took. This page is where that happens."
      />

      {/* Whatever else is on this page, an owner's first question is "am I
          taking orders right now?" — so it's answered before anything else. */}
      <div
        className={`mb-6 rounded-md border px-4 py-3 text-[13px] ${
          availability.ok
            ? "border-accent/30 bg-accent/5 text-accent"
            : "border-warn/30 bg-warn/5 text-warn"
        }`}
      >
        {availability.ok ? (
          <>
            Taking orders now
            {availability.minutesLeft != null && (
              <span className="text-dim">
                {" "}
                · {Math.floor(availability.minutesLeft / 60)}h {availability.minutesLeft % 60}m until
                close
              </span>
            )}
          </>
        ) : (
          <>
            Not taking orders — {availability.message}
            {availability.reopens && <span className="text-dim"> Back {availability.reopens}.</span>}
          </>
        )}
      </div>

      <HoursForm
        hours={hours}
        timezone={restaurant.timezone}
        prepMinutes={restaurant.prepMinutes}
        lastCallMins={restaurant.lastCallMins}
        autoExpireMins={restaurant.autoExpireMins}
        autoAccept={restaurant.autoAccept}
      />

      <div className="mt-4">
        <ClosuresPanel closures={restaurant.closures} />
      </div>
    </>
  );
}
