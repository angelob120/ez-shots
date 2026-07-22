import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { readFilterParams, resolveAnalyticsFilter } from "@/lib/analytics-params";
import { PLATFORM_TZ } from "@/lib/analytics-query";
import {
  adminCsv,
  ownerCsv,
  type AdminDataset,
  type OwnerDataset,
} from "@/lib/analytics-export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/analytics/csv?dataset=…&<the filter bar's own querystring>
 *
 * One endpoint for both surfaces, because the thing that differs between them
 * is a scope decision and scope decisions belong at the auth boundary rather
 * than in two near-identical files that drift.
 *
 * **The tenant is derived from the session, never from the query.** An owner
 * gets their own restaurant and there is no parameter that changes that. An
 * admin may pass `restaurant=<id>`, and that is the only path in this file
 * that reads a tenant id from a URL — it is reachable solely because the
 * session role is ADMIN, checked first. Same rule as everywhere else:
 * `restaurantId` is a scope, not a filter, and nothing accepts it from a
 * client that hasn't been proved to own it.
 *
 * Every other parameter is the analytics filter bar's, parsed by the same
 * `readFilterParams` and resolved by the same `resolveAnalyticsFilter` the page
 * uses — so "export what I'm looking at" is literally the same query against
 * the same range. See `lib/analytics-export.ts` for why that matters more here
 * than it looks.
 */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) redirect("/login");

  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams);
  const params = readFilterParams(sp);
  const dataset = url.searchParams.get("dataset") ?? "";

  if (session.role === "ADMIN") {
    const focus = url.searchParams.get("restaurant");

    if (focus) {
      // A tenant drilldown, exported. Resolved in the *tenant's* timezone —
      // reading their Tuesday in ours is how support ends up disagreeing with
      // an owner about which day was busy.
      const r = await prisma.restaurant.findUnique({
        where: { id: focus },
        select: { id: true, slug: true, timezone: true },
      });
      if (!r) return new NextResponse("Unknown tenant", { status: 404 });

      const filter = await resolveAnalyticsFilter({
        params,
        timezone: r.timezone,
        restaurantId: r.id,
      });
      const { body, filename } = await ownerCsv(r.id, filter, ownerDataset(dataset));
      return csv(body, `${r.slug}-${filename}`);
    }

    const filter = await resolveAnalyticsFilter({
      params,
      timezone: PLATFORM_TZ,
      restaurantId: null,
    });
    const { body, filename } = await adminCsv(filter, adminDataset(dataset));
    return csv(body, filename);
  }

  if (!session.restaurantId) redirect("/admin");

  const r = await prisma.restaurant.findUnique({
    where: { id: session.restaurantId },
    select: { timezone: true },
  });
  if (!r) return new NextResponse("Unknown tenant", { status: 404 });

  const filter = await resolveAnalyticsFilter({
    params,
    timezone: r.timezone,
    restaurantId: session.restaurantId,
  });
  const { body, filename } = await ownerCsv(session.restaurantId, filter, ownerDataset(dataset));
  return csv(body, filename);
}

// An unrecognised dataset falls back rather than 400s. This is reached from a
// link in a menu, so the only way to get here with a bad value is a hand-edited
// or stale URL, and handing that person the traffic export is a better answer
// than an error page they can't act on.
function ownerDataset(v: string): OwnerDataset {
  const allowed: OwnerDataset[] = ["items", "visits", "series", "sources", "funnel", "searches"];
  return allowed.includes(v as OwnerDataset) ? (v as OwnerDataset) : "series";
}

function adminDataset(v: string): AdminDataset {
  return v === "series" ? "series" : "tenants";
}

function csv(body: string, filename: string) {
  return new NextResponse(body, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
