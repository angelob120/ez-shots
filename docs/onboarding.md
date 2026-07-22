# Onboarding — the completion gate

Working plan for the owner setup wizard and the rules that decide when a tenant
may open for business. **Read this before touching `src/lib/onboarding.ts`,
`src/app/onboarding/`, or the redirect in `src/app/dashboard/layout.tsx`.**

---

## Update — v1 partnership onboarding (this round)

Three changes reshaped the flow. All are in `src/lib/onboarding.ts` (pure,
tested in `scripts/onboarding.test.ts`, now 30 cases) plus the wizard pages:

1. **A required booking step** was inserted before launch: basics → branding →
   menu → hours → **booking** → finish. `booking` is required and blocks the
   finish step; `callBooked` (a non-null `nextBookingForRestaurant`) clears it.
   `LAUNCH_STEP` is now `6` and is exported so nothing hardcodes it. The booking
   step embeds the real `/book/setup` form; on success the confirmation page
   (`/booking/[token]`) shows a "what happens next" panel and a link back to
   `/onboarding` when the booker is a tenant still mid-setup.

2. **The menu step gained a "have us build it for you" path.** The manual
   builder still exists, wrapped in `MenuChoice`; the default, recommended path
   is a submission form (links, pasted text, photos, notes) that writes a
   `MenuSubmission` — a *proposal*, never a `MenuItem`, same principle as
   `lib/menu-scrape.ts`. The menu step is satisfied by `itemCount > 0 OR
   menuSubmitted`, so an owner who handed us their menu isn't blocked. Admins see
   and work the submission on `/admin/restaurants/[id]` (Overview).

3. **No more auto-approve — activation is manual.** `launchAction` now sets
   `onboardedAt` (ends the wizard, opens the dashboard) but leaves `status` at
   **PENDING**. `/r/[slug]` stays dark until an admin flips ACTIVE from the
   console after the setup call. The owner keeps full dashboard access meanwhile
   and sees a "pending activation" banner (`src/app/dashboard/layout.tsx`). The
   admin activation control is surfaced at the top of the tenant Overview when
   `status === PENDING && onboardedAt`.

The `OnboardingSnapshot` gained `menuSubmitted` and `callBooked`; every
construction site (onboarding page, onboarding actions, dashboard layout) sets
both. Needs migration `33_password_reset_and_menu_submission` — see
`docs/SETUP-your-turn.md`.

---

## What exists

Five steps: basics → branding → menu → **hours** → launch. Three of them
(basics, menu, hours) are required and block launch; branding is a real step
that can be skipped.

`src/lib/onboarding.ts` is the only module that decides what "finished" means.
It is **pure** — no Prisma, no `server-only` — so the whole gate is unit tested
against plain snapshots in `scripts/onboarding.test.ts` (28 cases).

Enforcement is in three places and all three are load-bearing:

| Where | What it stops |
|---|---|
| `dashboard/layout.tsx` redirect | An un-launched owner reaching the dashboard at all |
| `resolveStep()` | `?step=5` in the URL skipping the work |
| `launchAction()` | A stale tab, a double submit, or an owner who deleted their last item in another window |

The third is the one people delete as redundant. It isn't: hiding a control is
a courtesy and not enforcement — the same rule `seedTestRestaurantAction`
follows for `testModeEnabled`.

## The hours step is new, and it is the point

Step 1 has always collected a **free-text** `hours` string, which is printed on
the storefront and consulted for nothing. `hoursJson` is the field every
availability decision actually reads, and nothing in the wizard ever collected
it — it only existed on `/dashboard/hours`, which an owner had no reason to
visit before opening.

So the failure this fixes is specific and had no visible symptom until it bit:
an owner completes onboarding, sees their own opening times on their own
storefront, and takes an order at 4am because `checkAvailability` fails open
for a tenant with no schedule. The two fields looking interchangeable is
exactly why hours needed its own step rather than a line on an existing one.

`parseHoursForm` in `lib/hours.ts` is shared by the wizard and the dashboard.
The only difference is `requireOpenDay`, and it is not cosmetic — see below.

## Decisions worth not re-litigating

**The gate applies before launch and never after.** `onboardedAt` being set is
a one-way door. A restaurant that launched last year and has since cleared its
hours gets a **persistent banner** (`SetupGaps.tsx`), not a redirect.

This is the one place the implementation deliberately doesn't match "make it
mandatory" read literally, and the reason is concrete: `/dashboard` is the live
order board. An owner reaching it at 7pm on a Friday is looking at tickets for
food already being cooked. Putting a form in front of that to demand a schedule
be re-entered would stop them handing paid-for food to customers standing at
the counter. The cost of a gate has to fall on someone who isn't trading yet.
`gateFor()` encodes this as three states — `blocked`, `gaps`, `complete` — and
`scripts/onboarding.test.ts` asserts the asymmetry directly, with two snapshots
identical but for `onboardedAt`.

**`requireOpenDay` is on in the wizard and off on the dashboard.** Same reason.
An established tenant ticking every day off is a legitimate act (availability
fails open, they keep trading, that's documented). A tenant doing it during
onboarding has simply not answered the question.

**Step 2 is now the same editor as the dashboard.** It used to collect three
fields (accent, logo, banner) while `/dashboard/branding` collected thirty
against the same columns — so an owner who chose a look during setup met an
unrecognisable page when they wanted to change it. Both now render
`components/hearth/StorefrontEditor`; the wizard passes `variant="essentials"`,
which trims the per-page copy sections and nothing else. The trimming is a prop
rather than a second component on purpose. `saveBrandingAction` consequently
writes the full column set, which is safe because the editor submits every
field it isn't currently showing as a hidden mirror — see
`docs/storefront-customization.md`.

The preview iframe works here even though the tenant is still **PENDING**:
`/r/[slug]?preview=1` bypasses the not-live notice for the owner of that
tenant, checked server-side against the session. "Check back soon" is not a
website anyone can design against.

**Branding doesn't block.** An owner without their logo file to hand at 11pm
should still be able to open tomorrow. A missing logo makes a storefront
plainer; a missing menu makes it useless. Those don't deserve the same gate.

**The banner isn't dismissable.** A dismiss button on "your ordering page never
closes" is a button that removes the knowledge, not the problem. It goes away
when the thing is fixed and not before.

**Once complete, the UI is gone permanently.** `/onboarding` redirects to
`/dashboard` when `onboardedAt` is set, and `gateFor` returns a `complete`
variant carrying no steps — so there is no payload a caller could accidentally
render. There is no "show me the tour again" path and shouldn't be one.

**`lib/onboarding.ts` and `lib/readiness.ts` are not the same module.** The
second answers "what should an operator look at?" across every tenant —
advisory, blocks nobody. They overlap on menu and hours and deliberately
*disagree* about hours (advisory there, required here), because collapsing them
would force one of two correct answers to become wrong. Both files carry a
note. **If you change what "has a menu" or "has hours" means, change it in
both.**

## What's left

1. **Nothing has been rendered in a browser.** The gate logic is tested; the
   wizard's fifth step, the hours grid, and both banners have only been
   reasoned about.
2. **Existing tenants are unaffected and mostly un-audited.** Anyone with
   `onboardedAt` set skips the gate entirely, by design. How many live tenants
   currently have no `hoursJson` is a question worth answering with a query —
   they'll all see the new banner at once.
3. **No re-entry path.** If an owner needs to redo setup, an admin currently
   has no button for it. Nulling `onboardedAt` would work and is not exposed
   deliberately — it would un-publish a live storefront.
4. **The setup call is not a step, and must not become one.** Step 5 offers a
   booking link and the dashboard carries a persistent banner
   (`SetupCallBanner.tsx`), but `lib/onboarding.ts` does not know bookings
   exist and `blockingSteps` does not consider one. Every other required step
   is something an owner can finish alone at 11pm; a call needs *us*, so
   gating launch on it makes a restaurant that finished its menu on Sunday
   wait until Tuesday for reasons that have nothing to do with them being
   ready. The banner keys off a call being **attended**, not booked — a
   no-show has onboarded nobody. See `docs/booking.md`.
5. **The wizard doesn't collect prep time, last call, or auto-accept.** All
   four have sane defaults and none are worth asking about before a restaurant
   has taken a single order. Deliberate, not an omission.
