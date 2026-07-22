import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centsToMoney } from "@/lib/money";
import { Badge, Card, Empty, SectionTitle } from "@/components/hearth/ui";
import RefundBox from "@/components/hearth/RefundBox";
import { adminRefundAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const q = (searchParams.q ?? "").trim();

  // Any order across every tenant. A search narrows by order number or the
  // customer's phone; with none, the most recent orders so there's always
  // something to act on.
  const orders = await prisma.order.findMany({
    where: q
      ? {
          OR: [
            { number: { contains: q, mode: "insensitive" } },
            { customer: { phone: { contains: q } } },
          ],
        }
      : {},
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      restaurant: { select: { name: true, slug: true } },
      customer: { select: { phone: true, name: true } },
    },
  });

  return (
    <>
      <SectionTitle
        title="Orders & refunds"
        subtitle="Find any order across every account and issue a full or partial refund for any reason."
      />

      <form className="mb-4 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Order number (A-8042) or phone"
          className="h-9 w-full max-w-sm rounded-sm border border-line2 bg-surface2 px-3 text-[13px] text-ink placeholder:text-mute outline-none focus:border-accentDim"
        />
        <button className="h-9 rounded-sm border border-line2 px-4 text-[13px] text-ink hover:bg-surface2">
          Search
        </button>
      </form>

      {orders.length === 0 ? (
        <Empty title="No orders found" body={q ? "Try a different number or phone." : "No orders yet."} />
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const refundable = Math.max(0, o.totalCts - o.refundedCts);
            return (
              <Card key={o.id}>
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[13px] text-ink">{o.number}</span>
                      <Badge tone={o.status === "COMPLETED" ? "good" : o.status === "CANCELED" || o.status === "REJECTED" ? "warn" : "neutral"}>
                        {o.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[12px] text-dim">
                      <Link href={`/r/${o.restaurant.slug}`} className="text-accent hover:underline" target="_blank">
                        {o.restaurant.name}
                      </Link>{" "}
                      · {o.customer?.phone ?? "no phone"} ·{" "}
                      {o.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                    </div>
                    <div className="mt-1 font-mono text-[12px] text-ink">
                      {centsToMoney(o.totalCts)}
                      {o.refundedCts > 0 && (
                        <span className="text-mute"> · {centsToMoney(o.refundedCts)} refunded</span>
                      )}
                    </div>
                  </div>
                  <div className="shrink-0">
                    <RefundBox orderId={o.id} refundableCts={refundable} action={adminRefundAction} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
