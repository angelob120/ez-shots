import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { centsToMoney } from "@/lib/money";
import { orderUrl } from "@/lib/orders";
import {
  testModeEnabled,
  resolveModeState,
  stripeConfigForMode,
  stripePublishableKeyForMode,
} from "@/lib/payments";
import { platformConnectStatus } from "@/lib/payments-connect";
import ModePanel from "./ModePanel";
import { simulationSummary } from "@/lib/simulator";
import { SIM_PHONE_PREFIX } from "@/lib/simulator-data";
import {
  Badge,
  Card,
  Empty,
  SectionTitle,
  Stat,
  Table,
  Td,
  Th,
  inputClass,
  cx,
} from "@/components/hearth/ui";
import { SimulatorPanel, ShiftPanel, TroublePanel, SweepPanel, WipePanel } from "./Panels";

export const dynamic = "force-dynamic";

/**
 * The operator's workbench.
 *
 * Three jobs that kept being done badly by other means: making a tenant look
 * like it has customers, putting a specific failure in front of the recovery
 * UI, and finding out what the platform would have said to somebody. All three
 * were previously answered by editing the database by hand, which is both
 * slower and a good way to create states the application can't produce.
 *
 * Tabbed rather than stacked because the destructive panel and the seeding
 * panel must not share a scroll position — the version of this page that had
 * them adjacent put "wipe" one flick away from "seed 200 orders".
 *
 * **Mode used to be its own page (`/admin/test-mode`) and no longer is.** The
 * two were one question asked twice — "is what I'm looking at real?" — and the
 * split had a concrete cost: the switch that enables these tools lived
 * somewhere else, so an admin on a fresh environment hit an error telling them
 * to navigate away and come back. Mode is the first tab now, and it is the only
 * tab that renders when the tools are switched off, so the fix is where the
 * problem is.
 */

type Tab = "mode" | "simulate" | "trouble" | "sweeps" | "outbox" | "cleanup";

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "mode", label: "Mode" },
  { key: "simulate", label: "Simulate" },
  { key: "trouble", label: "Trouble" },
  { key: "sweeps", label: "Sweeps" },
  { key: "outbox", label: "Outbox" },
  { key: "cleanup", label: "Cleanup" },
];

export default async function ToolsPage({
  searchParams,
}: {
  searchParams: { restaurant?: string; tab?: string };
}) {
  const [enabled, mode, restaurants] = await Promise.all([
    testModeEnabled(),
    resolveModeState(),
    prisma.restaurant.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, slug: true, _count: { select: { orders: true, items: true } } },
    }),
  ]);

  // Mode is the fallback tab, not Simulate: when the tools are off it's the
  // only one that renders, and landing on it is the whole point of the merge.
  const tab = (TABS.find((t) => t.key === searchParams.tab)?.key ?? (enabled ? "simulate" : "mode")) as Tab;
  const selected =
    restaurants.find((r) => r.id === searchParams.restaurant) ?? restaurants[0] ?? null;

  if (!enabled || tab === "mode") {
    return (
      <>
        <SectionTitle
          title="Testing tools"
          subtitle="Payment mode, the auto-revert timer, and the demo switch. Everything that decides whether what you're looking at is real."
          action={<Badge tone={mode.mode === "LIVE" ? "bad" : "neutral"}>Payments: {mode.mode}</Badge>}
        />

        {enabled && <ToolTabs tab={tab} restaurantId={selected?.id ?? null} />}

        <ModeTab />

        {!enabled && (
          <Card className="mt-4">
            <p className="text-[13px] text-dim">
              The rest of this page — seeding, failure injection, sweeps, the outbox — is switched off
              until <span className="font-mono text-ink">testModeEnabled</span> is on, above.
            </p>
            <p className="mt-3 text-[12px] text-mute">
              That&apos;s a separate switch from the payment mode on purpose: exercising a real Stripe
              test charge must not also arm a button that writes two hundred invented orders into a
              tenant&apos;s customer list.
            </p>
          </Card>
        )}
      </>
    );
  }

  if (!selected) {
    return (
      <>
        <SectionTitle title="Testing tools" />
        <ToolTabs tab={tab} restaurantId={null} />
        <Empty title="No tenants yet" body="Create one on /admin/restaurants, then come back." />
      </>
    );
  }

  const summary = await simulationSummary(selected.id);

  return (
    <>
      <SectionTitle
        title="Testing tools"
        subtitle="Seed traffic, inject failures, run the sweeps, and read the outbox — against one tenant at a time."
        action={
          <Badge tone={mode.mode === "LIVE" ? "bad" : "neutral"}>
            Payments: {mode.mode}
            {mode.expiresAt ? ` · reverts ${mode.expiresAt.toLocaleString()}` : ""}
          </Badge>
        }
      />

      {mode.mode === "LIVE" && (
        <Card className="mb-4 border-badLine">
          <p className="text-[12px] text-badInk">
            The platform is in LIVE payment mode. Nothing on this page charges a card — simulated orders
            are stamped with their own provider tag and always refund against the stub — but a seeded
            order still lands on a real tenant&apos;s board and in their reports. Pick the tenant carefully.
          </p>
        </Card>
      )}

      {/* Tenant picker. A plain GET form, so it works before hydration and the
          selection survives in the URL — which matters when the next thing you
          do is press a destructive button. */}
      <Card className="mb-4">
        <form method="GET" className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value={tab} />
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-dim">Tenant</span>
            <select name="restaurant" defaultValue={selected.id} className={cx(inputClass, "w-[320px]")}>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (/r/{r.slug}) · {r._count.items} items · {r._count.orders} orders
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="h-9 rounded-sm border border-line2 px-4 text-[13px] text-ink hover:bg-surface2"
          >
            Switch
          </button>
          <Link
            href={`/r/${selected.slug}`}
            className="h-9 rounded-sm border border-line2 px-4 text-[13px] leading-9 text-ink hover:bg-surface2"
          >
            Open storefront
          </Link>
          <Link
            href={`/admin/restaurants/${selected.id}`}
            className="h-9 rounded-sm border border-line2 px-4 text-[13px] leading-9 text-ink hover:bg-surface2"
          >
            Tenant page
          </Link>
        </form>
      </Card>

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Simulated customers" value={String(summary.customers)} hint={`${SIM_PHONE_PREFIX}xxxx`} />
        <Stat
          label="Simulated orders"
          value={String(summary.orders)}
          hint={`${summary.liveOrders} still live on the board`}
        />
        <Stat label="Simulated volume" value={centsToMoney(summary.simRevenueCts)} tone="accent" hint="Not real money." />
        <Stat
          label="Open trouble"
          value={`${summary.openIssues + summary.failedRefunds}`}
          hint={`${summary.openIssues} issues · ${summary.failedRefunds} failed refunds`}
        />
      </div>

      <ToolTabs tab={tab} restaurantId={selected.id} />

      {tab === "simulate" && (
        <div className="space-y-4">
          <SimulatorPanel restaurantId={selected.id} />
          <ShiftPanel restaurantId={selected.id} />
          <RecentSimOrders restaurantId={selected.id} />
        </div>
      )}

      {tab === "trouble" && <TroublePanel restaurantId={selected.id} />}

      {tab === "sweeps" && <SweepPanel restaurantId={selected.id} cronMissing />}

      {tab === "outbox" && <Outbox restaurantId={selected.id} />}

      {tab === "cleanup" && (
        <WipePanel
          restaurantId={selected.id}
          slug={selected.slug}
          counts={`${summary.orders} orders · ${summary.customers} customers · ${summary.messages} messages`}
        />
      )}
    </>
  );
}

/**
 * The tab strip.
 *
 * Extracted because it now renders in three places — the normal page, the
 * no-tenants page, and the mode page that shows when the tools are off — and a
 * fourth copy is how one of them ends up missing a tab nobody notices for a
 * month.
 *
 * The tenant is carried in the URL for every tab except Mode, which is
 * platform-wide and would be lying if it looked tenant-scoped.
 */
function ToolTabs({ tab, restaurantId }: { tab: Tab; restaurantId: string | null }) {
  return (
    <nav className="mb-4 flex flex-wrap items-center gap-1">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={
            t.key === "mode" || !restaurantId
              ? `/admin/tools?tab=${t.key}`
              : `/admin/tools?restaurant=${restaurantId}&tab=${t.key}`
          }
          aria-current={tab === t.key ? "page" : undefined}
          className={cx(
            "rounded-sm px-3 py-1.5 text-[13px] transition-colors",
            tab === t.key ? "bg-surface2 text-ink" : "text-dim hover:bg-surface2 hover:text-ink"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Payment mode, the auto-revert timer, the key inventory, and the demo switch.
 *
 * Moved here wholesale from `/admin/test-mode`. The panel itself is unchanged —
 * `resolveModeState()` remains the one door every charge and refund reads, and
 * this is a view onto it, not a second source of truth.
 */
async function ModeTab() {
  const state = await resolveModeState();

  const configured = {
    testSecret: !!stripeConfigForMode("TEST"),
    testPub: !!stripePublishableKeyForMode("TEST"),
    liveSecret: !!stripeConfigForMode("LIVE"),
    livePub: !!stripePublishableKeyForMode("LIVE"),
  };

  // Only probe when a Stripe mode is actually active — no point calling Stripe
  // while payments are stubbed, and it keeps this off the critical path.
  const connectStatus = state.mode === "STUB" ? "unknown" : await platformConnectStatus(state.mode);

  const fmt = (d: Date | null) =>
    d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;

  return (
    <>
      <ModePanel
        mode={state.mode}
        expiresAt={fmt(state.expiresAt)}
        revertTo={state.revertTo}
        revertedAt={fmt(state.revertedAt)}
        testModeEnabled={state.testModeEnabled}
        configured={configured}
      />

      {connectStatus === "disabled" && (
        <p className="mt-4 rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] leading-relaxed text-warnInk">
          Stripe Connect isn&apos;t enabled on the platform account for this mode — restaurants
          can&apos;t connect for payouts until it is, so no tenant can take cards however this page is
          set. Enable it at{" "}
          <a
            href="https://dashboard.stripe.com/connect"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            dashboard.stripe.com/connect
          </a>
          .
        </p>
      )}
    </>
  );
}

/**
 * Direct links to the customer-facing status pages.
 *
 * Small, but it's the difference between the simulator being a data generator
 * and being usable: the whole point of a seeded order is to open `/o/[token]`
 * and see what the customer sees, and the token is unguessable by design.
 * Built through `orderUrl` so a tenant with a verified custom domain gets links
 * on their own host, exactly as their customers would.
 */
async function RecentSimOrders({ restaurantId }: { restaurantId: string }) {
  const orders = await prisma.order.findMany({
    where: { restaurantId, paymentProvider: "sim" },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      id: true,
      number: true,
      status: true,
      totalCts: true,
      publicToken: true,
      createdAt: true,
      customer: { select: { name: true, phone: true } },
      restaurant: { select: { customDomain: true, domainVerifiedAt: true } },
    },
  });

  if (!orders.length) {
    return <Empty title="Nothing simulated yet" body="Seed a run above and the tickets will show up here." />;
  }

  return (
    <Card padded={false}>
      <Table>
        <thead>
          <tr>
            <Th>Order</Th>
            <Th>Status</Th>
            <Th>Customer</Th>
            <Th>Total</Th>
            <Th>Placed</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <Td className="font-mono">{o.number}</Td>
              <Td>
                <Badge tone={o.status === "COMPLETED" ? "good" : o.status === "CANCELED" || o.status === "REJECTED" ? "bad" : "neutral"}>
                  {o.status.toLowerCase()}
                </Badge>
              </Td>
              <Td>
                {o.customer?.name ?? "—"}{" "}
                <span className="font-mono text-[11px] text-mute">{o.customer?.phone}</span>
              </Td>
              <Td className="font-mono">{centsToMoney(o.totalCts)}</Td>
              <Td className="text-dim">{o.createdAt.toLocaleString()}</Td>
              <Td>
                <a
                  href={orderUrl(o.publicToken, o.restaurant)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent underline"
                >
                  status page
                </a>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

/**
 * What the platform has said, or declined to say.
 *
 * SMS is stubbed and will stay stubbed until A2P 10DLC registration completes,
 * so `Message` rows are the only evidence the consent rules work at all. A
 * SKIPPED row with its reason is the interesting one — it's the gate in
 * `queueMessage` doing its job, and there was previously nowhere in the product
 * to see it happen.
 */
async function Outbox({ restaurantId }: { restaurantId: string }) {
  const messages = await prisma.message.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: {
      id: true,
      kind: true,
      status: true,
      body: true,
      to: true,
      error: true,
      attempts: true,
      retryable: true,
      provider: true,
      createdAt: true,
      sentAt: true,
      customer: { select: { name: true, optInStatus: true } },
    },
  });

  if (!messages.length) {
    return <Empty title="Outbox is empty" body="Place or simulate an order — the confirmation text is logged here whether or not it was sent." />;
  }

  const tone = (s: string) =>
    s === "SENT" || s === "DELIVERED" ? "good" : s === "FAILED" || s === "UNDELIVERED" ? "bad" : s === "SKIPPED" ? "warn" : "neutral";

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[12px] text-dim">
          Newest 60. <span className="text-warn">SKIPPED</span> means <span className="font-mono">queueMessage</span> declined to
          send and recorded why — a customer who replied STOP is blocked for every kind, transactional
          included, because a sender that ignores STOP gets carrier-filtered and takes the tenant&apos;s whole
          list down with it.
        </p>
      </Card>

      <Card padded={false}>
        <Table>
          <thead>
            <tr>
              <Th>When</Th>
              <Th>Status</Th>
              <Th>Kind</Th>
              <Th>To</Th>
              <Th>Body</Th>
              <Th>Detail</Th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <Td className="whitespace-nowrap text-dim">{m.createdAt.toLocaleString()}</Td>
                <Td>
                  <Badge tone={tone(m.status) as "good" | "bad" | "warn" | "neutral"}>{m.status.toLowerCase()}</Badge>
                </Td>
                <Td className="text-dim">{m.kind.toLowerCase()}</Td>
                <Td className="whitespace-nowrap font-mono text-[12px]">
                  {m.to ?? "—"}
                  {m.customer?.optInStatus === "OPTED_OUT" && (
                    <span className="ml-1 text-[11px] text-warn">stopped</span>
                  )}
                </Td>
                <Td className="max-w-[380px] text-[12px] text-dim">{m.body}</Td>
                <Td className="text-[11px] text-mute">
                  {m.error ?? m.provider ?? ""}
                  {m.attempts > 0 && <> · {m.attempts} attempt{m.attempts === 1 ? "" : "s"}</>}
                  {m.retryable === false && <> · permanent</>}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
