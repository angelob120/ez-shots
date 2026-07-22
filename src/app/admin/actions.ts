"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { hashPassword, requireAdmin, setSession } from "@/lib/auth";
import { recordLogin } from "@/lib/activity";
import { moneyToCents, slugify } from "@/lib/money";
import { issueRefund } from "@/lib/orders";
import { demoRestaurantFields, randomToken, SEED_MENU, SEED_CATEGORIES } from "@/lib/test-data";
import { SERVICES, suspendService, restoreService } from "@/lib/entitlements";
import { createInvite, revokeInvite } from "@/lib/invites";
import { platformOrigin } from "@/lib/domains";
import { saveDomain, recheckDomain, clearDomain } from "@/lib/domain-ops";
import { addAdminNote, deleteAdminNote } from "@/lib/customers";
import {
  setStep as setOnboardingStep,
  addNote as addOnboardingNote,
  deleteNote as deleteOnboardingNote,
  setStepText as setOnboardingStepText,
  normalizeNoteKind,
} from "@/lib/onboarding-checklist";
import {
  resolvePaymentMode,
  resolveModeState,
  testModeEnabled,
  safeRevertTarget,
  MAX_TEST_WINDOW_HOURS,
  DEFAULT_TEST_WINDOW_HOURS,
} from "@/lib/payments";
import {
  ensureConnectAccount,
  createOnboardingLink,
  refreshConnectStatus,
} from "@/lib/payments-connect";
import type { OrderProblem, ServiceKind } from "@prisma/client";

type Result = { error?: string; ok?: string } | undefined;

/**
 * Some admin actions produce a link the operator has to copy and send — an
 * invite, a Stripe onboarding URL. Those can't redirect (the admin isn't the
 * one going there) and can't be re-read later (both are single-use secrets
 * shown exactly once), so the result carries the value back to the form.
 */
type LinkResult =
  | { error?: string; ok?: string; link?: string; linkLabel?: string }
  | undefined;

/**
 * Flip the platform payment mode (LIVE / TEST / STUB). Upserts the singleton
 * row so both the storefront (which key set to mount) and every future charge
 * read the change immediately, with no redeploy. The existing charges are
 * unaffected — each carries the mode it was taken in, so refunds still reach
 * the right key set after a flip.
 */
export async function setPaymentModeAction(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();

  const mode = String(formData.get("mode") ?? "");
  if (mode !== "LIVE" && mode !== "TEST" && mode !== "STUB") {
    return { error: "Unknown payment mode." };
  }

  // Going LIVE clears the timer — there's nothing to protect anyone from.
  // Leaving LIVE always sets one, whether or not the form asked for it: an
  // untimed TEST window is the exact failure this exists to prevent, and making
  // it opt-out would mean the dangerous path is the one fewer clicks away.
  const requested = parseFloat(String(formData.get("windowHours") ?? ""));
  const hours = Number.isFinite(requested)
    ? Math.min(Math.max(requested, 0.25), MAX_TEST_WINDOW_HOURS)
    : DEFAULT_TEST_WINDOW_HOURS;

  const live = mode === "LIVE";
  const revertTo = safeRevertTarget("LIVE");

  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      paymentMode: mode,
      updatedById: admin.userId,
      modeExpiresAt: live ? null : new Date(Date.now() + hours * 3600_000),
      modeRevertTo: live ? null : revertTo,
      modeRevertedAt: null,
    },
    update: {
      paymentMode: mode,
      updatedById: admin.userId,
      modeExpiresAt: live ? null : new Date(Date.now() + hours * 3600_000),
      modeRevertTo: live ? null : revertTo,
      // Clear the "it reverted on its own" marker — somebody is driving now.
      modeRevertedAt: null,
    },
  });

  revalidatePath("/admin", "layout");

  if (live) return { ok: "Live. Customers are being charged for real." };

  const target = revertTo === "STUB" ? "STUB (no live key configured)" : revertTo;
  return {
    ok: `${mode} for ${formatHours(hours)}, then back to ${target} automatically.`,
  };
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h === 1) return "1 hour";
  if (h < 48) return `${h % 1 === 0 ? h : h.toFixed(1)} hours`;
  return `${Math.round(h / 24)} days`;
}

/**
 * End a non-live window early, or push it out.
 *
 * "Revert now" exists because the alternative — waiting out a timer you set by
 * mistake — is how somebody ends up leaving it on. "Extend" exists because
 * without it, an admin mid-way through testing when the window closes will just
 * start a fresh long one, and a 7-day window set in irritation is worse than a
 * 2-hour extension.
 */
export async function adjustPaymentWindowAction(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "revert") {
    const target = safeRevertTarget("LIVE");
    await prisma.platformSetting.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", paymentMode: target, updatedById: admin.userId },
      update: {
        paymentMode: target,
        updatedById: admin.userId,
        modeExpiresAt: null,
        modeRevertTo: null,
        modeRevertedAt: null,
      },
    });
    revalidatePath("/admin", "layout");
    return {
      ok:
        target === "LIVE"
          ? "Back to live. Customers are being charged for real."
          : "Reverted to STUB — no live Stripe key is configured, so live isn't available.",
    };
  }

  if (intent === "extend") {
    const state = await resolveModeState();
    if (state.mode === "LIVE") return { error: "Already live — there's no window to extend." };

    const add = parseFloat(String(formData.get("hours") ?? "2"));
    const hours = Number.isFinite(add) ? Math.min(Math.max(add, 0.25), MAX_TEST_WINDOW_HOURS) : 2;
    // Extend from now rather than from the old expiry, so a window that already
    // lapsed can't be resurrected into the past.
    const from = Math.max(state.expiresAt?.getTime() ?? 0, Date.now());
    const next = new Date(from + hours * 3600_000);
    const cap = new Date(Date.now() + MAX_TEST_WINDOW_HOURS * 3600_000);

    await prisma.platformSetting.update({
      where: { id: "singleton" },
      data: {
        modeExpiresAt: next > cap ? cap : next,
        modeRevertTo: safeRevertTarget("LIVE"),
        updatedById: admin.userId,
      },
    });
    revalidatePath("/admin", "layout");
    return { ok: `Extended by ${formatHours(hours)}.` };
  }

  return { error: "Unknown action." };
}

/**
 * Show or hide the demo scaffolding.
 *
 * Deliberately independent of `paymentMode`. Tying them together would mean
 * that exercising a real Stripe test charge also puts an "autofill" button in
 * front of every restaurant owner signing up that afternoon.
 */
export async function setTestModeAction(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const on = String(formData.get("enabled") ?? "") === "true";

  await prisma.platformSetting.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", testModeEnabled: on, updatedById: admin.userId },
    update: { testModeEnabled: on, updatedById: admin.userId },
  });

  revalidatePath("/admin", "layout");
  revalidatePath("/signup");
  revalidatePath("/onboarding");
  return {
    ok: on
      ? "Test tools are visible — including on the public signup page."
      : "Test tools hidden.",
  };
}

export type CreateRestaurantResult =
  | { error?: string; ok?: string; link?: string; linkLabel?: string; restaurantId?: string }
  | undefined;

/**
 * Create a tenant and invite its owner.
 *
 * Two things changed from the original here, both deliberate:
 *
 * **No typed password.** The admin used to choose a temporary password and read
 * it out. That credential then lived in whatever channel carried it, forever,
 * and the owner usually never changed it. An invite link means the only person
 * who ever knows the password is the person it belongs to. See `lib/invites.ts`.
 *
 * **The tenant starts PENDING, not ACTIVE.** The old version marked
 * admin-created restaurants as fully onboarded on the theory that we'd set them
 * up by hand — but nothing here collects a menu or hours, so it produced tenants
 * that claimed to be live with an empty storefront. They now enter the same
 * wizard an owner would, and `lib/readiness.ts` tracks what's still missing.
 */
export async function createRestaurantAction(
  _prev: CreateRestaurantResult,
  formData: FormData
): Promise<CreateRestaurantResult> {
  const admin = await requireAdmin();

  const name = String(formData.get("name") ?? "").trim();
  const slugRaw = String(formData.get("slug") ?? "").trim();
  const email = String(formData.get("ownerEmail") ?? "").trim().toLowerCase();

  if (!name) return { error: "Restaurant name is required." };
  if (!email) return { error: "Owner email is required — that's who the invite goes to." };

  const slug = slugify(slugRaw || name);
  if (!slug) return { error: "Could not derive a valid slug from that name." };

  const [slugTaken, emailTaken] = await Promise.all([
    prisma.restaurant.findUnique({ where: { slug } }),
    prisma.user.findUnique({ where: { email } }),
  ]);
  if (slugTaken) return { error: `The slug "${slug}" is already in use.` };
  if (emailTaken) return { error: "That email already has an account on another restaurant." };

  const restaurant = await prisma.restaurant.create({
    data: {
      name,
      slug,
      status: "PENDING",
      accentColor: String(formData.get("accentColor") || "#3b82f6"),
      address: String(formData.get("address") || "") || null,
      city: String(formData.get("city") || "") || null,
      phone: String(formData.get("phone") || "") || null,
      timezone: String(formData.get("timezone") || "America/New_York"),
      heroUrl: String(formData.get("heroUrl") || "") || null,
      categories: {
        create: [
          { name: "Featured", sort: 0 },
          { name: "Mains", sort: 1 },
          { name: "Sides", sort: 2 },
          { name: "Drinks", sort: 3 },
        ],
      },
    },
  });

  // Branding uploaded before the tenant existed lands under "_unassigned".
  // Claim it now so it isn't swept as an orphan.
  const heroUrl = String(formData.get("heroUrl") || "");
  if (heroUrl) {
    await prisma.mediaAsset.updateMany({
      where: { url: heroUrl, restaurantId: null },
      data: { restaurantId: restaurant.id },
    });
  }

  const invite = await createInvite({ restaurantId: restaurant.id, email, actorId: admin.userId });

  revalidatePath("/admin");
  revalidatePath("/admin/restaurants");

  // A failed invite is not a failed restaurant — the tenant exists and the
  // invite can be re-sent from its page. Saying so beats an error that implies
  // nothing was created.
  if (!invite.ok) {
    return {
      ok: `Created ${name}, but the invite couldn't be sent: ${invite.error}`,
      restaurantId: restaurant.id,
    };
  }

  return {
    ok: `Created ${name}. Send this link to ${email} — it's the only time it's shown.`,
    link: invite.value.url,
    linkLabel: "Invite link",
    restaurantId: restaurant.id,
  };
}

/**
 * DEV / TESTING ONLY. Seeds a fully-populated demo restaurant: owner login,
 * info, branding text + images, and a sample menu (with photos). Each call
 * makes a fresh tenant with a random slug so you can seed as many as you like.
 * Remove the admin "Testing tools" card before launch.
 */
export async function seedTestRestaurantAction(_prev: Result, _formData: FormData): Promise<Result> {
  await requireAdmin();

  // The UI hides this card when test tools are off; the check lives here too.
  // Hiding a control is a courtesy, not enforcement — the same rule that makes
  // `setCardPaymentsAction` re-check suspension server-side.
  if (!(await testModeEnabled())) {
    return { error: "Test tools are switched off. Turn them on at /admin/tools (Mode tab) first." };
  }

  // Find a slug/email that isn't taken (retry a few tokens).
  let fields = demoRestaurantFields(randomToken());
  for (let i = 0; i < 5; i++) {
    const [slugTaken, emailTaken] = await Promise.all([
      prisma.restaurant.findUnique({ where: { slug: fields.slug } }),
      prisma.user.findUnique({ where: { email: fields.ownerEmail } }),
    ]);
    if (!slugTaken && !emailTaken) break;
    fields = demoRestaurantFields(randomToken());
    if (i === 4) return { error: "Couldn't find a free demo slug - try again." };
  }

  // Offline images (bundled in /public/test-menu) — no network, instant.
  const restaurant = await prisma.restaurant.create({
    data: {
      name: fields.name,
      slug: fields.slug,
      status: "ACTIVE",
      onboardingStep: 4,
      onboardedAt: new Date(),
      accentColor: fields.accentColor,
      tagline: fields.tagline,
      address: fields.address,
      city: fields.city,
      phone: fields.phone,
      hours: fields.hours,
      aboutTitle: fields.aboutTitle,
      aboutBody: fields.aboutBody,
      logoUrl: fields.logoUrl,
      heroUrl: fields.heroUrl,
      categories: {
        create: SEED_CATEGORIES.map((name, i) => ({ name, sort: i })),
      },
    },
    include: { categories: true },
  });

  const catId = new Map(restaurant.categories.map((c) => [c.name.toLowerCase(), c.id]));

  await prisma.user.create({
    data: {
      email: fields.ownerEmail,
      passwordHash: await hashPassword(fields.ownerPassword),
      role: "OWNER",
      restaurantId: restaurant.id,
    },
  });

  await prisma.menuItem.createMany({
    data: SEED_MENU.map((item, i) => ({
      restaurantId: restaurant.id,
      categoryId: catId.get(item.category.toLowerCase()) ?? null,
      name: item.name,
      description: item.description,
      priceCts: Math.round(item.price * 100),
      imageUrl: item.image,
      featured: item.featured ?? false,
      available: true,
      sort: i,
    })),
  });

  revalidatePath("/admin");
  return {
    ok: `Seeded ${fields.name} at /r/${fields.slug} with ${SEED_MENU.length} items. Login ${fields.ownerEmail} / ${fields.ownerPassword}.`,
  };
}

export async function setRestaurantStatusAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) === "SUSPENDED" ? "SUSPENDED" : "ACTIVE";
  await prisma.restaurant.update({ where: { id }, data: { status } });
  revalidatePath("/admin");
}

/**
 * Suspend or restore one service for one tenant.
 *
 * The write itself lives in lib/entitlements.ts; this is the admin door onto
 * it. There is deliberately no owner-side counterpart — the whole value of a
 * suspension is that the suspended party can't undo it.
 */
export async function setServiceSuspensionAction(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();

  const id = String(formData.get("id"));
  const service = String(formData.get("service"));
  const suspend = String(formData.get("suspend") ?? "") === "true";

  if (!SERVICES.includes(service as ServiceKind)) return { error: "Unknown service." };
  const kind = service as ServiceKind;

  const restaurant = await prisma.restaurant.findUnique({ where: { id }, select: { id: true } });
  if (!restaurant) return { error: "Restaurant not found." };

  const res = suspend
    ? await suspendService({
        restaurantId: id,
        service: kind,
        reason: String(formData.get("reason") ?? ""),
        internalNote: String(formData.get("internalNote") ?? ""),
        actorId: admin.userId,
      })
    : await restoreService(id, kind, admin.userId);

  revalidatePath(`/admin/restaurants/${id}`);
  revalidatePath("/admin/restaurants");
  // The owner sees the consequence on their own pages immediately.
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard");
  return res;
}

export async function deleteRestaurantAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const confirm = String(formData.get("confirm") ?? "");
  const r = await prisma.restaurant.findUnique({ where: { id } });
  if (!r) return;
  // Typing the slug is the guardrail — cascade deletes take the orders and
  // the customer list with them.
  if (confirm !== r.slug) return;
  await prisma.restaurant.delete({ where: { id } });
  revalidatePath("/admin");
}

/** Swaps the admin's session onto a tenant so /dashboard renders as that owner. */
export async function impersonateAction(formData: FormData) {
  const session = await requireAdmin();
  const id = String(formData.get("id"));
  const r = await prisma.restaurant.findUnique({ where: { id } });
  if (!r) return;

  await setSession({
    userId: session.userId,
    email: session.email,
    role: "ADMIN",
    restaurantId: r.id,
    impersonating: true,
  });
  await recordLogin({ userId: session.userId, method: "IMPERSONATE" });
  redirect("/dashboard");
}

export async function stopImpersonatingAction() {
  const session = await requireAdmin();
  await setSession({
    userId: session.userId,
    email: session.email,
    role: "ADMIN",
    restaurantId: null,
  });
  redirect("/admin");
}

export async function addSupportLogAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const weekOf = String(formData.get("weekOf") ?? "");
  const hours = parseFloat(String(formData.get("hours") ?? ""));

  if (!restaurantId) return { error: "Pick a restaurant." };
  if (!weekOf) return { error: "Pick the week." };
  if (!isFinite(hours) || hours < 0) return { error: "Hours must be a positive number." };

  await prisma.supportLog.create({
    data: {
      restaurantId,
      weekOf: new Date(`${weekOf}T00:00:00Z`),
      hours,
      note: String(formData.get("note") || "") || null,
    },
  });

  revalidatePath("/admin/support");
  return { ok: "Logged." };
}

export async function deleteSupportLogAction(formData: FormData) {
  await requireAdmin();
  await prisma.supportLog.delete({ where: { id: String(formData.get("id")) } });
  revalidatePath("/admin/support");
}

export async function resetOwnerPasswordAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
  return { ok: "Password updated." };
}

/**
 * Admin-side per-account payment controls: set/clear the Connect account id by
 * hand (for a tenant onboarded out of band) and force card payments on or off.
 * The owner has the same card switch on their side; this is the platform's
 * override.
 */
export async function adminUpdatePaymentsAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  const accountRaw = String(formData.get("stripeAccountId") ?? "").trim();
  const cardsEnabled = String(formData.get("cardPaymentsEnabled") ?? "") === "true";

  await prisma.restaurant.update({
    where: { id },
    data: {
      // Empty clears it; a value only sticks if it looks like a Connect id, so
      // a fat-fingered paste can't point charges at a bad account.
      stripeAccountId: accountRaw === "" ? null : accountRaw.startsWith("acct_") ? accountRaw : undefined,
      cardPaymentsEnabled: cardsEnabled,
    },
  });
  revalidatePath("/admin");
  revalidatePath("/admin/restaurants");
}

/**
 * Platform-side refund on any order in any tenant, full or partial, for any
 * reason. Same money path as the owner's refund (issueRefund — one door, takes
 * the lock, texts the customer), but unscoped by restaurant because an admin
 * acts across every account.
 */
export async function adminRefundAction(_prev: Result, formData: FormData): Promise<Result> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const problem = String(formData.get("problem") ?? "OTHER") as OrderProblem;
  const note = String(formData.get("note") ?? "").slice(0, 300);
  const amountCts = moneyToCents(String(formData.get("amount") ?? ""));

  if (!id) return { error: "No order." };
  if (amountCts <= 0) return { error: "Enter an amount above zero." };

  const res = await issueRefund({
    orderId: id,
    amountCts,
    reason: problem,
    actor: "ADMIN",
    actorId: admin.userId,
    note: note || undefined,
  });

  revalidatePath("/admin/orders");
  return res.ok ? { ok: "Refunded." } : { error: res.error };
}

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

/**
 * Mint an invite link for a tenant. The token comes back once and is never
 * retrievable again, so the result carries it straight to the UI — if the
 * operator navigates away without copying it, the correct move is to generate a
 * new one, which is why that's a one-click action rather than a buried form.
 */
export async function createInviteAction(_prev: LinkResult, formData: FormData): Promise<LinkResult> {
  const admin = await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const email = String(formData.get("email") ?? "");

  const res = await createInvite({ restaurantId, email, actorId: admin.userId });
  if (!res.ok) return { error: res.error };

  revalidatePath(`/admin/restaurants/${restaurantId}`);
  revalidatePath("/admin");
  return {
    ok: `Invite ready for ${email.trim().toLowerCase()}. Copy it now — it won't be shown again.`,
    link: res.value.url,
    linkLabel: "Invite link",
  };
}

export async function revokeInviteAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("inviteId") ?? "");
  const restaurantId = String(formData.get("restaurantId") ?? "");
  await revokeInvite(id);
  revalidatePath(`/admin/restaurants/${restaurantId}`);
  revalidatePath("/admin");
}

// ---------------------------------------------------------------------------
// Manual onboarding checklist — the operator's own tracking, per tenant
// ---------------------------------------------------------------------------

/**
 * Tick or un-tick a checklist step. State persists on `OnboardingTask` until the
 * operator changes it — this is the "saved until onboarding is complete" part.
 * The step catalog lives in `lib/onboarding-checklist.ts`; unknown keys are
 * refused there.
 */
export async function toggleOnboardingStepAction(formData: FormData) {
  const admin = await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const key = String(formData.get("key") ?? "");
  // The current state travels in the form; the button flips it. A hidden field
  // rather than reading the row first keeps this a single write.
  const done = String(formData.get("done") ?? "") === "true";
  await setOnboardingStep(restaurantId, key, done, { id: admin.userId, name: admin.email });
  revalidatePath(`/admin/restaurants/${restaurantId}`);
  revalidatePath("/admin");
}

export async function addOnboardingNoteAction(formData: FormData) {
  const admin = await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const body = String(formData.get("body") ?? "");
  const kind = normalizeNoteKind(String(formData.get("kind") ?? "onboarding"));
  await addOnboardingNote(restaurantId, body, { id: admin.userId, name: admin.email }, kind);
  revalidatePath(`/admin/restaurants/${restaurantId}`);
}

export async function deleteOnboardingNoteAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const restaurantId = String(formData.get("restaurantId") ?? "");
  await deleteOnboardingNote(id, restaurantId);
  revalidatePath(`/admin/restaurants/${restaurantId}`);
}

/**
 * Edit the wording of a checklist step, platform-wide, no deploy. Blank fields
 * reset to the code default. Revalidates the layout because every tenant's
 * Onboarding tab reads the same template.
 */
export async function updateOnboardingStepTextAction(formData: FormData) {
  await requireAdmin();
  const key = String(formData.get("key") ?? "");
  const label = String(formData.get("label") ?? "");
  const detail = String(formData.get("detail") ?? "");
  const restaurantId = String(formData.get("restaurantId") ?? "");
  await setOnboardingStepText(key, label, detail);
  revalidatePath("/admin", "layout");
  if (restaurantId) revalidatePath(`/admin/restaurants/${restaurantId}`);
}

// ---------------------------------------------------------------------------
// Stripe Connect, driven from our side
// ---------------------------------------------------------------------------

/**
 * Create the connected account if it doesn't exist and mint an onboarding link
 * for the owner.
 *
 * The owner has the same button on their own payments page. This exists because
 * the realistic sequence is a phone call: we set the account up while talking to
 * them and send the link, rather than talking them through finding a button.
 * It's the same `ensureConnectAccount` / `createOnboardingLink` pair — no second
 * path to a Connect account, because a duplicate account is unrecoverable
 * without Stripe support.
 *
 * Note we return the URL rather than redirecting: the admin is not the person
 * who should complete Stripe's form. Account Links are single-use and expire in
 * minutes, so this is generated fresh on each click and never stored.
 */
export async function adminConnectLinkAction(_prev: LinkResult, formData: FormData): Promise<LinkResult> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");

  const mode = await resolvePaymentMode();
  if (mode === "STUB") {
    return {
      error:
        "Payment mode is STUB, so there's no Stripe to connect to. Switch the platform to TEST or LIVE on the Overview page first.",
    };
  }

  const account = await ensureConnectAccount(id, mode);
  if (!account.ok) return { error: account.error };

  const origin = platformOrigin() || "http://localhost:3000";
  const back = `${origin}/admin/restaurants/${id}?tab=payments`;
  const link = await createOnboardingLink(account.value, mode, {
    // Both come back to us, not to the owner's dashboard: we generated this, so
    // we're the one who should see whether it landed.
    refreshUrl: `${back}&connect=refresh`,
    returnUrl: `${back}&connect=return`,
  });
  if (!link.ok) return { error: link.error };

  revalidatePath(`/admin/restaurants/${id}`);
  return {
    ok: `Onboarding link ready (${mode} mode). It's single-use and expires in a few minutes — send it now.`,
    link: link.value,
    linkLabel: "Stripe onboarding link",
  };
}

/** Re-pull a tenant's Connect readiness from Stripe and cache it on the row. */
export async function adminRefreshConnectAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const mode = await resolvePaymentMode();
  if (mode === "STUB") return { error: "Payment mode is STUB — nothing to check." };

  const res = await refreshConnectStatus(id, mode);
  revalidatePath(`/admin/restaurants/${id}`);
  if (!res.ok) return { error: res.error };

  return res.value.chargesEnabled
    ? { ok: "Charges enabled — this tenant can take cards." }
    : {
        ok: res.value.detailsSubmitted
          ? "Details submitted, but Stripe hasn't enabled charges yet. Usually a verification still in flight."
          : "Account exists but the owner hasn't finished Stripe's form.",
      };
}

// ---------------------------------------------------------------------------
// Domains
// ---------------------------------------------------------------------------

/**
 * The admin side of the same three domain operations owners have. Unscoped by
 * restaurant, because that's what an admin is for — the previous answer to
 * "what state is their domain in" was to impersonate the owner and read their
 * settings page, which is a lot of ceremony for a question with a one-word
 * answer.
 */
export async function adminSaveDomainAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const res = await saveDomain(id, String(formData.get("domain") ?? ""));
  revalidatePath(`/admin/restaurants/${id}`);
  revalidatePath("/dashboard/branding");
  return res;
}

export async function adminRecheckDomainAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const res = await recheckDomain(id);
  revalidatePath(`/admin/restaurants/${id}`);
  revalidatePath("/dashboard/branding");
  return res;
}

export async function adminClearDomainAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  await clearDomain(id);
  revalidatePath(`/admin/restaurants/${id}`);
  revalidatePath("/dashboard/branding");
}

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

/**
 * Remove a login from a tenant. Deliberately refuses the last one: a restaurant
 * with no users is unreachable by its owner and looks, from every screen we
 * have, exactly like a restaurant that's fine.
 */
export async function removeTenantUserAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const restaurantId = String(formData.get("restaurantId") ?? "");

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { restaurantId: true } });
  if (!user || user.restaurantId !== restaurantId) return { error: "That user isn't on this account." };

  const count = await prisma.user.count({ where: { restaurantId } });
  if (count <= 1) {
    return { error: "That's the only login on this account. Invite a replacement first." };
  }

  await prisma.user.delete({ where: { id: userId } });
  revalidatePath(`/admin/restaurants/${restaurantId}`);
  return { ok: "Login removed." };
}

export async function updateSurchargeAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id"));
  await prisma.restaurant.update({
    where: { id },
    data: {
      surchargePct: Math.max(0, parseFloat(String(formData.get("surchargePct"))) / 100 || 0),
      surchargeMinCts: moneyToCents(String(formData.get("surchargeMin"))),
      surchargeMaxCts: moneyToCents(String(formData.get("surchargeMax"))),
      taxPct: Math.max(0, parseFloat(String(formData.get("taxPct"))) / 100 || 0),
      // What the fee is called on the receipt is part of the pricing story, not
      // branding — owners can't rename it into something misleading.
      surchargeLabel: String(formData.get("surchargeLabel") ?? "").trim().slice(0, 40) || "Service fee",
    },
  });
  revalidatePath("/admin");
  revalidatePath("/dashboard/payments");
}

// ---------------------------------------------------------------------------
// Internal notes on a customer
// ---------------------------------------------------------------------------

/**
 * Our note on a customer, for support.
 *
 * This is the *only* write an admin has against a customer record, and it is
 * deliberately additive. `/admin/customers` stays read-only on everything the
 * tenant owns — consent, tags, name, email — for the reason that page's header
 * comment gives: the relationship belongs to the restaurant, and an admin
 * quietly editing an opt-in status would destroy the audit trail `lib/sms.ts`
 * depends on while leaving the tenant no way to know it happened.
 *
 * The note lands in `CustomerAdminNote`, which is a different table from the
 * owner's `CustomerNote` rather than the same table with a visibility flag —
 * see the schema comment, and `SupportNote` for the precedent. Nothing under
 * `src/app/dashboard/` may read it.
 */
export async function addCustomerAdminNoteAction(formData: FormData) {
  const session = await requireAdmin();
  const customerId = String(formData.get("customerId") || "");
  await addAdminNote(customerId, String(formData.get("body") || ""), {
    id: session.userId,
    name: session.email,
  });
  revalidatePath(`/admin/customers/${customerId}`);
}

export async function deleteCustomerAdminNoteAction(formData: FormData) {
  await requireAdmin();
  await deleteAdminNote(String(formData.get("noteId") || ""));
  revalidatePath(`/admin/customers/${String(formData.get("customerId") || "")}`);
}
