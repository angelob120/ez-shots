import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centsToMoney } from "@/lib/money";
import { Badge, Card, Empty, LinkButton, SectionTitle, Stat } from "@/components/hearth/ui";
import { attentionList } from "@/lib/readiness";
import { supportInbox } from "@/lib/support";
import SupportInboxCard from "./SupportInboxCard";

export const dynamic = "force-dynamic";

/**
 * The operations home.
 *
 * This page used to open with 30-day aggregates. Those are the numbers the
 * pilot is judged on, but they are not what an operator does anything about at
 * 9am — nothing on the old page said "this tenant can't take orders" or "this
 * refund still owes someone money". Metrics moved below the fold and the first
 * screen answers "what needs me today".
 *
 * The ordering rule, from `lib/readiness.ts`: money owed and tenants that
 * can't trade first, configuration problems second, soft signals last. An
 * attention list that mixes "no orders this week" in with "we owe this customer
 * $40" trains people to skim it, and a list that gets skimmed is worse than no
 * list because it looks like coverage.
 */
export default async function AdminHome() {
  const since = new Date(Date.now() - 30 * 864e5);

  const [
    attention,
    failedRefunds,
    suspensions,
    orderAgg,
    restaurantCount,
    activeCount,
    supportAgg,
    recentOrders,
    inbox,
  ] = await Promise.all([
      attentionList(),
      prisma.refund.findMany({
        where: { status: "FAILED", resolvedAt: null },
        select: {
          id: true,
          amountCts: true,
          order: {
            select: { number: true, restaurantId: true, restaurant: { select: { name: true } } },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 12,
      }),
      prisma.serviceSuspension.findMany({
        where: { liftedAt: null },
        select: {
          id: true,
          service: true,
          reason: true,
          restaurantId: true,
          restaurant: { select: { name: true } },
        },
      }),
      prisma.order.aggregate({
        _sum: { surchargeCts: true, totalCts: true },
        _count: true,
        where: { createdAt: { gte: since } },
      }),
      prisma.restaurant.count(),
      prisma.restaurant.count({ where: { status: "ACTIVE" } }),
      prisma.supportLog.aggregate({ _sum: { hours: true }, where: { weekOf: { gte: since } } }),
      prisma.order.findMany({
        take: 8,
        orderBy: { createdAt: "desc" },
        include: { restaurant: { select: { name: true, slug: true } } },
      }),
      supportInbox(),
    ]);

  const surcharge = orderAgg._sum.surchargeCts ?? 0;
  const gmv = orderAgg._sum.totalCts ?? 0;
  const supportHours = supportAgg._sum.hours ?? 0;
  const hoursPerAccount = activeCount ? supportHours / activeCount : 0;

  const owedCts = failedRefunds.reduce((n, r) => n + r.amountCts, 0);
  const nothingWrong =
    attention.length === 0 &&
    failedRefunds.length === 0 &&
    suspensions.length === 0 &&
    inbox.openTickets === 0 &&
    inbox.openContacts === 0;

  return (
    <>
      <SectionTitle
        title="Operations"
        subtitle="What needs attention, then how the platform is doing."
        action={
          <LinkButton href="/admin/restaurants" variant="primary">
            Restaurants
          </LinkButton>
        }
      />

      {/* ── Money owed. Loudest thing on the page, deliberately. ────── */}
      {failedRefunds.length > 0 && (
        <Card className="mb-4 border-badLine">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className="text-[15px] font-semibold text-badInk">
              {failedRefunds.length} refund{failedRefunds.length === 1 ? "" : "s"} failed —{" "}
              {centsToMoney(owedCts)} still owed
            </h2>
            <span className="text-[11.5px] text-mute">
              Retries run from the sweep; these are what it couldn&rsquo;t settle.
            </span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {failedRefunds.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <Link
                  href={`/admin/restaurants/${f.order.restaurantId}`}
                  className="truncate text-dim hover:text-ink"
                >
                  {f.order.restaurant.name} · order {f.order.number}
                </Link>
                <span className="shrink-0 font-mono text-badInk">
                  {centsToMoney(f.amountCts)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── Somebody is waiting on a reply ─────────────────────────── */}
      {/* Below failed refunds and above the tenant checklist, which is the
          honest ranking: money we owe outranks a person waiting, and a person
          waiting outranks a tenant with no logo. */}
      <SupportInboxCard inbox={inbox} />

      {/* ── Everything else that needs a person ────────────────────── */}
      <div className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Needs attention</h2>

          {attention.length === 0 ? (
            <p className="text-[13px] text-dim">
              {nothingWrong
                ? "Nothing outstanding. Every tenant can take orders."
                : "No tenant-level problems."}
            </p>
          ) : (
            <ul className="space-y-2.5">
              {attention.map((a) => (
                <li key={`${a.restaurantId}-${a.headline}`}>
                  <Link
                    href={a.href}
                    className="flex items-start gap-2.5 rounded-sm transition-colors hover:bg-surface2"
                  >
                    <span
                      className={`mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full ${
                        a.rank <= 1 ? "bg-badInk" : a.rank === 2 ? "bg-warn" : "bg-line2"
                      }`}
                    />
                    <span className="min-w-0">
                      <span className="text-[13px] text-ink">{a.name}</span>
                      <span className="ml-2 text-[12px] text-dim">{a.headline}</span>
                      <span className="mt-0.5 block text-[11.5px] leading-relaxed text-mute">
                        {a.detail}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-[15px] font-semibold text-ink">Live suspensions</h2>
          {suspensions.length === 0 ? (
            <p className="text-[13px] text-dim">None. Nobody is cut off.</p>
          ) : (
            <ul className="space-y-2.5">
              {suspensions.map((s) => (
                <li key={s.id} className="text-[12.5px]">
                  <Link
                    href={`/admin/restaurants/${s.restaurantId}?tab=services`}
                    className="text-ink hover:underline"
                  >
                    {s.restaurant.name}
                  </Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <Badge tone="warn">{s.service}</Badge>
                    {s.reason && <span className="text-[11.5px] text-mute">{s.reason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ── The numbers the pilot is judged on ─────────────────────── */}
      <h2 className="mb-3 text-[15px] font-semibold text-ink">Last 30 days</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active accounts" value={String(activeCount)} hint={`${restaurantCount} total`} />
        <Stat label="Orders" value={String(orderAgg._count)} hint={`${centsToMoney(gmv)} volume`} />
        <Stat
          label="Surcharge"
          value={centsToMoney(surcharge)}
          tone="accent"
          hint="Revenue — customer-paid"
        />
        <Stat
          label="Support hrs / account"
          value={hoursPerAccount.toFixed(1)}
          hint="The number that decides solo scale"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-[14px] font-semibold text-ink">Recent orders</h3>
          {recentOrders.length === 0 ? (
            <Empty title="Nothing yet" body="Orders across every account will show up here." />
          ) : (
            <ul className="space-y-3">
              {recentOrders.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 text-[13px]">
                  <div className="min-w-0">
                    <div className="truncate text-ink">{o.restaurant.name}</div>
                    <div className="font-mono text-[11px] text-mute">
                      {o.number} ·{" "}
                      {o.createdAt.toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-ink">{centsToMoney(o.totalCts)}</div>
                    <div className="font-mono text-[11px] text-accent">
                      +{centsToMoney(o.surchargeCts)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="mb-2 text-[14px] font-semibold text-ink">What the pilot has to prove</h3>
          <p className="text-[13px] leading-relaxed text-dim">
            Two things, and only two. First: net account-level lift — does the treatment group
            reorder more than the holdout? Second: support hours per account per week, and whether
            that trends up or down as accounts are added. Everything else in the pitch rests on the
            first number being real.
          </p>
          <div className="mt-4 flex gap-2">
            <LinkButton href="/admin/support?tab=load" variant="outline">
              Log support hours
            </LinkButton>
          </div>
        </Card>
      </div>
    </>
  );
}
