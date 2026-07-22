import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { exportCustomerCsvText, customerCsvTemplate } from "@/lib/customer-import";
import { paramsToFilters, readCustomerParams } from "@/lib/customers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/customers/csv            → this tenant's customer list as CSV
 * GET /api/customers/csv?template=1 → the starter template for imports
 *
 * Owner-scoped, and the tenant is re-derived from the session rather than
 * accepted from the query — this endpoint hands back an entire customer list,
 * which is the single most sensitive export in the product.
 *
 * Every *other* query param is the filter bar's, parsed through the same
 * `readCustomerParams` the list page uses, so "export what I'm looking at" is
 * literally the same query. Note the tenant is still not one of them: filters
 * narrow, they can never widen past the session's own restaurant.
 */
export async function GET(req: Request) {
  const { restaurantId } = await requireOwner();
  const url = new URL(req.url);
  const isTemplate = url.searchParams.get("template") === "1";

  const params = readCustomerParams(Object.fromEntries(url.searchParams));

  const body = isTemplate
    ? customerCsvTemplate()
    : await exportCustomerCsvText(restaurantId, paramsToFilters(restaurantId, params));
  const filename = isTemplate ? "customer-import-template.csv" : "customers.csv";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
