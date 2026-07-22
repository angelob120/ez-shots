"use client";

import * as React from "react";
import Icon from "./Icon";
import { Photo } from "./primitives";
import { money } from "./theme";
import type { StoreInfo } from "./Menu";
import type { MenuItemDTO } from "@/lib/cart";
import {
  HOME_VALUE_DEFAULTS,
  ABOUT_VALUE_DEFAULTS,
  FOOTER_TITLE_DEFAULT,
  FOOTER_BODY_DEFAULT,
  type SiteContent,
  type ValueCard,
} from "@/lib/site-content";

/**
 * The restaurant's website.
 *
 * Not an app screen — an actual multi-*page* site. There's a persistent nav and
 * footer, and the links (Home, Menu, About, Gallery, Visit) swap the whole page
 * beneath them rather than scrolling to an anchor, so each reads as its own
 * destination. The single job of every page is to make the Order button obvious.
 * When the customer taps Order, the ordering surface (StoreApp's menu/cart/
 * checkout) takes over; everything here is the marketing front that gets them
 * to that tap.
 *
 * Nothing here is ever allowed to look empty. A tenant mid-onboarding has no
 * hero, no gallery, and half a menu photographed — so hero, gallery, and about
 * imagery all fall back to a curated set of stock food photos, and copy falls
 * back to sensible defaults built from whatever the restaurant *has* set.
 */
export type SiteConfig = {
  heroHeadline: string | null;
  heroCtaLabel: string | null;
  aboutTitle: string | null;
  aboutBody: string | null;
  galleryUrls: string[];
  showAbout: boolean;
  showGallery: boolean;
};

/* Stock imagery now lives beside the ordering surface so both fall back to the
 * same photos. See ./stock. */
import { STOCK } from "./stock";

type Page = "home" | "menu" | "about" | "gallery" | "visit";

/** Merge stored cards with the template defaults: empty fields fall back. */
function mergeCards(stored: ValueCard[] | undefined, defaults: ValueCard[]): ValueCard[] {
  return defaults.map((d, i) => ({
    title: stored?.[i]?.title?.trim() || d.title,
    body: stored?.[i]?.body?.trim() || d.body,
  }));
}

export function StoreLanding({
  info,
  itemCount,
  categoryCount,
  highlights,
  site,
  content,
  onStart,
  onOpenItem,
}: {
  info: StoreInfo;
  itemCount: number;
  categoryCount: number;
  highlights: MenuItemDTO[];
  site: SiteConfig;
  content: SiteContent;
  onStart: () => void;
  onOpenItem: (item: MenuItemDTO) => void;
}) {
  const homeValues = mergeCards(content?.homeValues, HOME_VALUE_DEFAULTS);
  const aboutValues = mergeCards(content?.aboutValues, ABOUT_VALUE_DEFAULTS);
  const ctaLabel = site.heroCtaLabel?.trim() || "Order pickup";
  const headline = site.heroHeadline?.trim() || info.name;

  // Imagery, with fallbacks so no page is ever bare.
  const heroImage = info.heroUrl || STOCK.hero;
  const ownerGallery = (site.galleryUrls ?? []).filter(Boolean);
  const gallery = ownerGallery.length > 0 ? ownerGallery : STOCK.gallery;
  const aboutImage = ownerGallery[0] ?? info.heroUrl ?? STOCK.about;

  const [page, setPage] = React.useState<Page>("home");
  const [scrolled, setScrolled] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = React.useCallback((p: Page) => {
    setPage(p);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  // The home page keeps a translucent nav over its hero; every other page has a
  // solid header so the light-on-image treatment doesn't sit on white.
  const solidNav = page !== "home" || scrolled;

  const mapsHref = info.address
    ? `https://maps.google.com/?q=${encodeURIComponent(
        `${info.name} ${info.address} ${info.city ?? ""}`
      )}`
    : null;

  const NAV: Array<{ id: Page; label: string }> = [
    { id: "home", label: "Home" },
    { id: "menu", label: "Menu" },
    { id: "about", label: "About" },
    { id: "gallery", label: "Gallery" },
    { id: "visit", label: "Visit" },
  ];

  return (
    <div className="store-fade min-h-dvh">
      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav
        className={
          "store-pad-top fixed inset-x-0 top-0 z-50 transition-colors duration-300 " +
          (solidNav ? "border-b border-s-line bg-s-bg/90 backdrop-blur-md" : "bg-transparent")
        }
      >
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-3 px-5">
          <button onClick={() => go("home")} className="flex min-w-0 items-center gap-2.5">
            {info.logoUrl && (
              <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-s-line bg-white">
                <Photo src={info.logoUrl} alt="" rounded="rounded-none" />
              </span>
            )}
            <span
              className={
                "truncate text-[17px] font-extrabold tracking-[-0.02em] transition-colors " +
                (solidNav ? "text-s-ink" : "text-white drop-shadow")
              }
            >
              {info.name}
            </span>
          </button>

          <div className="ml-auto hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink
                key={n.id}
                label={n.label}
                active={page === n.id}
                onClick={() => go(n.id)}
                light={!solidNav}
              />
            ))}
          </div>

          <button
            onClick={onStart}
            className="ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-s-accent px-5 text-[14px] font-semibold text-s-accentInk shadow-sm transition active:scale-[0.97] md:ml-2"
          >
            Order
            <Icon name="chevron" size={15} color="currentColor" strokeWidth={2.4} />
          </button>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Menu"
            className={
              "grid h-10 w-10 shrink-0 place-items-center rounded-full transition md:hidden " +
              (solidNav ? "text-s-ink" : "text-white")
            }
          >
            <Icon name={menuOpen ? "close" : "menu"} size={20} color="currentColor" />
          </button>
        </div>

        {/* Mobile page drawer */}
        {menuOpen && (
          <div className="border-t border-s-line bg-s-bg px-5 py-3 md:hidden">
            {NAV.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={
                  "block w-full rounded-xl px-3 py-3 text-left text-[15px] font-semibold transition " +
                  (page === n.id ? "bg-s-accent/12 text-s-accent" : "text-s-ink hover:bg-s-raised")
                }
              >
                {n.label}
              </button>
            ))}
          </div>
        )}
      </nav>

      {/* ── Page body ───────────────────────────────────────────────────── */}
      {page === "home" && (
        <HomePage
          info={info}
          itemCount={itemCount}
          headline={headline}
          ctaLabel={ctaLabel}
          heroImage={heroImage}
          highlights={highlights}
          values={homeValues}
          mapsHref={mapsHref}
          onStart={onStart}
          onOpenItem={onOpenItem}
          go={go}
        />
      )}

      {page === "menu" && (
        <MenuPage
          info={info}
          itemCount={itemCount}
          highlights={highlights}
          heroImage={heroImage}
          subtitle={content?.menuSubtitle?.trim()}
          onStart={onStart}
          onOpenItem={onOpenItem}
        />
      )}

      {page === "about" && (
        <AboutPage
          info={info}
          site={site}
          itemCount={itemCount}
          categoryCount={categoryCount}
          aboutImage={aboutImage}
          gallery={gallery}
          values={aboutValues}
          onStart={onStart}
        />
      )}

      {page === "gallery" && (
        <GalleryPage
          info={info}
          gallery={gallery}
          subtitle={content?.gallerySubtitle?.trim()}
          onStart={onStart}
        />
      )}

      {page === "visit" && (
        <VisitPage
          info={info}
          heroImage={heroImage}
          mapsHref={mapsHref}
          subtitle={content?.visitSubtitle?.trim()}
          onStart={onStart}
        />
      )}

      {/* ── Footer (shared) ─────────────────────────────────────────────── */}
      <SiteFooter
        info={info}
        ctaLabel={ctaLabel}
        footerTitle={content?.footerTitle?.trim() || FOOTER_TITLE_DEFAULT}
        footerBody={content?.footerBody?.trim() || FOOTER_BODY_DEFAULT}
        onStart={onStart}
        go={go}
        nav={NAV}
        page={page}
      />
    </div>
  );
}

/* ================================================================ pages */

function HomePage({
  info,
  itemCount,
  headline,
  ctaLabel,
  heroImage,
  highlights,
  values,
  mapsHref,
  onStart,
  onOpenItem,
  go,
}: {
  info: StoreInfo;
  itemCount: number;
  headline: string;
  ctaLabel: string;
  heroImage: string;
  highlights: MenuItemDTO[];
  values: ValueCard[];
  mapsHref: string | null;
  onStart: () => void;
  onOpenItem: (item: MenuItemDTO) => void;
  go: (p: Page) => void;
}) {
  const VALUE_ICONS = ["receipt", "clock", "shield"];
  return (
    <>
      {/* Hero */}
      <header className="relative flex min-h-[86dvh] items-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" fetchPriority="high" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/40" />

        <div className="relative mx-auto w-full max-w-[1120px] px-5 py-24">
          <div className="max-w-[640px]">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/90 backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-s-accent" />
              Order ahead · Pickup
            </span>

            <h1 className="mt-5 text-[44px] font-extrabold leading-[1.02] tracking-[-0.03em] text-white drop-shadow-sm sm:text-[64px]">
              {headline}
            </h1>

            {info.tagline && (
              <p className="mt-4 max-w-[520px] text-[17px] leading-relaxed text-white/85 sm:text-[19px]">
                {info.tagline}
              </p>
            )}

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button
                onClick={onStart}
                className="flex h-[54px] items-center gap-2 rounded-full bg-s-accent px-8 text-[16px] font-semibold text-s-accentInk shadow-[0_8px_30px_rgba(0,0,0,0.3)] transition active:scale-[0.98]"
              >
                {ctaLabel}
                <Icon name="chevron" size={18} color="currentColor" strokeWidth={2.2} />
              </button>
              <button
                onClick={() => go("menu")}
                className="flex h-[54px] items-center rounded-full border border-white/40 bg-white/5 px-7 text-[15px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/10 active:scale-[0.98]"
              >
                View menu
              </button>
            </div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-white/80">
              {(info.hours.configured || info.hours.note) && (
                <span className="flex items-center gap-1.5">
                  <Icon name="clock" size={15} color="currentColor" />
                  {info.hours.configured
                    ? info.hours.today
                      ? `Today ${info.hours.today}`
                      : "Closed today"
                    : info.hours.note}
                </span>
              )}
              {mapsHref && (
                <a href={mapsHref} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 underline decoration-white/40 underline-offset-2">
                  <Icon name="pin" size={15} color="currentColor" />
                  {[info.address, info.city].filter(Boolean).join(", ")}
                </a>
              )}
              {info.phone && (
                <a href={`tel:${info.phone}`} className="flex items-center gap-1.5">
                  <Icon name="phone" size={15} color="currentColor" />
                  {info.phone}
                </a>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Value strip */}
      <section className="border-b border-s-line bg-s-raised">
        <div className="mx-auto grid max-w-[1120px] gap-6 px-5 py-10 sm:grid-cols-3">
          {values.map((v, i) => (
            <Value key={i} icon={VALUE_ICONS[i] ?? "spark"} title={v.title} body={v.body} />
          ))}
        </div>
      </section>

      {/* Popular preview */}
      {highlights.length > 0 && (
        <section>
          <div className="mx-auto max-w-[1120px] px-5 py-20">
            <div className="flex items-end justify-between gap-4">
              <div>
                <Eyebrow>The menu</Eyebrow>
                <h2 className="mt-3 text-[32px] font-extrabold tracking-[-0.025em] sm:text-[40px]">
                  What people order
                </h2>
              </div>
              <button
                onClick={() => go("menu")}
                className="hidden shrink-0 rounded-full border border-s-line px-5 py-2.5 text-[14px] font-semibold transition hover:bg-s-raised sm:block"
              >
                See the full menu
              </button>
            </div>

            <DishGrid items={highlights.slice(0, 4)} onOpenItem={onOpenItem} />

            <div className="mt-10 text-center">
              <button
                onClick={() => go("menu")}
                className="inline-flex h-[52px] items-center gap-2 rounded-full bg-s-accent px-8 text-[15px] font-semibold text-s-accentInk shadow-sm transition active:scale-[0.98]"
              >
                See the full menu
                <Icon name="chevron" size={17} color="currentColor" strokeWidth={2.2} />
              </button>
            </div>
          </div>
        </section>
      )}

      {/* About teaser */}
      <section className="border-y border-s-line bg-s-raised">
        <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-5 py-20 lg:grid-cols-2">
          <div className="relative order-2 aspect-[5/4] overflow-hidden rounded-[28px] border border-s-line lg:order-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={STOCK.about} alt="" className="h-full w-full object-cover" />
          </div>
          <div className="order-1 lg:order-2">
            <Eyebrow>Who we are</Eyebrow>
            <h2 className="mt-3 text-[32px] font-extrabold tracking-[-0.025em] sm:text-[40px]">
              {info.tagline || "Good food, ready when you are."}
            </h2>
            <p className="mt-5 max-w-[480px] text-[15.5px] leading-relaxed text-s-dim">
              {`${info.name} keeps it simple${
                itemCount > 0 ? `: a menu of ${itemCount} things` : ""
              } made to order and packed up for pickup. Order ahead from your phone, swing by, and skip the wait at the counter.`}
            </p>
            <button
              onClick={() => go("about")}
              className="mt-7 inline-flex h-12 items-center gap-2 rounded-full border border-s-line px-6 text-[14px] font-semibold transition hover:bg-s-bg active:scale-[0.98]"
            >
              Read our story
              <Icon name="chevron" size={15} color="currentColor" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function MenuPage({
  info,
  itemCount,
  highlights,
  heroImage,
  subtitle,
  onStart,
  onOpenItem,
}: {
  info: StoreInfo;
  itemCount: number;
  highlights: MenuItemDTO[];
  heroImage: string;
  subtitle?: string;
  onStart: () => void;
  onOpenItem: (item: MenuItemDTO) => void;
}) {
  return (
    <>
      <PageBanner
        image={heroImage}
        eyebrow="The menu"
        title="What people order"
        subtitle={
          subtitle ||
          (itemCount > 0
            ? `${itemCount} things made to order, packed for pickup.`
            : "Made to order and packed for pickup.")
        }
      />
      <section>
        <div className="mx-auto max-w-[1120px] px-5 py-16">
          {highlights.length > 0 ? (
            <DishGrid items={highlights} onOpenItem={onOpenItem} />
          ) : (
            <div className="rounded-3xl border border-s-line bg-s-raised px-6 py-16 text-center">
              <p className="text-[16px] font-semibold">The full menu opens when you order</p>
              <p className="mx-auto mt-1.5 max-w-[360px] text-[13.5px] text-s-dim">
                Tap the button below to browse everything and build your pickup order.
              </p>
            </div>
          )}

          <div className="mt-12 text-center">
            <button
              onClick={onStart}
              className="inline-flex h-[54px] items-center gap-2 rounded-full bg-s-accent px-9 text-[16px] font-semibold text-s-accentInk shadow-sm transition active:scale-[0.98]"
            >
              Start your order
              <Icon name="chevron" size={18} color="currentColor" strokeWidth={2.2} />
            </button>
            <p className="mt-4 text-[12.5px] text-s-mute">
              Pickup only. A small service fee is added at checkout and shown before you pay.
            </p>
          </div>
        </div>
      </section>
    </>
  );
}

function AboutPage({
  info,
  site,
  itemCount,
  categoryCount,
  aboutImage,
  gallery,
  values,
  onStart,
}: {
  info: StoreInfo;
  site: SiteConfig;
  itemCount: number;
  categoryCount: number;
  aboutImage: string;
  gallery: string[];
  values: ValueCard[];
  onStart: () => void;
}) {
  const VALUE_ICONS = ["spark", "star", "shield"];
  const body =
    site.aboutBody?.trim() ||
    `${info.name} keeps it simple: a menu${itemCount > 0 ? ` of ${itemCount} things` : ""}${
      categoryCount > 1 ? " across a few sections," : ""
    } made to order and packed up for pickup. Order ahead from your phone, swing by, and skip the wait at the counter. No delivery apps, no markup - just the food, the way we make it, ready when you get here.`;

  return (
    <>
      <PageBanner
        image={aboutImage}
        eyebrow="Who we are"
        title={site.aboutTitle?.trim() || info.tagline || "Good food, ready when you are."}
      />
      <section>
        <div className="mx-auto grid max-w-[1120px] items-center gap-12 px-5 py-20 lg:grid-cols-2">
          <div>
            <Eyebrow>Our story</Eyebrow>
            <p className="mt-5 whitespace-pre-line text-[16px] leading-relaxed text-s-dim">{body}</p>
            <button
              onClick={onStart}
              className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-s-accent px-7 text-[14px] font-semibold text-s-accentInk transition active:scale-[0.98]"
            >
              Browse the menu
              <Icon name="chevron" size={15} color="currentColor" strokeWidth={2.2} />
            </button>
          </div>
          <div className="relative aspect-[5/4] overflow-hidden rounded-[28px] border border-s-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={aboutImage} alt="" className="h-full w-full object-cover" />
          </div>
        </div>
      </section>

      {/* A few values, echoing the SaaS site's card grid */}
      <section className="border-t border-s-line bg-s-raised">
        <div className="mx-auto max-w-[1120px] px-5 py-16">
          <div className="grid gap-6 sm:grid-cols-3">
            {values.map((v, i) => (
              <Value key={i} icon={VALUE_ICONS[i] ?? "spark"} title={v.title} body={v.body} />
            ))}
          </div>
        </div>
      </section>

      {/* Small gallery strip to keep the page rich */}
      <section>
        <div className="mx-auto max-w-[1120px] px-5 py-16">
          <div className="grid grid-cols-3 gap-3">
            {gallery.slice(0, 3).map((url, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-2xl border border-s-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function GalleryPage({
  info,
  gallery,
  subtitle,
  onStart,
}: {
  info: StoreInfo;
  gallery: string[];
  subtitle?: string;
  onStart: () => void;
}) {
  return (
    <>
      <PageBanner
        image={gallery[0]}
        eyebrow="A look inside"
        title="Gallery"
        subtitle={subtitle || `A taste of what's coming out of ${info.name}'s kitchen.`}
      />
      <section>
        <div className="mx-auto max-w-[1120px] px-5 py-16">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {gallery.map((url, i) => (
              <div
                key={i}
                className={
                  "relative overflow-hidden rounded-2xl border border-s-line " +
                  (i % 5 === 0 ? "col-span-2 aspect-[16/10]" : "aspect-square")
                }
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt="" loading="lazy" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>

          <div className="mt-12 text-center">
            <button
              onClick={onStart}
              className="inline-flex h-[54px] items-center gap-2 rounded-full bg-s-accent px-9 text-[16px] font-semibold text-s-accentInk shadow-sm transition active:scale-[0.98]"
            >
              Order pickup
              <Icon name="chevron" size={18} color="currentColor" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

function VisitPage({
  info,
  heroImage,
  mapsHref,
  subtitle,
  onStart,
}: {
  info: StoreInfo;
  heroImage: string;
  mapsHref: string | null;
  subtitle?: string;
  onStart: () => void;
}) {
  return (
    <>
      <PageBanner
        image={heroImage}
        eyebrow="Come find us"
        title={`Visit ${info.name}`}
        subtitle={subtitle || "Order ahead, then swing by and skip the wait at the counter."}
      />
      <section>
        <div className="mx-auto max-w-[1120px] px-5 py-16">
          <div className="grid gap-4 sm:grid-cols-3">
            {/* The whole week, straight off hoursJson — the same data ordering
                obeys, so the page can't promise a window the system refuses. */}
            <InfoCard
              icon="clock"
              label="Hours"
              lines={
                info.hours.configured
                  ? info.hours.week.map((d) => `${d.label} — ${d.text}`)
                  : ["Call for today's hours"]
              }
              note={info.hours.note}
            />
            <InfoCard
              icon="pin"
              label="Find us"
              lines={([info.address, info.city].filter(Boolean) as string[]).length
                ? ([info.address, info.city].filter(Boolean) as string[])
                : ["Address on our Google listing"]}
              href={mapsHref ?? undefined}
              hrefLabel="Get directions"
            />
            <InfoCard
              icon="phone"
              label="Call"
              lines={info.phone ? [info.phone] : ["-"]}
              href={info.phone ? `tel:${info.phone}` : undefined}
              hrefLabel="Call now"
            />
          </div>

          <div className="mt-10 overflow-hidden rounded-[28px] border border-s-line">
            {mapsHref ? (
              <a href={mapsHref} target="_blank" rel="noreferrer" className="group relative block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroImage} alt="" className="h-[280px] w-full object-cover transition group-hover:scale-[1.02]" />
                <span className="absolute inset-0 grid place-items-center bg-black/45">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-[14px] font-semibold text-black shadow-lg">
                    <Icon name="pin" size={16} color="currentColor" />
                    Open in Maps
                  </span>
                </span>
              </a>
            ) : (
              <div className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={heroImage} alt="" className="h-[280px] w-full object-cover" />
              </div>
            )}
          </div>

          <div className="mt-12 text-center">
            <button
              onClick={onStart}
              className="inline-flex h-[54px] items-center gap-2 rounded-full bg-s-accent px-9 text-[16px] font-semibold text-s-accentInk shadow-sm transition active:scale-[0.98]"
            >
              Order pickup
              <Icon name="chevron" size={18} color="currentColor" strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- bits */

function PageBanner({
  image,
  eyebrow,
  title,
  subtitle,
}: {
  image?: string | null;
  eyebrow: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <header className="relative flex min-h-[42dvh] items-end overflow-hidden pt-16">
      {image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-s-accent/40 via-s-accent/15 to-black" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/45 to-black/30" />
      <div className="relative mx-auto w-full max-w-[1120px] px-5 pb-12 pt-16">
        <div className="flex items-center gap-2.5">
          <span className="h-px w-6 bg-s-accent" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-white/90">{eyebrow}</span>
        </div>
        <h1 className="mt-3 max-w-[720px] text-[38px] font-extrabold leading-[1.04] tracking-[-0.03em] text-white drop-shadow-sm sm:text-[52px]">
          {title}
        </h1>
        {subtitle && <p className="mt-3 max-w-[560px] text-[16px] leading-relaxed text-white/85">{subtitle}</p>}
      </div>
    </header>
  );
}

function DishGrid({
  items,
  onOpenItem,
}: {
  items: MenuItemDTO[];
  onOpenItem: (item: MenuItemDTO) => void;
}) {
  return (
    <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onOpenItem(item)}
          className="group overflow-hidden rounded-3xl border border-s-line bg-s-raised text-left transition hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99]"
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden">
            <Photo
              src={item.imageUrl || STOCK.dish}
              alt={item.name}
              color={item.color}
              rounded="rounded-none"
              className="h-full w-full transition duration-300 group-hover:scale-105"
            />
            <span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-s-accent text-s-accentInk shadow-md">
              <Icon name="plus" size={17} color="currentColor" strokeWidth={2.2} />
            </span>
          </div>
          <div className="p-3.5">
            <h3 className="line-clamp-1 text-[14.5px] font-bold tracking-[-0.01em]">{item.name}</h3>
            {item.description && (
              <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-s-dim">{item.description}</p>
            )}
            <p className="mt-2 text-[14px] font-bold tabular-nums text-s-accent">{money(item.priceCts)}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

function SiteFooter({
  info,
  ctaLabel,
  footerTitle,
  footerBody,
  onStart,
  go,
  nav,
  page,
}: {
  info: StoreInfo;
  ctaLabel: string;
  footerTitle: string;
  footerBody: string;
  onStart: () => void;
  go: (p: Page) => void;
  nav: Array<{ id: Page; label: string }>;
  page: Page;
}) {
  return (
    <section className="border-t border-s-line bg-s-accent/[0.07]">
      <div className="mx-auto max-w-[1120px] px-5 py-20 text-center">
        <h2 className="mx-auto max-w-[560px] text-[34px] font-extrabold leading-tight tracking-[-0.03em] sm:text-[46px]">
          {footerTitle}
        </h2>
        <p className="mx-auto mt-4 max-w-[420px] text-[15.5px] leading-relaxed text-s-dim">
          {footerBody}
        </p>
        <button
          onClick={onStart}
          className="mt-8 inline-flex h-[56px] items-center gap-2 rounded-full bg-s-accent px-9 text-[16px] font-semibold text-s-accentInk shadow-[0_8px_30px_rgba(0,0,0,0.18)] transition active:scale-[0.98]"
        >
          {ctaLabel}
          <Icon name="chevron" size={18} color="currentColor" strokeWidth={2.2} />
        </button>
      </div>

      <footer className="border-t border-s-line">
        <div className="mx-auto flex max-w-[1120px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[16px] font-extrabold tracking-[-0.02em] text-s-ink">{info.name}</div>
            {info.tagline && <div className="mt-1 max-w-[280px] text-[12.5px] text-s-dim">{info.tagline}</div>}
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2">
            {nav.map((n) => (
              <button
                key={n.id}
                onClick={() => go(n.id)}
                className={
                  "text-[13.5px] font-semibold transition-colors " +
                  (page === n.id ? "text-s-accent" : "text-s-dim hover:text-s-ink")
                }
              >
                {n.label}
              </button>
            ))}
          </nav>
        </div>
        <div className="border-t border-s-line">
          <div className="mx-auto max-w-[1120px] px-5 py-6 text-center text-[12px] text-s-mute">
            © {new Date().getFullYear()} {info.name}. Online ordering by EZ Orders.
          </div>
        </div>
      </footer>
    </section>
  );
}

function NavLink({
  label,
  onClick,
  light,
  active,
}: {
  label: string;
  onClick: () => void;
  light: boolean;
  active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full px-3.5 py-2 text-[14px] font-semibold transition-colors " +
        (active
          ? light
            ? "text-white"
            : "text-s-accent"
          : light
          ? "text-white/80 hover:text-white"
          : "text-s-dim hover:text-s-ink")
      }
    >
      {label}
    </button>
  );
}

function Value({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="flex gap-3.5">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-s-accent/12 text-s-accent">
        <Icon name={icon} size={20} color="currentColor" />
      </div>
      <div>
        <div className="text-[15px] font-bold tracking-[-0.01em]">{title}</div>
        <p className="mt-1 text-[13px] leading-relaxed text-s-dim">{body}</p>
      </div>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  lines,
  href,
  hrefLabel,
  note,
}: {
  icon: string;
  label: string;
  lines: string[];
  href?: string;
  hrefLabel?: string;
  /** An aside under the facts — never a competing version of them. */
  note?: string | null;
}) {
  return (
    <div className="rounded-3xl border border-s-line bg-s-raised p-6">
      <div className="grid h-11 w-11 place-items-center rounded-2xl bg-s-accent/12 text-s-accent">
        <Icon name={icon} size={20} color="currentColor" />
      </div>
      <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.1em] text-s-mute">{label}</div>
      <div className="mt-1.5 space-y-0.5">
        {lines.map((l, i) => (
          <div key={i} className="text-[15px] font-medium leading-snug text-s-ink">
            {l}
          </div>
        ))}
      </div>
      {note && (
        <p className="mt-3 text-[13px] leading-relaxed text-s-dim">{note}</p>
      )}
      {href && hrefLabel && (
        <a
          href={href}
          target={href.startsWith("http") ? "_blank" : undefined}
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1 text-[13.5px] font-semibold text-s-accent"
        >
          {hrefLabel}
          <Icon name="chevron" size={14} color="currentColor" strokeWidth={2.4} />
        </a>
      )}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-px w-6 bg-s-accent" />
      <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-s-accent">{children}</span>
    </div>
  );
}
