"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOwner, getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { fetchMenuPage } from "@/lib/menu-fetch";
import {
  detectPlatform,
  normalizeMenuUrl,
  scrapeMenuFromHtml,
  PLATFORM_LABEL,
  type MenuPlatform,
  type PriceScale,
  type ScrapedItem,
} from "@/lib/menu-scrape";
import { importMenuRows, type ImportSummary } from "@/lib/menu-import";
import type { ParsedMenuRow } from "@/lib/csv";

/**
 * The delivery-platform menu importer — auth boundary and nothing else.
 *
 * Shared by the dashboard menu page and the onboarding wizard, because the two
 * differ only in where the owner is standing. Both go through `requireOwner()`,
 * so the tenant is taken from the session and never from the form; and both
 * commit through `importMenuRows`, the one committer in `lib/menu-import.ts`.
 *
 * The preview and the commit are deliberately two separate actions. Preview
 * fetches and parses and writes nothing; commit takes rows the owner has seen
 * and possibly edited. Collapsing them into one "import from link" button is
 * the version of this feature that silently fills a menu with modifier options
 * priced at $1,299 each.
 */

const MAX_PASTE_BYTES = 8 * 1024 * 1024;

export type PreviewResult = {
  ok: boolean;
  error?: string;
  /** True when the platform refused us and pasting is the way through. */
  suggestPaste?: boolean;
  items: ScrapedItem[];
  platform: MenuPlatform;
  platformLabel: string;
  priceScale: PriceScale;
  warnings: string[];
  sourceUrl: string | null;
};

const emptyPreview: PreviewResult = {
  ok: false,
  items: [],
  platform: "other",
  platformLabel: PLATFORM_LABEL.other,
  priceScale: "dollars",
  warnings: [],
  sourceUrl: null,
};

/**
 * Fetch a delivery-platform page and propose rows. Writes nothing.
 *
 * Rate limited per tenant. Not for our protection — a menu import is a handful
 * of requests — but because an owner who pastes a link that redirect-loops, or
 * who leans on the button, should not turn our egress IP into something
 * DoorDash blocks for every other tenant on the platform.
 */
export async function previewMenuFromUrlAction(
  _prev: PreviewResult | undefined,
  formData: FormData
): Promise<PreviewResult> {
  const { restaurantId } = await requireOwner();

  const limit = checkRateLimit(`menu-url-import:${restaurantId}`, 10, 60_000);
  if (!limit.allowed) {
    return { ...emptyPreview, error: "That's a lot of imports at once — wait a minute and retry." };
  }

  const normalized = normalizeMenuUrl(String(formData.get("url") ?? ""));
  if ("error" in normalized) return { ...emptyPreview, error: normalized.error };

  const platform = detectPlatform(normalized.url);
  const page = await fetchMenuPage(normalized.url);

  if (!page.ok) {
    return {
      ...emptyPreview,
      platform,
      platformLabel: PLATFORM_LABEL[platform],
      error: page.error,
      suggestPaste: true,
      sourceUrl: normalized.url,
    };
  }

  const result = scrapeMenuFromHtml(page.html, platform);
  return {
    ok: result.items.length > 0,
    items: result.items,
    platform,
    platformLabel: PLATFORM_LABEL[platform],
    priceScale: result.priceScale,
    warnings: result.warnings,
    sourceUrl: page.finalUrl,
    suggestPaste: result.items.length === 0,
    error: result.items.length === 0 ? result.warnings[0] : undefined,
  };
}

/**
 * The fallback: the owner saved or copied the page themselves and pasted it.
 *
 * A first-class path, not a consolation prize. These platforms block
 * datacentre traffic as a matter of course, so on any given day this may be
 * the only route that works — and it involves no request from us at all, which
 * is the cleaner answer to their terms of service besides.
 */
export async function previewMenuFromPasteAction(
  _prev: PreviewResult | undefined,
  formData: FormData
): Promise<PreviewResult> {
  await requireOwner();

  const html = String(formData.get("html") ?? "");
  if (!html.trim()) {
    return { ...emptyPreview, error: "Paste the page's contents into the box first." };
  }
  if (html.length > MAX_PASTE_BYTES) {
    return { ...emptyPreview, error: "That's larger than we can handle (max 8 MB)." };
  }

  const hinted = String(formData.get("url") ?? "");
  const platform = hinted ? detectPlatform(hinted) : "other";
  const result = scrapeMenuFromHtml(html, platform);

  return {
    ok: result.items.length > 0,
    items: result.items,
    platform,
    platformLabel: PLATFORM_LABEL[platform],
    priceScale: result.priceScale,
    warnings: result.warnings,
    sourceUrl: hinted || null,
    error: result.items.length === 0 ? result.warnings[0] : undefined,
  };
}

/**
 * Commit the rows the owner approved.
 *
 * Prices arrive already resolved to cents by the review table, so the
 * cents-versus-dollars judgement has been made by a human looking at the
 * numbers rather than by `guessPriceScale`. Re-deriving it here would throw
 * that away.
 */
export async function commitScrapedMenuAction(
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

  let rows: ParsedMenuRow[];
  try {
    const raw = JSON.parse(String(formData.get("rows") ?? "[]")) as unknown;
    if (!Array.isArray(raw)) throw new Error("not an array");
    rows = raw.map(coerceRow).filter((r): r is ParsedMenuRow => r !== null);
  } catch {
    return { ...empty, error: "Something went wrong reading the table. Try the import again." };
  }

  if (rows.length === 0) return { ...empty, error: "Tick at least one item to import." };
  if (rows.length > 1000) return { ...empty, error: "That's more than 1,000 items — import it in parts." };

  // Re-hosting is skipped before launch, matching the CSV path: the storefront
  // isn't serving yet and pulling several hundred photos is a slow first
  // impression of the wizard. Derived from the tenant, never from the form.
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: { onboardedAt: true, onboardingStep: true },
  });

  const summary = await importMenuRows(restaurantId, rows, {
    rehostImages: Boolean(restaurant?.onboardedAt),
    createdById: session?.userId ?? null,
  });

  // Same progress bump the CSV path makes, so importing this way during the
  // wizard advances it. Never moves an owner backwards.
  if (summary.created > 0 && restaurant && restaurant.onboardingStep < 3) {
    await prisma.restaurant.update({
      where: { id: restaurantId },
      data: { onboardingStep: 3 },
    });
  }

  revalidatePath("/dashboard/menu");
  revalidatePath("/onboarding");
  return summary;
}

/** Trust nothing off the wire — this is a client-supplied JSON blob. */
function coerceRow(v: unknown): ParsedMenuRow | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;

  const name = typeof o.name === "string" ? o.name.trim().slice(0, 120) : "";
  if (!name) return null;

  const priceCts = Number(o.priceCts);
  if (!Number.isFinite(priceCts) || priceCts <= 0 || priceCts > 100_000_00) return null;

  const str = (x: unknown, max: number) =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, max) : null;

  const imageUrl = str(o.imageUrl, 2000);

  return {
    name,
    price: (Math.round(priceCts) / 100).toFixed(2),
    category: str(o.category, 60),
    description: str(o.description, 500),
    imageUrl: imageUrl && /^https?:\/\//i.test(imageUrl) ? imageUrl : null,
    available: o.available !== false,
    featured: o.featured === true,
  };
}
