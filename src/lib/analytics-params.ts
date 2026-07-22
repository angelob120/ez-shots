/**
 * The querystring → `AnalyticsFilter` step, in one place.
 *
 * This used to live inline in both analytics pages, which was fine while they
 * were the only two readers. The CSV export made a third, and an export that
 * resolves the range even slightly differently from the page it was clicked
 * from is the same class of bug `docs/analytics.md` warns about for conversion
 * rate: two implementations of the same question, and the first anyone hears of
 * the drift is a spreadsheet that disagrees with a dashboard.
 *
 * `readFilterParams` is re-exported from `components/hearth/AnalyticsFilters`
 * for the call sites that already import it from there.
 */

import { resolveRange } from "@/lib/analytics-range";
import { earliestActivity, type AnalyticsFilter } from "@/lib/analytics-query";
import type { VisitDevice, VisitSource } from "@prisma/client";

export type FilterParams = ReturnType<typeof readFilterParams>;

/** Read the filter bar's own querystring back out. */
export function readFilterParams(sp: Record<string, string | string[] | undefined>) {
  const one = (k: string) => {
    const v = sp[k];
    return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
  };
  return {
    range: one("range") || null,
    from: one("from") || null,
    to: one("to") || null,
    q: one("q"),
    source: one("source"),
    device: one("device"),
    includeSimulated: one("sim") === "1",
    tab: one("tab"),
  };
}

/**
 * Resolve those params against a timezone.
 *
 * `restaurantId` is used only to answer "all time" — it's the tenant whose
 * first recorded activity bounds the range, and null means platform-wide. It is
 * never a filter here; scoping is the caller's, passed separately to each query
 * function, exactly as `lib/customers.ts` requires.
 */
export async function resolveAnalyticsFilter(args: {
  params: FilterParams;
  timezone: string;
  restaurantId: string | null;
  now?: Date;
}): Promise<AnalyticsFilter> {
  const { params, timezone, restaurantId } = args;
  const since = params.range === "all" ? await earliestActivity(restaurantId) : null;
  const range = resolveRange({
    preset: params.range,
    from: params.from,
    to: params.to,
    timezone,
    now: args.now ?? new Date(),
    since,
  });

  return {
    range,
    timezone,
    q: params.q || null,
    source: (params.source || null) as VisitSource | null,
    device: (params.device || null) as VisitDevice | null,
    includeSimulated: params.includeSimulated,
  };
}
