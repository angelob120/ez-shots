# The booking calendar

Working plan for booked calls — the onboarding call an owner books during
setup, and the intro call a stranger books from `/contact`. **Read this before
touching `src/lib/booking-slots.ts`, `src/lib/bookings.ts`, or anything under
`src/app/(site)/book/`.**

---

## What exists

| Piece | Where |
|---|---|
| Slot engine (pure) | `src/lib/booking-slots.ts` |
| The one door (Prisma) | `src/lib/bookings.ts` |
| Public picker | `/book/[slug]` — seeded slugs are `setup` and `chat` |
| Inline picker | `/contact` renders the `chat` type directly, above the message form |
| Confirmation / manage | `/booking/[token]` — the token is the auth |
| Admin calendar | `/admin/calendar` — Upcoming, Past, Add a call, Availability |
| Owner banner | `components/hearth/SetupCallBanner.tsx`, in the dashboard layout |
| Onboarding prompt | Step 5 of the wizard, outside the gate |
| Tests | `scripts/booking-slots.test.ts` — 44 cases |
| Migration | `prisma/migrations/30_booking_calendar/` |

Two `BookingType` rows are seeded by the migration: a 20-minute **Setup call**
(`/book/setup`) and a 10-minute **Quick chat** (`/book/chat`). Both ship with
**no availability**, which means both hand out zero slots until someone sets
windows on `/admin/calendar?tab=availability`. That is the safe direction — see
below.

---

## Why this isn't TidyCal

The first cut of this was going to be a TidyCal link plus Zapier. It was
replaced before any of it was written, for one reason: **the calendar has to
know about tenants.**

An onboarding call belongs to a restaurant. It shows on that owner's dashboard,
it lingers until the call has been *attended*, and it stops on its own when it
has. None of that is reachable from an external scheduler without a sync job,
and TidyCal has no webhooks — so that job would have been polling, and a polled
calendar is wrong for however long the interval is. The visible failure would
have been an owner staring at "book your setup call" for a call they had
yesterday, or worse, a booking the product never heard about.

**Reminders are still going out through Zapier and that's the right split.**
*Who booked what* is product state and lives here. *Text them an hour before*
is plumbing and doesn't need to.

---

## Decisions worth not re-litigating

**The slot engine fails closed, and `lib/hours.ts` fails open.** They share the
`WeeklyHours` type and the same parser, so this looks like an inconsistency and
is the single most load-bearing line in `booking-slots.ts`. A restaurant with
no schedule keeps trading, because switching off every tenant that never
touched the setting is worse than one 3am order. A *calendar* with no schedule
must hand out nothing, because the alternative is a stranger booking 4am on a
Sunday and nobody turning up. `scripts/booking-slots.test.ts` asserts the
fail-closed direction in four cases specifically so that "making it consistent"
turns something red.

**The call never blocks launch.** Not in `lib/onboarding.ts`, not in
`blockingSteps`, not anywhere. The gate module does not know bookings exist.
The other required steps are things an owner can finish alone at 11pm; a call
needs *us*, and we are asleep or booked out. A restaurant that finished its
menu on Sunday should not wait until Tuesday to open for reasons that have
nothing to do with them being ready.

**The banner keys off `ATTENDED`, not off a booking existing.** A booked call
nobody turned up to has onboarded nobody. Going quiet at booking time would
hide exactly the tenants most worth chasing. This is also why the admin
calendar shouts about calls that finished unmarked — an unmarked past call is
the calendar's failed refund: a number that should be zero, and a growing one
means the record of who actually got onboarded has stopped being true.

**Nothing is dismissable.** Same rule as `SetupGaps`. A dismiss button on "you
haven't booked your setup call" removes the knowledge, not the problem.

**The double-booking race is closed by the database, not by the check.**
`isSlotBookable` runs before every insert and is the *courtesy* — it produces a
decent message in the common case. What actually prevents two people taking the
same 2pm is the **partial unique index** on `(typeId, startsAt) WHERE status =
'SCHEDULED'` in migration 30. `createBooking` catches P2002 and turns it into
`slot_taken`. **Do not delete the index because the pre-check looks
sufficient** — that read is stale the moment it returns, which is the same bug
class the optimistic locks in `lib/orders.ts` exist for.

The index has to be *partial*: a canceled 2pm must leave 2pm bookable, and a
plain unique constraint would burn the slot permanently on the first
cancellation. Prisma can't express a `WHERE` on a unique index, so it lives in
the migration and not in `schema.prisma` — the same arrangement as
`ServiceSuspension`.

**There are two creation doors, and only one of them checks availability.**
`createBooking` is the public one and enforces the grid — it has to, or the
grid means nothing. `createAdminBooking` deliberately does **not**: it exists
for the call already agreed on the phone, in an email, or at 7pm on a Saturday
as a favour, and every one of those is a time the grid would refuse. Making an
admin pick from the same slots a stranger sees would mean the calendar can only
record calls the calendar would have offered, which is backwards — the grid is
a convenience for people we don't know, and the admin is the authority.

What the admin door does *not* override is the double-booking guard. A clash
comes back as `slot_taken` for an admin exactly as it does for a stranger,
because that isn't a policy, it's the host being in two places at once. A time
outside the usual hours is allowed and **flagged afterwards** (`outsideAvailability`),
since the commonest way to land out there is a mistyped date rather than a
deliberate favour.

Admin-created bookings carry `source: "admin"` and are badged as such. A call
typed in by hand should not look like a self-serve one when the funnel gets
counted.

**The contact page renders the picker inline, and degrades to the message
form.** Booking sits above the form because a booked call gets an answer in
minutes where a message waits on a reply. But the section only renders when
there are *actually* times going — a picker announcing "no times available" as
the first thing on the contact page reads as a company that isn't taking
enquiries, which is worse than not offering. The standalone `/book/chat` stays
as the fallback link. This is the most linked-to page on the marketing site and
it must not depend on the calendar being configured.

**Cancelling sets a status, it never deletes.** That's what frees the slot,
since the index only counts SCHEDULED rows, and it's what lets the calendar
distinguish "they cancelled" from "they never booked".

**`busyBetween` is not scoped to a booking type.** There is one host. A 2pm
sales call blocks the 2pm setup call exactly as thoroughly as another setup
call would, and scoping the conflict check to `typeId` would let the two
bookable types double-book each other. Note this makes the unique index a
*narrower* guard than the function — the index only catches same-type
collisions. A cross-type double-book remains possible in the width of one
transaction; see "What's left".

**`restaurantId` comes from the session, never from the form.** It's in the
markup as a hidden field only so the form shape is identical in both places,
and `createBookingAction` ignores it. A hidden field is a text box anybody can
edit, and honouring one would let a stranger attach their booking — name, email,
phone — to somebody else's dashboard banner. This is the same class of rule as
`/api/track` taking a slug rather than a `restaurantId`.

**The one exception is the admin form, and it is the same exception analytics
already makes.** `createAdminBookingAction` *does* read `restaurantId` from its
form, because attaching a call to any tenant is the whole job of that page and
it is reachable only after `requireAdmin()`. That's exactly the shape of
`/api/analytics/csv` taking a `restaurant=<id>` only behind the role check. The
rule is not "never read a tenant id from a request" — it's "never read one from
a request that a stranger can make".

**The booking page is unauthenticated, and that's the point.** It's the second
public writer in the product after `ContactSubmission`. A stranger who has
never signed up has to be able to book, or `/contact` has nothing to offer
them.

**`/booking/[token]` is the auth, exactly like `/o/[token]`.** 160 bits from
the CSPRNG. Requiring an account to cancel would convert cancellations into
no-shows, which cost the host the slot *and* the wait. It's `noindex`, because
the URL is the only thing protecting a real person's contact details.

**Slots render in the host's zone server-side and the browser relabels them.**
`Intl` on the server reports UTC on Railway, which is nobody's zone, so the
server cannot know where the visitor is. The consequence is a brief flash of
host-zone times before hydration corrects them, and that's deliberate — a
booker who sees "2:00 PM EDT" for a moment has lost nothing, where one staring
at a spinner on a page whose whole job is to be quick has. The times carry
`suppressHydrationWarning` because server and client are *supposed* to
disagree there.

The admin calendar, by contrast, prints everything in the **host's** zone and
labels it. A calendar showing each booking in its own booker's zone is a list
of times that can't be compared to each other.

---

## What's left

1. **`npx prisma generate && npm run db:push` on a real machine.** Migration
   `30_booking_calendar` has never run. `prisma.booking` and
   `prisma.bookingType` do not exist in the generated client until it does, so
   **every page listed above throws** — the dashboard layout included, because
   the banner query runs in it. This is the biggest blast radius of any
   un-run migration in the repo so far. P0.

2. **Availability has never been set.** Both seeded types have
   `availabilityJson` null and therefore offer nothing. `/book/setup` and
   `/book/chat` render "No times available" until someone fills in the grid at
   `/admin/calendar?tab=availability`, and the onboarding banner links to a
   page that can't be booked. Neither is a bug; both look exactly like one.
   **This is the first thing to do after the migration runs.** P0.

3. **A meeting URL has never been set.** With none, the confirmation page says
   "we'll email you a link" and no email is sent, because nothing here sends
   anything yet — see 4. Set a static Zoom or Meet room on both types in the
   same visit as 2. P1.

4. **Nothing emails anybody.** No confirmation, no reminder, no notice to the
   host that a booking arrived. `lib/email.ts` is the one door and this
   feature does not call it. Today the only way to find out someone booked is
   to open `/admin/calendar`. The confirmation is the gap that will actually
   cost bookings — a booker who closes the tab has lost the only link to their
   booking. **P1, and the largest piece of work left.** Note the copy on
   `/booking/[token]` already promises an email; that promise is currently
   false.

5. **No reschedule.** "Pick a different time" links back to the picker and
   makes a second booking; nothing cancels the first. That leaves two live
   bookings and a slot burned. Either wire the link to cancel-then-rebook or
   change the copy. P1 — this is a real defect, not a missing nicety.

6. **The cross-type race.** `busyBetween` checks every type; the unique index
   only guards one. Two strangers booking different call types at the same
   instant, in the width of one transaction, can both land. One host, two
   bookable types, low volume — worth knowing, not worth a table lock. P3.

7. **One window per day in the form.** The data model supports several per day
   and the parser reads them; `AvailabilityForm` only writes the first, because
   the multi-window version needs add/remove buttons and client state. Nothing
   has to migrate when it's built. P3.

8. **`bookerTimezone` is recorded and barely used.** It's printed on the admin
   calendar when it differs from the host's and used on the confirmation page.
   It should be what a reminder email speaks in. Waiting on 4. P3.

9. **No rate limit on `createBookingAction`.** It's a public writer that
   creates rows. `ContactSubmission` has a throttle and a honeypot; this has
   neither. The blast radius is smaller — bookings collide with each other, so
   a flood mostly fills a finite grid rather than growing unboundedly — but it
   can still fill the calendar. P2.

10. **`createAdminBooking` has no test.** It's the one writer that skips the
    availability check, which makes the *other* guard — the conflict refusal —
    the only thing between it and a double-booked host. That branch deserves
    the same treatment `scripts/orders.concurrency.test.ts` gave refunds. P2.

11. **Zapier reminders.** The deliberate external piece. Nothing to build here
    beyond deciding whether Zapier reads the database or a future webhook. P2.
