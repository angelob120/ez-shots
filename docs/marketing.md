# Marketing campaigns — SMS and email

**Read this before touching `src/lib/campaigns.ts`, `src/lib/campaign-format.ts`,
`src/lib/email*.ts`, or anything under `src/app/dashboard/marketing/`.**

An owner writes one message, picks an audience, and sends it as a text or an
email. That's the whole feature. Everything below is the reasoning that keeps it
from becoming a spam cannon that gets a tenant's phone number carrier-filtered
and our sending domain blocklisted.

---

## The one rule

**Building an audience is not obtaining consent.**

`lib/customers.ts` already says this. It is restated in `lib/campaigns.ts` and
again here because this is the feature where breaking it is most convenient and
most tempting — the audience builder and the send button are on the same screen.

- An **audience** decides who is *considered*.
- `lib/sms.ts` and `lib/email.ts` decide who is *contacted*. They read consent
  columns and nothing else.

The visible consequence: a campaign aimed at 400 customers routinely reaches 90
over SMS. **That gap is the feature working.** The campaign detail page shows the
breakdown with a human sentence per reason, precisely so nobody — owner or
engineer — is tempted to "fix" it by loosening the gate.

---

## Email is opt-out. SMS is opt-in. Do not unify them.

This is the asymmetry a future session is most likely to tidy up, so it gets its
own section.

| | SMS | Email |
|---|---|---|
| Column | `optInStatus` enum, starts `UNKNOWN` | `emailOptOutAt` timestamp, starts null |
| Default | may not contact | may contact |
| Law | TCPA — prior express written consent required | CAN-SPAM — no prior consent required |
| Who can grant it | checkout only, never an import | n/a |
| Blocks transactional too? | **Yes** | No |

Why they differ:

- Texting without consent is a TCPA violation with statutory damages per
  message, and the *operational* punishment lands first: carriers filter the
  sending number and the tenant's order-ready texts stop arriving too.
- CAN-SPAM requires honest headers, a physical postal address and a working
  unsubscribe honoured promptly. It does not require prior consent. A restaurant
  emailing its own customer list is the ordinary, legal case.

Unifying them is wrong in **both** directions: opt-in for email guts the channel
on day one for exactly the tenants with the biggest lists, and opt-out for SMS
is illegal.

One more consequence worth stating: an email unsubscribe deliberately does *not*
touch `optInStatus`. Killing somebody's order-ready texts because they didn't
want a newsletter is a worse outcome than the one they asked to avoid.

---

## Structure

| File | What it is |
|---|---|
| `lib/campaign-format.ts` | **Pure.** Status machine, segment arithmetic, merge fields, validator, skip-reason labels. No Prisma, no `server-only` — the composer imports it in the browser. |
| `lib/campaigns.ts` | `server-only`. Audience resolution, CRUD, launch, cancel, drain, counters. Re-exports all of the above so server callers have one import. |
| `lib/email.ts` | The email door. Consent gate, sender identity, rendering, unsubscribe tokens. Mirrors `lib/sms.ts`. |
| `lib/email-sendgrid.ts` | SendGrid behind the provider seam. Nothing here decides whether to send. |
| `app/u/[token]` | The public unsubscribe page. |
| `app/dashboard/marketing/` | Owner UI: list, composer, detail/results, sender settings. |

The split between the first two exists for the browser's sake. The composer has
to show the segment count as the owner types — an SMS cost revealed only after
sending is not a cost anybody can act on — and a `server-only` import in a
client component is a build error. It pays a second time in tests:
`scripts/campaigns.test.ts` is 42 cases with no database and no Prisma stub.

---

## Journeys are a separate document

A campaign is one message sent once. An **automation** is a standing
instruction — trigger, wait, condition, send — and it lives in
`docs/automations.md` with its own module, its own tables and its own builder.
What it does *not* have is its own sending path: a journey's SEND block calls
`queueMessage` / `queueEmail` exactly as a campaign does, and inherits the same
gate, the same outbox and the same skip reasons. Everything in this file
applies there too.

---

## Decisions not to re-litigate

### There is no `CampaignRecipient` table

A recipient is a `Message` row carrying a `campaignId`. That makes a campaign
send pass through the same single door as every other message and inherit the
existing consent gate, retry sweep, delivery receipts and outbox. A parallel
recipient table would be a second sending path, and a second sending path is a
second place for the consent rules to be almost right.

### Sending is queued, not immediate

`launchCampaign` materialises QUEUED rows and returns. `drainCampaigns` sends
them in batches of 100.

- 2,000 recipients is 2,000 sequential provider calls. A server action does not
  have minutes. An immediate send times out mid-list, the owner can't tell
  where, presses the button again, and half the list gets it twice.
- Providers rate-limit. Bounded batches are the only shape that backs off
  without losing the queue.
- A restart mid-send is survivable, because the queue is in the database.

The batch size is also a deliverability decision: 100 every two minutes is 3,000
an hour, fast enough for an independent restaurant and slow enough that a new
sending domain isn't emitting its first thousand emails in ninety seconds, which
reputation systems read as a spam cannon.

### The consent gate runs twice, and that is not redundancy

`reachableWhere()` filters the audience at queue time so we don't write a wall
of junk rows. `deliverQueuedMessage` / `deliverQueuedEmail` re-check **against
current data** at send time.

The second check is the real one. A STOP or an unsubscribe that arrives between
the owner pressing Send and the drain running has to win, and the queued row was
written before it existed. If you add a queue-time optimisation, the send-time
check stays.

### Merge fields render at queue time, not send time

The body stored on each `Message` row is exactly what that person received.
Rendering at send would leave the outbox showing a template, which is the wrong
answer to "what did you actually text my customer".

### The segment counter counts the worst case

`{{name}}` is 8 characters and renders to a name that may be longer. And `{`
and `}` are GSM-7 *extended* characters costing two septets each, so the
direction of the error isn't even constant. What matters is that the estimate is
made against a rendered message: a short-name estimate is billed against
everybody's name.

The encoding warning is the other half. One curly apostrophe pasted from a word
processor forces UCS-2 and drops the per-segment budget from 160 characters to
70 — tripling the bill across the whole list, with no visible change to the
message. The composer names the offending character.

### Unsubscribe is a GET, on the platform origin, with no auth

- **GET that mutates**, deliberately. Unsubscribing too eagerly costs somebody
  marketing email they can restore with one click on the same page. Requiring a
  confirmation click costs a spam complaint, which attaches to the sending
  domain and damages every tenant on it. RFC 8058 one-click makes the same call.
- **`platformOrigin()`, not `canonicalOrigin()`**, even though the mail is from
  the restaurant. The link has to work for years, including after the owner lets
  their domain lapse or leaves. A suppression we can't honour because a hostname
  stopped resolving is a CAN-SPAM violation with our name on it.
- **No auth.** The token is the auth, same as `/o/[token]`. Asking somebody to
  sign in to stop receiving email is the most reliable way to convert them into
  a spam complaint.

Note the guard in `app/u/[token]/page.tsx`: the resubscribe redirect lands back
on this page, so the opt-out is skipped when `?resubscribed=1`. Without it the
"keep me subscribed" button silently does nothing.

### The from-line uses the tenant's *name* and our *address* until verified

`Sal's Pizza <no-reply@ezorders.app>` is the honest combination: the reader
learns who wrote it, the mailbox provider learns who sent it, neither is misled.
Putting an unverified tenant address in the from-line is a DMARC failure that
lands the mail in spam while SendGrid still reports a successful send.

`saveEmailSenderAction` deliberately cannot write `emailSenderVerifiedAt`. That
column mirrors provider state and is ours.

### Owners compose plain text; we generate the HTML

Email HTML is tables, inline styles and a decade of client quirks, and anything
pasted from a word processor renders differently in every client at once. A
plain-text part that genuinely matches the HTML part is also worth real
deliverability, and generating one from the other is the only way to keep them
in sync.

When templates land, they pick the wrapper. The owner still writes the words.

### The drain runs last in the sweep

Refunds, stale orders and failed order notifications are the platform keeping
promises already made to a customer. Marketing is the restaurant asking for
something. If a pass runs long, this is the queue that should back up.

---

## What still has to happen

Same warning as everywhere else in this repo: **if something looks done, check
whether the thing that runs it exists.**

1. **`npx prisma generate && npm run db:push` on a real machine.** Migration
   `28_campaigns_and_email` is written and idempotent and has never run.
   `prisma.campaign` does not exist in the generated client until it does, so
   nothing on `/dashboard/marketing` works. It joins five earlier migrations in
   the same queue — see `docs/SETUP-your-turn.md`.

2. **The Railway cron still doesn't exist.** `drainCampaigns` is wired into
   `scripts/sweep.ts` and is inert without it. A campaign launched today would
   sit in SENDING forever. The drain button in `/admin/tools` makes the path
   testable; it is **not** the cron.

3. **SendGrid.** `EMAIL_PROVIDER=sendgrid`, `SENDGRID_API_KEY`, `EMAIL_FROM`,
   and a **verified sending domain** — not just a verified single sender.
   `scripts/config-check.mjs` refuses to boot on the half-configured cases.
   Until then the stub records every send and delivers nothing.

4. **A2P 10DLC** still gates SMS to US carriers. Weeks of lead time, unchanged
   by this work.

### Left to build, in rough priority order

- **P1 — Bounce and complaint webhooks.** `suppressEmailAddress()` exists and
  nothing calls it. Without an endpoint at SendGrid's event webhook, a hard
  bounce is retried up to the attempts cap and a spam complaint is never
  recorded at all. This is the item that most directly protects the sending
  domain, and it is the reason `emailOptOutReason` distinguishes `bounced` and
  `complained` from `unsubscribed`.
- **P2 — Templates and automations.** Explicitly planned. The seams are in
  place: `renderEmail` takes the body and wraps it, `MessageKind` already has
  the lifecycle kinds (`FIRST_REORDER`, `WIN_BACK`, `FREQUENCY`) that an
  automation would send under, and `Campaign.audienceQuery` is the same
  representation a trigger would evaluate. A template picks the wrapper; the
  owner still writes the words.
- **P2 — Email capture at checkout.** `Customer.email` is null for nearly every
  organic customer, so the email audience is mostly imported rows today. This is
  the single biggest lever on email reach and it lives in `src/app/r/`, not here.
- **P2 — Campaign visibility in `/admin`.** The admin console can see the
  outbox but has no cross-tenant campaign view. The question it should answer is
  "who is sending a lot, and are their skip rates normal" — an abnormal skip
  rate is the earliest signal of a tenant about to earn us a complaint.
- **P3 — Per-tenant link tracking.** Click tracking is off in
  `email-sendgrid.ts` on purpose: a shared redirect domain drags every tenant's
  reputation down together. Per-tenant redirect domains would fix it and are a
  bigger decision than this feature.
- **P3 — Integration tests.** The pure half is covered by
  `scripts/campaigns.test.ts`. Every writer in `lib/campaigns.ts` takes an
  optimistic lock and none of them has a test — the same gap
  `orders.concurrency.test.ts` closed for orders, and the same in-memory Prisma
  double would close it here.
