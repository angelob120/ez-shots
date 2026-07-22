import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { centsToMoney, displayPhone } from "@/lib/money";
import { Badge, Bars, Button, Card, Donut, Empty, SectionTitle, Stat } from "@/components/hearth/ui";
import { updateOrderStatusAction } from "./actions";
import { OrderTrouble, IssueCard, NoShowPrompt, GoodwillRefund } from "./OrderTrouble";
import { PauseControl } from "./PauseControl";
import { FailedRefunds } from "./FailedRefunds";
import { UndeliveredMessages } from "./UndeliveredMessages";
import {
  ISSUE_LABELS,
  LIVE_STATUSES,
  isProbableNoShow,
  outstandingRefunds,
  refundableCts,
} from "@/lib/orders";
import { undeliveredMessages } from "@/lib/sms";
import { checkAvailability } from "@/lib/hours";
import type { OrderStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

const COLUMNS: Array<{ key: OrderStatus; title: string; next?: OrderStatus; nextLabel?: string }> = [
  { key: "RECEIVED", title: "Incoming", next: "PREPARING", nextLabel: "Start" },
  { key: "ACCEPTED", title: "Confirmed", next: "PREPARING", nextLabel: "Start" },
  { key: "PREPARING", title: "Preparing", next: "READY", nextLabel: "Mark ready" },
  { key: "READY", title: "Ready", next: "COMPLETED", nextLabel: "Complete" },
];

export default async function OrdersPage() {
  const { restaurantId } = await requireOwner();
  const dayAgo = new Date(Date.now() - 864e5);
  const monthAgo = new Date(Date.now() - 30 * 864e5);

  // The stale-order sweep used to run here. It now runs on a schedule
  // (scripts/sweep.ts) — a safety net for "nobody is watching the board"
  // cannot be triggered by someone watching the board.

  const [
    restaurant,
    live,
    failedRefunds,
    undelivered,
    completedToday,
    openIssues,
    todayOrders,
    monthOrders,
    customers,
    repeatCustomers,
  ] = await Promise.all([
    prisma.restaurant.findUniqueOrThrow({
      where: { id: restaurantId },
      include: { closures: { select: { startDate: true, endDate: true, reason: true } } },
    }),
    prisma.order.findMany({
      where: { restaurantId, status: { in: LIVE_STATUSES } },
      orderBy: { createdAt: "asc" },
      include: {
        items: { include: { modifiers: true } },
        customer: { select: { phone: true, name: true, orderCount: true } },
      },
    }),
    outstandingRefunds(restaurantId),
    undeliveredMessages(restaurantId),
    prisma.order.findMany({
      where: { restaurantId, status: "COMPLETED", completedAt: { gte: dayAgo } },
      orderBy: { completedAt: "desc" },
      select: {
        id: true,
        number: true,
        totalCts: true,
        refundedCts: true,
        completedAt: true,
        customer: { select: { name: true, phone: true } },
      },
      take: 30,
    }),
    prisma.orderIssue.findMany({
      where: { restaurantId, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      orderBy: { createdAt: "desc" },
      include: { order: { select: { number: true } } },
      take: 20,
    }),
    prisma.order.findMany({
      where: { restaurantId, createdAt: { gte: dayAgo } },
      select: { createdAt: true, totalCts: true },
    }),
    prisma.order.aggregate({
      where: { restaurantId, createdAt: { gte: monthAgo } },
      _sum: { totalCts: true, subtotalCts: true },
      _count: true,
    }),
    prisma.customer.count({ where: { restaurantId } }),
    prisma.customer.count({ where: { restaurantId, orderCount: { gt: 1 } } }),
  ]);

  const availability = checkAvailability(restaurant, new Date());
  const todayRevenue = todayOrders.reduce((a, o) => a + o.totalCts, 0);
  const now = Date.now();

  // Orders by hour, 11am–10pm — the window that actually matters to a kitchen.
  const hours = Array.from({ length: 12 }, (_, i) => i + 11);
  const byHour = hours.map((h) => ({
    label: h > 12 ? `${h - 12}p` : h === 12 ? "12p" : `${h}a`,
    value: todayOrders.filter((o) => o.createdAt.getHours() === h).length,
  }));

  return (
    <>
      <SectionTitle title="Orders" subtitle="Live board, plus the last 24 hours and 30 days at a glance." />

      {/* Whether the ordering page is currently accepting anything is the one
          fact an owner should never have to go looking for. */}
      {!availability.ok && availability.code !== "PAUSED" && (
        <div className="mb-4 rounded-md border border-warn/30 bg-warn/5 px-4 py-3 text-[13px] text-warn">
          Customers can&apos;t order right now — {availability.message}{" "}
          {availability.reopens && <span className="text-dim">Back {availability.reopens}.</span>}{" "}
          <Link href="/dashboard/hours" className="underline underline-offset-2">
            Check your hours
          </Link>
        </div>
      )}

      <PauseControl
        pausedUntil={
          restaurant.pausedUntil && restaurant.pausedUntil.getTime() > now
            ? restaurant.pausedUntil.toLocaleTimeString("en-US", {
                hour: "numeric",
                minute: "2-digit",
              })
            : null
        }
        pauseReason={restaurant.pauseReason}
      />

      {/* Owed money outranks everything, including complaints. */}
      <FailedRefunds
        rows={failedRefunds.map((r) => ({
          id: r.id,
          amountCts: r.amountCts,
          orderNumber: r.order.number,
          attempts: r.attempts,
          error: r.error,
          createdAt: r.createdAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        }))}
      />

      {/* Complaints outrank charts. If someone is unhappy, that's the first
          thing on the screen after the live board's own alarm. */}
      {openIssues.length > 0 && (
        <div className="mb-6 rounded-md border border-warn/30 bg-warn/5 p-4">
          <h3 className="mb-3 text-[13px] font-semibold text-warn">
            {openIssues.length === 1
              ? "1 customer reported a problem"
              : `${openIssues.length} customers reported problems`}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {openIssues.map((i) => (
              <IssueCard
                key={i.id}
                id={i.id}
                kindLabel={ISSUE_LABELS[i.kind] ?? i.kind}
                body={i.body}
                orderNumber={i.order.number}
                createdAt={i.createdAt.toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Not a debt and not a fault, so it ranks below both — but an owner
          fielding "I never got a text" should be able to see the bounce. */}
      <UndeliveredMessages
        rows={undelivered.map((m) => ({
          id: m.id,
          to: m.to,
          customerName: m.customer?.name ?? null,
          customerPhone: m.customer?.phone ?? null,
          when: m.createdAt.toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }),
        }))}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open orders" value={String(live.length)} tone="accent" />
        <Stat label="Orders today" value={String(todayOrders.length)} hint={centsToMoney(todayRevenue)} />
        <Stat label="Orders (30d)" value={String(monthOrders._count)} hint={centsToMoney(monthOrders._sum.totalCts ?? 0)} />
        <Stat label="Customers" value={String(customers)} hint={`${repeatCustomers} have reordered`} />
      </div>

      <div className="mb-6 grid gap-4 lg:grid-cols-4">
        {COLUMNS.map((col) => {
          const orders = live.filter((o) => o.status === col.key);
          return (
            <div key={col.key} className="rounded-md border border-line bg-surface p-4">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold text-ink">{col.title}</h3>
                <span className="font-mono text-[12px] text-mute">{orders.length}</span>
              </div>

              {orders.length === 0 ? (
                <p className="py-6 text-center text-[12px] text-mute">Nothing here.</p>
              ) : (
                <div className="space-y-3">
                  {orders.map((o) => (
                    <div key={o.id} className="rounded-sm border border-line2 bg-surface2 p-3">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono text-[13px] text-ink">{o.number}</span>
                        <span className="font-mono text-[12px] text-dim">{centsToMoney(o.totalCts)}</span>
                      </div>
                      {/* A promise the kitchen is about to break, flagged
                          while there's still time to do something about it. */}
                      {o.promisedAt && o.status !== "READY" && (
                        <div
                          className={`mt-0.5 text-[11px] ${
                            o.promisedAt.getTime() < now ? "text-warn" : "text-mute"
                          }`}
                        >
                          {o.promisedAt.getTime() < now
                            ? `Late — promised ${o.promisedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                            : `Due ${o.promisedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`}
                        </div>
                      )}

                      {o.refundedCts > 0 && (
                        <div className="mt-0.5 text-[11px] text-accent">
                          {centsToMoney(o.refundedCts)} already refunded
                        </div>
                      )}

                      <div className="mt-0.5 text-[11px] text-mute">
                        {o.createdAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        {o.customer && (
                          <>
                            {" · "}
                            {o.customer.name || displayPhone(o.customer.phone)}
                            {o.customer.orderCount > 1 && (
                              <span className="ml-1 text-accent">returning</span>
                            )}
                          </>
                        )}
                      </div>
                      <ul className="mt-2 space-y-0.5 text-[12px] text-dim">
                        {o.items.map((it) => (
                          <li key={it.id}>
                            <span className="font-mono text-ink">{it.qty}×</span> {it.name}
                            {/* The choices are what the line cook actually
                                needs. Indented under the item, not inline,
                                so a long list stays readable at a glance. */}
                            {it.modifiers.length > 0 && (
                              <span className="mt-0.5 block pl-5 text-[11.5px] text-mute">
                                {it.modifiers.map((m) => m.optionName).join(" · ")}
                              </span>
                            )}
                            {it.notes && (
                              <span className="mt-0.5 block pl-5 text-[11.5px] italic text-warn">
                                {it.notes}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                      {o.notes && <p className="mt-2 text-[11px] italic text-mute">“{o.notes}”</p>}
                      {col.next && (
                        <form action={updateOrderStatusAction} className="mt-3 flex gap-2">
                          <input type="hidden" name="id" value={o.id} />
                          <input type="hidden" name="status" value={col.next} />
                          <Button size="sm" className="w-full">
                            {col.nextLabel}
                          </Button>
                        </form>
                      )}

                      {/* Cooked, bagged, and nobody came. */}
                      {isProbableNoShow(o, new Date()) && o.readyAt && (
                        <NoShowPrompt
                          orderId={o.id}
                          waitingFor={`since ${o.readyAt.toLocaleTimeString("en-US", {
                            hour: "numeric",
                            minute: "2-digit",
                          })}`}
                        />
                      )}

                      <OrderTrouble
                        orderId={o.id}
                        refundableCts={refundableCts(o)}
                        lines={o.items.map((it) => ({
                          id: it.id,
                          name: it.name,
                          qty: it.qty,
                          fulfilledQty: it.fulfilledQty,
                          unitCts: Math.max(0, it.unitPriceCts + it.modifiersCts),
                        }))}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-[14px] font-semibold text-ink">Orders by hour - today</h3>
          {todayOrders.length === 0 ? (
            <Empty title="No orders today yet" />
          ) : (
            <Bars data={byHour} />
          )}
        </Card>
        <Card>
          <h3 className="mb-4 text-[14px] font-semibold text-ink">New vs returning</h3>
          <Donut
            a={repeatCustomers}
            b={Math.max(0, customers - repeatCustomers)}
            aLabel="Returning"
            bLabel="First-time"
          />
          <p className="mt-4 text-[12px] leading-relaxed text-dim">
            The left number is the business. Everything the platform does is aimed at moving first-time customers
            into that column.
          </p>
        </Card>
      </div>

      {/* Orders that finished today. The board drops them the moment they're
          complete, but goodwill happens after the fact — a regular who had a
          bad night, a mixup not worth a formal complaint — so the owner needs
          somewhere to reach a closed order and hand money back. */}
      {completedToday.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-[14px] font-semibold text-ink">Completed today</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {completedToday.map((o) => (
              <div key={o.id} className="rounded-sm border border-line bg-surface p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[13px] text-ink">{o.number}</span>
                  <span className="font-mono text-[12px] text-dim">{centsToMoney(o.totalCts)}</span>
                </div>
                <div className="mt-0.5 text-[11px] text-mute">
                  {o.completedAt?.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  {o.customer && <> · {o.customer.name || displayPhone(o.customer.phone)}</>}
                </div>
                {o.refundedCts > 0 && (
                  <div className="mt-0.5 text-[11px] text-accent">
                    {centsToMoney(o.refundedCts)} already refunded
                  </div>
                )}
                <GoodwillRefund orderId={o.id} refundableCts={Math.max(0, o.totalCts - o.refundedCts)} />
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
