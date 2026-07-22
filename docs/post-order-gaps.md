# Post-order support: what's missing

An honest audit of the post-order system after the first pass. Some of this is
scope that was deliberately deferred. Some of it is defects that shipped. The
two are marked differently, because they deserve different urgency.

Ordered by what it costs to leave alone, not by effort.

---

## P0 — Correctness. Fix before real money moves. **— DONE**

Nothing here matters while `StubPaymentProvider` is in place, because no funds
actually move. All of it matters the day Stripe is wired in, and that is
exactly the day nobody will be re-reading this file.

All four are fixed. `scripts/orders.concurrency.test.ts` covers them against an
in-memory Prisma double (`scripts/test-stubs/prisma-memory.ts`) whose
`updateMany` is atomic the way a conditional UPDATE is — which is the only
property the fixes rely on. The original text is kept below for the reasoning;
each item records what landed.

### 1. `issueRefund` can over-refund under concurrency — **defect**

`lib/orders.ts` reads the order, computes `refundableCts(order)` from that
snapshot, clamps the amount against it, and only later does
`refundedCts: { increment: amount }`. Nothing holds a lock across the gap.

Two owners on two tablets pressing "Cancel and refund" on the same ticket both
read `refundedCts = 0`, both clamp to the full total, and both increment. The
order ends up refunded twice. The clamp reads like a guarantee and isn't one.

**Fix.** Make the write conditional on the value that was read, and treat a
zero-row update as a lost race:

```ts
const { count } = await prisma.order.updateMany({
  where: { id: order.id, refundedCts: order.refundedCts }, // optimistic lock
  data:  { refundedCts: order.refundedCts + amount },
});
if (count === 0) return { ok: false, error: "That order changed — reload and try again." };
```

The provider call has to move inside that guard, or be made idempotent with a
key derived from the `Refund` row id, so a retry can't double-charge the
platform. Stripe supports idempotency keys directly; use the refund id.

**Test to add:** fire two `issueRefund` calls at one order concurrently and
assert `refundedCts <= totalCts`.

**Fixed.** The amount is now *reserved* with the optimistic `updateMany` before
the provider is called, and released with a decrement if the payout fails.
Reserve-then-charge rather than charge-then-reserve: a crash between the two
then leaves an order looking over-refunded, which an owner can see and correct,
instead of money gone with no record. `RefundInput.idempotencyKey` carries the
`Refund` row id.

### 2. `cancelOrder` and `transitionOrder` have the same read-then-write gap — **defect**

`isTerminal(order.status)` and `canTransition(...)` are both checked against a
stale read. Two rapid clicks can drive two cancellations, each firing its own
refund and its own apology text to the customer.

**Fix.** Same shape — make the status write conditional on the status that was
read (`where: { id, status: order.status }`) and bail when no row matches. This
also removes the double-text problem for free.

**Fixed.** Both writers now go through `updateMany` with the read status in the
WHERE and return "that order changed — reload" on a zero-row result. Tests
assert one `status_changed` event and one text per double-tap.

### 3. A failed refund is invisible — **defect**

`cancelOrder` calls `issueRefund` and then does `if (res.ok) refunded = ...`.
When the refund fails, the order is still marked CANCELED, the customer still
gets a text — but the text omits the money line, and the `FAILED` refund row is
written where nobody will ever look. The dashboard has no view of it.

An order that owes a customer money must be impossible to ignore. Right now it
is the quietest state in the system.

**Fix.** Surface failed refunds as a blocking banner on the dashboard, next to
the open-issues panel. Add a retry action. Consider a `Refund.attempts` counter
and a scheduled retry for transient provider errors.

**Fixed.** `Refund` gained `attempts`, `resolvedAt` and `resolvedNote`
(migration `14_refund_recovery`). `outstandingRefunds()` feeds a banner above
everything else on the board — `FailedRefunds.tsx` — with a retry button and an
"I sorted it another way" escape hatch that demands a note, because a refund
can only stop being outstanding by being paid or being explained.

**Automatic retry is now done too.** `retryFailedRefunds` (run from the sweep)
re-tries FAILED, unresolved payouts *in place* — against the same Refund row, so
the row id stays the idempotency key the provider dedupes on and a payout that
succeeded but timed out can't be moved twice. That's the one thing the dashboard
button (`retryRefund`) can't safely do: it mints a fresh row and so a fresh key
on every press, which is fine under a human's eye but wrong on a timer. Bounded
by `MAX_REFUND_RETRIES` because `RefundResult` has no transient/permanent flag,
after which it's left in the banner for a human. `concurrent_refund` failures
are skipped — a lost race is not a debt. Covered by five cases in
`scripts/orders.concurrency.test.ts`. Like the sweeps, it's correct code that
does nothing until the Railway cron exists.

### 4. Canceled orders permanently inflate customer stats — **defect**

`placeOrderAction` does `orderCount: { increment: 1 }` and sets `lastOrderAt`.
Nothing reverses either when the order is canceled or rejected. `issueRefund`
decrements `lifetimeCts` but leaves `orderCount` alone.

Consequences, in rising order of embarrassment: the "returning customers"
donut is wrong; a customer whose only order was rejected is counted as a real
customer; and the reorder campaigns in `MessageKind` will eventually text
someone a win-back offer based on an order the restaurant refused to make.

**Fix.** Decrement `orderCount` and `lifetimeCts` in `cancelOrder`, and recompute
`lastOrderAt` from the customer's remaining non-canceled orders. Better still,
derive these counters from the orders table rather than storing them — they are
a cache, and this is the classic cache-invalidation bug.

**Fixed, the cheap way.** `cancelOrder` decrements `orderCount` and recomputes
`lastOrderAt` from the customer's remaining non-canceled orders; `lifetimeCts`
is still walked back per refunded cent by `issueRefund`. The counters are still
a cache, so the underlying bug class is still live — deriving them on read
remains the right fix and is now the only thing left in this item.

---

## P1 — Safety nets that are currently inert

Items 5 and 6 are done; 7 is open.

### 5. `expireStaleOrders` almost never runs — **defect**

Two independent reasons the auto-cancel never fires:

1. It only queries `status: "RECEIVED"`. But `autoAccept` defaults to **true**,
   so orders are created as `ACCEPTED` and skip that state entirely. For every
   tenant on the default config, the sweep matches nothing, ever.
2. It's called from `dashboard/page.tsx` — on dashboard load. The scenario it
   exists for is "nobody is watching the dashboard." It is triggered by the
   exact thing whose absence it's meant to cover.

The comment in the code claims the board "is loaded far more often than any
cron would run." That is true and irrelevant.

**Fix.** Move it to a real scheduled job (`workers/` already exists, and
`railway.json` can run a cron process), and widen it: an `ACCEPTED` order that
blows past `promisedAt` by some margin needs escalation too, not just an
unacknowledged `RECEIVED` one.

**Fixed.** `expireStaleOrders` now picks the status to sweep from the tenant's
own config — `ACCEPTED` when `autoAccept` is on (where it carries no human
acknowledgement) and `RECEIVED` when it's off. `flagOverdueOrders` handles the
late-but-real case: a `PREPARING` order past its promise by 15 minutes gets one
apology text, de-duped on an `order_overdue` event, and is never auto-canceled —
taking food away from someone already waiting helps nobody. Both run from
`scripts/sweep.ts` (`npm run sweep`), and the call is gone from dashboard load.

**Deploy step, still outstanding:** the cron has to be created by hand. Railway
takes one service per repo config, so this needs a *second* service off the same
repo pointed at `railway.sweep.json` (`startCommand: npm run sweep`, cron
`*/2 * * * *`). That config file and a step-by-step now live in
`docs/deploy-sweep.md`; what remains is the dashboard clicks — creating the
service, pointing it at the config, and giving it the env. Until someone does
that in the Railway UI, the sweep is correct code that never runs — the same
failure this item started as, one layer out.

### 6. Nothing handles food that was made and never collected

`NO_SHOW` exists in the `OrderProblem` enum and no code path ever sets it. An
order sits in `READY` forever. There's no prompt, no auto-complete, no sweep.

**Fix.** Flag `READY` orders older than ~45 minutes on the board with a
one-click "Never picked up" that closes them out. Deliberately not automatic —
whether to refund a no-show is a judgement call the owner should make.

**Fixed, as described.** `isProbableNoShow` (45 minutes past `readyAt`) puts a
`NoShowPrompt` on the card — on the card itself, not behind "Something wrong?",
since an uncollected order is an ordinary end to a service rather than a fault.
`markNoShow` refuses anything not currently `READY` and hands off to
`cancelOrder` with `problem: NO_SHOW`. Two buttons, keep-the-charge and refund,
because the answer depends on whether they're a regular and only the owner
knows that. No sweep, no auto-close.

Two things fell out of this worth knowing:

- **The cancellation text needed a second voice.** "Sorry — your order was
  canceled because the order wasn't picked up" reads as sarcasm. A no-show gets
  a plain "closed out — it wasn't picked up" instead, and `statusHeadline` says
  "Not picked up" rather than "Canceled" on the customer's page.
- **The counter reversal from item 4 was subtly wrong** and this caught it. It
  fired on every cancellation, but a no-show where the owner keeps the money is
  a real transaction — food was made and paid for. The rule is now "did the
  customer end up paying nothing", not "was the order canceled".

### 7. `APP_URL` is an unguarded deployment footgun — **DONE**

`orderUrl()` falls back to a bare path when `APP_URL` / `NEXT_PUBLIC_APP_URL`
is unset. A text message containing `/o/abc123` is useless — and the failure is
silent, so it'll ship to production and nobody notices until a customer can't
find their order.

**Fix.** Fail loudly at boot in `scripts/storage-check.mjs` (which already does
this kind of preflight), or fall back to the tenant's `customDomain`/slug.

**Fixed** in a sibling script rather than that one: `scripts/config-check.mjs`,
which runs before the storage check in `npm start` because unlike storage it is
fatal. Graded rather than absolute — a missing `APP_URL` warns while SMS is
stubbed and refuses the boot once `SMS_PROVIDER=twilio`, because the severity
genuinely is different. A bare path in a logged message is readable; a bare
path in a real text is the support call this product exists to remove. The same
script covers the mirror-image footgun that arrived with item 11: `SMS_PROVIDER
=twilio` with no credentials, which falls back to the stub at runtime and so
fails as total silence in which every `Message` row still says `SENT`.

---

## P2 — Holes the customer can feel

Items 8, 9 and 10 are done. 11 and 12 are open.

### 8. Closed restaurants are only discovered at checkout

`checkAvailability` runs in `placeOrderAction` and nowhere on the storefront. A
customer can browse, build a cart, enter their phone number, and only then be
told the kitchen shut an hour ago. The information exists the whole time.

**Fix.** Call it in `r/[slug]/page.tsx`, render a banner, and disable the cart
bar with "Opens again tomorrow at 11 AM" rather than letting them build an
order that can't be placed.

**Fixed.** `checkAvailability` now runs on the storefront too and the result
rides into `StoreApp` on the restaurant DTO. A `ClosedNotice` sits under the
banner with the reason, the reopening time and the phone number, and `CartBar`
renders as an inert "Closed — opens ..." strip instead of a route to checkout.
Browsing is still allowed: reading a closed restaurant's menu is useful, and
the cart survives until they reopen. `placeOrderAction` remains the authority —
the page is dynamic but a customer can still sit on it past closing.

### 9. Two contradictory sources of truth for hours

The storefront still renders the free-text `hours` string
(`r/[slug]/page.tsx:107`) while ordering now obeys `hoursJson`. An owner who
edits one and not the other shows customers hours that the system disagrees
with — which manufactures exactly the support tickets this project set out to
remove.

**Fix.** Render the site's hours from `describeWeek(hoursJson)` and demote the
free-text field to a note ("Kitchen closes 30 min early on match days"), or drop
it. Migrate existing values by best-effort parse, flagging failures for the owner.

**Fixed.** `StoreInfo.hours` is now a `StoreHours` object built server-side from
`hoursJson`: today's window for the hero lines, the full week for the Visit
page, and the free-text column carried alongside as `note`, rendered under the
schedule rather than instead of it. The branding form relabels that field
"Hours note (optional)" and points at the Hours page for the real thing. A
tenant with no schedule reports `configured: false` and the page says nothing
about hours at all — ordering fails open there, so announcing "Closed today"
would be the same contradiction pointing the other way.

**Not done:** the best-effort parse of existing free-text values into
`hoursJson`. Owners who never visited the Hours page still show a note and no
schedule, which is honest but thin.

### 10. Resolving an issue doesn't tell the customer

`resolveIssueAction` writes a resolution and logs a public event. The customer
sees it only if they happen to reopen the link. Someone who reported a problem
and got a refund is never told.

**Fix.** Send a transactional message on resolution. The plumbing already
exists; it just isn't called.

**Fixed.** The write moved out of `resolveIssueAction` and into `resolveIssue`
in `lib/orders.ts` — it sends money-adjacent news to a customer, which is not
something a route should own. It texts the owner's own words when they wrote
any and a plain statement of where things stand when they didn't, never both.
`ACKNOWLEDGED` is included: "we're looking into it" is the reassurance a
frustrated customer actually wants, and it leaves `resolvedAt` null so the
report stays open on the board.

Note this is still a `StubSmsProvider` call — correct and silent. See item 11.

### 11. The notification layer is entirely stubbed — **code DONE, registration outstanding**

Worth stating plainly since it's easy to lose: `StubSmsProvider` logs and does
not send. Every "we'll text you" in this system is currently false. The status
page link is the only real channel, and it's delivered by... a text message.

Until Twilio and A2P 10DLC registration land, consider an email fallback on the
`Customer.email` field, which is captured and unused.

**The email fallback was investigated and rejected.** `Customer.email` is
nullable and there is not one reference to it anywhere under `src/app/r/` — it
is never captured. So it is null for every customer who exists, and "fall back
to email" means adding a field to the checkout form: friction on the exact
capture point the whole product is built around, covering only customers
acquired afterwards. The existing list stays unreachable either way. That is a
second project with worse economics, not a stopgap.

**Done instead: Twilio behind the seam, defaulted off.**

- `TwilioSmsProvider` (`lib/sms-twilio.ts`) over `fetch` rather than the SDK —
  the surface used is two endpoints and a signature check. Selected by
  `SMS_PROVIDER=twilio`; the stub stays the default so no deploy can start
  texting people on its own.
- **The seam was the actual work.** `SendInput` had no destination — the stub
  never needed one, so the question was never asked. `queueMessage` now
  resolves the number, normalises it, records it on the `Message` row, and
  writes a `SKIPPED` row when there isn't one. Under the stub, a customer with
  an unusable number was indistinguishable from one who got their text.
- **A defect fell out of this.** The consent gate only ran for marketing kinds,
  so a customer who replied STOP kept receiving transactional messages. Carriers
  don't make that distinction; a sender that ignores STOP gets filtered, and the
  filtering takes the tenant's whole list with it. Opt-out now blocks every kind.
- Inbound `STOP`/`START`/`HELP` at `/api/sms/inbound`, delivery receipts at
  `/api/sms/status`, both authenticated by Twilio's request signature —
  reconstructing the signed URL from `x-forwarded-host`, the same proxy
  mismatch `next.config.mjs` already documents for Server Actions. Unsigned
  webhooks here would let anyone who learns the URL rewrite the consent record.
- `START` returns a customer to `UNKNOWN`, not `OPTED_IN`. It undoes a STOP; it
  is not the express written consent marketing requires, and recording it as
  such would manufacture a consent record that never happened.
- Schema (migration `15_sms_delivery`): `Message.to`, `Message.deliveredAt`,
  `DELIVERED`/`UNDELIVERED` statuses, and `Restaurant.smsFrom` — per-tenant and
  unique, because 10DLC registers a brand per business and because an inbound
  STOP arrives addressed only to the number that sent the original, making that
  column the sole route from a receipt back to a restaurant.
- 17 cases in `scripts/sms.test.ts` against `test-stubs/prisma-sms.ts`.

**What's genuinely left is not code.** A2P 10DLC brand and campaign
registration has a lead time measured in weeks and gates delivery to every US
carrier. Until it clears, `SMS_PROVIDER` stays unset and this is all correct
code that doesn't run — the same shape as the Railway cron in item 5, and worth
noticing that this project has now produced two of those.

Also still open, and only now worth doing because failures are real:

- **Retry for transient send failures — done.** `SendResult.retryable` finally
  has a consumer. `retryFailedMessages` (in `lib/sms.ts`, run from the sweep)
  re-sends FAILED messages marked retryable, in place on the same row, bounded by
  `MAX_SEND_RETRIES` and re-checking consent each pass so a STOP that arrived
  between attempts wins. A permanent failure — a landline, a rejected number — is
  written `retryable: false` and never touched, because re-sending to a number
  that will never accept is exactly how a sender earns carrier filtering. Needed
  a schema change (migration `16_message_retry`: `Message.attempts` and
  `Message.retryable`) because the verdict was computed at send time and never
  stored. Four cases in `scripts/sms.test.ts`. Still waits on the cron to run.
- **Delivery visibility for owners — done.** `undeliveredMessages` (in
  `lib/sms.ts`) feeds a quiet panel on the board (`UndeliveredMessages.tsx`),
  ranked below the failed-refund banner and the complaints panel because a
  bounce is neither a debt nor a fault. No retry and no per-message dismiss —
  the fix for a bounced number is a phone call, not a resend — so the panel is
  time-boxed to the last 7 days and empties itself. "I never got a text" now
  has an answer an owner can reach.
- **Tenants on the shared platform number** are deliverable but not attributable:
  inbound STOP can't be routed back to them. Fine as the state between going
  live and a campaign clearing; not a place to leave anyone.
- **`Restaurant.smsFrom` has no UI.** The column exists and the send path reads
  it, but nothing writes it — setting a tenant's number currently means a
  `db:studio` session. Deliberate for now: there's no point building the form
  before any campaign has cleared registration, and the shape of the admin
  screen depends on whether numbers get provisioned per tenant through the API
  or bought by hand. It belongs on `/admin` next to the other tenant fields.

### 12. No rate limiting on the public order actions — **DONE**

`/o/[token]` actions are guarded only by token possession. The token is 160
bits, so enumeration isn't the concern — but there's no throttle on
`reportIssue` or repeated cancel attempts. Low severity, cheap to add.

**Fixed.** `lib/rate-limit.ts` is a single-process sliding window (a module-level
`Map`, swept opportunistically), keyed per token and per action —
`cancel:${token}` and `report:${token}`, 5 attempts per 10 minutes each, so a
burst on one doesn't spend the other's budget. Its own comment is candid that
this resets on deploy and needs a shared store (Postgres row, Redis) the day
this repo runs more than one web instance; the token stays the real security
boundary and this is only a safety net against a stuck retry loop. Covered by
`scripts/rate-limit.test.ts` (5 cases), wired into `npm test`.

---

## P3 — Deliberately deferred. Listed so they aren't forgotten.

- **Split shifts in the hours UI.** The data model supports multiple windows per
  day; the form writes one. Flagged when built.
- **Scheduled / pre-orders.** No way to order ahead for tomorrow. Would need
  `promisedAt` to become an input rather than a derived value.
- **Partial-refund UI for completed orders — done.** `refundOrderAction` now has
  a button: `GoodwillRefund` (in `OrderTrouble.tsx`) sends an arbitrary amount
  against the `QUALITY` reason — the enum's "remake or goodwill" slot — clamped
  server-side to what's still refundable so it can't over-refund. It lives on a
  new "Completed today" panel on the board (`page.tsx`), because the live board
  drops an order the moment it completes and goodwill happens after the fact.
  That panel is also a first, thin cut at the order-history gap below (completed
  orders only; canceled/rejected still have no view).
- **Order history for the restaurant.** The board shows live orders only. There's
  no view of what was canceled or rejected today, and no reliability metrics,
  despite a code comment claiming these are "metrics an owner gets judged on."
- **Admin cross-tenant view** of failed refunds and open issues.
- **Integration tests.** Only pure functions are covered. Every path that writes
  to the database — the whole state machine in practice — is untested.

---

## Suggested order of work

1. ~~**P0 items 1–4 together.**~~ Done — one pass, with
   `scripts/orders.concurrency.test.ts` behind them.
2. ~~**Item 5**~~ Done in code — but the Railway cron service still has to be
   created by hand, and until it is, nothing has actually changed in production.
3. ~~**Items 8 and 9**~~ Done.
4. ~~**Item 6**~~ Done — `NO_SHOW` finally has a producer.
5. ~~**Item 10**~~ Done.
6. ~~**Item 11**~~ Done in code, and ~~**item 7**~~ with it. Sending is now
   gated on A2P 10DLC registration rather than on anything in this repo.
7. Everything else as it earns priority. ~~**Item 12**~~ (rate limiting),
   ~~**delivery visibility**~~ for `UNDELIVERED`, and ~~**both retry queues**~~
   (refund and send) are now done in code. What's left is P3 and the two deploy
   tasks below.

**The two blockers now are entirely deploy-and-paperwork; no code is left on
them.** The Railway cron from item 5 has never been created, and *four* features
are now queued behind it — the two sweeps it was built for, refund retry, and
send retry. Every one is written, tested, and inert until a second Railway
service runs `npm run sweep` on a schedule. A2P 10DLC registration gates every
message. Both have the same failure mode: correct code that never runs, which
reads as done in every file except this one. **This is now the whole remaining
critical path** — a coding session cannot advance it.

Genuinely-code work still open is all P3: deriving the customer counters instead
of caching them (item 4), the best-effort parse of free-text hours (item 9), a
shared-store rate limiter (item 12), the `smsFrom` admin UI, and integration
tests for the database-writing paths.

Items 1–5 are defects introduced in the first pass, not future features. They
should be treated as finishing the work rather than extending it.
