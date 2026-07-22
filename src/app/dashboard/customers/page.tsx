import { requireOwner } from "@/lib/auth";
import { centsToMoney, displayPhone } from "@/lib/money";
import {
  customerStats,
  filtersToQuery,
  isFiltering,
  listSegments,
  listTags,
  paramsToFilters,
  readCustomerParams,
  searchCustomers,
  DEFAULT_PAGE_SIZE,
} from "@/lib/customers";
import { listImportJobs } from "@/lib/customer-import";
import {
  bulkTagAction,
  importCustomerCsvAction,
  previewCustomerCsvAction,
} from "@/app/dashboard/actions";
import { Card, Empty, SectionTitle, Stat } from "@/components/hearth/ui";
import CustomerSearch from "@/components/hearth/CustomerSearch";
import CustomerImport from "@/components/hearth/CustomerImport";
import CustomerTable from "@/components/hearth/CustomerTable";
import Pager from "@/components/hearth/Pager";
import TagManager from "./TagManager";
import SegmentBar from "./SegmentBar";
import ImportHistory from "./ImportHistory";

export const dynamic = "force-dynamic";

function daysAgo(d: Date | null) {
  if (!d) return null;
  return Math.floor((Date.now() - d.getTime()) / 864e5);
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const { restaurantId } = await requireOwner();
  const params = readCustomerParams(searchParams);

  // The stats are deliberately unfiltered — they describe the list, not the
  // search. A repeat rate that moves as you type is a number nobody can act on.
  const [stats, result, tags, segments, jobs] = await Promise.all([
    customerStats(restaurantId),
    searchCustomers({
      ...paramsToFilters(restaurantId, params),
      sort: params.sort,
      take: DEFAULT_PAGE_SIZE,
      skip: (params.page - 1) * DEFAULT_PAGE_SIZE,
    }),
    listTags(restaurantId),
    listSegments(restaurantId),
    listImportJobs(restaurantId, 10),
  ]);

  const filtering = isFiltering(params);
  const query = filtersToQuery(params);

  return (
    <>
      <SectionTitle
        title="Customers"
        subtitle="Your list. Not a delivery app's list - yours, built one order at a time."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Customers" value={stats.total.toLocaleString()} />
        <Stat
          label="Reachable by text"
          value={stats.optedIn.toLocaleString()}
          tone="accent"
          hint="Explicitly opted in"
        />
        <Stat
          label="Repeat rate"
          value={`${stats.repeatRate}%`}
          hint={`${stats.repeat} have ordered more than once`}
        />
        <Stat label="Lapsed 30d+" value={stats.lapsed.toLocaleString()} hint="Win-back audience" />
      </div>

      <CustomerImport
        action={importCustomerCsvAction}
        previewAction={previewCustomerCsvAction}
        tags={tags.filter((t) => !t.system).map((t) => ({ id: t.id, name: t.name }))}
      />

      <ImportHistory jobs={jobs as any} />
      <TagManager tags={tags} />

      <Card className="mb-6">
        <h3 className="mb-2 text-[14px] font-semibold text-ink">Messaging is not live yet</h3>
        <p className="text-[13px] leading-relaxed text-dim">
          Opt-in consent, the exact disclosure text, and the timestamp are being captured on every order from day
          one, so the list is compliant the moment carrier registration clears. Until then nothing is sent - the
          audience is just being built. Customers in the holdout cohort are excluded from campaigns permanently, so
          the lift measurement stays honest.
        </p>
      </Card>

      {stats.total === 0 ? (
        <Empty
          title="No customers yet"
          body="The first order through your ordering page starts the list — or import the customers you already have."
        />
      ) : (
        <>
          <SegmentBar segments={segments as any} query={query} filtering={filtering} />

          <CustomerSearch
            tags={tags.map((t) => ({ slug: t.slug, name: t.name, color: t.color, count: t.count }))}
            total={stats.total}
            shown={result.total}
          />

          {result.rows.length === 0 ? (
            <Empty
              title="No customers match those filters"
              body={
                filtering
                  ? "Try a name, a full phone number, or just the last four digits — or clear a filter."
                  : undefined
              }
            />
          ) : (
            <>
              <CustomerTable
                rows={result.rows.map((c) => {
                  const d = daysAgo(c.lastOrderAt);
                  return {
                    id: c.id,
                    name: c.name,
                    phone: c.phone,
                    phoneDisplay: displayPhone(c.phone),
                    optInStatus: c.optInStatus,
                    cohort: c.cohort,
                    orderCount: c.orderCount,
                    lifetime: centsToMoney(c.lifetimeCts),
                    lastOrderLabel: d === null ? "—" : d === 0 ? "Today" : `${d}d ago`,
                    imported: Boolean(c.importJobId),
                    tags: c.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
                  };
                })}
                tags={tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))}
                total={result.total}
                bulkAction={bulkTagAction}
              />

              <Pager page={params.page} pageSize={DEFAULT_PAGE_SIZE} total={result.total} />

              <div className="mt-4">
                <a
                  href={`/api/customers/csv${query ? `?${query}` : ""}`}
                  className="text-[12px] text-dim underline underline-offset-2 hover:text-ink"
                >
                  {/* The export follows the filter, so what downloads is what's
                      on screen. An export that ignores the filter bar turns a
                      40-person win-back list into a 3,000-row file with no
                      indication anything went wrong. */}
                  Export {filtering ? "these" : "all"} customers as CSV
                </a>
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}
