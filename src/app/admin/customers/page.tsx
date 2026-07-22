import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { centsToMoney, displayPhone } from "@/lib/money";
import {
  isFiltering,
  paramsToFilters,
  readCustomerParams,
  searchCustomers,
  DEFAULT_PAGE_SIZE,
} from "@/lib/customers";
import { Badge, Card, Empty, SectionTitle, Stat, Table, Td, Th } from "@/components/hearth/ui";
import CustomerSearch from "@/components/hearth/CustomerSearch";
import TagChip from "@/components/hearth/TagChip";
import Pager from "@/components/hearth/Pager";

export const dynamic = "force-dynamic";

/**
 * Cross-tenant customer lookup.
 *
 * This exists for one job: somebody rings us about an order and all we have is
 * their phone number. Without it that call requires guessing which restaurant
 * they mean and opening tenants one at a time.
 *
 * Two things are deliberately absent.
 *
 * **It does not list customers by default.** With no search term the page shows
 * nothing but the search box. A paginated dump of every customer on the
 * platform is not a support tool, it's a data-exfiltration surface with a
 * pager on it — and an idle admin session left open on it is the sort of thing
 * that shows up in a breach report. You get rows when you ask a question.
 *
 * **Nothing about the customer is editable.** This is a lookup, not a console.
 * Changing a customer's consent, tags or details belongs to the tenant that
 * owns the relationship, and an admin quietly editing somebody's opt-in status
 * would destroy the audit trail `lib/sms.ts` depends on. The one thing an admin
 * can add is an internal note, in a table the tenant never sees — see
 * `/admin/customers/[id]`.
 *
 * The filters *are* offered, because narrowing a search is the opposite of
 * dumping a list: "the Hartley number, opted out, ordered in the last month"
 * is a support question, and every filter added makes the result set smaller.
 * Tag filtering is deliberately not offered here — tag vocabularies are
 * per-tenant, so a cross-tenant tag filter would be asking a question that has
 * no answer.
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  await requireAdmin();
  const params = readCustomerParams(searchParams);

  // A tag filter can't mean anything across tenants — the slugs aren't shared
  // — so it's dropped rather than silently returning nothing.
  const filters = { ...paramsToFilters(null, params), tags: [] };
  const searching = isFiltering({ ...params, tags: [] });

  // Platform totals are cheap and answer "is the list growing" without
  // listing anybody.
  const [platformTotal, optedInTotal] = await Promise.all([
    prisma.customer.count(),
    prisma.customer.count({ where: { optInStatus: "OPTED_IN" } }),
  ]);

  const result = searching
    ? await searchCustomers({
        ...filters,
        sort: params.sort,
        take: DEFAULT_PAGE_SIZE,
        skip: (params.page - 1) * DEFAULT_PAGE_SIZE,
      })
    : { rows: [], total: 0, hasMore: false };

  return (
    <>
      <SectionTitle
        title="Customers"
        subtitle="Every tenant's list, searchable. For answering the phone - not for editing."
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Customers, all tenants" value={platformTotal.toLocaleString()} />
        <Stat
          label="Reachable by text"
          value={optedInTotal.toLocaleString()}
          tone="accent"
          hint="Opted in with a record of consent"
        />
        <Stat
          label="Consent rate"
          value={platformTotal ? `${Math.round((optedInTotal / platformTotal) * 100)}%` : "-"}
          hint="Across the platform"
        />
      </div>

      <CustomerSearch
        placeholder="Search every tenant by name, phone, or email"
        tags={[]}
        total={searching ? result.total : platformTotal}
        shown={searching ? result.total : platformTotal}
      />

      {!searching ? (
        <Card>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">Search to see customers</h3>
          <p className="text-[13px] leading-relaxed text-dim">
            This page doesn&apos;t list customers until you ask it something - a name, a full phone
            number, or just the last four digits off a caller ID. Listing every customer on the
            platform by default would make an idle browser tab a standing copy of every tenant&apos;s
            most valuable asset.
          </p>
        </Card>
      ) : result.rows.length === 0 ? (
        <Empty
          title="No customers match that search"
          body="Try the last four digits of the number, or part of a name."
        />
      ) : (
        <>
          <Table>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Restaurant</Th>
                <Th>Tags</Th>
                <Th>Texts</Th>
                <Th className="text-right">Orders</Th>
                <Th className="text-right">Lifetime</Th>
                <Th>Last order</Th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/admin/customers/${c.id}`} className="font-medium text-ink hover:text-accent">
                      {c.name || "—"}
                    </Link>
                    <div className="font-mono text-[11px] text-mute">{displayPhone(c.phone)}</div>
                  </Td>
                  <Td>
                    {/* Straight to the tenant page — the next thing an admin
                        does after finding somebody is look at who they belong
                        to. */}
                    <Link
                      href={`/admin/restaurants/${c.restaurantId}`}
                      className="text-accent underline underline-offset-2"
                    >
                      {c.restaurant?.name ?? "Unknown"}
                    </Link>
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 2).map((t) => (
                        <TagChip key={t.id} name={t.name} color={t.color} />
                      ))}
                      {c.tags.length > 2 && (
                        <span className="text-[11px] text-mute">+{c.tags.length - 2}</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge
                      tone={
                        c.optInStatus === "OPTED_IN"
                          ? "good"
                          : c.optInStatus === "OPTED_OUT"
                            ? "bad"
                            : "neutral"
                      }
                    >
                      {c.optInStatus === "OPTED_IN"
                        ? "Opted in"
                        : c.optInStatus === "OPTED_OUT"
                          ? "Opted out"
                          : "No consent"}
                    </Badge>
                  </Td>
                  <Td className="text-right font-mono tabular-nums">{c.orderCount}</Td>
                  <Td className="text-right font-mono tabular-nums">{centsToMoney(c.lifetimeCts)}</Td>
                  <Td className="text-dim">
                    {c.lastOrderAt ? c.lastOrderAt.toISOString().slice(0, 10) : "-"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          <Pager page={params.page} pageSize={DEFAULT_PAGE_SIZE} total={result.total} />
        </>
      )}
    </>
  );
}
