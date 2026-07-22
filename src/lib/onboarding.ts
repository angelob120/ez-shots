/**
 * What a new tenant must finish before they are let out of the wizard.
 *
 * One module decides this, and it is deliberately **pure** — no Prisma import,
 * no `server-only`. Every function here takes a plain snapshot and returns a
 * verdict, which is what lets the whole gate be unit tested without a database.
 * The callers do the reading.
 *
 * ─── Why a gate at all ────────────────────────────────────────────────────
 *
 * The wizard used to be advisory past step 1. An owner could reach `/dashboard`
 * with no schedule and no items, which produces two specific failures that both
 * look like the product is broken:
 *
 * - **No items**: `/r/[slug]` renders an empty page. Customers who followed a
 *   link from a Google listing see a restaurant that sells nothing.
 * - **No schedule**: `lib/hours.ts` *fails open* by design, so ordering never
 *   closes. That is the right default for a tenant who once had hours and
 *   cleared them; for a tenant who never set any it means 3am orders into an
 *   empty kitchen, which is the single most common "why did this happen"
 *   support call.
 *
 * ─── The rule that isn't obvious ──────────────────────────────────────────
 *
 * **The gate applies to the wizard, never to a tenant already trading.**
 * `onboardedAt` being set is a one-way door. A restaurant that completed
 * onboarding last year and has since cleared its hours must NOT be locked out
 * of `/dashboard` — that page is the live order board, and blocking it during
 * a dinner rush to demand a form be filled in would stop them serving food.
 * The cost of the gate has to fall on someone who isn't trading yet.
 *
 * So: hard block *before* launch, persistent nag *after*. `gateFor` returns
 * "blocked" only when `onboardedAt` is null. `docs/onboarding.md` records this,
 * because "make onboarding mandatory" reads like it should apply to everyone
 * and the reason it doesn't is invisible from the requirement.
 *
 * ─── Not to be confused with `lib/readiness.ts` ───────────────────────────
 *
 * That module answers "what should an operator look at?" for the admin
 * console — advisory, cross-tenant, blocks nobody. This one is the gate. They
 * overlap on menu and hours and deliberately disagree about hours: advisory
 * there because an established tenant with no schedule keeps trading, required
 * here because a tenant that has never set one must not launch. See the note
 * at the top of that file. **If you change what "has a menu" or "has hours"
 * means, change it in both.**
 */

export type OnboardingStepKey =
  | "basics"
  | "branding"
  | "menu"
  | "hours"
  | "booking"
  | "reorder"
  | "launch";

export type OnboardingSnapshot = {
  onboardedAt: Date | null;
  onboardingStep: number;
  name: string;
  phone: string | null;
  address: string | null;
  /** True when `hoursJson` parses to a schedule with at least one open day. */
  hasSchedule: boolean;
  itemCount: number;
  /**
   * True when the owner asked us to build their menu for them (a
   * `MenuSubmission` exists). The menu step is satisfied by *either* real items
   * or a submission — an owner who handed over their menu is not blocked
   * waiting on us to type it in. See `MenuSubmission` in schema.prisma.
   */
  menuSubmitted: boolean;
  /**
   * True when a setup call has been booked (`nextBookingForRestaurant` is
   * non-null). Booking is a **required** step now — a v1 launch is a
   * partnership, and we meet the owner before their account is activated. The
   * call being *booked* clears the gate; it being *attended* is what an admin
   * confirms before flipping the tenant live.
   */
  callBooked: boolean;
  /**
   * True once the owner has answered the reordering question (yes or no) —
   * `Restaurant.reorderChoiceAt` is set. This step is **required-to-answer but
   * not launch-gating**: an owner must consciously decide, but a restaurant is
   * never stopped from opening over a marketing preference (the same reason
   * branding doesn't gate — see the header). So this drives whether the step
   * reads as done and whether the dashboard nags, not whether launch is
   * allowed. `reorderCampaigns` on its own doesn't tell us this: false is both
   * "said no" and "never asked".
   */
  reorderChosen: boolean;
  logoUrl: string | null;
  heroUrl: string | null;
};

/** The launch step's number. Derived, so inserting a step ahead of it doesn't
 *  leave a hardcoded `6` pointing at the wrong page. */
export const LAUNCH_STEP = 7;

export type StepState = {
  key: OnboardingStepKey;
  n: number;
  label: string;
  /** Shown in the rail and on the step itself. */
  blurb: string;
  /** Rough time cost, so the wizard doesn't feel open-ended. */
  hint: string;
  /**
   * Required steps block launch. Optional ones are real steps an owner walks
   * through and can skip — branding is the only one, because an owner without
   * their logo to hand at 11pm should still be able to open tomorrow.
   */
  required: boolean;
  done: boolean;
  /** What to say when it isn't done. Imperative, specific, no jargon. */
  todo: string;
};

/**
 * The wizard, in order.
 *
 * Hours is step 4 — after the menu, before launch — and it is new. It used to
 * be absent entirely: step 1 collected a *free-text* `hours` string for display
 * and nothing ever collected `hoursJson`, which is the field every availability
 * decision actually reads. An owner could therefore complete onboarding, see
 * their own opening times printed on their storefront, and still be taking
 * orders at 4am. The two fields looking interchangeable is exactly why this
 * needed its own step rather than a line on an existing one.
 */
export function onboardingSteps(s: OnboardingSnapshot): StepState[] {
  const basicsDone = Boolean(s.name.trim() && s.phone?.trim() && s.address?.trim());

  return [
    {
      key: "basics",
      n: 1,
      label: "Your restaurant",
      blurb:
        "Name, address and phone — what a customer sees when your link opens, and how they find you to collect.",
      hint: "About a minute",
      required: true,
      done: basicsDone,
      todo: "Add your address and phone number so customers can find you and call if something's wrong.",
    },
    {
      key: "branding",
      n: 2,
      label: "Look and feel",
      blurb:
        "Your ordering page carries your brand, not ours. A logo and one good photo does most of the work.",
      hint: "Two minutes",
      // The only skippable step. A missing logo makes a storefront plainer;
      // a missing menu makes it useless. Those don't deserve the same gate.
      required: false,
      done: Boolean(s.logoUrl || s.heroUrl),
      todo: "Add a logo or a photo. You can skip this and come back — it won't stop you opening.",
    },
    {
      key: "menu",
      n: 3,
      label: "Your menu",
      blurb:
        "Add items yourself, or hand us what you already have and we'll build it for you — free — before your setup call.",
      hint: "Longest if you do it yourself",
      required: true,
      // Either real items OR a "build it for me" submission clears this. An
      // owner who sent us their menu isn't blocked waiting on us to type it in.
      done: s.itemCount > 0 || s.menuSubmitted,
      todo: "Add at least one item, or send us your menu and we'll build it for you.",
    },
    {
      key: "hours",
      n: 4,
      label: "Opening hours",
      blurb:
        "When you're actually open. This is what closes ordering at night — without it your page takes orders at 3am.",
      hint: "A minute",
      required: true,
      done: s.hasSchedule,
      todo: "Set the days and times you're open, so ordering closes when your kitchen does.",
    },
    {
      key: "booking",
      n: 5,
      label: "Book your setup call",
      blurb:
        "A quick call with us before you go live. We look over your menu together and switch your account on.",
      hint: "Pick a time",
      // Required now. This is the partnership gate — we meet every new owner
      // before activating their account, so onboarding can't complete without a
      // call on the calendar.
      required: true,
      done: s.callBooked,
      todo: "Pick a time for your setup call — we activate your account after we talk.",
    },
    {
      key: "reorder",
      n: 6,
      label: "Bringing customers back",
      blurb:
        "The whole point of collecting your customer list is getting people to reorder. Let us run that for you — or keep it in your own hands.",
      hint: "One question",
      // Required-to-answer, never launch-gating. The wizard shows no skip and
      // recommends yes, but a restaurant is not held back from taking orders
      // over a marketing preference — so this is `false` here (it doesn't block
      // launch) and the "must decide" is enforced in the UI plus the persistent
      // nag, exactly as agreed. Treating it as blocking would break the
      // invariant that only basics, menu and hours gate a launch.
      required: false,
      done: s.reorderChosen,
      todo: "Choose whether we run reordering campaigns for you. We recommend letting us.",
    },
    {
      key: "launch",
      n: LAUNCH_STEP,
      label: "Finish setup",
      blurb: "Submit your page for review. We activate it right after your setup call.",
      hint: "Thirty seconds",
      required: true,
      // Launch is done when the tenant has actually finished the wizard; it
      // can't be "completed" any other way.
      done: s.onboardedAt !== null,
      todo: "Submit your ordering page for activation.",
    },
  ];
}

/** The steps that block launch and aren't finished. Empty means ready. */
export function blockingSteps(s: OnboardingSnapshot): StepState[] {
  return onboardingSteps(s).filter((x) => x.required && x.key !== "launch" && !x.done);
}

export function canLaunch(s: OnboardingSnapshot): boolean {
  return blockingSteps(s).length === 0;
}

/**
 * Where an owner should be sent when they land on the wizard.
 *
 * The first unfinished *required* step, not the furthest one reached. An owner
 * who did steps 1–4, skipped branding, and came back a day later should land on
 * whatever still blocks them rather than on the last page they happened to see.
 * Falls through to launch once nothing blocks.
 */
export function nextStep(s: OnboardingSnapshot): number {
  const blocking = blockingSteps(s);
  return blocking.length > 0 ? blocking[0].n : LAUNCH_STEP;
}

/**
 * Clamp a requested step to one the owner is allowed to open.
 *
 * They may revisit anything already reached, and move forward one step at a
 * time — but they may not jump to launch with required work outstanding, which
 * is the only rule here with teeth. Everything else is navigation comfort.
 */
export function resolveStep(s: OnboardingSnapshot, requested: number | null): number {
  const steps = onboardingSteps(s);
  const furthest = Math.max(s.onboardingStep, 1);
  const target = requested && Number.isFinite(requested) ? requested : nextStep(s);

  const clamped = Math.min(Math.max(target, 1), steps.length);

  // Launch is reachable only when it's genuinely reachable. Otherwise bounce
  // to the first thing standing in the way — with the reason visible, which
  // the page does — rather than showing a Go Live button that refuses.
  if (clamped === LAUNCH_STEP && !canLaunch(s)) return nextStep(s);

  // Don't let someone skip several steps ahead by editing the URL. One past
  // the furthest reached is allowed, because that's just "next".
  return Math.min(clamped, Math.max(furthest + 1, nextStep(s)));
}

export type Gate =
  | { state: "blocked"; steps: StepState[]; next: number }
  | { state: "complete" }
  | { state: "gaps"; steps: StepState[] };

/**
 * The verdict every caller wants.
 *
 * - `blocked` — still in the wizard with required work outstanding. The
 *   dashboard redirects to `/onboarding`.
 * - `gaps` — already launched, but something required has since been cleared.
 *   Nag, never block. See the header for why this distinction is load-bearing.
 * - `complete` — nothing to say, and nothing to render. Once a tenant is here
 *   the onboarding UI is gone permanently.
 */
export function gateFor(s: OnboardingSnapshot): Gate {
  const outstanding = blockingSteps(s);

  if (s.onboardedAt === null) {
    return outstanding.length > 0
      ? { state: "blocked", steps: outstanding, next: nextStep(s) }
      : { state: "blocked", steps: [], next: LAUNCH_STEP };
  }

  return outstanding.length > 0 ? { state: "gaps", steps: outstanding } : { state: "complete" };
}

/** Progress for the rail: how many required steps are behind them. */
export function progress(s: OnboardingSnapshot): { done: number; total: number; pct: number } {
  const required = onboardingSteps(s).filter((x) => x.required && x.key !== "launch");
  const done = required.filter((x) => x.done).length;
  return {
    done,
    total: required.length,
    pct: required.length ? Math.round((done / required.length) * 100) : 100,
  };
}
