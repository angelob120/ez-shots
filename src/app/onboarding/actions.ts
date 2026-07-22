"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { moneyToCents } from "@/lib/money";
import { importMenuCsvText, type ImportSummary } from "@/lib/menu-import";
import { SEED_MENU, SEED_CATEGORIES } from "@/lib/test-data";
import { testModeEnabled } from "@/lib/payments";
import { parseHoursForm, parseWeeklyHours, hasSchedule } from "@/lib/hours";
import { canLaunch, LAUNCH_STEP, nextStep, type OnboardingSnapshot } from "@/lib/onboarding";
import { coerceMode } from "@/lib/reorder";
import { setReorderChoice } from "@/lib/reorder-manage";
import { nextBookingForRestaurant } from "@/lib/bookings";
import { siteContentFromForm } from "@/lib/site-content";
import { storeTheme } from "@/lib/store-theme";

type Result = { error?: string; ok?: string } | undefined;

const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * CSV import during onboarding. Images are NOT re-hosted here — the site isn't
 * live yet and photo upload is deferred until after launch — but any image
 * URLs in the file are preserved in the parse so the owner is told they'll add
 * photos later.
 */
export async function importMenuCsvOnboardingAction(
  _prev: ImportSummary | undefined,
  formData: FormData
): Promise<ImportSummary> {
  const { restaurantId } = await requireOwner();

  const empty: ImportSummary = {
    created: 0,
    categoriesCreated: 0,
    imagesRehosted: 0,
    imagesFailed: 0,
    warnings: [],
  };

  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "Choose a .csv file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { ...empty, error: "That file is too large (max 2 MB)." };
  }

  const text = await file.text();
  const summary = await importMenuCsvText(restaurantId, text, { rehostImages: false });

  await markStep(restaurantId, 3);
  revalidatePath("/onboarding");
  return summary;
}

/** Records progress without ever moving an owner backwards. */
async function markStep(restaurantId: string, step: number) {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { onboardingStep: true },
  });
  if (r && r.onboardingStep < step) {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { onboardingStep: step } });
  }
}

/** Step 1 — the basics a customer needs to actually pick up an order. */
export async function saveBasicsAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();

  if (!name) return { error: "Restaurant name is required." };
  if (!address) return { error: "Customers need a pickup address." };
  if (!phone) return { error: "A phone number is required so customers can reach you." };

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      name,
      phone,
      address,
      city: String(formData.get("city") || "") || null,
      hours: String(formData.get("hours") || "") || null,
      tagline: String(formData.get("tagline") || "") || null,
    },
  });

  await markStep(restaurantId, 1);
  redirect("/onboarding?step=2");
}

/**
 * Step 2 — the website. Still skippable; defaults still look fine without it.
 *
 * This used to collect three fields (accent, logo, banner) and the dashboard
 * collected thirty. Same columns, two different forms, and an owner who chose a
 * look during setup met an unrecognisable page when they wanted to change it.
 * Both surfaces now render `components/hearth/StorefrontEditor`, so this action
 * receives the same FormData shape as `updateBrandingAction` and writes the
 * same columns — the only difference is where it redirects afterwards.
 *
 * The editor submits every field it isn't currently showing as a hidden mirror
 * (see `HiddenFields` there), which is what makes writing the full set safe
 * from a wizard step that only displays three panels.
 */
export async function saveBrandingAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const accent = String(formData.get("accentColor") || "").trim();
  if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) {
    return { error: "Accent color must be a hex value like #3b82f6." };
  }

  const name = String(formData.get("name") ?? "").trim();

  const galleryUrls = formData
    .getAll("gallery")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, 6);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      // Step 1 set the name; the editor shows it again because it is the
      // biggest thing on the page being previewed. An empty submit is a
      // trimmed variant that never rendered the field, not an owner clearing
      // their restaurant's name.
      ...(name ? { name } : {}),
      tagline: String(formData.get("tagline") || "") || null,
      accentColor: accent || "#3b82f6",
      themePreset: storeTheme(String(formData.get("themePreset") ?? "")).id,
      theme: ["LIGHT", "DARK", "SYSTEM"].includes(String(formData.get("theme")))
        ? String(formData.get("theme"))
        : "SYSTEM",
      logoUrl: String(formData.get("logoUrl") || "") || null,
      heroUrl: String(formData.get("heroUrl") || "") || null,
      address: String(formData.get("address") || "") || null,
      city: String(formData.get("city") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      hours: String(formData.get("hours") || "") || null,
      heroHeadline: String(formData.get("heroHeadline") || "") || null,
      heroCtaLabel: String(formData.get("heroCtaLabel") || "") || null,
      aboutTitle: String(formData.get("aboutTitle") || "") || null,
      aboutBody: String(formData.get("aboutBody") || "") || null,
      galleryUrls,
      showAbout: formData.get("showAbout") === "on",
      showGallery: formData.get("showGallery") === "on",
      siteContent: siteContentFromForm(formData) as object,
    },
  });

  await markStep(restaurantId, 2);
  redirect("/onboarding?step=3");
}

/** Step 3 — first menu items. One item is the bar to move on. */
export async function addFirstItemAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  const priceCts = moneyToCents(String(formData.get("price") ?? ""));
  const categoryId = String(formData.get("categoryId") ?? "") || null;

  if (!name) return { error: "Item name is required." };
  if (priceCts <= 0) return { error: "Price must be greater than zero." };

  if (categoryId) {
    const cat = await prisma.menuCategory.findFirst({ where: { id: categoryId, restaurantId } });
    if (!cat) return { error: "That category doesn't belong to this restaurant." };
  }

  const count = await prisma.menuItem.count({ where: { restaurantId } });

  await prisma.menuItem.create({
    data: {
      restaurantId,
      categoryId,
      name,
      description: String(formData.get("description") || "") || null,
      priceCts,
      sort: count,
      available: true,
    },
  });

  revalidatePath("/onboarding");
  return { ok: `Added ${name}.` };
}

/**
 * DEV / TESTING ONLY — remove before launch. One click builds a realistic
 * menu: 5 categories and ~16 items with bundled OFFLINE images (/public/
 * test-menu), so a test restaurant is fully populated instantly with no
 * network calls or uploads.
 */
export async function seedFullMenuAction(_prev: Result, _formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  // The button is hidden when test tools are off; enforce it here too. An owner
  // who seeds sixteen fake menu items into their real restaurant mid-setup has
  // a mess to clean up that looks, to them, like the product malfunctioning.
  if (!(await testModeEnabled())) {
    return { error: "That's a test tool and it isn't switched on." };
  }

  // Reuse existing categories (case-insensitive), create the rest.
  const existing = await prisma.menuCategory.findMany({
    where: { restaurantId },
    select: { id: true, name: true, sort: true },
  });
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c.id]));
  let catSort = existing.reduce((m, c) => Math.max(m, c.sort), -1) + 1;

  for (const catName of SEED_CATEGORIES) {
    if (byName.has(catName.toLowerCase())) continue;
    const created = await prisma.menuCategory.create({
      data: { restaurantId, name: catName, sort: catSort++ },
    });
    byName.set(catName.toLowerCase(), created.id);
  }

  let sort = await prisma.menuItem.count({ where: { restaurantId } });
  for (const item of SEED_MENU) {
    await prisma.menuItem.create({
      data: {
        restaurantId,
        categoryId: byName.get(item.category.toLowerCase()) ?? null,
        name: item.name,
        description: item.description,
        priceCts: Math.round(item.price * 100),
        imageUrl: item.image,
        featured: item.featured ?? false,
        available: true,
        sort: sort++,
      },
    });
  }

  await markStep(restaurantId, 3);
  revalidatePath("/onboarding");
  return { ok: `Added ${SEED_MENU.length} items across ${SEED_CATEGORIES.length} categories.` };
}

/**
 * Step 3, the "have us build it for you" path.
 *
 * Captures whatever the owner already has — links, pasted menu text, photos of
 * a printed menu — as a `MenuSubmission`. This is a *submission*, never a menu:
 * nothing here writes a `MenuItem`. We build the menu by hand from it before
 * the setup call. A submission satisfies the onboarding menu gate, so the owner
 * isn't blocked waiting on us.
 *
 * Requires at least one real signal — an empty submission is a step skipped,
 * not a menu handed over, and would clear the gate while giving us nothing to
 * work from.
 */
export async function submitMenuForBuildAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const links = String(formData.get("links") ?? "")
    .split(/[\n,]+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);

  const pastedText = String(formData.get("pastedText") ?? "").trim().slice(0, 20_000) || null;
  const notes = String(formData.get("notes") ?? "").trim().slice(0, 4_000) || null;

  const photoUrls = formData
    .getAll("photo")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, 8);

  if (links.length === 0 && !pastedText && photoUrls.length === 0) {
    return {
      error:
        "Add at least one thing — a link, your menu text, or a photo — so we have something to build from.",
    };
  }

  await prisma.menuSubmission.create({
    data: { restaurantId, links, pastedText, photoUrls, notes },
  });

  await markStep(restaurantId, 3);
  revalidatePath("/onboarding");
  return { ok: "Got it — we'll build your menu and go through it on your setup call." };
}

export async function removeFirstItemAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const item = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
  if (!item) return;
  await prisma.menuItem.delete({ where: { id } });
  revalidatePath("/onboarding");
}

export async function finishMenuStepAction() {
  const { restaurantId } = await requireOwner();
  // Either typed items OR a "build it for me" submission clears the menu step.
  const [count, submissions] = await Promise.all([
    prisma.menuItem.count({ where: { restaurantId } }),
    prisma.menuSubmission.count({ where: { restaurantId } }),
  ]);
  if (count === 0 && submissions === 0) return;
  await markStep(restaurantId, 3);
  redirect("/onboarding?step=4");
}

/**
 * Step 4 — opening hours.
 *
 * `requireOpenDay` is on here and off on the dashboard's version of this form,
 * and that asymmetry is the whole reason this step exists. See the note on
 * `parseHoursForm` in lib/hours.ts: availability fails open, so a tenant that
 * finishes onboarding with an empty schedule is a tenant taking 3am orders on
 * its first night.
 */
export async function saveOnboardingHoursAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const parsed = parseHoursForm((k) => formData.get(k) as string | null, { requireOpenDay: true });
  if (parsed.error) return { error: parsed.error };

  const timezone = String(formData.get("timezone") ?? "America/New_York");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { error: "That timezone isn't recognized." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { hoursJson: parsed.hours, timezone },
  });

  await markStep(restaurantId, 4);
  revalidatePath("/onboarding");
  // Step 5 is now the required setup-call booking; launch moved to step 6.
  redirect("/onboarding?step=5");
}

/** Reads the snapshot `lib/onboarding.ts` judges. One shape, one query. */
async function snapshot(restaurantId: string): Promise<OnboardingSnapshot | null> {
  const r = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      onboardedAt: true,
      onboardingStep: true,
      name: true,
      phone: true,
      address: true,
      hoursJson: true,
      logoUrl: true,
      heroUrl: true,
      reorderChoiceAt: true,
      _count: { select: { items: true, menuSubmissions: true } },
    },
  });
  if (!r) return null;

  const callBooked = (await nextBookingForRestaurant(restaurantId)) !== null;

  return {
    onboardedAt: r.onboardedAt,
    onboardingStep: r.onboardingStep,
    name: r.name,
    phone: r.phone,
    address: r.address,
    hasSchedule: hasSchedule(parseWeeklyHours(r.hoursJson)),
    itemCount: r._count.items,
    menuSubmitted: r._count.menuSubmissions > 0,
    callBooked,
    reorderChosen: r.reorderChoiceAt !== null,
    logoUrl: r.logoUrl,
    heroUrl: r.heroUrl,
  };
}

/**
 * Step 6 — the reordering choice.
 *
 * One yes/no plus, when yes, a level. Writing `reorderChoiceAt` is what records
 * that the owner answered at all — the step is required-to-answer, and this
 * timestamp is the only thing that distinguishes "chose off" from "never
 * asked", which is why `reorderCampaigns: false` alone can't stand in for it.
 *
 * The level is validated here rather than trusted from the form: a mode is a
 * cadence downstream, and an unrecognised one has to resolve to the default
 * rather than produce no schedule. `coerceMode` is the same guard the choke
 * point applies on read, applied once more at the write so a bad value never
 * lands in the column in the first place.
 *
 * This does NOT enroll the tenant into anything or send a message. Enrollment
 * is the sweep's job (see docs/reorder-dfy.md) and, like everything else in
 * that queue, is inert until the Railway cron exists — so saving a preference
 * here is a promise the drain keeps, not a send.
 */
export async function saveReorderAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const on = String(formData.get("reorderCampaigns") ?? "") === "on";
  const mode = coerceMode(String(formData.get("reorderMode") ?? ""));

  // Writes the two columns and the timestamp, then reconciles the machinery —
  // adopting and starting the matching reordering template when on. The apply
  // half may fail harmlessly (templates not seeded on this environment, or
  // messaging suspended); the owner's choice is already persisted either way,
  // so the wizard never blocks on it. The dashboard card reports the real
  // running state afterwards.
  await setReorderChoice(restaurantId, on, mode);

  await markStep(restaurantId, 6);
  revalidatePath("/onboarding");
  redirect(`/onboarding?step=${LAUNCH_STEP}`);
}

/**
 * The final step — "finish setup". Marks the wizard complete and hands the
 * tenant to us for review.
 *
 * **This deliberately does NOT flip the tenant to ACTIVE.** A v1 launch is a
 * partnership: we meet every new owner on their setup call before switching
 * their account on. So this sets `onboardedAt` (which grants full dashboard
 * access and ends the wizard) but leaves `status` at PENDING, and `/r/[slug]`
 * stays dark until an admin activates it from the console. The owner keeps the
 * whole back end in the meantime — they just aren't taking public orders yet.
 *
 * The gate is re-checked **here**, not only on the page that renders the
 * button. Hiding a control is a courtesy and not enforcement — the same rule
 * `seedTestRestaurantAction` follows for `testModeEnabled`. A stale tab, a
 * double submit, or an owner who deleted their last menu item in another
 * window all arrive here with the button having looked perfectly valid.
 */
export async function launchAction(): Promise<void> {
  const { restaurantId } = await requireOwner();

  const s = await snapshot(restaurantId);
  if (!s) redirect("/onboarding");
  if (!canLaunch(s)) redirect(`/onboarding?step=${nextStep(s)}&blocked=1`);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    // status stays PENDING on purpose — activation is a manual admin step
    // after the setup call. onboardedAt is what ends the wizard and opens the
    // dashboard.
    data: { onboardingStep: LAUNCH_STEP, onboardedAt: new Date() },
  });

  revalidatePath("/dashboard");
  redirect("/dashboard?welcome=1");
}
