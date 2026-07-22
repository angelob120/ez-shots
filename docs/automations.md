# Automations — the visual journey builder

**Read this before touching `src/lib/automation-flow.ts`, `src/lib/automations.ts`,
`src/lib/automation-templates.ts`, or anything under
`src/app/dashboard/marketing/automations/` or `src/app/admin/templates/`.**

A campaign is one message an owner sends to a list on a Tuesday. An automation
is a *standing instruction*: when this happens to a customer, wait, then text
them, then check whether they came back, then either stop or email them. The
owner draws it once on a canvas and it runs forever without them.

Everything in `docs/marketing.md` still applies. This is a new way to decide
*when* to send. It is not a new way to send.

---

## The one rule, restated because this is where it breaks

**An automation is not consent, and an automation does not send.**

`lib/automations.ts` never touches a provider. A `SEND_SMS` block calls
`queueMessage` in `lib/sms.ts`; a `SEND_EMAIL` block calls `queueEmail` in
`lib/email.ts`. Both re-run the full consent gate at the moment of the send and
write a `Message` row either way, exactly as a campaign does.

This matters more here than it does for campaigns, and the reason is timing. A
campaign is composed and sent in the same afternoon by a person who just looked
at their audience. An automation queues a message **weeks** after the owner drew
the box — long after a STOP may have arrived, an address may have bounced, or
the platform may have suspended the tenant. There is no version of "check
consent when the automation is saved" that is correct. The check has to be at
the door, at the instant of sending, or it is not a check.

Consequence to keep in mind when reading the stats: an automation that enrolled
400 people and shows 90 messages sent is **working**. The enrollment list shows
the skip reason per person, same sentence-per-reason treatment the campaign
results page gets, and for the same reason — a number with no explanation reads
as the platform being broken.

**Quiet hours are the second half of that.** A campaign is sent when a human
presses a button, so a human is implicitly deciding it's a reasonable hour. An
automation's wait can land at 3am. `lib/automation-flow.ts` defers an SMS send
outside the automation's quiet-hours window to the next opening of that window,
reckoned in the **restaurant's** timezone the way `lib/hours.ts` does it. That
is not politeness — texting at 3am is a TCPA problem and a complaint generator,
and complaints are what get a sending number filtered.

---

## Structure

| File | What it is |
|---|---|
| `lib/automation-flow.ts` | **Pure.** Node vocabulary, graph validation, condition evaluation, next-node resolution, wait arithmetic, quiet hours, split assignment. No Prisma, no `server-only` — the canvas imports it in the browser so a broken graph is flagged as it's drawn. |
| `lib/automations.ts` | `server-only`. The runtime: enrollment, advance, the drain, re-entry rules, exits. Re-exports the pure half so server callers have one import. |
| `lib/automation-templates.ts` | `server-only`. Admin-side template CRUD, publish, and the three sync policies. |
| `app/dashboard/marketing/automations/` | Owner UI: list, canvas builder, enrollment inspector, template gallery. |
| `app/admin/templates/` | Admin UI: the same canvas, plus publish, version history and adoption counts. |
| `api/automations/hook/[token]` | The inbound webhook trigger. |

Same split, same reasons as `campaign-format.ts` / `campaigns.ts`. It pays here
three times rather than twice: the canvas validates in the browser, the tests
run with no database, and the sweep and the UI cannot disagree about which node
comes next, because there is one implementation of that question.

---

## The node vocabulary

A graph is `{ nodes: Node[], edges: Edge[] }` stored as JSON on
`AutomationVersion.graph`. Node kinds are **strings validated in the pure
module, not a Prisma enum** — the graph is JSON either way, so an enum would put
half the vocabulary in the schema and half in code, and adding a block would
need a migration for no benefit.

### Triggers (exactly one per graph, and it is the entry node)

| Kind | Fires when |
|---|---|
| `ORDER_PLACED` | any order is placed |
| `FIRST_ORDER` | an order is placed by a customer whose `orderCount` was 0 |
| `ORDER_FULFILLED` | an order reaches `FULFILLED` |
| `ORDER_CANCELED` | an order is canceled or rejected |
| `ORDER_REFUNDED` | a refund settles |
| `CUSTOMER_CREATED` | a `Customer` row is created by checkout |
| `TAG_ADDED` / `TAG_REMOVED` | a specific tag moves on a customer |
| `OPTED_IN` | `optInStatus` becomes `OPTED_IN` |
| `LAPSED` | no order for N days — evaluated by the sweep, not by an event |
| `ANNIVERSARY` | N days after `firstOrderAt`, annually |
| `MANUAL` | an owner enrolls people from the customer list |
| `WEBHOOK` | a POST to this automation's hook URL |

There is no `BIRTHDAY`, because `Customer` has no birthday and inventing a
column that checkout never fills would produce a trigger that never fires.

### Actions

| Kind | Notes |
|---|---|
| `SEND_SMS` | body + merge fields, validated by the campaign validator |
| `SEND_EMAIL` | subject + body, same |
| `WAIT` | a duration |
| `WAIT_UNTIL` | a condition, with a required timeout — see below |
| `IF_ELSE` | one condition, two outgoing edges (`true` / `false`) |
| `SPLIT` | weighted A/B, assigned once at the node and recorded on the enrollment |
| `ADD_TAG` / `REMOVE_TAG` | writes through `lib/customers.ts` |
| `GOAL` | marks the enrollment's goal met and exits |
| `NOTIFY_OWNER` | an email to the restaurant, not to the customer |
| `WEBHOOK_OUT` | outbound POST, through the `lib/net-guard.ts` SSRF fence |
| `EXIT` | ends the enrollment with a reason |

**`WAIT_UNTIL` requires a timeout and the validator enforces it.** A wait with no
ceiling is an enrollment that sits in the database forever, and a thousand of
them is a sweep that gets slower every week for a reason nobody can see. The
timeout has a second outgoing edge, so "they never came back" is a branch the
owner drew rather than a silence.

---

## Decisions not to re-litigate

### An enrollment runs the version it entered on

`AutomationVersion` snapshots the whole graph. `Enrollment.versionId` pins it.
Editing a live automation publishes a new version; people already partway
through finish on the old one.

The alternative — everyone jumps to the newest graph — sounds tidier and is
incoherent. A customer sitting at node 7 of a graph whose node 7 no longer
exists has to go *somewhere*, and every answer is wrong: dropping them silently
abandons a journey the owner set up, restarting them re-sends messages they
already got. Pinning means the owner's edit affects everyone who enters from now
on, which is what they meant.

### Enrollment is idempotent at the database, not in a check

A partial unique index on `(automationId, customerId) WHERE status IN
('ACTIVE','WAITING')` is the enforcement. `canEnroll` is the courtesy that
produces a good message. This is the same shape as the booking double-book index
in migration 30 and it's here for the same reason: the read is stale the moment
it returns, and two order events a second apart are exactly how a customer gets
enrolled twice and texted twice.

It has to stay **partial**, or a customer who completed a journey in March can
never enter it again.

### Re-entry is a policy, and the default is `ONCE`

`ONCE` / `ONCE_PER_TRIGGER` / `COOLDOWN(days)` / `ALWAYS`. Default `ONCE`,
because the failure mode of the loose setting is a regular who orders twice a
week receiving the same "we miss you" text twice a week, and the failure mode of
the strict setting is a message that doesn't get sent. Those are not symmetric.

### The graph must be acyclic, and the step budget is a second belt

The validator rejects cycles. The runtime *also* caps how many nodes one
enrollment may traverse in a single pass, and caps total steps over its
lifetime. A cycle that slipped past validation — through a template import, a
hand-edited JSON blob, a bug — is an infinite loop that sends a text every time
round. The budget makes that a stuck enrollment with an error on it, which
somebody notices, instead of a phone that rings all night.

### There is no `AutomationRecipient` table

A message sent by an automation is a `Message` row carrying `automationId` and
`enrollmentId`, exactly as a campaign message carries `campaignId`. Same reason,
stated in `docs/marketing.md`: a parallel recipient table is a second sending
path, and a second sending path is a second place for the consent rules to be
almost right. The outbox stays the one record of what a tenant sent.

### The canvas is hand-rolled

No `react-flow`, no graph library. Nodes are absolutely-positioned divs, edges
are one SVG layer behind them, dragging is pointer events writing to React state.
This follows the analytics charts decision: the repo has no UI dependencies and
the interaction surface here is small — drag a node, click to select, connect two
ports. A flow library is ~150KB and owns the data model, which would put the
graph shape in a vendor's hands rather than in `automation-flow.ts` where the
validator and the runtime read it.

The bound on this, so it doesn't creep: the canvas renders and drags. Every
*decision* about the graph — is it valid, what comes next, does this condition
hold — is imported from the pure module and is the same code the server runs.

### Sending is inert without the cron, same as everything else

`drainAutomations()` is wired into `scripts/sweep.ts`. Until the Railway service
in `docs/deploy-sweep.md` exists, an automation enrolls people and never advances
them. There is a manual drain button in `/admin/tools`, and its existence must
not make the cron look optional.

---

## Templates

Admin builds a journey in `/admin/templates`, presses Publish, and owners see it
in their gallery. An owner adopts it and gets a working automation without
drawing anything.

### Publishing

A template has a **draft graph** and a list of **published versions**. Editing
touches the draft only. Publish freezes the draft as a new version and points
`publishedVersionId` at it. Nothing an owner sees ever reflects an unpublished
draft — otherwise a half-finished edit is live in every tenant that adopted it.

### The three sync policies, and why there are three

Set per template by the admin. This is the question "when I fix a typo in a
template that 40 restaurants are running, what happens to them?" and it has
three legitimate answers depending on what the template is.

| Policy | Owner edits | On publish |
|---|---|---|
| `ALWAYS` | Not allowed — read-only. To customize, copy it, which severs the link. | Every adopter's automation moves to the new version. |
| `AUTO_UNLESS_CUSTOMIZED` | Allowed; the first edit **forks** the automation and severs the link. | Unmodified adopters move. Forked ones don't, and are told an update exists. |
| `OPT_IN` | Allowed, link kept. | Nobody moves. Adopters see "a new version is available" and choose. |

`ALWAYS` is right for a template whose correctness is ours — a compliance
footer, a transactional-adjacent flow. `OPT_IN` is right for anything whose
wording an owner has a legitimate opinion about. `AUTO_UNLESS_CUSTOMIZED` is the
sensible default and the one the gallery marks as recommended.

**A sync never touches an in-flight enrollment**, whatever the policy. Versions
are pinned (see above). Sync repoints the automation so the *next* person to
enter gets the new graph.

**A sync never re-activates a paused automation, and never activates a draft.**
An owner who paused a journey has made a decision, and a publish on our side
overriding it is us sending messages from an account whose owner switched them
off.

---

## What to do next

1. **Migration `31_automations` has never run.** Same as every migration since
   22. `npx prisma generate && npm run db:push` on a real machine, or nothing on
   either surface works.
2. **The Railway cron still doesn't exist**, so nothing advances. This is now the
   fifth thing queued behind it.
3. `WEBHOOK_OUT` retries are not implemented — a failed outbound POST is logged
   on the step and the enrollment continues. Deliberate for v1: an automation
   that stalls a customer's journey because a third-party endpoint is down is
   worse than a missed webhook.
4. Analytics on automations are counters only (entered, completed, goal met,
   sent, skipped). Per-node conversion — how many people made it past step 3 —
   wants the step log aggregated and is the obvious next thing.
5. No per-tenant cap on concurrent enrollments yet. A tenant with 50,000
   customers and a `LAPSED` trigger enrolls all of them at once on the first
   sweep after it's activated. The drain is bounded so nothing falls over, but
   the first pass will be large.

---

## `TRIGGER_LABELS` lives in `lib/automation-flow.ts`, not in the canvas

It used to be exported from `FlowCanvas.tsx`, which carries `"use client"`, and
three **server** components imported it to label a table cell:
`/dashboard/marketing/automations`, that automation's detail page, and
`/admin/templates`.

That builds clean and fails at request time on all three:

```
Error: Could not find the module
".../FlowCanvas.tsx#TRIGGER_LABELS#FIRST_ORDER" in the React Client Manifest.
```

A server component importing across the client boundary receives a **client
reference proxy**, not the value. For a React component that is the whole
mechanism; for a plain object it is nonsense, and it throws during
serialization. `tsc` cannot see it — it is a bundler rule.

This is the `server-only` rule in `CLAUDE.md` pointing the other way, and the
resolution is the same one: **a value both sides need lives in the pure module,
and neither side owns it.** `lib/automation-flow.ts` already held the node
vocabulary, the validator and the trigger kinds precisely so the canvas could
import them in the browser; the labels belong beside `TRIGGER_KINDS` for the
same reason.

`FlowCanvas.tsx` now imports them like any other consumer and deliberately does
**not** re-export them — a re-export would restore the exact import path that
broke, while looking like a convenience. `npm run check:client-values` fails the
build if it comes back.
