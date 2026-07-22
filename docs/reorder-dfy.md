# Done-for-you reordering

The working plan for the automatic reordering system. **Read this before
touching `src/lib/reorder.ts`, the reordering onboarding step, or anything that
enrolls customers into reordering journeys.**

## What it is

Getting customers to reorder is the entire reason the product collects a
customer list — and it's the thing an independent owner has neither the time nor
the appetite to do by hand. So this is done-for-you: the owner answers **one
yes/no question** in onboarding, and if yes, sets **one dial** (Light / Medium /
Heavy). The platform runs the win-back for them. Everything else is derived from
that one choice.

The owner can change the level, or switch it off entirely, anytime from the
dashboard — the "traffic's been heavy lately, dial it down" case is a
first-class one, not an edge.

## The decisions, and why they're the way they are

**One question in onboarding, level revealed only on yes.** The wizard step
(step 6, `key: "reorder"`) asks "shall we run reordering for you?" with **yes
pre-selected and recommended** and **no skip button** — it is
*required-to-answer*. The three levels appear only after yes is chosen, so the
owner sees a dial, not a form. A fast tapper who accepts the default lands on
Medium.

**Required-to-answer, never launch-gating.** This is the load-bearing
distinction and it is deliberate. `lib/onboarding.ts` gates a launch on basics,
menu and hours only — a restaurant is never stopped from handing paid-for food
to a customer over a form, which is why branding doesn't gate either. A
reordering preference is closer to branding than to hours. So the step's
`required` flag in `onboardingSteps` is **`false`** (it does not enter
`blockingSteps`, `canLaunch` ignores it), and "must decide" is enforced two
other ways: the wizard shows no skip, and `reorderChoiceAt` being null is what
makes the step read as not-done and (later) drives a dashboard nag. Making it
block launch would break `scripts/onboarding.test.ts`'s central asymmetry and
the invariant behind it.

**Two columns, not one.** `Restaurant.reorderCampaigns` (on/off) and
`Restaurant.reorderMode` (which level) are separate, exactly like
`cardPaymentsEnabled` is separate from a `ServiceSuspension`. "Off" and "which
level" are different questions: switching off preserves the tuned level so
switching back on restores it rather than resetting to Medium. `reorderChoiceAt`
is a third column — the timestamp of the last answer — because
`reorderCampaigns: false` is ambiguous between "said no" and "never asked", and
only the timestamp distinguishes them.

**The dial is cadence + reach, and it never loosens consent.** `reorderConfigFor`
in `lib/reorder.ts` is the one place a level becomes numbers —
`{ enabled, mode, lapseDays, minGapDays }` — the same choke-point shape as
`surchargeConfigFor` in `lib/plans.ts`. A level decides only two things: how
lapsed a customer must be to qualify (`lapseDays`) and the minimum gap between
reordering messages to one person (`minGapDays`). It does **not** touch the
consent gate. Even Heavy still sends through `queueMessage` / `queueEmail`, so a
STOP'd customer is untouched and nothing fires in quiet hours. **If a change
ever makes a level do anything other than move those two numbers, it has escaped
its lane.**

The first proposed cadence cut (revise against real send data; must stay
monotone — a lower level always waits longer and reaches fewer):

| Level  | `lapseDays` | `minGapDays` |
|--------|-------------|--------------|
| Light  | 60          | 45           |
| Medium | 30          | 21           |
| Heavy  | 21          | 14           |

**`reorderMode` is a String, not an enum**, like `themePreset` — a level can be
renamed without a migration touching every row. The cost is that an unknown
value must resolve to something, so `coerceMode` maps anything unrecognised to
the recommended default (Medium). A tenant must never end up on a level with no
defined cadence.

## How it actually runs

The dial does not contain a journey, it **selects** one. Light, Medium and Heavy
are three admin-authored automation templates (`reorder-light`,
`reorder-medium`, `reorder-heavy`). The owner's choice turns the matching
template on for their tenant, reusing the exact adopt / activate / pause
primitives an owner uses by hand in the builder. There is no second enrollment
path and no second sending path: a reordering message is an ordinary automation
send, so `queueMessage` enforces consent at the moment it fires.

The flow, end to end:

1. **Templates exist** because `seedReorderTemplates()` (in
   `lib/reorder-templates.ts`) created and published them. Their graphs are a
   straight line: `TRIGGER(LAPSED) → SMS → [WAIT → SMS]… → EXIT`, one to three
   texts by level. Sync policy is `ALWAYS` (ours, read-only to owners). Run from
   `prisma/seed.ts`; re-running republishes after a copy edit.
2. **Owner chooses** in onboarding or on the dashboard card.
   `setReorderChoice` writes the three columns then calls `applyReorderChoice`
   (`lib/reorder-manage.ts`), the one door. On → adopt the matching template
   (or resume it if a paused copy exists), set `reentry: COOLDOWN` with the
   level's gap, and activate. Switching level → **pause** the old level (never
   archive, so in-flight sequences finish) and start the new one. Off → pause.
3. **The sweep enrolls.** `enrollTimeTriggers` in `lib/automations.ts` already
   walks `ACTIVE` `LAPSED` automations and enrolls customers whose `lastOrderAt`
   is older than the trigger's `lapsedDays`, excluding anyone already in flight.
   The reordering automation is just one of those, so no new sweep is needed —
   the level's `lapsedDays` rides in as the trigger config, and the `COOLDOWN`
   `reentryDays` is the frequency cap.
4. **Each send** runs through `queueMessage`, which drops STOP'd customers and
   defers quiet hours. The dial chose who is considered; the gate chose who is
   contacted.

## What's built

- `src/lib/reorder.ts` — the pure choke point plus the mode→template-slug map
  (`reorderTemplateSlug`, `ALL_REORDER_SLUGS`, `isReorderSlug`). No
  `server-only`. Covered by `scripts/reorder.test.ts` (12 cases: coercion, the
  on/off-vs-level split, monotonicity, slug mapping).
- `src/lib/reorder-templates.ts` — the three template graphs, the per-level
  cadence (`lapsedDays` + `reentryDays`), and `seedReorderTemplates()`. Graphs
  verified against `validateGraph` (including a long tenant name for SMS
  segments).
- `src/lib/reorder-manage.ts` — `applyReorderChoice`, `setReorderChoice`,
  `reorderStatusFor`. The one door between the choice and the machinery;
  idempotent, and switching levels pauses rather than archives.
- Schema: `reorderCampaigns`, `reorderMode`, `reorderChoiceAt` on `Restaurant`,
  migration `36_reorder_dfy` (idempotent).
- Onboarding: non-gating step 6, `saveReorderAction` (now calls
  `setReorderChoice`), `ReorderStep` UI. Launch moved to step 7;
  `scripts/onboarding.test.ts` updated.
- Owner dashboard: `setReorderAction` and `ReorderCard` at the top of
  `/dashboard/marketing`, showing running state and reach, with one-tap on/off
  and level.
- `prisma/seed.ts` seeds the templates.

## What's left

1. **The Railway cron.** Same blocker as everything in the send queue.
   `enrollTimeTriggers` and the automation drain only run under `npm run sweep`
   on the second Railway service that still has to be created by hand (see
   `docs/deploy-sweep.md`). Until then a tenant's reordering automation is
   `ACTIVE` and correct and enrolls nobody.
2. **Seeding on non-seed environments.** `seedReorderTemplates()` runs from
   `prisma/seed.ts`; production wasn't seeded that way. It needs to run once
   there (a deploy step or an admin `/admin/tools` button) or `applyReorderChoice`
   returns "not available yet" and only saves the preference. Wiring a button is
   the clean fix.
3. **The dashboard nag** for a launched tenant with `reorderChoiceAt` still null
   (URL-hacked past the step). A gentle card, never a redirect.
## Template visibility: PRIVATE / OWNERS / PRESET

Every template carries a `visibility` an admin sets in the builder
(`AutomationTemplate.visibility`, migration `38_template_visibility`):

- **PRIVATE** — admins only. Experiments and half-built drafts. Never in the
  owner gallery.
- **OWNERS** — the DIY gallery. Owners browse and adopt these by hand. The
  default for a new template.
- **PRESET** — the done-for-you reordering templates. Shown to owners **and**
  driven by the dial, so a hands-on owner who declined the dial can still adopt
  a preset by hand.

The owner gallery (`listPublishedTemplates`) shows OWNERS + PRESET; the dial
finds its three levels by the `reorder-` slug, which is orthogonal to
visibility. Publishing is "make it adoptable", not "make it automatic" — only a
`reorder-` slug wires a template to the dial. The old `category` column was
removed (migration `37_drop_template_category`); visibility is the one
distinction that matters and the gallery query enforces it.

**Adopting opens a draft.** For OWNERS or PRESET alike, `adoptTemplate` creates
a DRAFT automation in the owner's account that they open in the builder, edit,
and activate — the copy is theirs from then on. Admins edit the template itself
the same way (its `draftGraph`, published when ready). Both sides get "open it,
build off it" for free.

**The one overlap to watch:** a PRESET is visible in the gallery, so an owner
with the dial **on** could also hand-adopt the same preset and a customer could
land in both copies (double win-back texts). Hands-on owners have no such risk.
A guard blocking hand-adopt of a preset while the dial is on is a sensible
follow-up.

**Per-level monitoring polish** (P3). `reorderStatusFor` reports
entered/in-flight for the active level; a fuller admin view (sends, opt-outs,
reorders attributed) would live off the existing automation analytics.

## The caveat that isn't a bug

Like everything else in the send queue, this is **inert until the Railway cron
exists** (see `docs/deploy-sweep.md` and `docs/post-order-gaps.md`). Hands-off
will enrol people the moment it's switched on and then not advance them until
the automation drain runs. So an owner would see a journey that looks alive with
nobody moving through it. The onboarding choice, the config, and the schema are
all real; the thing that *runs* them is the second Railway service that still
has to be created by hand. **If this looks done, check whether the thing that
runs it exists.**

## Before anything works

`npx prisma generate && npm run db:push` on a real machine — migration
`36_reorder_dfy` has never run, so `reorderCampaigns` / `reorderMode` /
`reorderChoiceAt` are missing from the generated client until it does.
