/**
 * The reordering "done-for-you" dial: one owner preference, turned into cadence.
 *
 * This module is deliberately **pure** — no Prisma, no `server-only` — for the
 * same reason `lib/onboarding.ts` and `lib/automation-flow.ts` are: the numbers
 * it produces gate real sends, so every branch has to be unit-testable without
 * a database, and the dashboard imports it in the browser to render the status
 * card without dragging a server module across the client boundary.
 *
 * ─── What this is ─────────────────────────────────────────────────────────
 *
 * An owner does not want more marketing work; they want less. So onboarding
 * asks one yes/no question — "shall we run reordering campaigns for you?" —
 * and, if yes, offers a single dial with three positions: LIGHT, MEDIUM, HEAVY.
 * That dial is the whole product surface. Everything downstream is derived from
 * it here, in one place, so the level an owner sees and the behaviour they get
 * can never disagree — the same reason `surchargeConfigFor` in `lib/plans.ts`
 * is the only place a plan becomes money.
 *
 * ─── The rule that isn't obvious ──────────────────────────────────────────
 *
 * **The dial is cadence and reach, never consent.** A level decides two things
 * and only two: how lapsed a customer must be before they qualify for a
 * win-back (`lapseDays`), and the minimum gap between reordering messages to
 * one person (`minGapDays`). It does NOT loosen the consent gate. Even HEAVY
 * still sends through `queueMessage` / `queueEmail`, which means a STOP'd
 * customer is untouched and nothing fires in quiet hours — turning the dial up
 * can never contact someone the rules protect. If a future change makes a level
 * do anything other than move these two numbers, it has escaped its lane.
 *
 * ─── Two fields, not one ──────────────────────────────────────────────────
 *
 * `Restaurant.reorderCampaigns` (the on/off) and `Restaurant.reorderMode`
 * (which level) are separate columns on purpose, exactly like
 * `cardPaymentsEnabled` is separate from a suspension. "Off" and "which level"
 * are different questions: an owner who dials down to nothing when trade is
 * heavy should get their tuned level back when they switch it on again, not be
 * reset to the default. So turning it off preserves the mode, and callers must
 * check `enabled` — `mode` alone is half the answer.
 */

export type ReorderMode = "LIGHT" | "MEDIUM" | "HEAVY";

export type ReorderConfig = {
  /** Whether reordering campaigns run at all. Check this first — the cadence
   *  numbers below are still populated when off, so the dashboard can preview a
   *  level the owner hasn't switched on, but no send may happen while false. */
  enabled: boolean;
  mode: ReorderMode;
  /** A customer qualifies for a win-back once this many days have passed since
   *  their last order. Someone who has *never* ordered has not lapsed and is
   *  never swept in — the caller enforces `lastOrderAt: not null`, same NULL
   *  care as the "lapsed" filter in `lib/customers.ts`. */
  lapseDays: number;
  /** Minimum days between reordering messages to one customer, enforced at the
   *  send. The frequency cap the whole "turn it down when it's busy" promise
   *  rests on. */
  minGapDays: number;
};

/** Recommended default when an owner says yes but doesn't pick a level — a fast
 *  tapper still lands somewhere sane. Medium is the "steady rhythm" middle. */
export const DEFAULT_REORDER_MODE: ReorderMode = "MEDIUM";

/**
 * The dial's three positions, as numbers.
 *
 * These are a first proposed cut and the one thing in here most worth revising
 * against real send data — but they must always satisfy LIGHT ⊇ MEDIUM ⊇ HEAVY
 * in reach (a lower level qualifies fewer, waits longer) or the labels lie.
 *
 *   LIGHT  — a rare nudge to people who have clearly drifted. Barely noticeable.
 *   MEDIUM — a steady win-back rhythm. The default.
 *   HEAVY  — frequent re-engagement across a broader, less-lapsed audience.
 */
const MODE_CADENCE: Record<ReorderMode, { lapseDays: number; minGapDays: number }> = {
  LIGHT: { lapseDays: 60, minGapDays: 45 },
  MEDIUM: { lapseDays: 30, minGapDays: 21 },
  HEAVY: { lapseDays: 21, minGapDays: 14 },
};

/** Human-facing one-liners for the wizard and the dashboard card. Kept beside
 *  the numbers so a level's promise and its behaviour are edited together. */
export const MODE_BLURB: Record<ReorderMode, string> = {
  LIGHT: "An occasional nudge to customers who've drifted away.",
  MEDIUM: "A steady win-back rhythm for regulars who've cooled off.",
  HEAVY: "Frequent re-engagement across your whole reorder-able list.",
};

export const MODE_LABEL: Record<ReorderMode, string> = {
  LIGHT: "Light",
  MEDIUM: "Medium",
  HEAVY: "Heavy",
};

export const REORDER_MODES: ReorderMode[] = ["LIGHT", "MEDIUM", "HEAVY"];

/**
 * The admin-authored template each level enrolls a tenant into.
 *
 * The dial does not *contain* the journey — it *selects* one. Light, Medium and
 * Heavy are three real automation templates built and tested in the admin
 * builder (`/admin/templates`), and a tenant on a level runs an adopted copy of
 * the matching template. So the cadence, the copy, and the number of touches
 * live in the template where an admin can see and change them, and this map is
 * the only link between the owner's one-word choice and the journey that runs.
 *
 * The slug prefix `reorder-` is load-bearing: `lib/reorder-manage.ts` finds a
 * tenant's reordering automations by it, so a template outside this map is not
 * a reordering journey and won't be touched by the dial.
 */
export const REORDER_TEMPLATE_SLUGS: Record<ReorderMode, string> = {
  LIGHT: "reorder-light",
  MEDIUM: "reorder-medium",
  HEAVY: "reorder-heavy",
};

/** Every reordering template slug — the set `reorder-manage.ts` recognises. */
export const ALL_REORDER_SLUGS: string[] = Object.values(REORDER_TEMPLATE_SLUGS);

export function reorderTemplateSlug(mode: ReorderMode): string {
  return REORDER_TEMPLATE_SLUGS[mode];
}

/** True for a template slug that belongs to the reordering system. */
export function isReorderSlug(slug: string): boolean {
  return ALL_REORDER_SLUGS.includes(slug);
}

/**
 * Coerce a stored string to a known mode.
 *
 * `reorderMode` is a plain String column, not an enum, for the same reason
 * `themePreset` is: a level can be renamed without a migration touching every
 * tenant row. The cost is that an unknown value has to resolve to something,
 * and it resolves to the recommended default — an owner must never be able to
 * end up on a level that produces no defined cadence.
 */
export function coerceMode(v: string | null | undefined): ReorderMode {
  return v === "LIGHT" || v === "MEDIUM" || v === "HEAVY" ? v : DEFAULT_REORDER_MODE;
}

export type ReorderSnapshot = {
  reorderCampaigns: boolean;
  reorderMode: string | null;
};

/**
 * The config to actually use. **Call this instead of reading the columns.**
 *
 * The mode is always resolved (so a disabled tenant still reports the level
 * they'd run), but `enabled` reflects the on/off switch. Every downstream
 * caller — the enrollment sweep, the frequency cap, the dashboard card — reads
 * the verdict here rather than pairing the two columns itself, so there is one
 * definition of "is reordering running and how hard".
 */
export function reorderConfigFor(s: ReorderSnapshot): ReorderConfig {
  const mode = coerceMode(s.reorderMode);
  const cadence = MODE_CADENCE[mode];
  return {
    enabled: Boolean(s.reorderCampaigns),
    mode,
    lapseDays: cadence.lapseDays,
    minGapDays: cadence.minGapDays,
  };
}
