"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { resolvePaymentMode } from "@/lib/payments";
import { isSuspended } from "@/lib/entitlements";
import { ensureConnectAccount, createOnboardingLink, refreshConnectStatus } from "@/lib/payments-connect";
import { moneyToCents } from "@/lib/money";
import { siteContentFromForm } from "@/lib/site-content";
import { storeTheme } from "@/lib/store-theme";
import { importMenuCsvText, type ImportSummary } from "@/lib/menu-import";
import {
  importCustomerCsvText,
  previewCustomerCsvText,
  undoImport,
  type CustomerImportPreview,
  type CustomerImportSummary,
} from "@/lib/customer-import";
import {
  addCustomerNote,
  deleteCustomerNote,
  deleteSegment,
  deleteTag,
  ensureTag,
  filtersToQuery,
  isTagColor,
  paramsToFilters,
  readCustomerParams,
  renameTag,
  saveSegment,
  setTagColor,
  tagCustomers,
  tagMatching,
} from "@/lib/customers";
import { getSession } from "@/lib/auth";
import { platformOrigin } from "@/lib/domains";
import { checkSlug } from "@/lib/slug-rules";
import { saveDomain, recheckDomain, clearDomain } from "@/lib/domain-ops";
import {
  cancelOrder,
  dismissFailedRefund,
  issueRefund,
  markItemsUnavailable,
  markNoShow,
  resolveIssue,
  retryRefund,
  transitionOrder,
} from "@/lib/orders";
import { DAY_KEYS, isValidTime, parseHoursForm } from "@/lib/hours";
import type { IssueStatus, OrderProblem, OrderStatus } from "@prisma/client";

type Result = { error?: string; ok?: string } | undefined;

const MAX_CSV_BYTES = 2 * 1024 * 1024;

/**
 * CSV menu import from the dashboard. Photos referenced by URL are re-hosted
 * into our media system because the site is already live.
 */
export async function importMenuCsvAction(
  _prev: ImportSummary | undefined,
  formData: FormData
): Promise<ImportSummary> {
  const { restaurantId } = await requireOwner();
  const session = await getSession();

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
  const summary = await importMenuCsvText(restaurantId, text, {
    rehostImages: true,
    createdById: session?.userId ?? null,
  });

  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
  return summary;
}

/**
 * CSV customer import from the dashboard.
 *
 * Thin on purpose — every rule that matters (consent is never granted here,
 * upsert by phone, gap-filling merges) lives in `lib/customer-import.ts`, and
 * this is only the auth boundary and the file handling. See that module's
 * header before changing anything about what an import is allowed to write.
 */
export async function importCustomerCsvAction(
  _prev: CustomerImportSummary | undefined,
  formData: FormData
): Promise<CustomerImportSummary> {
  const { restaurantId } = await requireOwner();

  const empty: CustomerImportSummary = {
    created: 0,
    updated: 0,
    duplicatesInFile: 0,
    skipped: 0,
    warnings: [],
  };

  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "Choose a .csv file to import." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { ...empty, error: "That file is too large (max 2 MB)." };
  }

  const tagName = String(formData.get("tagName") || "").trim() || undefined;
  const summary = await importCustomerCsvText(restaurantId, await file.text(), {
    filename: file.name,
    tagName,
  });

  revalidatePath("/dashboard/customers");
  return summary;
}

/**
 * Dry-run an upload. Reads only.
 *
 * A separate action from the import rather than a mode flag on it, so there is
 * no argument anyone can get wrong that turns a preview into a write.
 */
export async function previewCustomerCsvAction(
  _prev: CustomerImportPreview | undefined,
  formData: FormData
): Promise<CustomerImportPreview> {
  const { restaurantId } = await requireOwner();

  const empty: CustomerImportPreview = {
    columns: [],
    totalRows: 0,
    usableRows: 0,
    duplicatesInFile: 0,
    willCreate: 0,
    willUpdate: 0,
    unchanged: 0,
    sample: [],
    warnings: [],
  };

  const file = formData.get("csv");
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "Choose a .csv file first." };
  }
  if (file.size > MAX_CSV_BYTES) {
    return { ...empty, error: "That file is too large (max 2 MB)." };
  }

  return previewCustomerCsvText(restaurantId, await file.text());
}

export async function undoImportAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await undoImport(restaurantId, String(formData.get("jobId") || ""));
  revalidatePath("/dashboard/customers");
  if (!res.ok) return { error: res.error };
  return {
    ok: res.kept
      ? `Removed ${res.deleted} imported contact${res.deleted === 1 ? "" : "s"}. Kept ${res.kept} who have ordered since.`
      : `Removed ${res.deleted} imported contact${res.deleted === 1 ? "" : "s"}.`,
  };
}

// ---------------------------------------------------------------------------
// Customer tags, segments and notes
// ---------------------------------------------------------------------------

export async function createTagAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const color = String(formData.get("color") || "neutral");
  const res = await ensureTag(
    restaurantId,
    String(formData.get("name") || ""),
    isTagColor(color) ? color : "neutral"
  );
  revalidatePath("/dashboard/customers");
  return res.ok ? { ok: `Tag "${res.tag.name}" ready.` } : { error: res.error };
}

export async function renameTagAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await renameTag(
    restaurantId,
    String(formData.get("tagId") || ""),
    String(formData.get("name") || "")
  );
  revalidatePath("/dashboard/customers");
  return res.ok ? { ok: "Renamed." } : { error: res.error };
}

export async function setTagColorAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const color = String(formData.get("color") || "");
  if (!isTagColor(color)) return { error: "Unknown colour." };
  await setTagColor(restaurantId, String(formData.get("tagId") || ""), color);
  revalidatePath("/dashboard/customers");
  return { ok: "Updated." };
}

export async function deleteTagAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  await deleteTag(restaurantId, String(formData.get("tagId") || ""));
  revalidatePath("/dashboard/customers");
  // Said explicitly because it's the thing the owner was worried about when
  // they hovered the button.
  return { ok: "Tag deleted. The customers who had it are untouched." };
}

/**
 * Bulk tag. Two modes, and they take different inputs on purpose.
 *
 * `selection` acts on checkboxes the person can see. `matching` acts on
 * everything the current filter returns, and takes the *filter* rather than a
 * list of ids — so the set is recomputed server-side inside the tenant scope
 * and can't be widened by editing a hidden field.
 */
export async function bulkTagAction(formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const tagId = String(formData.get("tagId") || "");
  const mode = String(formData.get("mode") || "add") === "remove" ? "remove" : "add";
  const scope = String(formData.get("scope") || "selection");

  if (!tagId) return { error: "Pick a tag first." };

  let count = 0;
  if (scope === "matching") {
    const params = readCustomerParams(
      Object.fromEntries(new URLSearchParams(String(formData.get("query") || "")))
    );
    count = await tagMatching(restaurantId, tagId, paramsToFilters(restaurantId, params), mode);
  } else {
    const ids = formData.getAll("customerId").map(String).filter(Boolean);
    if (ids.length === 0) return { error: "Select some customers first." };
    count = await tagCustomers(restaurantId, tagId, ids, mode);
  }

  revalidatePath("/dashboard/customers");
  // The count is the number of links actually changed, so re-tagging people
  // who already had the tag reports 0 rather than claiming work it didn't do.
  return {
    ok:
      mode === "add"
        ? `Tagged ${count} customer${count === 1 ? "" : "s"}.`
        : `Removed the tag from ${count} customer${count === 1 ? "" : "s"}.`,
  };
}

export async function saveSegmentAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const params = readCustomerParams(
    Object.fromEntries(new URLSearchParams(String(formData.get("query") || "")))
  );
  // Re-rendered from the parsed params rather than stored as received, so a
  // junk param can't round-trip into the database. See `filtersToQuery`.
  const res = await saveSegment(restaurantId, String(formData.get("name") || ""), filtersToQuery(params));
  revalidatePath("/dashboard/customers");
  return res.ok ? { ok: "Segment saved." } : { error: res.error };
}

export async function deleteSegmentAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  await deleteSegment(restaurantId, String(formData.get("segmentId") || ""));
  revalidatePath("/dashboard/customers");
  return { ok: "Segment deleted." };
}

export async function addCustomerNoteAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const customerId = String(formData.get("customerId") || "");
  const res = await addCustomerNote(restaurantId, customerId, String(formData.get("body") || ""), {
    id: session.userId,
    name: session.email,
  });
  revalidatePath(`/dashboard/customers/${customerId}`);
  return res.ok ? { ok: "Note added." } : { error: res.error };
}

export async function deleteCustomerNoteAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  await deleteCustomerNote(restaurantId, String(formData.get("noteId") || ""));
  revalidatePath(`/dashboard/customers/${String(formData.get("customerId") || "")}`);
  return { ok: "Note deleted." };
}

/** Tag toggles from a customer's own page. */
export async function toggleCustomerTagAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const customerId = String(formData.get("customerId") || "");
  const tagId = String(formData.get("tagId") || "");
  const mode = String(formData.get("mode") || "add") === "remove" ? "remove" : "add";
  await tagCustomers(restaurantId, tagId, [customerId], mode);
  revalidatePath(`/dashboard/customers/${customerId}`);
  return { ok: mode === "add" ? "Tagged." : "Tag removed." };
}

export async function reorderMenuItemAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const dir = String(formData.get("dir")); // "up" | "down"

  const item = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
  if (!item) return;

  // Swap sort with the adjacent item in the same category.
  const neighbor = await prisma.menuItem.findFirst({
    where: {
      restaurantId,
      categoryId: item.categoryId,
      sort: dir === "up" ? { lt: item.sort } : { gt: item.sort },
    },
    orderBy: { sort: dir === "up" ? "desc" : "asc" },
  });
  if (!neighbor) return;

  await prisma.$transaction([
    prisma.menuItem.update({ where: { id: item.id }, data: { sort: neighbor.sort } }),
    prisma.menuItem.update({ where: { id: neighbor.id }, data: { sort: item.sort } }),
  ]);
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

/**
 * Every mutation re-derives the tenant from the session and filters by it.
 * Nothing accepts a restaurantId from the client.
 */

export async function updateOrderStatusAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as OrderStatus;

  // Routed through the state machine rather than writing `status` directly,
  // so a stale board tab can't resurrect a canceled order.
  await transitionOrder({ orderId: id, restaurantId, to: status, actor: "RESTAURANT" });
  revalidatePath("/dashboard");
}

// ---------------------------------------------------------------------------
// When an order goes wrong
// ---------------------------------------------------------------------------

/**
 * Decline or kill an order, refunding it in full. The reason is mandatory:
 * it drives the customer's apology text, and an owner who has to name the
 * cause tends to cancel fewer orders.
 */
export async function cancelOrderAction(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const problem = String(formData.get("problem") ?? "") as OrderProblem;
  const note = String(formData.get("note") ?? "").slice(0, 300);

  if (!problem) return { error: "Pick a reason so we can tell the customer." };

  const res = await cancelOrder({
    orderId: id,
    restaurantId,
    problem,
    actor: "RESTAURANT",
    actorId: session.userId,
    note: note || undefined,
    // Before anyone started cooking it's a rejection, not a cancellation.
    reject: true,
  });

  revalidatePath("/dashboard");
  return res.ok
    ? { ok: "Order canceled and refunded. The customer has been told why." }
    : { error: res.error };
}

/**
 * The 86 button. Marks how many of each line the kitchen can actually make and
 * refunds the difference, leaving the rest of the order alive.
 */
export async function markUnavailableAction(
  _prev: Result,
  formData: FormData
): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const id = String(formData.get("id") ?? "");

  // Fields arrive as qty_<orderItemId>.
  const lines: Array<{ orderItemId: string; fulfilledQty: number }> = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("qty_")) continue;
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    lines.push({ orderItemId: key.slice(4), fulfilledQty: Math.max(0, Math.floor(n)) });
  }

  if (!lines.length) return { error: "Nothing to change." };

  const res = await markItemsUnavailable({
    orderId: id,
    restaurantId,
    lines,
    actor: "RESTAURANT",
    actorId: session.userId,
  });

  revalidatePath("/dashboard");
  if (!res.ok) return { error: res.error };
  return {
    ok: res.value.canceled
      ? "Nothing left to make, so the order was canceled and fully refunded."
      : "Customer refunded for the missing items. The rest of the order is still live.",
  };
}

/**
 * Close out food that was made and never collected.
 *
 * The refund is the owner's explicit choice, not a default we picked for them —
 * "keep" and "refund" are two different buttons on the board rather than one
 * button and a policy.
 */
export async function markNoShowAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const refund = String(formData.get("refund") ?? "none") === "auto" ? "auto" : "none";

  const res = await markNoShow({
    orderId: id,
    restaurantId,
    actor: "RESTAURANT",
    actorId: session.userId,
    refund,
  });

  revalidatePath("/dashboard");
  if (!res.ok) return { error: res.error };
  return {
    ok:
      refund === "auto"
        ? "Closed out and refunded."
        : "Closed out. The customer keeps the charge and has been told.",
  };
}

/** Goodwill money on an order that already happened. */
export async function refundOrderAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const problem = String(formData.get("problem") ?? "QUALITY") as OrderProblem;
  const note = String(formData.get("note") ?? "").slice(0, 300);
  const amountCts = moneyToCents(String(formData.get("amount") ?? ""));

  if (amountCts <= 0) return { error: "Enter an amount above zero." };

  const res = await issueRefund({
    orderId: id,
    restaurantId,
    amountCts,
    reason: problem,
    actor: "RESTAURANT",
    actorId: session.userId,
    note: note || undefined,
  });

  revalidatePath("/dashboard");
  return res.ok ? { ok: "Refunded." } : { error: res.error };
}

/**
 * Try a failed payout again. Nothing here is fire-and-forget: the result is
 * reported back to the owner, because the alternative is a button that looks
 * like it worked and a customer who still hasn't been paid.
 */
export async function retryRefundAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId, session } = await requireOwner();
  const id = String(formData.get("id") ?? "");

  const res = await retryRefund({
    refundId: id,
    restaurantId,
    actor: "RESTAURANT",
    actorId: session.userId,
  });

  revalidatePath("/dashboard");
  return res.ok ? { ok: "Refunded. The customer has been told." } : { error: res.error };
}

/** Close out a failed refund that was settled some other way. */
export async function dismissRefundAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "");

  const res = await dismissFailedRefund({
    refundId: id,
    restaurantId,
    note,
    actor: "RESTAURANT",
  });

  revalidatePath("/dashboard");
  return res.ok ? { ok: "Closed out." } : { error: res.error };
}

/** Answer a customer's report. The customer is told; see lib/orders. */
export async function resolveIssueAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "RESOLVED") as IssueStatus;
  const resolution = String(formData.get("resolution") ?? "").slice(0, 500);

  const res = await resolveIssue({ issueId: id, restaurantId, status, resolution });

  revalidatePath("/dashboard");
  return res.ok ? { ok: "Customer updated and notified." } : { error: res.error };
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

/**
 * The panic button. Stops new orders for a fixed window rather than
 * indefinitely, because a pause with no expiry is how a restaurant quietly
 * stays closed for a week without noticing.
 */
export async function pauseOrdersAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const minutes = Number(formData.get("minutes") ?? 30);
  const reason = String(formData.get("reason") ?? "").slice(0, 140);

  if (!Number.isFinite(minutes) || minutes <= 0) return { error: "Pick how long." };

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      pausedUntil: new Date(Date.now() + Math.min(minutes, 24 * 60) * 60_000),
      pauseReason: reason || null,
    },
  });

  revalidatePath("/dashboard");
  return { ok: `Paused for ${minutes} minutes. Existing orders are unaffected.` };
}

export async function resumeOrdersAction() {
  const { restaurantId } = await requireOwner();
  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { pausedUntil: null, pauseReason: null },
  });
  revalidatePath("/dashboard");
}

/**
 * Weekly schedule, saved from the hours grid. Each day arrives as
 * `open_<day>` / `close_<day>` pairs, with an `on_<day>` checkbox.
 */
export async function saveHoursAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  // Shared with the onboarding wizard — see lib/hours.ts. No `requireOpenDay`
  // here: an established tenant clearing every day is allowed, and
  // checkAvailability fails open for them on purpose.
  const parsed = parseHoursForm((k) => formData.get(k) as string | null);
  if (parsed.error) return { error: parsed.error };
  const hoursJson = parsed.hours;

  const prepMinutes = Number(formData.get("prepMinutes") ?? 20);
  const lastCallMins = Number(formData.get("lastCallMins") ?? 20);
  const autoExpireMins = Number(formData.get("autoExpireMins") ?? 10);
  const timezone = String(formData.get("timezone") ?? "America/New_York");

  // A zone the server can't resolve would make every open/closed check fall
  // back to UTC, silently and wrongly. Catch it here instead.
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    return { error: "That timezone isn't recognized." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      hoursJson,
      timezone,
      prepMinutes: clampInt(prepMinutes, 5, 180),
      lastCallMins: clampInt(lastCallMins, 0, 120),
      autoExpireMins: clampInt(autoExpireMins, 2, 120),
      autoAccept: formData.get("autoAccept") === "on",
    },
  });

  revalidatePath("/dashboard/hours");
  revalidatePath("/dashboard");
  return { ok: "Hours saved. Ordering now follows this schedule." };
}

function clampInt(n: number, lo: number, hi: number) {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

export async function addClosureAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const startDate = String(formData.get("startDate") ?? "");
  const endDate = String(formData.get("endDate") ?? "") || startDate;
  const reason = String(formData.get("reason") ?? "").slice(0, 140);

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    return { error: "Pick valid dates." };
  }
  if (endDate < startDate) return { error: "The end date is before the start date." };

  await prisma.closure.create({
    data: { restaurantId, startDate, endDate, reason: reason || null },
  });

  revalidatePath("/dashboard/hours");
  return { ok: "Closure added. Ordering is off for those days." };
}

export async function deleteClosureAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  await prisma.closure.deleteMany({ where: { id, restaurantId } });
  revalidatePath("/dashboard/hours");
}

export async function upsertMenuItemAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const priceCts = moneyToCents(String(formData.get("price") ?? ""));
  const categoryId = String(formData.get("categoryId") ?? "") || null;

  if (!name) return { error: "Name is required." };
  if (priceCts <= 0) return { error: "Price must be greater than zero." };

  if (categoryId) {
    const cat = await prisma.menuCategory.findFirst({ where: { id: categoryId, restaurantId } });
    if (!cat) return { error: "That category doesn't belong to this restaurant." };
  }

  // Sale price is optional; only honored when it's a positive amount below the
  // list price, otherwise cleared so a blank or bad value removes the sale.
  const saleRaw = String(formData.get("salePrice") ?? "").trim();
  const saleCtsParsed = saleRaw ? moneyToCents(saleRaw) : 0;
  const salePriceCts = saleCtsParsed > 0 && saleCtsParsed < priceCts ? saleCtsParsed : null;

  const data = {
    name,
    description: String(formData.get("description") || "") || null,
    priceCts,
    salePriceCts,
    imageUrl: String(formData.get("imageUrl") || "") || null,
    color: String(formData.get("color") || "") || null,
    categoryId,
    available: formData.get("available") === "on",
    featured: formData.get("featured") === "on",
    sort: parseInt(String(formData.get("sort") ?? "0"), 10) || 0,
  };

  if (id) {
    const existing = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
    if (!existing) return { error: "Item not found." };
    await prisma.menuItem.update({ where: { id }, data });
  } else {
    await prisma.menuItem.create({ data: { ...data, restaurantId } });
  }

  revalidatePath("/dashboard/menu");
  return { ok: id ? "Item updated." : "Item added." };
}

export async function toggleItemAvailabilityAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const item = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
  if (!item) return;
  await prisma.menuItem.update({ where: { id }, data: { available: !item.available } });
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

export async function deleteMenuItemAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const item = await prisma.menuItem.findFirst({ where: { id, restaurantId } });
  if (!item) return;
  await prisma.menuItem.delete({ where: { id } });
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

/* ── Upsell / cross-sell links ──────────────────────────────────────────
 * Both items must belong to the caller's restaurant, and an item can't
 * recommend itself. The pair is unique, so re-adding just updates the kind.
 */
export async function addItemLinkAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const itemId = String(formData.get("itemId") ?? "");
  const linkedItemId = String(formData.get("linkedItemId") ?? "");
  const kindRaw = String(formData.get("kind") ?? "CROSS_SELL");
  const kind = kindRaw === "UPSELL" ? "UPSELL" : "CROSS_SELL";

  if (!itemId || !linkedItemId || itemId === linkedItemId) return;

  const both = await prisma.menuItem.findMany({
    where: { id: { in: [itemId, linkedItemId] }, restaurantId },
    select: { id: true },
  });
  if (both.length !== 2) return;

  const count = await prisma.menuItemLink.count({ where: { itemId } });
  await prisma.menuItemLink
    .upsert({
      where: { itemId_linkedItemId: { itemId, linkedItemId } },
      create: { itemId, linkedItemId, kind, sort: count },
      update: { kind },
    })
    .catch(() => null);

  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

export async function removeItemLinkAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id") ?? "");
  const link = await prisma.menuItemLink.findFirst({
    where: { id, item: { restaurantId } },
    select: { id: true },
  });
  if (!link) return;
  await prisma.menuItemLink.delete({ where: { id } });
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

export async function createCategoryAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const count = await prisma.menuCategory.count({ where: { restaurantId } });
  await prisma.menuCategory
    .create({ data: { restaurantId, name, sort: count } })
    .catch(() => null); // unique(restaurantId, name)
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

export async function deleteCategoryAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const cat = await prisma.menuCategory.findFirst({ where: { id, restaurantId } });
  if (!cat) return;
  await prisma.menuCategory.delete({ where: { id } }); // items fall back to uncategorized
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

export async function updateBrandingAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Restaurant name is required." };

  // Gallery arrives as gallery0..galleryN hidden inputs; keep the non-empty
  // ones in order, cap it so the strip can't grow unbounded.
  const galleryUrls = formData
    .getAll("gallery")
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, 6);

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: {
      name,
      tagline: String(formData.get("tagline") || "") || null,
      logoUrl: String(formData.get("logoUrl") || "") || null,
      heroUrl: String(formData.get("heroUrl") || "") || null,
      accentColor: String(formData.get("accentColor") || "#3b82f6"),
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
      theme: (["LIGHT", "DARK", "SYSTEM"].includes(String(formData.get("theme")))
        ? String(formData.get("theme"))
        : "SYSTEM"),
      // Coerced through storeTheme rather than trusted: the column is a plain
      // String, so an unknown value would reach the storefront and render an
      // unstyled page. Unknown falls back to Classic — see lib/store-theme.ts.
      themePreset: storeTheme(String(formData.get("themePreset") ?? "")).id,
      siteContent: siteContentFromForm(formData) as object,
    },
  });

  revalidatePath("/dashboard/branding");
  revalidatePath("/dashboard");
  return { ok: "Saved." };
}

/**
 * Change the ordering address (/r/[slug]).
 *
 * This is destructive in a quiet way: every QR code, Google Business Profile
 * field, and printed card pointing at the old slug stops resolving the moment
 * it changes. So we make the owner retype the new address to confirm, and we
 * hand back the old one in the success message so they can undo by hand.
 */
export async function updateSlugAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const check = checkSlug(String(formData.get("slug") ?? ""));
  if (!check.ok) return { error: check.error };
  const slug = check.slug;

  const current = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { slug: true },
  });
  if (!current) return { error: "Restaurant not found." };
  if (current.slug === slug) return { ok: "That's already your address." };

  // Typed confirmation — the field must match what they're asking for, after
  // the same normalization, so "Bobs Pizza" confirms "bobs-pizza".
  const confirmRaw = String(formData.get("confirm") ?? "");
  const confirm = checkSlug(confirmRaw);
  if (!confirm.ok || confirm.slug !== slug) {
    return { error: "Type the new address again in the confirm box to change it." };
  }

  const taken = await prisma.restaurant.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== restaurantId) {
    return { error: `"${slug}" is already taken. Try adding your city or neighborhood.` };
  }

  await prisma.restaurant.update({ where: { id: restaurantId }, data: { slug } });

  revalidatePath("/dashboard/branding");
  revalidatePath("/dashboard");
  revalidatePath(`/r/${current.slug}`);
  revalidatePath(`/r/${slug}`);
  return { ok: `Your link is now /r/${slug}. The old one (/r/${current.slug}) no longer works.` };
}

/* ── Custom domain ────────────────────────────────────────────────────
 * Thin owner-side wrappers. The logic lives in `lib/domain-ops.ts` because
 * the admin console performs the same three operations on any tenant, and two
 * implementations would eventually disagree about whether a domain is live.
 * These supply the auth scope; that module supplies the behaviour.
 */

export async function saveCustomDomainAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await saveDomain(restaurantId, String(formData.get("domain") ?? ""));
  revalidatePath("/dashboard/branding");
  return res;
}

export async function verifyCustomDomainAction(_prev: Result, _formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const res = await recheckDomain(restaurantId);
  revalidatePath("/dashboard/branding");
  return res;
}

export async function removeCustomDomainAction(): Promise<void> {
  const { restaurantId } = await requireOwner();
  await clearDomain(restaurantId);
  revalidatePath("/dashboard/branding");
}

/* ── Modifiers ────────────────────────────────────────────────────────
 * Groups hang off a single item. Every mutation walks group -> item ->
 * restaurantId so a forged id from another tenant can't be touched.
 */

async function assertOwnsGroup(groupId: string, restaurantId: string) {
  return prisma.modifierGroup.findFirst({
    where: { id: groupId, menuItem: { restaurantId } },
    select: { id: true, menuItemId: true },
  });
}

export async function upsertModifierGroupAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const id = String(formData.get("id") ?? "");
  const menuItemId = String(formData.get("menuItemId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const required = formData.get("required") === "on";
  const multiple = formData.get("multiple") === "on";
  const maxRaw = parseInt(String(formData.get("maxSelect") ?? "1"), 10);

  if (!name) return { error: "Give this group a name, like “Size” or “Add-ons”." };

  const item = await prisma.menuItem.findFirst({ where: { id: menuItemId, restaurantId } });
  if (!item) return { error: "That item doesn't belong to this restaurant." };

  // min/max encode the shape: single-choice is max 1, required is min 1.
  const maxSelect = multiple ? Math.max(1, Math.min(20, maxRaw || 5)) : 1;
  const minSelect = required ? 1 : 0;

  if (id) {
    const owned = await assertOwnsGroup(id, restaurantId);
    if (!owned) return { error: "Group not found." };
    await prisma.modifierGroup.update({ where: { id }, data: { name, minSelect, maxSelect } });
  } else {
    const count = await prisma.modifierGroup.count({ where: { menuItemId } });
    await prisma.modifierGroup.create({
      data: { menuItemId, name, minSelect, maxSelect, sort: count },
    });
  }

  revalidatePath("/dashboard/menu");
  return { ok: id ? "Group updated." : "Group added." };
}

export async function deleteModifierGroupAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  if (!(await assertOwnsGroup(id, restaurantId))) return;
  await prisma.modifierGroup.delete({ where: { id } });
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

export async function upsertModifierOptionAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const id = String(formData.get("id") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name this choice." };

  if (!(await assertOwnsGroup(groupId, restaurantId))) {
    return { error: "That group doesn't belong to this restaurant." };
  }

  // Deltas may be negative — "no cheese, −$0.50" is a real menu line.
  const priceRaw = String(formData.get("priceDelta") ?? "0").trim();
  const negative = priceRaw.startsWith("-") || priceRaw.startsWith("\u2212");
  const priceDeltaCts = (negative ? -1 : 1) * moneyToCents(priceRaw);

  const data = {
    name,
    priceDeltaCts,
    isDefault: formData.get("isDefault") === "on",
    available: formData.get("available") !== "off",
  };

  if (id) {
    const owned = await prisma.modifierOption.findFirst({
      where: { id, group: { menuItem: { restaurantId } } },
    });
    if (!owned) return { error: "Choice not found." };
    await prisma.modifierOption.update({ where: { id }, data });
  } else {
    const count = await prisma.modifierOption.count({ where: { groupId } });
    await prisma.modifierOption.create({ data: { ...data, groupId, sort: count } });
  }

  // Only one default makes sense per single-select group.
  if (data.isDefault) {
    const group = await prisma.modifierGroup.findUnique({
      where: { id: groupId },
      select: { maxSelect: true },
    });
    if (group?.maxSelect === 1) {
      await prisma.modifierOption.updateMany({
        where: { groupId, isDefault: true, NOT: { name } },
        data: { isDefault: false },
      });
    }
  }

  revalidatePath("/dashboard/menu");
  return { ok: "Saved." };
}

export async function deleteModifierOptionAction(formData: FormData) {
  const { restaurantId } = await requireOwner();
  const id = String(formData.get("id"));
  const owned = await prisma.modifierOption.findFirst({
    where: { id, group: { menuItem: { restaurantId } } },
  });
  if (!owned) return;
  await prisma.modifierOption.delete({ where: { id } });
  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
}

// ---------------------------------------------------------------------------
// Payments (owner-facing)
// ---------------------------------------------------------------------------

/**
 * Absolute origin for building Stripe return/refresh URLs. Onboarding leaves
 * our site entirely, so these have to be absolute and public — a relative path
 * would send the owner back to stripe.com, not to us.
 */
function appOrigin(): string {
  // Deliberately the platform origin and not `canonicalOrigin(restaurant)`:
  // Stripe sends the owner back to /dashboard, which lives on our host. A
  // tenant's custom domain only serves their storefront.
  return platformOrigin() || "http://localhost:3000";
}

/**
 * Send the owner into Stripe Connect onboarding. Creates the connected account
 * if there isn't one yet, mints a fresh single-use link, and redirects. Uses
 * the current platform mode, so this practises against test Connect while the
 * platform is in test and does the real thing once it's live.
 */
export async function startStripeOnboardingAction(_prev: Result, _formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const mode = await resolvePaymentMode();
  if (mode === "STUB") {
    return { error: "Online payments aren't switched on yet. Ask the platform admin to enable them first." };
  }

  const account = await ensureConnectAccount(restaurantId, mode);
  if (!account.ok) return { error: friendlyConnectError(account.error) };

  const origin = appOrigin();
  const link = await createOnboardingLink(account.value, mode, {
    refreshUrl: `${origin}/dashboard/payments?onboarding=refresh`,
    returnUrl: `${origin}/dashboard/payments?onboarding=return`,
  });
  if (!link.ok) return { error: friendlyConnectError(link.error) };

  redirect(link.value);
}

/**
 * Translate raw Stripe errors into something an owner should see. The big one is
 * "you've signed up for Connect…", which fires when the *platform* hasn't
 * enabled Connect yet — a setup step that belongs to us, not the restaurant. An
 * owner told to go sign up for Connect would (reasonably) be baffled, so that
 * case becomes a plain "we're still finishing setup".
 */
function friendlyConnectError(raw: string): string {
  const s = raw.toLowerCase();
  if (s.includes("signed up for connect") || s.includes("connect") && s.includes("enable")) {
    return "Card payouts aren't fully switched on by the platform yet. Nothing you need to do — check back shortly.";
  }
  return raw;
}

/** Re-pull the connected account's readiness from Stripe and cache it. */
export async function refreshStripeStatusAction(_prev: Result, _formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const mode = await resolvePaymentMode();
  if (mode === "STUB") return { error: "Online payments aren't switched on yet." };

  const res = await refreshConnectStatus(restaurantId, mode);
  revalidatePath("/dashboard/payments");
  if (!res.ok) return { error: res.error };
  return res.value.chargesEnabled
    ? { ok: "Connected — you're set up to receive card payments." }
    : { ok: "Status updated. Stripe still needs a bit more before you can take cards." };
}

/**
 * Owner's switch for taking cards online. Off means pay-at-counter.
 *
 * Turning it *on* is refused while the platform has payments suspended. The UI
 * already hides the control in that state, but the check lives here too — a
 * suspended owner posting this form directly is exactly the case the feature
 * exists to stop, and a suspension an owner can lift isn't one.
 */
export async function setCardPaymentsAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const enabled = String(formData.get("enabled") ?? "") === "true";

  if (enabled && (await isSuspended(restaurantId, "PAYMENTS"))) {
    return { error: "Card payments are suspended on this account. Contact support." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { cardPaymentsEnabled: enabled },
  });
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard");
  return { ok: enabled ? "Card payments on." : "Card payments off — orders are pay-at-counter." };
}

/**
 * Owner's switch for offering delivery, guarded the same way cards are: the
 * platform's DELIVERY suspension outranks it and the owner cannot post their
 * way past it.
 *
 * The ordering flow doesn't read `deliveryEnabled` yet — this stores an
 * intention, not a capability. Kept honest in the UI rather than by pretending
 * the switch does something.
 */
export async function setDeliveryAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();
  const enabled = String(formData.get("enabled") ?? "") === "true";

  if (enabled && (await isSuspended(restaurantId, "DELIVERY"))) {
    return { error: "Delivery is suspended on this account. Contact support." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { deliveryEnabled: enabled },
  });
  revalidatePath("/dashboard/payments");
  revalidatePath("/dashboard");
  return { ok: enabled ? "Delivery on." : "Delivery off." };
}

/**
 * The one fee input an owner controls: their own state sales-tax rate.
 *
 * Everything about the surcharge — the rate, its floor and ceiling, and the
 * label it carries on the receipt — is the platform's revenue model and is set
 * in admin. This action must never accept those fields, whatever the form posts.
 */
export async function updateSalesTaxAction(_prev: Result, formData: FormData): Promise<Result> {
  const { restaurantId } = await requireOwner();

  const taxPctRaw = Number(formData.get("taxPct") ?? "");

  if (!Number.isFinite(taxPctRaw) || taxPctRaw < 0 || taxPctRaw > 20) {
    return { error: "Tax rate must be between 0 and 20%." };
  }

  await prisma.restaurant.update({
    where: { id: restaurantId },
    // Stored as a fraction; the form collects a percent.
    data: { taxPct: taxPctRaw / 100 },
  });
  revalidatePath("/dashboard/payments");
  return { ok: "Saved." };
}
