"use client";

import * as React from "react";
import Icon from "./Icon";
import { Photo, cx } from "./primitives";
import { STOCK } from "./stock";
import { money } from "./theme";
import type { MenuItemDTO } from "@/lib/cart";

/**
 * Hours reach the storefront in three shapes, all derived from `hoursJson` on
 * the server so the page can never disagree with what ordering actually does.
 * The free-text `hours` column is now a *note* beside them, not a rival answer.
 */
export type StoreHours = {
  /**
   * False when the tenant never set a schedule. Ordering fails open in that
   * case (see lib/hours), so the page must not announce "Closed today" — it
   * says nothing about hours at all and leans on the owner's note.
   */
  configured: boolean;
  /** Today's window, e.g. "11:00 AM – 9:00 PM". Null when closed today. */
  today: string | null;
  /** The full week, for the Visit page. */
  week: Array<{ label: string; text: string }>;
  /** Owner's free-text aside — "kitchen closes early on match days". */
  note: string | null;
};

/**
 * Whether an order can be placed at this moment, decided by the same
 * `checkAvailability` the order action calls. Sent to the client so the page
 * can say so up front instead of letting someone build a cart for nothing.
 */
export type StoreAvailability =
  | { ok: true }
  | { ok: false; message: string; reopens: string | null };

export type StoreInfo = {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  hours: StoreHours;
  availability: StoreAvailability;
};

/**
 * The ordering surface is a page *of the restaurant's website*, not a separate
 * app bolted onto it. So it borrows the site's vocabulary wholesale: the same
 * 1120px measure, the same accent-hairline eyebrow over an extrabold heading,
 * the same full-bleed banner, the same raised card with an accent add button.
 * A customer tapping "Order" should feel like they turned a page, not like
 * they were handed off to a different product.
 */
const SHELL = "mx-auto w-full max-w-[1120px] px-5";

/** Accent hairline + label. Lifted verbatim from the marketing pages. */
export function Eyebrow({
  children,
  light,
}: {
  children: React.ReactNode;
  light?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="h-px w-6 bg-s-accent" />
      <span
        className={cx(
          "text-[11px] font-bold uppercase tracking-[0.16em]",
          light ? "text-white/90" : "text-s-accent"
        )}
      >
        {children}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Site bar — the same persistent chrome the marketing pages carry
   ──────────────────────────────────────────────────────────────── */

export function SiteBar({ info, onBack }: { info: StoreInfo; onBack?: () => void }) {
  const [scrolled, setScrolled] = React.useState(false);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={cx(
        "store-pad-top fixed inset-x-0 top-0 z-50 transition-colors duration-300",
        scrolled ? "border-b border-s-line bg-s-bg/90 backdrop-blur-md" : "bg-transparent"
      )}
    >
      <div className={cx(SHELL, "flex h-16 items-center gap-3")}>
        <button
          onClick={onBack}
          className="flex min-w-0 items-center gap-2.5"
          aria-label="Back to site"
        >
          {info.logoUrl && (
            <span className="h-9 w-9 shrink-0 overflow-hidden rounded-xl border border-s-line bg-white">
              <Photo src={info.logoUrl} alt="" rounded="rounded-none" />
            </span>
          )}
          <span
            className={cx(
              "truncate text-[17px] font-extrabold tracking-[-0.02em] transition-colors",
              scrolled ? "text-s-ink" : "text-white drop-shadow"
            )}
          >
            {info.name}
          </span>
        </button>

        {onBack && (
          <button
            onClick={onBack}
            className={cx(
              "ml-auto flex h-10 shrink-0 items-center gap-1.5 rounded-full px-4 text-[14px] font-semibold transition active:scale-[0.97]",
              scrolled
                ? "border border-s-line text-s-dim hover:text-s-ink"
                : "border border-white/35 bg-white/10 text-white backdrop-blur-sm"
            )}
          >
            <Icon name="back" size={15} color="currentColor" strokeWidth={2.3} />
            <span className="hidden sm:inline">Back to site</span>
          </button>
        )}
      </div>
    </nav>
  );
}

/* ────────────────────────────────────────────────────────────────
   Banner
   ──────────────────────────────────────────────────────────────── */

/**
 * Same construction as the site's PageBanner: photo, black gradient, eyebrow,
 * oversized white title. The previous version floated a raised card over the
 * photo, which read as a different product the moment you came from the
 * landing page — the whole complaint.
 */
export function StoreBanner({ info }: { info: StoreInfo }) {
  const image = info.heroUrl || STOCK.hero;
  const mapsHref = info.address
    ? `https://maps.google.com/?q=${encodeURIComponent(
        `${info.name} ${info.address} ${info.city ?? ""}`
      )}`
    : null;

  return (
    <header className="relative flex min-h-[40dvh] items-end overflow-hidden pt-16 sm:min-h-[46dvh]">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        fetchPriority="high"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/35" />

      <div className={cx(SHELL, "relative pb-10 pt-16")}>
        <Eyebrow light>Order pickup</Eyebrow>
        <h1 className="mt-3 max-w-[720px] text-[36px] font-extrabold leading-[1.04] tracking-[-0.03em] text-white drop-shadow-sm sm:text-[52px]">
          {info.name}
        </h1>
        {info.tagline && (
          <p className="mt-3 max-w-[560px] text-[15.5px] leading-relaxed text-white/85 sm:text-[16px]">
            {info.tagline}
          </p>
        )}

        <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px] text-white/80">
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
            <a
              href={mapsHref}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 underline decoration-white/40 underline-offset-2"
            >
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
    </header>
  );
}

/* ────────────────────────────────────────────────────────────────
   Sticky navigation: search + categories
   ──────────────────────────────────────────────────────────────── */

/**
 * One sticky block, not two. Search and category chips scroll together and pin
 * together, so there's never a moment where a stray element is stuck halfway
 * up the screen — the failure mode of stacking independent stickies.
 *
 * It pins at top-16, below the site bar, which is fixed. The block measures
 * itself and publishes its height as --s-nav-h for section anchors, so a store
 * with a single category (no chip row) doesn't scroll to a phantom offset.
 */
export function StoreNav({
  storeName,
  sections,
  activeId,
  query,
  onQuery,
  onJump,
}: {
  storeName: string;
  sections: Array<{ id: string; name: string }>;
  activeId: string | null;
  query: string;
  onQuery: (q: string) => void;
  onJump: (id: string) => void;
}) {
  const navRef = React.useRef<HTMLDivElement>(null);
  const railRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const write = () => {
      document
        .querySelector<HTMLElement>(".store")
        ?.style.setProperty("--s-nav-h", `${el.offsetHeight + 64}px`);
    };
    write();
    const ro = new ResizeObserver(write);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sections.length]);

  // Keep the active chip in view as sections scroll past.
  React.useEffect(() => {
    if (!activeId || !railRef.current) return;
    const chip = railRef.current.querySelector<HTMLElement>(`[data-chip="${activeId}"]`);
    chip?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [activeId]);

  return (
    <div
      ref={navRef}
      className="sticky top-16 z-30 border-b border-s-line bg-s-bg/92 backdrop-blur-xl"
    >
      <div className={cx(SHELL, "py-3")}>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-s-mute">
            <Icon name="search" size={17} color="currentColor" />
          </span>
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            type="search"
            enterKeyHint="search"
            aria-label={`Search the ${storeName} menu`}
            placeholder={`Search the menu`}
            className="h-12 w-full rounded-full border border-s-line bg-s-raised pl-11 pr-11 text-[15px] text-s-ink outline-none transition placeholder:text-s-mute focus:border-s-accent focus:ring-4 focus:ring-s-accent/15"
          />
          {query && (
            <button
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-s-line/70 text-s-dim transition active:scale-90"
            >
              <Icon name="close" size={13} color="currentColor" strokeWidth={2.4} />
            </button>
          )}
        </div>

        {sections.length > 1 && !query && (
          <nav
            ref={railRef}
            aria-label="Menu sections"
            className="store-rail mt-3 flex gap-2 overflow-x-auto"
          >
            {sections.map((s) => (
              <button
                key={s.id}
                data-chip={s.id}
                onClick={() => onJump(s.id)}
                aria-current={activeId === s.id ? "true" : undefined}
                className={cx(
                  "shrink-0 rounded-full border px-4 py-2 text-[13.5px] font-semibold transition-all duration-200",
                  // The border is on both states so the chip doesn't change
                  // width as it activates and nudge the whole rail sideways.
                  activeId === s.id
                    ? "border-s-accent bg-s-accent text-s-accentInk shadow-[0_2px_10px_-2px_rgb(var(--store-accent)/0.55)]"
                    : "border-s-line text-s-dim hover:bg-s-raised hover:text-s-ink"
                )}
              >
                {s.name}
              </button>
            ))}
          </nav>
        )}
      </div>
    </div>
  );
}

/**
 * Hook: which section is currently under the nav.
 *
 * Deliberately not an IntersectionObserver keyed on intersection ratio. That
 * approach highlights whichever section occupies the most screen, which is not
 * the same question — scroll to the top of a three-item section and a tall
 * neighbour still showing below it wins, so the chip lags a section behind.
 * Worse, a bottom rootMargin means the final section can never take the lead
 * at all, because it's never tall enough to clear the cutoff.
 *
 * So: read positions directly, and take the last section whose top has crossed
 * the nav. That is the definition of "the one you're in". Reads are throttled
 * to one per animation frame, which keeps it cheap on the mid-range Android
 * phones this actually runs on.
 */
export function useScrollSpy(ids: string[]): string | null {
  const [active, setActive] = React.useState<string | null>(ids[0] ?? null);

  React.useEffect(() => {
    if (!ids.length) return;
    let frame = 0;

    const read = () => {
      frame = 0;

      // The nav publishes its own height; the fallback only matters for the
      // first frame, before the ResizeObserver has written it.
      const store = document.querySelector<HTMLElement>(".store");
      const navH =
        parseFloat(
          getComputedStyle(store ?? document.documentElement).getPropertyValue("--s-nav-h")
        ) || 180;
      const line = navH + 16;

      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }

      // At the very bottom, the last section is the one you're looking at even
      // if a short one never pushed its heading past the line.
      const atBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 2;
      if (atBottom) current = ids[ids.length - 1];

      setActive(current);
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };

    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  return active;
}

/* ────────────────────────────────────────────────────────────────
   Section heading
   ──────────────────────────────────────────────────────────────── */

export function SectionHeading({
  eyebrow,
  title,
  count,
}: {
  eyebrow: string;
  title: string;
  count?: number;
}) {
  return (
    <div>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-3 flex items-baseline gap-3 text-[28px] font-extrabold tracking-[-0.025em] sm:text-[34px]">
        {title}
        {count != null && (
          <span className="text-[15px] font-semibold tabular-nums text-s-mute">{count}</span>
        )}
      </h2>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
   Cards
   ──────────────────────────────────────────────────────────────── */

/**
 * An item can skip the detail sheet only if nothing about it is a decision:
 * no group demands a choice. Optional groups fall back to their defaults, the
 * same ones the sheet would have pre-selected, so a quick-add and a two-tap
 * add produce an identical line.
 */
export function canQuickAdd(item: MenuItemDTO): boolean {
  return item.groups.every((g) => g.minSelect === 0);
}

/**
 * Same card as the site's DishGrid — rounded-3xl, hairline border, raised
 * surface, photo-topped, accent add button in the photo's corner. The ordering
 * grid uses it at every breakpoint so the menu you browsed on the landing page
 * and the menu you order from are visibly the same menu.
 */
export function ItemCard({
  item,
  qtyInCart,
  index = 0,
  onOpen,
  onQuickAdd,
}: {
  item: MenuItemDTO;
  qtyInCart: number;
  index?: number;
  onOpen: () => void;
  onQuickAdd?: () => void;
}) {
  const quick = onQuickAdd && canQuickAdd(item) ? onQuickAdd : undefined;

  return (
    <div
      className="store-rise group relative h-full"
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` }}
    >
      <button
        onClick={onOpen}
        className={cx(
          "flex h-full w-full flex-col overflow-hidden rounded-3xl border bg-s-raised text-left transition duration-200",
          "hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.99]",
          qtyInCart > 0 ? "border-s-accent/50" : "border-s-line"
        )}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          <Photo
            src={item.imageUrl || STOCK.dish}
            alt={item.name}
            color={item.color}
            rounded="rounded-none"
            className="h-full w-full transition duration-300 group-hover:scale-105"
          />

          <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1.5">
            {item.featured && (
              <span className="rounded-full bg-black/55 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-white backdrop-blur-md">
                Popular
              </span>
            )}
            {item.listPriceCts != null && (
              <span className="rounded-full bg-[#c2382b] px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-[0.05em] text-white">
                Deal
              </span>
            )}
          </div>

          {qtyInCart > 0 && (
            <span className="store-pop absolute right-2.5 top-2.5 grid h-7 min-w-7 place-items-center rounded-full bg-s-accent px-2 text-[12px] font-bold tabular-nums text-s-accentInk shadow-md">
              {qtyInCart}
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-3.5">
          <h3 className="line-clamp-1 text-[14.5px] font-bold tracking-[-0.01em]">{item.name}</h3>
          {item.description && (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-s-dim">
              {item.description}
            </p>
          )}
          <p className="mt-2 flex items-baseline gap-1.5 pt-0.5 text-[14px] font-bold tabular-nums text-s-accent">
            {money(item.priceCts)}
            {item.listPriceCts != null && (
              <span className="text-[12px] font-normal text-s-mute line-through">
                {money(item.listPriceCts)}
              </span>
            )}
            {item.groups.length > 0 && (
              <span className="text-[11.5px] font-medium text-s-mute">· options</span>
            )}
          </p>
        </div>
      </button>

      {/* Outside the card button so a tap here adds rather than opening the
          sheet. The wrapper mirrors the photo's aspect box exactly, so the
          button pins to the photo's bottom-right corner at any card width
          instead of to a hand-tuned percentage that drifts. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 aspect-[4/3]">
        <AddButton
          onClick={() => (quick ? quick() : onOpen())}
          label={quick ? `Add ${item.name} to order` : `Choose options for ${item.name}`}
          instant={Boolean(quick)}
          className="pointer-events-auto absolute bottom-2.5 right-2.5"
        />
      </div>
    </div>
  );
}

/**
 * The add affordance. Accent-filled, matching the site's dish cards. It flashes
 * a check on its own rather than relying on the cart bar alone — on a tall
 * phone the bar is far from the thumb that just tapped, and an unconfirmed tap
 * gets tapped again.
 */
export function AddButton({
  onClick,
  label,
  instant,
  className,
}: {
  onClick: (e: React.MouseEvent) => void;
  label: string;
  instant?: boolean;
  className?: string;
}) {
  const [hit, setHit] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        onClick(e);
        if (!instant) return;
        if (typeof navigator !== "undefined") navigator.vibrate?.(8);
        setHit(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setHit(false), 700);
      }}
      className={cx(
        "grid h-9 w-9 place-items-center rounded-full bg-s-accent text-s-accentInk shadow-md transition duration-200 active:scale-90 hover:brightness-110",
        className
      )}
    >
      {hit ? (
        <span className="store-pop">
          <Icon name="check" size={17} color="currentColor" strokeWidth={2.8} />
        </span>
      ) : (
        <Icon name="plus" size={17} color="currentColor" strokeWidth={2.4} />
      )}
    </button>
  );
}

/**
 * Horizontal rail of the owner's featured items.
 *
 * This exists because the first screen of a long menu is otherwise whichever
 * category happens to sort first — usually appetizers, rarely what the kitchen
 * is known for. It reuses ItemCard rather than inventing a second card shape,
 * and stays inside the 1120 measure so its cards line up with the heading
 * above them and the grid below.
 */
export function FeaturedRail({
  items,
  qtyByItem,
  onOpen,
  onQuickAdd,
}: {
  items: MenuItemDTO[];
  qtyByItem: Map<string, number>;
  onOpen: (item: MenuItemDTO) => void;
  onQuickAdd?: (item: MenuItemDTO) => void;
}) {
  if (!items.length) return null;

  return (
    <section className="pt-14" aria-label="Popular items">
      <div className={SHELL}>
        <SectionHeading eyebrow="Most ordered" title="Popular right now" />
        <div className="store-rail mt-8 flex snap-x snap-mandatory gap-4 overflow-x-auto pb-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="w-[210px] shrink-0 snap-start sm:w-[240px]"
            >
              <ItemCard
                item={item}
                qtyInCart={qtyByItem.get(item.id) ?? 0}
                onOpen={() => onOpen(item)}
                onQuickAdd={onQuickAdd ? () => onQuickAdd(item) : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export { SHELL };
