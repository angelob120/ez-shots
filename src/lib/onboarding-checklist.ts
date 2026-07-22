import "server-only";

/**
 * The **manual** onboarding checklist — the operator's own list for walking a
 * restaurant through going live, one door for its state and its notes.
 *
 * ─── Why this exists next to `lib/readiness.ts` ───────────────────────────
 *
 * `lib/readiness.ts` *derives* what the database already knows: a menu exists,
 * hours are set, a Stripe account is connected. It needs no storage because the
 * answer is recomputed from the tenant's rows every time.
 *
 * This module is the other half — the steps that happen on a phone call and
 * leave no row behind: "tested a live order end to end", "walked the owner
 * through the board", "confirmed the surcharge shows on the receipt", "call
 * attended". None of that is derivable, so it has to be *recorded*, and it has
 * to persist until the operator ticks it. The two are deliberately separate:
 * merging them would force a derived fact and a human judgement to share a
 * representation, and one of them would end up lying.
 *
 * ─── Registry is code, state is a table ───────────────────────────────────
 *
 * The step *catalog* below is code, the same choice as `lib/legal.ts` and
 * `lib/help-articles.ts`: a step can be added, reworded, or reordered without a
 * migration, and a step that's removed simply stops being read. `OnboardingTask`
 * stores only the per-tenant tick (`done`, who, when). A row whose `key` no
 * longer appears in the catalog is ignored, never an error — the checklist must
 * never be the thing that discovers a step went away.
 *
 * ─── Notes are ours ───────────────────────────────────────────────────────
 *
 * `OnboardingNote` is an admin's running commentary on an account — "left a
 * voicemail", "waiting on their Stripe verification". A separate table rather
 * than a visibility flag, the same rule `CustomerAdminNote` and `SupportNote`
 * carry. Nothing under `src/app/dashboard/` may read it.
 */

import { prisma } from "@/lib/prisma";

export type OnboardingStep = {
  key: string;
  label: string;
  /** The one-line "why" or "how", shown under the label. */
  detail: string;
  /** Deep-link to the tenant tab where this step actually gets done, if any. */
  tab?: string;
};

export type OnboardingSection = {
  key: string;
  title: string;
  steps: OnboardingStep[];
};

/**
 * The catalog. Mirrors the operator's paper checklist, grouped by the order the
 * work actually happens in — an account can't take a live order until account,
 * menu, and hours are done, so those come first.
 *
 * Keys are stable strings; **renaming a key orphans its saved ticks**, so change
 * a `label` freely but treat a `key` as permanent once it has shipped.
 */
export const ONBOARDING_SECTIONS: OnboardingSection[] = [
  {
    key: "account",
    title: "Account & basics",
    steps: [
      {
        key: "invite_sent",
        label: "Invite link sent to owner",
        detail: "Single-use link — never set a password for them.",
        tab: "people",
      },
      {
        key: "invite_redeemed",
        label: "Owner signed in",
        detail: "Confirm they redeemed the invite and can reach the dashboard.",
        tab: "people",
      },
      {
        key: "basics",
        label: "Name, address, phone entered",
        detail: "The business details the storefront and receipts print.",
      },
      {
        key: "timezone",
        label: "Timezone set correctly",
        detail: "Every hours and booking decision is made in this timezone — a wrong one breaks ordering silently.",
      },
    ],
  },
  {
    key: "menu",
    title: "Menu",
    steps: [
      {
        key: "menu_imported",
        label: "Menu imported and committed",
        detail: "Link or CSV import, reviewed and pressed Import — a scraped menu is only a proposal until then.",
      },
      {
        key: "price_scale",
        label: "Price scale checked for the whole menu",
        detail: "Cents vs dollars — confirm nothing is 100x off. Decided for the whole menu at once.",
      },
      {
        key: "modifiers_ok",
        label: "Modifiers didn't import as dishes",
        detail: "Spot-check that options (sizes, add-ons) stayed as modifiers.",
      },
      {
        key: "menu_spotcheck",
        label: "Spot-checked items and prices",
        detail: "3–5 items against the real menu.",
      },
    ],
  },
  {
    key: "hours",
    title: "Hours & availability",
    steps: [
      {
        key: "hours_set",
        label: "Weekly hours configured",
        detail: "A tenant with no schedule fails open and never closes — don't leave it blank by accident.",
        tab: "overview",
      },
      {
        key: "closures",
        label: "Last-call cutoff and any closures set",
        detail: "If they want them.",
      },
      {
        key: "hours_verified",
        label: "Storefront shows open/closed correctly",
        detail: "Checked against their real open hours.",
      },
    ],
  },
  {
    key: "branding",
    title: "Branding & storefront",
    steps: [
      {
        key: "branding_set",
        label: "Logo, theme, and accent set",
        detail: "Previewed the live storefront on mobile.",
      },
      {
        key: "domain",
        label: "Custom domain verified (if any)",
        detail: "Verified with us AND active at the edge. Apex gets a www twin.",
        tab: "domain",
      },
    ],
  },
  {
    key: "payments",
    title: "Payments",
    steps: [
      {
        key: "stripe_connected",
        label: "Stripe Connect completed",
        detail: "Charges enabled on their connected account.",
        tab: "payments",
      },
      {
        key: "mode_live",
        label: "Payment mode is LIVE",
        detail: "Not TEST/STUB — those let customers check out with no money arriving.",
      },
      {
        key: "test_order",
        label: "Live test order placed and refunded",
        detail: "Confirmed the charge landed on THEIR account and the surcharge shows as its own line.",
      },
      {
        key: "webhook",
        label: "Webhook listens on connected accounts",
        detail: "Without this, payment status silently stops updating.",
      },
    ],
  },
  {
    key: "plan",
    title: "Plan & messaging",
    steps: [
      {
        key: "plan_set",
        label: "Correct plan set",
        detail: "Owner understands who pays the fee on their plan.",
        tab: "pricing",
      },
      {
        key: "tax_set",
        label: "Sales-tax rate entered",
        detail: "By the owner.",
        tab: "pricing",
      },
      {
        key: "consent_explained",
        label: "Consent rules explained",
        detail: "SMS is opt-in (checkout only); email is opt-out; an import grants no consent.",
      },
    ],
  },
  {
    key: "golive",
    title: "Go-live",
    steps: [
      {
        key: "board_walkthrough",
        label: "Owner walked through the order board",
        detail: "They know how to accept, reject, and refund.",
      },
      {
        key: "call_attended",
        label: "Onboarding call attended",
        detail: "Attended, not just booked — a no-show has onboarded nobody.",
      },
      {
        key: "activated",
        label: "Account activated",
        detail: "Switched on and ready for real orders.",
      },
      {
        key: "followup",
        label: "Followed up after first day of orders",
        detail: "Confirmed notifications are reaching customers.",
      },
    ],
  },
];

/** Every step key in the catalog, flat. */
export const ALL_STEP_KEYS: string[] = ONBOARDING_SECTIONS.flatMap((s) =>
  s.steps.map((step) => step.key),
);

const STEP_KEY_SET = new Set(ALL_STEP_KEYS);
const MAX_NOTE_LENGTH = 2000;
const MAX_LABEL_LENGTH = 120;
const MAX_DETAIL_LENGTH = 300;

/** `{ [stepKey]: { label?, detail? } }` — operator edits over the code catalog. */
export type StepOverrides = Record<string, { label?: string; detail?: string }>;

/**
 * Read the operator's wording overrides from the platform singleton. Tolerant
 * of a malformed blob — a bad override should fall back to the code default,
 * never throw and take the checklist down with it.
 */
async function readOverrides(): Promise<StepOverrides> {
  try {
    const row = await prisma.platformSetting.findUnique({
      where: { id: "singleton" },
      select: { onboardingStepOverrides: true },
    });
    const raw = row?.onboardingStepOverrides;
    return raw && typeof raw === "object" ? (raw as StepOverrides) : {};
  } catch {
    return {};
  }
}

/** Apply an override to one step's wording. Pure. */
function applyOverride(step: OnboardingStep, ov: StepOverrides): OnboardingStep {
  const o = ov[step.key];
  if (!o) return step;
  return {
    ...step,
    label: o.label?.trim() || step.label,
    detail: o.detail?.trim() || step.detail,
  };
}

export type ChecklistStepState = OnboardingStep & {
  done: boolean;
  completedByName: string | null;
  completedAt: Date | null;
};

export type ChecklistSectionState = {
  key: string;
  title: string;
  steps: ChecklistStepState[];
  done: number;
  total: number;
};

export type ChecklistState = {
  sections: ChecklistSectionState[];
  done: number;
  total: number;
  /** True once every catalog step is ticked. This is the "action item done" signal. */
  complete: boolean;
};

/**
 * Merge the code catalog with the tenant's saved ticks into one view. Pure over
 * its inputs so the shape is easy to reason about; `getChecklist` is the async
 * wrapper that supplies the rows.
 */
export function mergeChecklist(
  done: Map<string, { completedByName: string | null; completedAt: Date | null }>,
  overrides: StepOverrides = {},
): ChecklistState {
  let doneCount = 0;
  const sections = ONBOARDING_SECTIONS.map((section) => {
    const steps: ChecklistStepState[] = section.steps.map((base) => {
      const step = applyOverride(base, overrides);
      const hit = done.get(step.key);
      if (hit) doneCount++;
      return {
        ...step,
        done: Boolean(hit),
        completedByName: hit?.completedByName ?? null,
        completedAt: hit?.completedAt ?? null,
      };
    });
    return {
      key: section.key,
      title: section.title,
      steps,
      done: steps.filter((s) => s.done).length,
      total: steps.length,
    };
  });

  const total = ALL_STEP_KEYS.length;
  return { sections, done: doneCount, total, complete: doneCount >= total };
}

/** The tenant's checklist, catalog merged with saved state and wording overrides. */
export async function getChecklist(restaurantId: string): Promise<ChecklistState> {
  const [rows, overrides] = await Promise.all([
    prisma.onboardingTask.findMany({
      where: { restaurantId, done: true },
      select: { key: true, completedByName: true, completedAt: true },
    }),
    readOverrides(),
  ]);
  const done = new Map<string, { completedByName: string | null; completedAt: Date | null }>(
    rows.map((r: { key: string; completedByName: string | null; completedAt: Date | null }) => [
      r.key,
      { completedByName: r.completedByName, completedAt: r.completedAt },
    ]),
  );
  return mergeChecklist(done, overrides);
}

// ---------------------------------------------------------------------------
// Editing the wording — platform-wide, no code deploy
// ---------------------------------------------------------------------------

export type EditableStep = OnboardingStep & { sectionTitle: string; isEdited: boolean };

/**
 * The flat step list with current (possibly overridden) wording, for the
 * "edit the checklist text" UI. Carries the code default alongside so the form
 * can show what was changed and offer a reset.
 */
export async function getStepTemplate(): Promise<EditableStep[]> {
  const overrides = await readOverrides();
  return ONBOARDING_SECTIONS.flatMap((section) =>
    section.steps.map((base) => ({
      ...applyOverride(base, overrides),
      sectionTitle: section.title,
      isEdited: Boolean(overrides[base.key]),
    })),
  );
}

/**
 * Rewrite one step's label and/or detail. Blank fields reset that string to the
 * code default (by clearing the override), so an operator can always get back to
 * the shipped wording. Unknown keys are refused.
 */
export async function setStepText(key: string, label: string, detail: string) {
  if (!STEP_KEY_SET.has(key)) return { ok: false as const, error: "Unknown step." };
  const overrides = await readOverrides();
  const cleanLabel = label.trim().slice(0, MAX_LABEL_LENGTH);
  const cleanDetail = detail.trim().slice(0, MAX_DETAIL_LENGTH);

  const next: StepOverrides = { ...overrides };
  const entry: { label?: string; detail?: string } = {};
  if (cleanLabel) entry.label = cleanLabel;
  if (cleanDetail) entry.detail = cleanDetail;

  if (Object.keys(entry).length === 0) {
    delete next[key]; // both blank → back to code defaults
  } else {
    next[key] = entry;
  }

  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", onboardingStepOverrides: next },
    update: { onboardingStepOverrides: next },
  });
  return { ok: true as const };
}

/**
 * Tick or un-tick a step. Upsert on the (restaurant, key) unique index so a
 * double-click can't split into two rows. Unknown keys are refused rather than
 * stored — a typo shouldn't create an orphan that inflates the count.
 */
export async function setStep(
  restaurantId: string,
  key: string,
  done: boolean,
  author: { id?: string; name?: string },
) {
  if (!STEP_KEY_SET.has(key)) return { ok: false as const, error: "Unknown step." };
  await prisma.onboardingTask.upsert({
    where: { restaurantId_key: { restaurantId, key } },
    create: {
      restaurantId,
      key,
      done,
      completedByName: done ? author.name ?? null : null,
      completedAt: done ? new Date() : null,
    },
    update: {
      done,
      completedByName: done ? author.name ?? null : null,
      completedAt: done ? new Date() : null,
    },
  });
  return { ok: true as const };
}

/** The two note streams. "onboarding" while getting a tenant live, "account" after. */
export type NoteKind = "onboarding" | "account";
const NOTE_KINDS: NoteKind[] = ["onboarding", "account"];
export function normalizeNoteKind(v: string): NoteKind {
  return NOTE_KINDS.includes(v as NoteKind) ? (v as NoteKind) : "onboarding";
}

export async function addNote(
  restaurantId: string,
  body: string,
  author: { id?: string; name?: string },
  kind: NoteKind = "onboarding",
) {
  const clean = body.trim().slice(0, MAX_NOTE_LENGTH);
  if (!clean) return { ok: false as const, error: "Write something first." };
  await prisma.onboardingNote.create({
    data: {
      restaurantId,
      kind: normalizeNoteKind(kind),
      body: clean,
      authorUserId: author.id ?? null,
      authorName: author.name ?? null,
    },
  });
  return { ok: true as const };
}

export async function listNotes(restaurantId: string, kind: NoteKind = "onboarding") {
  return prisma.onboardingNote.findMany({
    where: { restaurantId, kind: normalizeNoteKind(kind) },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function deleteNote(id: string, restaurantId: string) {
  // Scoped to the tenant so an id from one page can't delete another's note.
  await prisma.onboardingNote.deleteMany({ where: { id, restaurantId } });
}
