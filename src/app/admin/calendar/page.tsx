import Link from "next/link";
import { Badge, Card, Empty, SectionTitle, cx } from "@/components/hearth/ui";
import { requireAdmin } from "@/lib/auth";
import { calendarBetween, listBookingTypes, bookingCounts, type CalendarEntry } from "@/lib/bookings";
import { prisma } from "@/lib/prisma";
import { formatFullInZone } from "@/lib/booking-slots";
import CalendarTabs, { type CalendarTab } from "./CalendarTabs";
import AvailabilityForm from "./AvailabilityForm";
import NewBookingForm from "./NewBookingForm";
import { adminCancelBookingAction, markOutcomeAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Who booked, when, and how it went.
 *
 * Three tabs on one page for the same reason `/admin/support` has three: they
 * are one job. "What's coming up", "what happened", and "when am I available"
 * split across three nav entries means two of them are pages nobody opens, and
 * the availability grid is the one that most needs to be found — an empty
 * calendar hands out no slots and looks, from the outside, exactly like a
 * booking page that's broken.
 *
 * Every time on this page is printed in the **host's** zone, labelled. An
 * admin calendar showing each booking in the booker's own zone would be a list
 * of times that can't be compared to each other, which is the one thing a
 * calendar has to do.
 */

const SUBTITLES: Record<CalendarTab, string> = {
  upcoming: "Calls booked, soonest first. Times in your timezone.",
  past: "Calls that have happened. Mark how they went — an unmarked one reads as a call nobody had.",
  new: "Write down a call agreed somewhere else. Your availability grid doesn't apply here.",
  availability: "When people can book you, and how long each kind of call runs.",
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: { tab?: string; err?: string; note?: string };
}) {
  await requireAdmin();

  const tab = (["upcoming", "past", "new", "availability"].includes(searchParams.tab ?? "")
    ? searchParams.tab
    : "upcoming") as CalendarTab;

  const types = await listBookingTypes();
  const counts = await bookingCounts();

  // The host's zone comes from the types. They can in principle disagree; the
  // first active one wins, because a header that says two timezones is worse
  // than one that occasionally says the wrong single one.
  const hostZone = types.find((t) => t.active)?.timezone ?? types[0]?.timezone ?? "America/New_York";

  const now = new Date();

  return (
    <>
      <SectionTitle title="Calendar" subtitle={SUBTITLES[tab]} />

      <CalendarTabs tab={tab} counts={{ upcoming: counts.upcoming, past: counts.unattended }} />

      {/* Calls that finished and were never marked. The calendar's equivalent
          of a failed refund: a small number that should be zero, and a growing
          one means the record of who actually got onboarded has quietly
          stopped being true. Shown on every tab, like the support counts. */}
      {counts.unattended > 0 && tab !== "past" && (
        <div className="mb-6 rounded-md border border-warnLine bg-warnBg px-4 py-3" role="status">
          <p className="text-[12.5px] text-warnInk">
            {counts.unattended} {counts.unattended === 1 ? "call has" : "calls have"} finished
            without being marked attended or no-show.{" "}
            <Link href="/admin/calendar?tab=past" className="font-medium underline underline-offset-2">
              Clear them
            </Link>
          </p>
        </div>
      )}

      {/* A booking that landed outside the usual hours. Not an error — it was
          made — but the commonest way to get here is a mistyped date, so it
          gets said once rather than silently. */}
      {searchParams.note === "outside" && (
        <div className="mb-6 rounded-md border border-warnLine bg-warnBg px-4 py-3" role="status">
          <p className="text-[12.5px] text-warnInk">
            Added — but that time is outside your usual availability. Worth a second look if you
            didn&apos;t mean it.
          </p>
        </div>
      )}

      {tab === "new" && (
        <NewBookingForm
          types={types}
          error={searchParams.err}
          restaurants={await prisma.restaurant.findMany({
            orderBy: { name: "asc" },
            select: { id: true, name: true },
          })}
        />
      )}

      {tab === "availability" && (
        <div className="space-y-6">
          {types.length === 0 ? (
            <Empty
              title="No bookable call types"
              body="Migration 30 seeds two. If this is empty, it hasn't run."
            />
          ) : (
            types.map((t) => <AvailabilityForm key={t.id} type={t} />)
          )}
        </div>
      )}

      {tab === "upcoming" && (
        <BookingList
          entries={await calendarBetween(now, new Date(now.getTime() + 120 * 86_400_000))}
          hostZone={hostZone}
          empty="Nothing booked. If that's a surprise, check the Availability tab — a calendar with no windows hands out no slots."
          showOutcome={false}
        />
      )}

      {tab === "past" && (
        <BookingList
          entries={(
            await calendarBetween(new Date(now.getTime() - 180 * 86_400_000), now, {
              includeCanceled: true,
            })
          ).reverse()}
          hostZone={hostZone}
          empty="No calls yet."
          showOutcome
        />
      )}
    </>
  );
}

function BookingList({
  entries,
  hostZone,
  empty,
  showOutcome,
}: {
  entries: CalendarEntry[];
  hostZone: string;
  empty: string;
  showOutcome: boolean;
}) {
  if (entries.length === 0) return <Empty title="Nothing here" body={empty} />;

  return (
    <div className="space-y-3">
      {entries.map((e) => {
        const unmarked = showOutcome && e.status === "SCHEDULED";
        return (
          <Card key={e.id}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-ink">{e.name}</span>
                  <Badge tone={e.typeSlug === "setup" ? "good" : "neutral"}>{e.typeName}</Badge>
                  {e.status === "CANCELED" && <Badge tone="neutral">Canceled</Badge>}
                  {e.status === "ATTENDED" && <Badge tone="good">Attended</Badge>}
                  {e.status === "NO_SHOW" && <Badge tone="warn">No-show</Badge>}
                  {e.source === "admin" && <Badge tone="neutral">Entered by hand</Badge>}
                </div>

                <p className="mt-1 text-[13px] text-ink">{formatFullInZone(e.startsAt, hostZone)}</p>

                <p className="mt-1 text-[12px] text-dim">
                  {e.email}
                  {e.phone && ` · ${e.phone}`}
                  {/* The zone they booked in. Worth printing: it's the
                      difference between "they're an hour away" and "they're
                      calling from three timezones over at 6am their time". */}
                  {e.bookerTimezone && e.bookerTimezone !== hostZone && ` · ${e.bookerTimezone}`}
                </p>

                {/* An unattached booking is a lead, not an error. Shown as
                    unattached rather than hidden — see calendarBetween. */}
                <p className="mt-1.5 text-[12px]">
                  {e.restaurant ? (
                    <Link
                      href={`/admin/restaurants/${e.restaurant.id}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {e.restaurant.name}
                    </Link>
                  ) : (
                    <span className="text-mute">No account yet — from the contact page</span>
                  )}
                  {e.restaurant && !e.restaurant.onboardedAt && (
                    <span className="ml-2 text-warn">not launched</span>
                  )}
                </p>

                {e.note && (
                  <p className="mt-2 max-w-[560px] whitespace-pre-wrap rounded-sm bg-surface2 px-3 py-2 text-[12.5px] leading-relaxed text-dim">
                    {e.note}
                  </p>
                )}
              </div>

              <div className="flex shrink-0 flex-col items-end gap-2">
                {e.meetingUrl && e.status === "SCHEDULED" && (
                  <a
                    href={e.meetingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center rounded-sm bg-accent px-3.5 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90"
                  >
                    Join
                  </a>
                )}

                {unmarked && (
                  <div className="flex items-center gap-2">
                    <form action={markOutcomeAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="outcome" value="ATTENDED" />
                      <button className="rounded-sm border border-line2 px-2.5 py-1 text-[12px] text-dim transition-colors hover:text-ink">
                        Attended
                      </button>
                    </form>
                    <form action={markOutcomeAction}>
                      <input type="hidden" name="id" value={e.id} />
                      <input type="hidden" name="outcome" value="NO_SHOW" />
                      <button className="rounded-sm border border-line2 px-2.5 py-1 text-[12px] text-dim transition-colors hover:text-warn">
                        No-show
                      </button>
                    </form>
                  </div>
                )}

                {!showOutcome && e.status === "SCHEDULED" && (
                  <form action={adminCancelBookingAction}>
                    <input type="hidden" name="id" value={e.id} />
                    <button className="text-[12px] text-dim underline underline-offset-2 transition-colors hover:text-danger">
                      Cancel
                    </button>
                  </form>
                )}

                <Link
                  href={`/booking/${e.publicToken}`}
                  className={cx("text-[11.5px] text-mute underline underline-offset-2 hover:text-dim")}
                >
                  Their view
                </Link>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
