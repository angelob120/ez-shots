import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { exportMenuCsvText, menuCsvTemplate } from "@/lib/menu-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/menu/csv            → current menu as CSV
 * GET /api/menu/csv?template=1 → a starter template with example rows
 *
 * Both are owner-scoped; the export re-derives the tenant from the session.
 */
export async function GET(req: Request) {
  const { restaurantId } = await requireOwner();
  const url = new URL(req.url);
  const isTemplate = url.searchParams.get("template") === "1";

  const body = isTemplate ? menuCsvTemplate() : await exportMenuCsvText(restaurantId);
  const filename = isTemplate ? "menu-template.csv" : "menu.csv";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
