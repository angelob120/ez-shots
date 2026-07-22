import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centsToMoney } from "@/lib/money";
import { Badge, Card, Empty, SectionTitle } from "@/components/hearth/ui";
import { SERVICE_LABELS } from "@/lib/entitlements";
import { readiness, type ReadinessInput } from "@/lib/readiness";
import { testModeEnabled } from "@/lib/payments";
import CreateRestaurantForm from "./CreateRestaurantForm";
import TestingTools from "./TestingTools";

export const dynamic = "force-dynamic";

/**
 * The index, deliberately read-only.
 *
 * Every control that changes a tenant lives on /admin/restaurants/[id]. An
 * earlier version stacked five inline forms per row, which put the dangerous
 * ones a stray click from the harmless ones and made the list unscannable past
 * a handful of tenants. This page answers "who do I have and which of them
 * needs attention"; the detail page does the work.
 *
 * Each row now carries its blocking state, because "which of them needs
 * attention" was previously only answerable by opening all of them.
 */
export default async function RestaurantsPage() {
  const restaurants = await prisma.restaurant.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { orders: true, customers: true, items: true, users: true } },
      users: { where: { role: "OWNER" }, select: { email: true } },
      suspensions: { where: { liftedAt: null }, select: { service: true } },
    },
  });

  const [surcharges, testMode] = await Promise.all([
    prisma.order.groupBy({ by: ["restaurantId"], _sum: { surchargeCts: true } }),
    testModeEnabled(),
  ]);
  const surchargeBy = new Map(surcharges.map((s) => [s.restaurantId, s._sum.surchargeCts ?? 0]));

  const rows = restaurants.map((r) => ({
    r,
    state: readiness(r as unknown as ReadinessInput),
  }));
  const needsWork = rows.filter((x) => !x.state.canTrade).length;

  return (
    <>
      <SectionTitle
        title="Restaurants"
        subtitle={
          needsWork > 0
            ? `${restaurants.length} tenants · ${needsWork} can't take orders yet.`
            : `${restaurants.length} tenants, all able to take orders.`
        }
      />

      <div className="mb-4">
        <CreateRestaurantForm />
      </div>

      {restaurants.length === 0 ? (
        <Empty title="No accounts yet" body="Create one above to start a pilot." />
      ) : (
        <div className="space-y-2">
          {rows.map(({ r, state }) => (
            <Link key={r.id} href={`/admin/restaurants/${r.id}`} className="block">
              <Card className="transition-colors hover:border-line2">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-[15px] font-semibold text-ink">{r.name}</h3>
                      <Badge
                        tone={
                          r.status === "ACTIVE" ? "good" : r.status === "PENDING" ? "neutral" : "warn"
                        }
                      >
                        {r.status === "ACTIVE"
                          ? "Active"
                          : r.status === "PENDING"
                            ? `Setup · step ${Math.min(r.onboardingStep + 1, 4)} of 4`
                            : "Suspended"}
                      </Badge>
                      {!state.canTrade && (
                        <Badge tone="bad">
                          {state.blockers.map((b) => b.label).join(", ")} missing
                        </Badge>
                      )}
                      {r.suspensions.map((s) => (
                        <Badge key={s.service} tone="warn">
                          {SERVICE_LABELS[s.service]} off
                        </Badge>
                      ))}
                    </div>
                    <div className="mt-1 font-mono text-[12px] text-mute">
                      /r/{r.slug} ·{" "}
                      {r._count.users === 0
                        ? "nobody can sign in"
                        : r.users[0]?.email ?? `${r._count.users} logins`}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-dim">
                    <span>
                      <span className="font-mono text-ink">{r._count.orders}</span> orders
                    </span>
                    <span>
                      <span className="font-mono text-ink">{r._count.customers}</span> customers
                    </span>
                    <span>
                      <span className="font-mono text-accent">
                        {centsToMoney(surchargeBy.get(r.id) ?? 0)}
                      </span>{" "}
                      collected
                    </span>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}

      {testMode && (
        <div className="mt-8">
          <TestingTools />
        </div>
      )}
    </>
  );
}
