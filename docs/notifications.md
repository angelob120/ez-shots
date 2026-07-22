# Platform notifications

The admin notifications centre and the alert pipeline behind it. Read this
before touching `src/lib/notifications.ts`, `src/lib/notification-format.ts`, or
anything under `src/app/admin/notifications/`.

## What it is

A per-recipient inbox for platform events — a new order, a failed refund, a
booked call, a support ticket, an admin's hand-written announcement — plus the
delivery of those events off-platform over operator email and SMS, and the
per-user preferences that govern which channel each kind reaches.

Three surfaces, all under `/admin/notifications` behind URL-driven tabs:

- **Inbox** — the signed-in admin's notifications, newest first, mark-one/all-read.
- **Preferences** — a per-kind grid of in-app / email / SMS toggles.
- **Compose** — send an announcement to all owners or all admins, or set
  yourself a reminder surfaced at a chosen time.

A bell in the admin header carries the unread badge and links to the inbox. The
count is read in the admin *layout* so it's honest on every page, the same
reasoning as the payment-mode banner beside it.

## The shape, and why

**One row per recipient per event.** A "notify the admins" call fans out into
one `Notification` per admin `User` at creation time. Read/unread is then a
plain column on the row the reader owns, rather than a broadcast row plus a
join table of who's seen it that has to be kept in step. Admins are few and a
broadcast to owners is bounded, so the fan-out is cheap.

**One door.** `src/lib/notifications.ts` is the only module that writes a
`Notification`, sends an operator alert, or resolves preferences. The argument
is the same as `lib/sms.ts` and `lib/email.ts`: delivery is governed by the
recipient's saved preference, and a second path that wrote a row or sent an
email directly would be a second place for that preference to be almost right.
Everything raises alerts through `notify()`; nothing calls `sendOperatorEmail`
or `sendOperatorSms` for a notification on its own.

**The pure half is split out.** `src/lib/notification-format.ts` holds the kind
catalog (label, detail, default severity, default channels, group), the channel
resolver, and the badge/severity helpers. No `server-only`, no Prisma — because
the preferences form, the inbox and the bell all import it in the browser, and
the picture and the runtime must not disagree about which channels a kind
reaches. The enum in `schema.prisma` owns *which kinds exist*; the catalog owns
the strings and booleans a human reads and tunes. Same split as the onboarding
checklist and `lib/order-labels.ts`.

**Best-effort, always.** A `notify()` call must never break the flow that
raised it — a refund that succeeded must not report failure because the alert
email bounced. `notify()` swallows its own errors and logs. Callers wrap it in
nothing. Modules that are exercised by the pure tests without a database
(`lib/orders.ts`) reach `notify()` through a **lazy** `import()`, mirroring how
`fireTrigger` reaches `lib/automations.ts`, so a static server-only chain
doesn't get dragged into every module that touches an order.

## Preferences: absent row is the default

An absent `NotificationPref` row means "use the catalog default". A fresh
operator has sensible delivery with zero rows written, and only a deliberate
change persists. `resolveChannels(kind, pref)` returns the saved override when
one exists — **including when it turns a channel off that the default turns
on**, because the whole point of the row is to let someone mute an alert — and
the catalog default otherwise. The preferences form upserts *every* kind on
save, so unchecking a box persists as an off-row rather than silently reverting
to the default.

In-app is the floor: the catalog defaults it on for every kind. Email/SMS
default on only for the kinds worth interrupting someone who isn't logged in —
money and people waiting (failed refund, auto-reverted payment mode, a call
reminder). A menu submission can wait for the next visit.

## Operator email and SMS are not the customer doors

Operator alerts go out through `lib/operator-email.ts` and the new
`lib/operator-sms.ts`, **not** `lib/email.ts` / `lib/sms.ts`. An operator asking
to be alerted about their own platform is transactional — there is no
`Customer`, no `optInStatus`, no CAN-SPAM opt-out — and must never pass the
customer consent gate. Operator SMS goes out on the platform messaging service
(an empty tenant id makes Twilio's `senderFor` fall back to it) because the
platform is speaking, not a restaurant. Both are no-ops that log until their
provider is configured, the same "exercisable today, lights up when the wire is
connected" contract as the rest of the messaging in this repo.

SMS to an operator needs a number: `User.phone` (added in migration 39). Null
means "SMS alerts unavailable", so a notification whose resolved channel
includes SMS simply skips the wire for that recipient.

## Scheduled reminders

A notification with a future `scheduledFor` is a reminder: hidden from the inbox
and the unread count until its clock passes, and its email/SMS deferred until
then. In-app it surfaces on any page load once due (the list and count queries
filter `scheduledFor <= now`). The outbound send waits for the drain.

`drainScheduledNotifications()` (called from `scripts/sweep.ts`) claims each due
row by stamping `deliveredAt` in an atomic `updateMany` *before* any wire call,
so an overlapping drain can't double-send — the same optimistic-claim pattern as
the refund and message retries. `deliveredAt` marks "the outbound pass ran",
distinct from `emailedAt`/`smsedAt` (which stay null on a kind the recipient
gets in-app only), so a re-drain can tell "not yet processed" from "processed,
email not wanted". **Like everything else in the sweep, this is inert until the
Railway cron exists** — see `docs/post-order-gaps.md`.

## Dedupe

`dedupeKey` collapses duplicates per recipient: the same key twice to the same
user is dropped by a partial unique index on `(userId, dedupeKey) WHERE
dedupeKey IS NOT NULL`, in the migration rather than the schema (Prisma can't
express the `WHERE`). Pass something stable and event-scoped — `order:${id}`,
`ticket:${id}`, `refund-failed:${refundId}`. The `notify()` path treats the
resulting `P2002` as the dedupe working, not an error.

## Wired event sources

Raised today, each best-effort at the point the event commits:

| Kind | Where | Audience |
|---|---|---|
| `ORDER_PLACED` | `placeOrderAction` (after the paid order) | the tenant's owners |
| `REFUND_FAILED` | `issueRefund` failure branch (`lib/orders.ts`) | admins, URGENT |
| `SUPPORT_TICKET` | `createTicket` (`lib/support.ts`) | admins |
| `CONTACT_FORM` | contact submission (`lib/support.ts`) | admins |
| `BOOKING_CREATED` + `BOOKING_REMINDER` | `createBooking` / `createAdminBooking` | admins |
| `NEW_OPERATOR` | `redeemInvite` (`lib/invites.ts`) | admins |
| `BROADCAST` / `REMINDER` | the Compose tab | chosen audience |

Kinds defined but not yet wired: `MENU_SUBMISSION`, `SERVICE_SUSPENDED`,
`PAYMENT_MODE_REVERTED`, `PLAN_CHANGED`. They exist in the catalog and
preferences so the plumbing is ready; adding the `notify()` call at each source
is the remaining work.

## What still has to happen on a real machine

The familiar shape for this repo — written, typechecked, tested, and nothing
has run it yet:

1. **`npx prisma generate && npm run db:push`.** Migration `39_admin_notifications`
   is idempotent and has never run. Until it does, the generated client is
   missing `prisma.notification`, `prisma.notificationPref` and `User.phone`, so
   the notifications page and the bell throw. (This is also why the filtered
   `tsc` shows one stub artifact in `PrefsTab.tsx` — it clears after generate.)
2. **The Railway cron** for `drainScheduledNotifications`. Same second service
   as everything else queued behind it; see `docs/deploy-sweep.md`.
3. **SendGrid and Twilio** for the outbound channels. Configured via
   `SENDGRID_API_KEY` / `EMAIL_FROM` and `SMS_PROVIDER=twilio` + credentials.
   Until then, in-app works fully and email/SMS log the payload.

## Tests

`scripts/notifications.test.ts` — 12 cases over the pure half: catalog
completeness (every enum member has a spec and appears in `KIND_ORDER` once — a
missing entry is a kind whose alert never sends and nothing throws), channel
resolution (a saved off-pref beats an on-default; the result is a copy, not the
shared catalog object), and severity mapping. The sending door itself is
untested, the same gap the other `lib/*` writers carry.
