import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DOMAIN_HEADER } from "@/lib/domains";
import { centsToMoney, displayPhone } from "@/lib/money";
import { LIVE_STATUSES, statusHeadline, isTerminal } from "@/lib/orders";
import { AutoRefresh, CancelOrder, ReportIssue } from "./OrderClient";
import type { OrderStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

// Search engines have no business indexing someone's dinner.
export const metadata = { robots: { index: false, follow: false } };

const STEPS: Array<{ key: OrderStatus; label: string }> = [
  { key: "ACCEPTED", label: "Confirmed" },
  { key: "PREPARING", label: "Cooking" },
  { key: "READY", label: "Ready" },
  { key: "COMPLETED", label: "Picked up" },
];

function timeOf(d: Date) {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default async function OrderStatusPage({ params }: { params: { token: string } }) {
  const order = await prisma.order.findUnique({
    where: { publicToken: params.token },
    include: {
      restaurant: {
        select: { name: true, slug: true, phone: true, address: true, city: true, accentColor: true },
      },
      items: { include: { modifiers: true } },
      refunds: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "asc" } },
      issues: { orderBy: { createdAt: "desc" } },
      // Only events with a public note are shown; the rest are for support.
      events: { where: { publicNote: { not: null } }, orderBy: { createdAt: "asc" } },
    },
  });

  // A bad token is a 404, not an error — never confirm that a token almost
  // matched something.
  if (!order) notFound();

  const { restaurant } = order;

  // On a tenant's own domain the store IS the site root; /r/<slug> would send
  // the customer to a path that doesn't exist there.
  const storeHref = headers().get(DOMAIN_HEADER) ? "/" : `/r/${restaurant.slug}`;

  const head = statusHeadline(order.status, order.problem);
  const live = LIVE_STATUSES.includes(order.status);
  const stepIndex = STEPS.findIndex((s) => s.key === order.status);
  const ended = isTerminal(order.status);

  const late =
    live && order.promisedAt && order.promisedAt < new Date() && order.status !== "READY";

  const openIssue = order.issues.find((i) => i.status === "OPEN" || i.status === "ACKNOWLEDGED");
  const resolvedIssue = order.issues.find((i) => i.status === "RESOLVED" || i.status === "DECLINED");

  const paid = order.totalCts - order.refundedCts;
  const fullyRefunded = order.refundedCts >= order.totalCts;

  return (
    <div className="mx-auto min-h-screen w-full max-w-[560px] px-5 py-8">
      <AutoRefresh live={live} />

      <header className="mb-6">
        <Link href={storeHref} className="text-[13px] text-mute hover:text-ink">
          {restaurant.name}
        </Link>
        <h1 className="mt-1 font-mono text-[15px] text-ink">Order {order.number}</h1>
      </header>

      {/* --- Status ------------------------------------------------------ */}
      <section
        className={`mb-5 rounded-md border p-5 ${
          head.tone === "bad"
            ? "border-warn/30 bg-warn/5"
            : "border-line bg-surface"
        }`}
      >
        <h2 className="text-[18px] font-semibold text-ink">{head.title}</h2>

        {order.status === "READY" && (
          <p className="mt-1 text-[13px] text-dim">Come and get it — the counter has it waiting.</p>
        )}

        {live && order.status !== "READY" && order.promisedAt && (
          <p className="mt-1 text-[13px] text-dim">
            {late ? (
              <>
                We said {timeOf(order.promisedAt)} and we&apos;re running behind. It&apos;s still
                coming — if you need it sorted now, use the button at the bottom.
              </>
            ) : (
              <>Ready around {timeOf(order.promisedAt)}.</>
            )}
          </p>
        )}

        {ended && order.problem && (
          <p className="mt-1 text-[13px] text-dim">
            {order.problemNote?.trim() ||
              "The restaurant couldn't complete this order."}
          </p>
        )}

        {fullyRefunded && (
          <p className="mt-2 text-[13px] text-accent">
            Fully refunded — {centsToMoney(order.refundedCts)} is on its way back to your card, usually
            within 3–5 days.
          </p>
        )}

        {!fullyRefunded && order.refundedCts > 0 && (
          <p className="mt-2 text-[13px] text-accent">
            {centsToMoney(order.refundedCts)} refunded. You paid {centsToMoney(paid)}.
          </p>
        )}

        {/* Progress rail. Hidden once the order died — a dead order has no
            next step, and showing one is a lie. */}
        {!ended && (
          <ol className="mt-5 flex gap-1.5">
            {STEPS.map((s, i) => (
              <li key={s.key} className="flex-1">
                <div
                  className={`h-1 rounded-full ${i <= stepIndex ? "bg-accent" : "bg-line2"}`}
                  style={i <= stepIndex ? { background: restaurant.accentColor } : undefined}
                />
                <span
                  className={`mt-1.5 block text-[10.5px] ${
                    i <= stepIndex ? "text-ink" : "text-mute"
                  }`}
                >
                  {s.label}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* --- Items ------------------------------------------------------- */}
      <section className="mb-5 rounded-md border border-line bg-surface p-5">
        <h3 className="mb-3 text-[13px] font-semibold text-ink">Your order</h3>

        <ul className="space-y-2.5">
          {order.items.map((it) => {
            const made = it.fulfilledQty ?? it.qty;
            const short = made < it.qty;
            return (
              <li key={it.id} className="text-[13px]">
                <div className={`flex justify-between gap-3 ${made === 0 ? "opacity-50" : ""}`}>
                  <span className={made === 0 ? "text-dim line-through" : "text-ink"}>
                    <span className="font-mono text-mute">{made === 0 ? it.qty : made}×</span> {it.name}
                  </span>
                  <span className="shrink-0 font-mono text-dim">
                    {centsToMoney(Math.max(0, it.unitPriceCts + it.modifiersCts) * made)}
                  </span>
                </div>

                {it.modifiers.length > 0 && (
                  <p className="pl-5 text-[11.5px] text-mute">
                    {it.modifiers.map((m) => m.optionName).join(" · ")}
                  </p>
                )}

                {short && (
                  <p className="pl-5 text-[11.5px] text-warn">
                    {made === 0
                      ? "Out of stock — refunded."
                      : `Only ${made} of ${it.qty} available — the difference was refunded.`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        <dl className="mt-4 space-y-1 border-t border-line2 pt-3 text-[12.5px]">
          <div className="flex justify-between">
            <dt className="text-mute">Subtotal</dt>
            <dd className="font-mono text-dim">{centsToMoney(order.subtotalCts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mute">Service fee</dt>
            <dd className="font-mono text-dim">{centsToMoney(order.surchargeCts)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-mute">Tax</dt>
            <dd className="font-mono text-dim">{centsToMoney(order.taxCts)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-[13px]">
            <dt className="text-ink">Total</dt>
            <dd className="font-mono text-ink">{centsToMoney(order.totalCts)}</dd>
          </div>
          {order.refundedCts > 0 && (
            <>
              <div className="flex justify-between">
                <dt className="text-mute">Refunded</dt>
                <dd className="font-mono text-accent">−{centsToMoney(order.refundedCts)}</dd>
              </div>
              <div className="flex justify-between text-[13px]">
                <dt className="text-ink">You paid</dt>
                <dd className="font-mono text-ink">{centsToMoney(paid)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>

      {/* --- Timeline ---------------------------------------------------- */}
      {order.events.length > 0 && (
        <section className="mb-5 rounded-md border border-line bg-surface p-5">
          <h3 className="mb-3 text-[13px] font-semibold text-ink">History</h3>
          <ol className="space-y-2">
            {order.events.map((e) => (
              <li key={e.id} className="flex gap-3 text-[12.5px]">
                <span className="shrink-0 font-mono text-mute">{timeOf(e.createdAt)}</span>
                <span className="text-dim">{e.publicNote}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* --- Reported problem -------------------------------------------- */}
      {openIssue && (
        <section className="mb-5 rounded-md border border-line bg-surface p-5">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">You reported a problem</h3>
          <p className="text-[12.5px] text-dim">“{openIssue.body}”</p>
          <p className="mt-2 text-[12px] text-mute">
            {openIssue.status === "ACKNOWLEDGED"
              ? "The restaurant has seen this and is looking into it."
              : "Sent to the restaurant. They'll be in touch."}
          </p>
        </section>
      )}

      {resolvedIssue && !openIssue && (
        <section className="mb-5 rounded-md border border-line bg-surface p-5">
          <h3 className="mb-1 text-[13px] font-semibold text-ink">Resolved</h3>
          <p className="text-[12.5px] text-dim">
            {resolvedIssue.resolution?.trim() || "The restaurant closed out your report."}
          </p>
        </section>
      )}

      {/* --- What the customer can do ------------------------------------ */}
      <section className="space-y-3">
        {(order.status === "RECEIVED" || order.status === "ACCEPTED") && (
          <CancelOrder token={order.publicToken} />
        )}

        {!openIssue && (
          <ReportIssue
            token={order.publicToken}
            // Pre-select the most likely complaint for the state they're in,
            // so the common case is one tap.
            defaultKind={
              order.status === "COMPLETED"
                ? "MISSING_ITEM"
                : late
                  ? "LONG_WAIT"
                  : "OTHER"
            }
          />
        )}

        {restaurant.phone && (
          <a
            href={`tel:${restaurant.phone}`}
            className="block rounded-md border border-line2 px-4 py-2.5 text-center text-[13px] text-dim hover:text-ink"
          >
            Call {restaurant.name} — {displayPhone(restaurant.phone)}
          </a>
        )}

        <p className="pt-2 text-center text-[11.5px] leading-relaxed text-mute">
          Keep this link. It&apos;s how you check on this order or report a problem later —
          {restaurant.address ? ` pickup at ${restaurant.address}${restaurant.city ? `, ${restaurant.city}` : ""}.` : "."}
        </p>
      </section>
    </div>
  );
}
