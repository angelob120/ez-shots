import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { centsToMoney } from "@/lib/money";
import { Badge, Button, Card, SectionTitle, Stat } from "@/components/hearth/ui";
import CopyField from "@/components/hearth/CopyField";
import QrCode from "@/components/hearth/QrCode";
import { canonicalOrigin, platformOrigin, DOMAIN_CHALLENGE_PREFIX } from "@/lib/domains";
import { domainView } from "@/lib/domain-ops";
import { readiness, type ReadinessInput } from "@/lib/readiness";
import { outstandingInvites } from "@/lib/invites";
import { resolvePaymentMode } from "@/lib/payments";
import {
  SERVICES,
  SERVICE_LABELS,
  SERVICE_CONSEQUENCES,
  serviceStates,
  suspensionHistory,
} from "@/lib/entitlements";
import {
  adminUpdatePaymentsAction,
  deleteRestaurantAction,
  impersonateAction,
  setRestaurantStatusAction,
  updateSurchargeAction,
} from "../../actions";
import DeleteRestaurant from "../DeleteRestaurant";
import TenantTabs, { type TabKey, type TabBadges } from "./TenantTabs";
import TenantAnalytics from "@/components/hearth/TenantAnalytics";
import AnalyticsFilters, { readFilterParams } from "@/components/hearth/AnalyticsFilters";
import { resolveRange } from "@/lib/analytics-range";
import { earliestActivity, type AnalyticsFilter } from "@/lib/analytics-query";
import { activityForRestaurant } from "@/lib/activity";
import { OperatorActivityTables } from "@/components/hearth/OperatorActivity";
import type { VisitDevice, VisitSource } from "@prisma/client";
import ServicesPanel, { type ServiceRow } from "./ServicesPanel";
import PeoplePanel from "./PeoplePanel";
import DomainPanel from "./DomainPanel";
import ConnectPanel from "./ConnectPanel";
import SetupChecklist from "./SetupChecklist";
import OnboardingPanel from "./OnboardingPanel";
import NotesPanel from "./NotesPanel";
import { getChecklist, listNotes } from "@/lib/onboarding-checklist";

export const dynamic = "force-dynamic";

const fmt = (d: Date | null) =>
  d ? d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : null;
const fmtDate = (d: Date) => d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const labelCls = "mb-1 block text-[11px] text-mute";
const inputCls =
  "h-8 rounded-sm border border-line2 bg-surface2 px-2 text-[12px] text-ink outline-none focus:border-accentDim";

export default async function TenantPage({
  params,
  searchParams,
}: {
  params: { id: string };
  // Analytics adds its own filter params (range/from/to/sim), so this can no
  // longer be a closed shape — `readFilterParams` reads them off the same bag.
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const r = await prisma.restaurant.findUnique({
    where: { id: params.id },
    include: {
      _count: { select: { orders: true, customers: true, items: true, users: true } },
      users: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!r) notFound();

  const [states, history, collected, domain, invites, mode, menuSubmissions] = await Promise.all([
    serviceStates(r.id),
    suspensionHistory(r.id),
    prisma.order.aggregate({ where: { restaurantId: r.id }, _sum: { surchargeCts: true } }),
    domainView(r.id),
    outstandingInvites(r.id),
    resolvePaymentMode(),
    prisma.menuSubmission.findMany({
      where: { restaurantId: r.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const state = readiness(r as unknown as ReadinessInput);

  // The manual onboarding checklist — operator-tracked, distinct from the
  // derived readiness above. Wrapped so a missing migration 34 degrades to an
  // empty checklist rather than taking the whole tenant page down; the tables
  // don't exist until `db:push` runs on a real machine (see docs/admin-roadmap).
  const onboarding = await getOnboarding(r.id);
  const { checklist, onboardingNotes, accountNotes } = onboarding;

  const rows: ServiceRow[] = SERVICES.map((s) => ({
    service: s,
    label: SERVICE_LABELS[s],
    consequence: SERVICE_CONSEQUENCES[s],
    suspended: states[s].suspended,
    reason: states[s].reason,
    internalNote: states[s].internalNote,
    suspendedAt: fmt(states[s].suspendedAt),
    // The owner's own switch, where they have one. Shown beside ours so an
    // admin can tell "we cut them off" from "they never turned it on" — the
    // two look identical from the outside and generate the same support call.
    ownerSetting:
      s === "PAYMENTS" ? r.cardPaymentsEnabled : s === "DELIVERY" ? r.deliveryEnabled : null,
  }));
  const suspendedCount = rows.filter((x) => x.suspended).length;

  const tab = ((typeof searchParams.tab === "string" ? searchParams.tab : null) ??
    "overview") as TabKey;
  const basePath = `/admin/restaurants/${r.id}`;

  // Canonical link — their domain once verified, ours otherwise. See lib/domains.ts.
  const storeUrl = `${canonicalOrigin(r) || platformOrigin()}${
    r.customDomain && r.domainVerifiedAt ? "" : `/r/${r.slug}`
  }`;
  const platformUrl = `${platformOrigin()}/r/${r.slug}`;

  const onboardingLeft = checklist.total - checklist.done;
  const badges: TabBadges = {
    onboarding: onboardingLeft > 0 ? { count: onboardingLeft, tone: "warn" } : undefined,
    services: suspendedCount > 0 ? { count: suspendedCount, tone: "bad" } : undefined,
    people: r._count.users === 0 ? { count: 1, tone: "bad" } : undefined,
    domain:
      r.customDomain && !r.domainVerifiedAt ? { count: 1, tone: "warn" } : undefined,
    payments: !r.stripeChargesEnabled ? { count: 1, tone: "warn" } : undefined,
  };

  return (
    <>
      <div className="mb-4">
        <Link href="/admin/restaurants" className="text-[12px] text-dim hover:text-ink">
          ← All restaurants
        </Link>
      </div>

      <SectionTitle
        title={r.name}
        subtitle={`/r/${r.slug} · ${r.users[0]?.email ?? "nobody can sign in"}`}
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge
          tone={
            r.status === "ACTIVE"
              ? "good"
              : r.status === "PENDING" && r.onboardedAt
                ? "warn"
                : r.status === "PENDING"
                  ? "neutral"
                  : "warn"
          }
        >
          {r.status === "ACTIVE"
            ? "Active"
            : r.status === "PENDING" && r.onboardedAt
              ? "Awaiting activation"
              : r.status === "PENDING"
                ? `Setup · step ${Math.min(r.onboardingStep + 1, 6)} of 6`
                : "Suspended"}
        </Badge>
        {!state.canTrade && <Badge tone="bad">Can&rsquo;t take orders</Badge>}
        {rows
          .filter((x) => x.suspended)
          .map((x) => (
            <Badge key={x.service} tone="warn">
              {x.label} suspended
            </Badge>
          ))}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a
            href={storeUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-8 items-center rounded-sm border border-line2 px-3 text-[12px] text-ink hover:bg-surface2"
          >
            Live site
          </a>
          <form action={impersonateAction}>
            <input type="hidden" name="id" value={r.id} />
            <Button size="sm" variant="outline">
              Open dashboard
            </Button>
          </form>
        </div>
      </div>

      <TenantTabs badges={badges} />

      {/* ── Overview ──────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* The activation gate. A tenant that finished the wizard but is still
              PENDING has done everything on their side and is waiting on us to
              meet them and switch them on — this is the manual "yes" that
              replaced auto-approve. Surfaced at the top of Overview so it's the
              obvious next action, not buried in Danger. */}
          {r.status === "PENDING" && r.onboardedAt && (
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="max-w-2xl">
                  <h3 className="text-[14px] font-semibold text-ink">Awaiting activation</h3>
                  <p className="mt-1 text-[12px] leading-relaxed text-mute">
                    {r.name} finished setup{r.onboardedAt ? ` on ${fmt(r.onboardedAt)}` : ""} and is
                    waiting on us. Meet them on the setup call, then activate — this switches their
                    ordering page on and starts taking real orders.
                    {menuSubmissions.length > 0 &&
                      " They asked us to build their menu — see the submission below before you activate."}
                  </p>
                </div>
                <form action={setRestaurantStatusAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="status" value="ACTIVE" />
                  <Button size="sm">Activate account</Button>
                </form>
              </div>
            </Card>
          )}

          {menuSubmissions.length > 0 && (
            <Card>
              <h3 className="mb-1 text-[14px] font-semibold text-ink">
                Menu to build ({menuSubmissions.length})
              </h3>
              <p className="mb-3 text-[12px] leading-relaxed text-mute">
                The owner chose &ldquo;have us do it for you&rdquo; and sent this. Build their menu
                from it before the setup call.
              </p>
              <div className="space-y-4">
                {menuSubmissions.map((sub) => (
                  <div key={sub.id} className="rounded-sm border border-line2 bg-surface2 p-3 text-[12px]">
                    <div className="mb-2 flex items-center gap-2 text-[11px] text-mute">
                      <span>Sent {fmt(sub.createdAt)}</span>
                      {sub.fulfilledAt ? (
                        <Badge tone="good">Built</Badge>
                      ) : (
                        <Badge tone="warn">To do</Badge>
                      )}
                    </div>
                    {sub.links.length > 0 && (
                      <div className="mb-2">
                        <span className="text-mute">Links:</span>
                        <ul className="mt-1 space-y-0.5">
                          {sub.links.map((l, i) => (
                            <li key={i} className="truncate font-mono text-ink">
                              {l}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {sub.pastedText && (
                      <div className="mb-2">
                        <span className="text-mute">Pasted text:</span>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-base p-2 text-[11px] text-ink">
                          {sub.pastedText}
                        </pre>
                      </div>
                    )}
                    {sub.photoUrls.length > 0 && (
                      <div className="mb-2">
                        <span className="text-mute">Photos:</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {sub.photoUrls.map((p, i) => (
                            <a
                              key={i}
                              href={p}
                              target="_blank"
                              rel="noreferrer"
                              className="text-accent underline underline-offset-2"
                            >
                              Photo {i + 1}
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                    {sub.notes && (
                      <div>
                        <span className="text-mute">Notes:</span>{" "}
                        <span className="text-ink">{sub.notes}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Orders" value={String(r._count.orders)} />
            <Stat label="Customers" value={String(r._count.customers)} />
            <Stat label="Menu items" value={String(r._count.items)} />
            <Stat
              label="Surcharge collected"
              value={centsToMoney(collected._sum.surchargeCts ?? 0)}
              tone="accent"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <SetupChecklist checks={state.checks} basePath={basePath} />

            <Card>
              <h3 className="mb-3 text-[14px] font-semibold text-ink">Account</h3>
              <dl className="grid gap-x-8 gap-y-2 text-[12px]">
                {[
                  ["Slug", `/r/${r.slug}`],
                  ["Custom domain", r.customDomain ?? "—"],
                  ["Logins", String(r._count.users)],
                  ["Timezone", r.timezone],
                  ["Created", fmt(r.createdAt) ?? "—"],
                  ["Onboarded", fmt(r.onboardedAt) ?? "not finished"],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5">
                    <dt className="text-mute">{k}</dt>
                    <dd className="truncate font-mono text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          </div>
        </div>
      )}

      {/* ── Onboarding ────────────────────────────────────────────── */}
      {tab === "onboarding" && (
        <OnboardingPanel restaurantId={r.id} basePath={basePath} checklist={checklist} />
      )}

      {/* ── Onboarding notes ──────────────────────────────────────── */}
      {tab === "onboarding-notes" && (
        <NotesPanel
          restaurantId={r.id}
          kind="onboarding"
          title="Onboarding notes"
          blurb="Working notes while getting this restaurant live. Only we see these."
          placeholder="e.g. Left a voicemail, waiting on their Stripe verification…"
          notes={onboardingNotes.map((n) => ({
            id: n.id,
            body: n.body,
            authorName: n.authorName,
            createdAt: fmtDate(n.createdAt),
          }))}
        />
      )}

      {/* ── Account notes ─────────────────────────────────────────── */}
      {tab === "account-notes" && (
        <NotesPanel
          restaurantId={r.id}
          kind="account"
          title="Account notes"
          blurb="Ongoing notes about this account once they're up and running. Only we see these."
          placeholder="e.g. Owner asked about adding a second location…"
          notes={accountNotes.map((n) => ({
            id: n.id,
            body: n.body,
            authorName: n.authorName,
            createdAt: fmtDate(n.createdAt),
          }))}
        />
      )}

      {/* ── Links ─────────────────────────────────────────────────── */}
      {tab === "links" && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-4">
            <Card>
              <h3 className="text-[14px] font-semibold text-ink">Ordering link</h3>
              <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
                This is what goes in the &ldquo;Order online&rdquo; field of their Google
                Business Profile and Apple Business Connect. It&rsquo;s the canonical
                address — their own domain once verified, ours until then.
              </p>
              <div className="mt-4 space-y-3">
                <CopyField label="Canonical" value={storeUrl} tone="accent" />
                {storeUrl !== platformUrl && (
                  <CopyField
                    label="Our host"
                    value={platformUrl}
                    hint="Still works, and always will — a slug change is what breaks a printed link, not a domain."
                  />
                )}
              </div>
            </Card>

            <Card>
              <h3 className="mb-3 text-[14px] font-semibold text-ink">Where it goes</h3>
              <ul className="space-y-2 text-[12.5px] leading-relaxed text-dim">
                <li>
                  <span className="text-ink">Google Business Profile</span> — the &ldquo;Order
                  online&rdquo; field. The one that matters most.
                </li>
                <li>
                  <span className="text-ink">Apple Business Connect</span> — same field, under
                  the place&rsquo;s actions.
                </li>
                <li>
                  <span className="text-ink">Instagram &amp; Facebook</span> — bio link and the
                  &ldquo;Order food&rdquo; button.
                </li>
                <li>
                  <span className="text-ink">In the store</span> — the QR beside this, on the
                  counter, the door, and the receipt.
                </li>
              </ul>
            </Card>
          </div>

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">QR</h3>
            <div className="overflow-hidden rounded-sm bg-white p-2">
              <QrCode value={storeUrl} size={200} />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-mute">
              Points at the canonical link above. Regenerate and reprint if their domain
              changes — the code encodes the URL, not a redirect.
            </p>
          </Card>
        </div>
      )}

      {/* ── People ────────────────────────────────────────────────── */}
      {tab === "people" && (
        <PeoplePanel
          restaurantId={r.id}
          people={r.users.map((u) => ({
            id: u.id,
            email: u.email,
            name: u.name,
            role: u.role,
            createdAt: fmtDate(u.createdAt),
          }))}
          invites={invites.map((i) => ({
            id: i.id,
            email: i.email,
            expiresAt: fmtDate(i.expiresAt),
          }))}
        />
      )}

      {/* ── Domain ────────────────────────────────────────────────── */}
      {tab === "domain" && (
        <DomainPanel
          restaurantId={r.id}
          domain={domain.domain}
          verifiedAt={fmt(domain.verifiedAt)}
          challengeToken={domain.challengeToken}
          challengePrefix={DOMAIN_CHALLENGE_PREFIX}
          cfHostnameId={domain.cfHostnameId}
          cfStatus={domain.cfStatus}
          cfSslStatus={domain.cfSslStatus}
          wwwDomain={domain.wwwDomain}
          cfWwwStatus={domain.cfWwwStatus}
          cfWwwSslStatus={domain.cfWwwSslStatus}
          cloudflare={domain.cloudflare}
          cnameTarget={domain.cnameTarget}
        />
      )}

      {/* ── Payments ──────────────────────────────────────────────── */}
      {tab === "payments" && (
        <div className="space-y-4">
          {states.PAYMENTS.suspended && (
            <Card>
              <p className="text-[12px] text-badInk">
                Card payments are suspended for this tenant. These settings still save, but the
                storefront takes no cards until the suspension is lifted on the Services tab.
              </p>
            </Card>
          )}

          {searchParams.connect === "return" && (
            <Card>
              <p className="text-[12px] text-dim">
                Back from Stripe. Press <span className="text-ink">Refresh status</span> to pull
                what actually changed — returning from the form doesn&rsquo;t mean charges are
                enabled.
              </p>
            </Card>
          )}

          <ConnectPanel
            restaurantId={r.id}
            mode={mode}
            accountId={r.stripeAccountId}
            chargesEnabled={r.stripeChargesEnabled}
            payoutsEnabled={r.stripePayoutsEnabled}
            detailsSubmitted={r.stripeDetailsSubmitted}
          />

          <Card>
            <h3 className="mb-1 text-[14px] font-semibold text-ink">Manual overrides</h3>
            <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-mute">
              For a tenant onboarded out of band. Setting the account id by hand skips every
              check Connect does — only paste one you got from the Stripe dashboard.
            </p>
            <form action={adminUpdatePaymentsAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="id" value={r.id} />
              <label className="block grow">
                <span className={labelCls}>Connect account</span>
                <input
                  name="stripeAccountId"
                  defaultValue={r.stripeAccountId ?? ""}
                  placeholder="acct_… (blank to clear)"
                  className={`${inputCls} w-full min-w-[220px] font-mono`}
                />
              </label>
              <label className="block">
                <span className={labelCls}>Owner&rsquo;s card switch</span>
                <select
                  name="cardPaymentsEnabled"
                  defaultValue={r.cardPaymentsEnabled ? "true" : "false"}
                  className={inputCls}
                >
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </label>
              <Button size="sm" variant="outline">
                Save
              </Button>
            </form>
            <p className="mt-3 max-w-2xl text-[11px] leading-relaxed text-mute">
              That switch is the owner&rsquo;s own preference and they can change it back. To
              stop a tenant taking cards in a way they can&rsquo;t undo, suspend the service
              instead.
            </p>
          </Card>
        </div>
      )}

      {/* ── Pricing ───────────────────────────────────────────────── */}
      {tab === "pricing" && (
        <Card>
          <h3 className="mb-1 text-[14px] font-semibold text-ink">Surcharge &amp; tax</h3>
          <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-mute">
            Percent of subtotal, clamped between min and max. Always shown to the customer as its
            own disclosed line. Owners can set their sales tax themselves; everything else here is
            ours.
          </p>
          <form action={updateSurchargeAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={r.id} />
            <label className="block">
              <span className={labelCls}>Surcharge %</span>
              <input
                name="surchargePct"
                defaultValue={(r.surchargePct * 100).toFixed(2)}
                className={`${inputCls} w-24 font-mono`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Min</span>
              <input
                name="surchargeMin"
                defaultValue={(r.surchargeMinCts / 100).toFixed(2)}
                className={`${inputCls} w-20 font-mono`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Max</span>
              <input
                name="surchargeMax"
                defaultValue={(r.surchargeMaxCts / 100).toFixed(2)}
                className={`${inputCls} w-20 font-mono`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Fee label</span>
              <input
                name="surchargeLabel"
                defaultValue={r.surchargeLabel}
                maxLength={40}
                className={`${inputCls} w-36`}
              />
            </label>
            <label className="block">
              <span className={labelCls}>Tax %</span>
              <input
                name="taxPct"
                defaultValue={(r.taxPct * 100).toFixed(2)}
                className={`${inputCls} w-20 font-mono`}
              />
            </label>
            <Button size="sm" variant="outline">
              Save pricing
            </Button>
          </form>
        </Card>
      )}

      {/* ── Services ──────────────────────────────────────────────── */}
      {tab === "services" && (
        <div className="space-y-4">
          <p className="max-w-2xl text-[13px] leading-relaxed text-dim">
            Suspending a service withdraws it from this tenant. The owner sees the reason you write
            and has no control to turn it back on — only this page can restore it.
          </p>

          <ServicesPanel restaurantId={r.id} rows={rows} />

          <Card>
            <h3 className="mb-3 text-[14px] font-semibold text-ink">History</h3>
            {history.length === 0 ? (
              <p className="text-[12px] text-mute">Never suspended.</p>
            ) : (
              <ul className="space-y-2 text-[12px]">
                {history.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-3 border-b border-line pb-2">
                    <span className="font-medium text-ink">{SERVICE_LABELS[h.service]}</span>
                    <span className="text-mute">{fmt(h.suspendedAt)}</span>
                    <span className={h.liftedAt ? "text-dim" : "text-badInk"}>
                      {h.liftedAt ? `restored ${fmt(h.liftedAt)}` : "still in force"}
                    </span>
                    {h.reason && <span className="w-full text-dim">{h.reason}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}

      {/* ── Analytics ─────────────────────────────────────────────── */}
      {tab === "analytics" && <TenantAnalyticsTab restaurant={r} searchParams={searchParams} />}

      {/* ── Danger ────────────────────────────────────────────────── */}
      {tab === "danger" && (
        <div className="space-y-4">
          <Card>
            <h3 className="mb-1 text-[14px] font-semibold text-ink">Account status</h3>
            <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-mute">
              A suspended account is switched off wholesale. To withdraw one capability while the
              restaurant keeps trading, use the Services tab instead.
            </p>
            <form action={setRestaurantStatusAction}>
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value={r.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
              <Button size="sm" variant={r.status === "ACTIVE" ? "danger" : "outline"}>
                {r.status === "ACTIVE" ? "Suspend account" : "Activate account"}
              </Button>
            </form>
          </Card>

          <Card>
            <h3 className="mb-1 text-[14px] font-semibold text-ink">Delete</h3>
            <p className="mb-4 max-w-2xl text-[12px] leading-relaxed text-mute">
              Cascades. Takes {r._count.orders} orders and {r._count.customers} customers with it —
              the customer list is the asset, and this is the one action that destroys it.
            </p>
            <DeleteRestaurant id={r.id} slug={r.slug} action={deleteRestaurantAction} />
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

/**
 * The onboarding checklist reads, made resilient. Migration 34 may not have run
 * yet (the sandbox can't `prisma generate`), and a throw here would take down
 * every tab of the tenant page, not just Onboarding. On failure we return an
 * empty checklist so the rest of the page still renders.
 */
async function getOnboarding(restaurantId: string) {
  try {
    const [checklist, onboardingNotes, accountNotes] = await Promise.all([
      getChecklist(restaurantId),
      listNotes(restaurantId, "onboarding"),
      listNotes(restaurantId, "account"),
    ]);
    return { checklist, onboardingNotes, accountNotes };
  } catch {
    return {
      checklist: { sections: [], done: 0, total: 0, complete: false },
      onboardingNotes: [] as Awaited<ReturnType<typeof listNotes>>,
      accountNotes: [] as Awaited<ReturnType<typeof listNotes>>,
    };
  }
}

/**
 * This tenant's storefront analytics, inside their admin page.
 *
 * The whole point is that it renders `TenantAnalytics` — the same component,
 * fed by the same query functions, as the owner's own dashboard and the
 * drilldown on `/admin/analytics`. `docs/analytics.md` is explicit that a
 * second implementation of these numbers is how the console tells us 4.1%
 * while the owner's page tells them 3.8%, and there is no winning the support
 * call that follows.
 *
 * The range is resolved in the **tenant's** timezone, not the platform's. On
 * the platform analytics page that distinction is a nicety; here it would be a
 * bug, because this page sits next to the tenant's hours and an admin will
 * read the two together.
 */
async function TenantAnalyticsTab({
  restaurant,
  searchParams,
}: {
  restaurant: { id: string; timezone: string };
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const params = readFilterParams(searchParams);

  const since = params.range === "all" ? await earliestActivity(restaurant.id) : null;
  const range = resolveRange({
    preset: params.range,
    from: params.from,
    to: params.to,
    timezone: restaurant.timezone,
    now: new Date(),
    since,
  });

  const filter: AnalyticsFilter = {
    range,
    timezone: restaurant.timezone,
    q: params.q || null,
    source: (params.source || null) as VisitSource | null,
    device: (params.device || null) as VisitDevice | null,
    includeSimulated: params.includeSimulated,
  };

  return (
    <>
      {/* `tab` is carried through as a hidden field by the filter form, so
          changing the range doesn't bounce you back to Overview. */}
      <AnalyticsFilters
        action={`/admin/restaurants/${restaurant.id}`}
        timezone={restaurant.timezone}
        searchPlaceholder="Search items or search terms"
        state={{
          range,
          q: params.q,
          source: params.source,
          device: params.device,
          includeSimulated: params.includeSimulated,
          tab: "analytics",
        }}
      />

      <TenantAnalytics
        restaurantId={restaurant.id}
        timezone={restaurant.timezone}
        filter={filter}
      />

      {/* Operator login history for this tenant's own logins — separate from the
          storefront analytics above (that's their customers; this is them). It
          ignores the date filter on purpose: "who's been in this account
          lately" is a fixed recent-window question, not one you slice by the
          same range as traffic. */}
      <div className="mt-10 border-t border-line pt-8">
        <h3 className="mb-1 text-[14px] font-semibold text-ink">Operator activity</h3>
        <p className="mb-4 text-[12px] text-dim">
          Sign-ins and in-app activity for this account&rsquo;s own logins over the last 30 days.
        </p>
        <OperatorActivity restaurantId={restaurant.id} />
      </div>
    </>
  );
}

async function OperatorActivity({ restaurantId }: { restaurantId: string }) {
  const { summary, logins } = await activityForRestaurant(restaurantId, 30);
  return (
    <OperatorActivityTables
      summary={summary}
      logins={logins}
      emptyBody="Nobody on this account has signed in during the window — or migration 35_login_history hasn't run yet."
    />
  );
}
