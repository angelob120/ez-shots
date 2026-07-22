import "server-only";
import { prisma } from "@/lib/prisma";
import { moneyToCents } from "@/lib/money";
import { mapMenuCsv, MENU_CSV_HEADER, toCsvRow, type ParsedMenuRow } from "@/lib/csv";
import { rehostImageFromUrl } from "@/lib/rehost";

export type ImportSummary = {
  ok?: string;
  error?: string;
  created: number;
  categoriesCreated: number;
  imagesRehosted: number;
  imagesFailed: number;
  warnings: string[];
};

/**
 * Ingest a CSV file into a restaurant's menu. Creates any categories that
 * don't exist yet, re-hosts every valid image URL through our media system,
 * and appends items after whatever is already there.
 *
 * `rehostImages` is off during onboarding (site isn't live yet) and on from
 * the dashboard — but image URLs are always parsed so nothing is silently lost.
 */
export async function importMenuCsvText(
  restaurantId: string,
  csvText: string,
  opts: { rehostImages: boolean; createdById?: string | null } = { rehostImages: true }
): Promise<ImportSummary> {
  const { rows, warnings } = mapMenuCsv(csvText);
  return importMenuRows(restaurantId, rows, { ...opts, warnings });
}

/**
 * Create menu items from already-parsed rows. **The one committer.**
 *
 * Both import paths end here — the CSV upload and the delivery-platform link
 * importer in `lib/menu-scrape.ts`. They differ entirely in how they obtain
 * rows and not at all in what happens to them, and a second copy of this
 * function is how the link importer ends up quietly skipping the image
 * re-hosting, or creating categories the CSV path would have reused.
 */
export async function importMenuRows(
  restaurantId: string,
  rows: ParsedMenuRow[],
  opts: { rehostImages: boolean; createdById?: string | null; warnings?: string[] }
): Promise<ImportSummary> {
  const warnings = [...(opts.warnings ?? [])];

  if (rows.length === 0) {
    return {
      error: warnings[0] ?? "No valid rows found.",
      created: 0,
      categoriesCreated: 0,
      imagesRehosted: 0,
      imagesFailed: 0,
      warnings,
    };
  }

  // Resolve categories once. Reuse existing (case-insensitive), create the rest.
  const existing = await prisma.menuCategory.findMany({
    where: { restaurantId },
    select: { id: true, name: true, sort: true },
  });
  const byName = new Map(existing.map((c) => [c.name.toLowerCase(), c]));
  let sortCursor = existing.reduce((m, c) => Math.max(m, c.sort), -1) + 1;
  let categoriesCreated = 0;

  const wantedCats = new Set(
    rows.map((r) => r.category?.trim()).filter((c): c is string => Boolean(c))
  );
  for (const catName of wantedCats) {
    if (byName.has(catName.toLowerCase())) continue;
    try {
      const created = await prisma.menuCategory.create({
        data: { restaurantId, name: catName, sort: sortCursor++ },
      });
      byName.set(catName.toLowerCase(), { id: created.id, name: created.name, sort: created.sort });
      categoriesCreated++;
    } catch {
      /* unique collision under a race — fall through, item lands uncategorized */
    }
  }

  let itemSort = await prisma.menuItem.count({ where: { restaurantId } });
  let created = 0;
  let imagesRehosted = 0;
  let imagesFailed = 0;

  for (const row of rows) {
    const priceCts = moneyToCents(row.price);
    if (priceCts <= 0) {
      warnings.push(`“${row.name}”: price wasn't a positive amount - skipped.`);
      continue;
    }

    const category = row.category ? byName.get(row.category.toLowerCase()) : null;

    let imageUrl: string | null = null;
    if (row.imageUrl && opts.rehostImages) {
      const hosted = await rehostImageFromUrl(row.imageUrl, restaurantId, "ITEM", opts.createdById);
      if (hosted) {
        imageUrl = hosted.url;
        imagesRehosted++;
      } else {
        imagesFailed++;
        warnings.push(`“${row.name}”: couldn't fetch its image - imported without a photo.`);
      }
    }

    await prisma.menuItem.create({
      data: {
        restaurantId,
        categoryId: category?.id ?? null,
        name: row.name,
        description: row.description,
        priceCts,
        imageUrl,
        available: row.available,
        featured: row.featured,
        sort: itemSort++,
      },
    });
    created++;
  }

  const bits = [`Imported ${created} item${created === 1 ? "" : "s"}`];
  if (categoriesCreated) bits.push(`${categoriesCreated} new categor${categoriesCreated === 1 ? "y" : "ies"}`);
  if (imagesRehosted) bits.push(`${imagesRehosted} photo${imagesRehosted === 1 ? "" : "s"}`);

  return {
    ok: bits.join(", ") + ".",
    created,
    categoriesCreated,
    imagesRehosted,
    imagesFailed,
    warnings,
  };
}

/** Serialize a restaurant's menu to CSV text for the "Export" button. */
export async function exportMenuCsvText(restaurantId: string): Promise<string> {
  const items = await prisma.menuItem.findMany({
    where: { restaurantId },
    orderBy: [{ sort: "asc" }, { name: "asc" }],
    include: { category: { select: { name: true } } },
  });

  const lines = [toCsvRow([...MENU_CSV_HEADER])];
  for (const it of items) {
    lines.push(
      toCsvRow([
        it.name,
        (it.priceCts / 100).toFixed(2),
        it.category?.name ?? "",
        it.description ?? "",
        it.imageUrl ?? "",
        it.available ? "yes" : "no",
        it.featured ? "yes" : "no",
      ])
    );
  }
  return lines.join("\n") + "\n";
}

/** A small starter file owners can download, fill in, and re-upload. */
export function menuCsvTemplate(): string {
  return [
    toCsvRow([...MENU_CSV_HEADER]),
    toCsvRow(["Margherita Pizza", "16.00", "Pizza", "San marzano, fresh mozzarella, basil", "https://example.com/margherita.jpg", "yes", "yes"]),
    toCsvRow(["Caesar Salad", "11.50", "Salads", "Romaine, parmesan, house dressing", "", "yes", "no"]),
  ].join("\n") + "\n";
}
