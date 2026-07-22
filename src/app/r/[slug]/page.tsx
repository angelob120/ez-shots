import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata, Viewport } from "next";
import { prisma } from "@/lib/prisma";
import StoreApp from "@/components/customer/StoreApp";
import { storeRootProps } from "@/components/customer/theme";
import { parseSiteContent } from "@/lib/site-content";
import { effectiveItemPriceCts, isOnSale } from "@/lib/money";
import { tenantWhere, DOMAIN_HEADER, platformOrigin } from "@/lib/domains";
import { resolvePaymentMode, stripePublishableKeyForMode } from "@/lib/payments";
import { cardPaymentsAllowed } from "@/lib/entitlements";
import { providerButtons } from "@/lib/oauth";
import { getCustomerSession } from "@/lib/customer-session";
import { getSession } from "@/lib/auth";
import {
  checkAvailability,
  describeWeek,
  hasSchedule,
  localNow,
  parseWeeklyHours,
} from "@/lib/hours";

export const dynamic = "force-dynamic";

/** True when this request is being served from a tenant's custom domain, in
 * which case PWA paths must be site-root (not /r/<slug>). */
function onCustomDomain(): boolean {
  return Boolean(headers().get(DOMAIN_HEADER));
}

async function getRestaurant(slug: string) {
  return prisma.restaurant.findFirst({
    where: tenantWhere(slug),
    include: {
      // Needed by checkAvailability — a holiday closure is the difference
      // between "closed today" and a schedule that says otherwise.
      closures: { select: { startDate: true, endDate: true, reason: true } },
      categories: { orderBy: { sort: "asc" } },
      items: {
        where: { available: true },
        orderBy: [{ sort: "asc" }, { name: "asc" }],
        include: {
          modifierGroups: {
            orderBy: { sort: "asc" },
            include: {
              options: { where: { available: true }, orderBy: [{ sort: "asc" }, { name: "asc" }] },
            },
          },
          // Upsell first so a "make it a large" beats "add a cookie" in the list.
          links: { orderBy: [{ kind: "asc" }, { sort: "asc" }] },
        },
      },
    },
  });
}

// themeColor belongs in a viewport export, not metadata (Next 14 requirement).
export async function generateViewport({
  params,
}: {
  params: { slug: string };
}): Promise<Viewport> {
  const r = await prisma.restaurant.findFirst({ where: tenantWhere(params.slug) });
  return { themeColor: r?.accentColor ?? "#0b0c0e" };
}

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const r = await prisma.restaurant.findFirst({ where: tenantWhere(params.slug) });
  if (!r) return { title: "Not found" };
  const manifestPath = onCustomDomain()
    ? `/manifest.webmanifest`
    : `/r/${r.slug}/manifest.webmanifest`;
  return {
    title: `${r.name} - Order online`,
    description: r.tagline ?? `Order pickup from ${r.name}.`,
    manifest: manifestPath,
    appleWebApp: { capable: true, title: r.name, statusBarStyle: "black-translucent" },
    openGraph: { title: r.name, images: r.heroUrl ? [r.heroUrl] : undefined },
  };
}

export default async function StorePage({
  params,
  searchParams,
}: {
  params: { slug: string };
  searchParams?: { preview?: string };
}) {
  const r = await getRestaurant(params.slug);
  if (!r) notFound();

  /**
   * Branding preview, for the owner of this tenant only.
   *
   * The client half of preview mode is just a querystring flag (see
   * components/customer/usePreviewDraft.ts), but the flag alone must not open
   * the not-yet-live and paused gates below — that would let anyone read a
   * suspended tenant's menu by typing seven characters. So the bypass is an
   * ownership check against the session, which is also what makes the preview
   * useful during onboarding: a PENDING restaurant has no live storefront to
   * frame, and "Check back soon" is not a website anyone can design against.
   *
   * An admin gets it too, because impersonation lands them here while
   * troubleshooting exactly the tenant whose site won't render.
   */
  const operator = searchParams?.preview === "1" ? await getSession() : null;
  const previewing =
    !!operator && (operator.role === "ADMIN" || operator.restaurantId === r.id);

  // Not-yet-live and paused are different situations and get different copy.
  if (!previewing && (r.status === "SUSPENDED" || r.status === "PENDING")) {
    return (
      <div className="store grid min-h-dvh place-items-center px-6" {...storeRootProps(r)}>
        <div className="max-w-[340px] text-center">
          <h1 className="text-[22px] font-bold tracking-[-0.02em]">{r.name}</h1>
          <p className="mt-2 text-[14px] leading-relaxed text-s-dim">
            {r.status === "PENDING"
              ? "This ordering page isn't live yet. Check back soon."
              : "Online ordering is paused right now."}
          </p>
          {r.status === "SUSPENDED" && r.phone && (
            <a
              href={`tel:${r.phone}`}
              className="mt-5 inline-flex rounded-full bg-s-accent px-5 py-3 text-[14px] font-semibold text-s-accentInk"
            >
              Call {r.phone}
            </a>
          )}
        </div>
      </div>
    );
  }

  // Asked here as well as in placeOrderAction. The action stays the authority —
  // this page is rendered dynamically but a customer can still sit on it past
  // closing — but there is no reason to let someone build a whole cart first.
  const now = new Date();
  const availability = checkAvailability(r, now);

  // Payment mode drives whether checkout shows a card field and which
  // publishable key it mounts with. Resolved server-side so neither key set is
  // baked into the client bundle.
  const paymentMode = await resolvePaymentMode();
  const publishableKey = stripePublishableKeyForMode(paymentMode);

  // The owner's switch AND the platform's. A PAYMENTS suspension looks
  // identical to the customer — pay at the counter — because the reason we cut
  // a tenant off is between us and the tenant, not something to publish on
  // their storefront.
  const cardsAllowed = await cardPaymentsAllowed(r);

  // The signed-in diner, if there is one. Scoped to this tenant by the read
  // itself — a signature-valid cookie minted on another storefront resolves to
  // null here rather than to somebody else's account.
  const session = await getCustomerSession(r.id);
  const customerAccount = session
    ? await prisma.customerAccount
        .findFirst({
          where: { id: session.accountId, restaurantId: r.id },
          select: { name: true, email: true },
        })
        .catch(() => null) // the table may predate a migration on a stale env
    : null;

  // One source of truth for hours. `hoursJson` decides whether ordering is
  // open, so it is also what the page displays; the free-text `hours` column
  // is demoted to a note beside it. Previously the two were independent and an
  // owner who edited one and not the other advertised hours the system would
  // refuse to honour.
  const weekly = parseWeeklyHours(r.hoursJson);
  const week = describeWeek(weekly);
  // "Today" is the restaurant's today, not the browser's.
  const todayKey = localNow(now, r.timezone).day;
  const today = week.find((d) => d.day === todayKey);

  return (
    <StoreApp
      restaurant={{
        slug: r.slug,
        name: r.name,
        tagline: r.tagline,
        logoUrl: r.logoUrl,
        heroUrl: r.heroUrl,
        accentColor: r.accentColor,
        address: r.address,
        city: r.city,
        phone: r.phone,
        hours: {
          configured: hasSchedule(weekly),
          today: today && today.text !== "Closed" ? today.text : null,
          week: week.map((d) => ({ label: d.label, text: d.text })),
          note: r.hours,
        },
        availability: availability.ok
          ? { ok: true }
          : { ok: false, message: availability.message, reopens: availability.reopens },
        // Policies are ours, not the tenant's, so they carry the platform
        // origin even when this page is being served on the tenant's own
        // domain — where /legal/* does not resolve at all.
        legalBase: platformOrigin(),
        signIn: {
          providers: providerButtons(),
          account: customerAccount,
        },
        surchargeLabel: r.surchargeLabel,
        // Cards off means pay-at-counter, and the service fee is waived (it only
        // exists when the platform processes the card). Zeroed here so the
        // client-side total matches what the server will actually charge.
        surchargePct: cardsAllowed ? r.surchargePct : 0,
        surchargeMinCts: cardsAllowed ? r.surchargeMinCts : 0,
        surchargeMaxCts: cardsAllowed ? r.surchargeMaxCts : 0,
        taxPct: r.taxPct,
        heroHeadline: r.heroHeadline,
        heroCtaLabel: r.heroCtaLabel,
        aboutTitle: r.aboutTitle,
        aboutBody: r.aboutBody,
        galleryUrls: r.galleryUrls,
        showAbout: r.showAbout,
        showGallery: r.showGallery,
        theme: (["LIGHT", "DARK", "SYSTEM"].includes(r.theme) ? r.theme : "SYSTEM") as
          | "LIGHT"
          | "DARK"
          | "SYSTEM",
        themePreset: r.themePreset,
        content: parseSiteContent(r.siteContent),
        // Card field follows the current platform mode. STUB shows no field
        // (the server charges nothing); LIVE/TEST show it when their
        // publishable key is present. In a Stripe mode with no publishable key
        // the server still charges (test card in TEST), so checkout stays
        // functional without a field.
        payments: {
          cardEnabled: cardsAllowed && paymentMode !== "STUB" && !!publishableKey,
          publishableKey,
          // Not a secret — `acct_...` is public by design and is exactly what
          // Stripe.js takes to tokenize against the connected account. The
          // charge is created on this same account server-side; if the two
          // disagree the PaymentMethod is unusable.
          stripeAccount: r.stripeAccountId,
        },
      }}
      categories={r.categories.map((c) => ({ id: c.id, name: c.name }))}
      items={r.items.map((i) => ({
        id: i.id,
        name: i.name,
        description: i.description,
        priceCts: effectiveItemPriceCts(i),
        listPriceCts: isOnSale(i) ? i.priceCts : null,
        imageUrl: i.imageUrl,
        color: i.color,
        categoryId: i.categoryId,
        featured: i.featured,
        // Groups with nothing selectable left would render as dead UI.
        groups: i.modifierGroups
          .filter((g) => g.options.length > 0)
          .map((g) => ({
            id: g.id,
            name: g.name,
            minSelect: g.minSelect,
            maxSelect: Math.max(1, Math.min(g.maxSelect, g.options.length)),
            options: g.options.map((o) => ({
              id: o.id,
              name: o.name,
              priceDeltaCts: o.priceDeltaCts,
              isDefault: o.isDefault,
            })),
          })),
        recommendedIds: i.links.map((l) => l.linkedItemId),
      }))}
    />
  );
}
