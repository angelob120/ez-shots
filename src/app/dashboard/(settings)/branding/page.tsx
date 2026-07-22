import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireOwner } from "@/lib/auth";
import { SectionTitle } from "@/components/hearth/ui";
import { parseSiteContent } from "@/lib/site-content";
import { DOMAIN_CHALLENGE_PREFIX, platformOrigin } from "@/lib/domains";
import { fallbackOrigin } from "@/lib/cloudflare";
import BrandingForm from "./BrandingForm";

export const dynamic = "force-dynamic";

export default async function BrandingPage() {
  const { restaurantId } = await requireOwner();
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!r) notFound();

  // The hostname owners point their CNAME at. With Cloudflare for SaaS this
  // MUST be the fallback origin — pointing at the apex/marketing host makes
  // Cloudflare's hostname validation never go active.
  const appHost =
    fallbackOrigin() ||
    (process.env.PRIMARY_DOMAIN ?? "").split(",")[0].trim() ||
    process.env.RAILWAY_PUBLIC_DOMAIN ||
    "your-app.up.railway.app";

  // The public origin owners actually share, from the same resolver that builds
  // the links in their customers' texts — so the address on this page and the
  // address on a receipt can't drift apart. It deliberately never returns the
  // Cloudflare fallback origin above: that's a routing detail no customer
  // should see printed on a card. Only the platform half is needed here, since
  // the panel picks the tenant's own domain itself when one is verified.
  const origin = platformOrigin() || `https://${appHost}`;

  return (
    <>
      <SectionTitle
        title="Branding & info"
        subtitle="This is what themes your ordering page. The Links tab has the address you put on your Google and Apple Maps profile."
      />

      <div className="grid gap-6">
        <BrandingForm
          initial={{
            name: r.name,
            tagline: r.tagline ?? "",
            logoUrl: r.logoUrl ?? "",
            heroUrl: r.heroUrl ?? "",
            accentColor: r.accentColor,
            address: r.address ?? "",
            city: r.city ?? "",
            phone: r.phone ?? "",
            hours: r.hours ?? "",
            heroHeadline: r.heroHeadline ?? "",
            heroCtaLabel: r.heroCtaLabel ?? "",
            aboutTitle: r.aboutTitle ?? "",
            aboutBody: r.aboutBody ?? "",
            gallery: r.galleryUrls ?? [],
            showAbout: r.showAbout,
            showGallery: r.showGallery,
            theme: (["LIGHT", "DARK", "SYSTEM"].includes(r.theme) ? r.theme : "SYSTEM") as
              | "LIGHT"
              | "DARK"
              | "SYSTEM",
            themePreset: r.themePreset,
            content: parseSiteContent(r.siteContent),
          }}
          slug={r.slug}
          domain={{
            domain: r.customDomain ?? "",
            verified: Boolean(r.domainVerifiedAt),
            token: r.domainVerifyToken ?? "",
          }}
          appHost={appHost}
          challengePrefix={DOMAIN_CHALLENGE_PREFIX}
          origin={origin}
        />
      </div>
    </>
  );
}
