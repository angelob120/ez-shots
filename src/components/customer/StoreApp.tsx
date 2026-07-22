"use client";

import * as React from "react";
import {
  FeaturedRail,
  ItemCard,
  SHELL,
  SectionHeading,
  SiteBar,
  StoreBanner,
  StoreNav,
  canQuickAdd,
  useScrollSpy,
  type StoreAvailability,
  type StoreInfo,
} from "./Menu";
import { cx } from "./primitives";
import Icon from "./Icon";
import ItemSheet from "./ItemSheet";
import { CartBar, CartSheet, CheckoutSheet, Confirmation } from "./Cart";
import { StoreLanding } from "./StoreLanding";
import { storeRootProps } from "./theme";
import { mergeDraft, usePreviewDraft } from "./usePreviewDraft";
import {
  defaultSelection,
  lineKey,
  unitPriceCts,
  type CartLine,
  type MenuItemDTO,
} from "@/lib/cart";
import type { SiteContent } from "@/lib/site-content";
import { placeOrderAction, type PlacedOrder } from "@/app/r/[slug]/actions";
import { useStripeCard } from "./useStripeCard";
import { useDebouncedSearchTracking, useTracker } from "./useTracker";

export type { MenuItemDTO } from "@/lib/cart";

export type RestaurantDTO = StoreInfo & {
  slug: string;
  accentColor: string;
  surchargeLabel: string;
  surchargePct: number;
  surchargeMinCts: number;
  surchargeMaxCts: number;
  taxPct: number;
  // Website customization
  heroHeadline: string | null;
  heroCtaLabel: string | null;
  aboutTitle: string | null;
  aboutBody: string | null;
  galleryUrls: string[];
  showAbout: boolean;
  showGallery: boolean;
  theme: "LIGHT" | "DARK" | "SYSTEM";
  /** Which look the site wears. See src/lib/store-theme.ts. */
  themePreset: string;
  content: SiteContent;
  /**
   * Card collection config for checkout. `cardEnabled` is false whenever the
   * server is on the stub or the test-card path (no publishable key), in which
   * case checkout collects no card and the charge is handled server-side.
   */
  payments: { cardEnabled: boolean; publishableKey: string | null; stripeAccount: string | null };
  /**
   * Absolute origin for our own policy pages, e.g. "https://ezorders.app".
   *
   * Absolute rather than a bare "/legal/terms" because this page is frequently
   * served on the tenant's own domain, where that path does not exist — the
   * host rewrite sends everything to `/r/[slug]`. Policies are ours, so they
   * live at `platformOrigin()`, which is exactly the distinction
   * `lib/domains.ts` draws between the three origins.
   */
  legalBase: string;
  /**
   * Which sign-in providers this deployment offers, and who is signed in.
   *
   * An account here is a convenience — past orders, a prefilled name — and
   * nothing more. It is not a `Customer`, carries no phone number, and grants
   * no messaging consent: that has one door, the checkbox at checkout.
   */
  signIn: {
    /**
     * Every provider worth drawing, with whether it can actually be used.
     * A `configured: false` entry renders inert — see `OAUTH_PREVIEW_BUTTONS`
     * in `lib/oauth.ts`, and turn it off before real diners arrive.
     */
    providers: Array<{ provider: "google" | "apple"; configured: boolean }>;
    account: { name: string | null; email: string | null } | null;
  };
};

const CART_KEY = (slug: string) => `hearth.cart.${slug}`;

/**
 * Policy links in the storefront footer.
 *
 * The labels are written out rather than derived from `LEGAL_DOCS`, on purpose:
 * this is a client component, and importing the registry would pull the full
 * text of ten policy documents into the storefront's JavaScript bundle — on the
 * page whose load time decides whether a hungry stranger orders at all.
 *
 * Refunds is included because it is the one a customer needs at the exact
 * moment they are angry, and the merchant agreement is not, because a diner is
 * not a merchant.
 */
const STOREFRONT_POLICIES: Array<[string, string]> = [
  ["Terms", "terms"],
  ["Privacy", "privacy"],
  ["Refunds", "refunds"],
  ["Texts", "messaging"],
];

/**
 * Sign in / signed-in state, in the footer rather than the header.
 *
 * Deliberately unobtrusive. A storefront that opens with a sign-in wall loses
 * the order — the whole design of this product is that a stranger can go from
 * link to paid order without an account, and an account is something they may
 * optionally pick up on the way past. Everything above this line works signed
 * out.
 *
 * Links are absolute to the platform origin because these pages are frequently
 * served on the tenant's own domain, where /api/auth/* does not resolve.
 */
function StorefrontAccount({
  base,
  slug,
  signIn,
}: {
  base: string;
  slug: string;
  signIn: RestaurantDTO["signIn"];
}) {
  if (signIn.providers.length === 0) return null;

  if (signIn.account) {
    return (
      <form
        method="POST"
        action={`${base}/api/auth/signout`}
        className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-s-mute"
      >
        <input type="hidden" name="next" value={`/r/${slug}`} />
        <a
          href={`/r/${slug}/account`}
          className="underline underline-offset-2 hover:opacity-70"
        >
          Your orders
        </a>
        <span aria-hidden>·</span>
        <span>{signIn.account.name || signIn.account.email}</span>
        <span aria-hidden>·</span>
        <button type="submit" className="underline underline-offset-2 hover:opacity-70">
          Sign out
        </button>
      </form>
    );
  }

  return (
    <p className="mt-3 flex flex-wrap items-center justify-center gap-2 text-[12px] text-s-mute">
      <span>See your past orders:</span>
      {signIn.providers.map(({ provider, configured }) => {
        const label = provider === "google" ? "Google" : "Apple";
        // An unconfigured provider is shown but not clickable. A live link
        // would bounce off the start route and leave a diner on an error page,
        // which is a worse outcome than a greyed-out word.
        return configured ? (
          <a
            key={provider}
            href={`${base}/api/auth/${provider}/start?as=customer&slug=${encodeURIComponent(slug)}`}
            className="underline underline-offset-2 hover:opacity-70"
          >
            Sign in with {label}
          </a>
        ) : (
          <span key={provider} className="opacity-40" title="Not set up yet">
            Sign in with {label}
          </span>
        );
      })}
    </p>
  );
}

function StorefrontLegalLinks({ base }: { base: string }) {
  return (
    <p className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-s-mute">
      {STOREFRONT_POLICIES.map(([label, slug], i) => (
        <span key={slug} className="flex items-center gap-3">
          {i > 0 && <span aria-hidden>&middot;</span>}
          <a
            href={`${base}/legal/${slug}`}
            className="underline underline-offset-2 transition-opacity hover:opacity-70"
          >
            {label}
          </a>
        </span>
      ))}
    </p>
  );
}

/** Shared shape for "nothing here" — an unpublished menu and a dead search. */
function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-14 rounded-3xl border border-s-line bg-s-raised px-6 py-16 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-s-bg text-s-mute">
        <Icon name="search" size={24} color="currentColor" />
      </div>
      <p className="mt-5 text-[16px] font-semibold">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[360px] text-[13.5px] leading-relaxed text-s-dim">
        {body}
      </p>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-6 inline-flex h-12 items-center rounded-full border border-s-line px-6 text-[14px] font-semibold transition hover:bg-s-bg active:scale-[0.98]"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

/**
 * "You can't order right now", said at the top of the menu rather than at the
 * end of checkout.
 *
 * The information was always available — `checkAvailability` just wasn't asked
 * until the order was submitted, so a customer could browse, build a cart and
 * type in their phone number before being told the kitchen shut an hour ago.
 * Browsing is still allowed: seeing the menu of a closed restaurant is useful,
 * and the reopening time is right here.
 */
function ClosedNotice({
  availability,
  phone,
}: {
  availability: StoreAvailability;
  phone: string | null;
}) {
  if (availability.ok) return null;

  return (
    <div className={cx(SHELL, "pt-6")}>
      <div className="rounded-3xl border border-s-line bg-s-raised px-5 py-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-2xl bg-s-accent/12 text-s-accent">
            <Icon name="clock" size={18} color="currentColor" />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold leading-snug">
              Not taking orders right now
            </p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-s-dim">
              {availability.message}
              {availability.reopens && ` Back ${availability.reopens}.`}
            </p>
            {phone && (
              <a
                href={`tel:${phone}`}
                className="mt-2 inline-flex text-[13.5px] font-semibold text-s-accent"
              >
                Call {phone}
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type View = "landing" | "menu" | "cart" | "checkout";

/**
 * The ordering surface.
 *
 * State lives here; everything below is presentational. The cart is the only
 * thing that persists, and it persists as ids and quantities only — prices are
 * re-derived from the menu on load and re-derived again on the server at
 * checkout, so a stale localStorage entry can never set a price.
 */
export default function StoreApp({
  restaurant: saved,
  categories,
  items,
}: {
  restaurant: RestaurantDTO;
  categories: Array<{ id: string; name: string }>;
  items: MenuItemDTO[];
}) {
  // Branding preview. Inert unless this page is `?preview=1` inside the
  // editor's iframe — see components/customer/usePreviewDraft.ts. On the live
  // storefront `draft` is always null and `restaurant` is `saved` unchanged.
  const { isPreview, draft } = usePreviewDraft();
  const restaurant = React.useMemo(() => mergeDraft(saved, draft), [saved, draft]);
  const [lines, setLines] = React.useState<CartLine[]>([]);
  // Open on the store's front door, not cold on the menu. A returning customer
  // with a cart already in progress is sent straight past it (see cart-load).
  const [view, setView] = React.useState<View>("landing");
  const [openItem, setOpenItem] = React.useState<{
    item: MenuItemDTO;
    editingKey?: string;
    returnTo?: View;
  } | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [placed, setPlaced] = React.useState<PlacedOrder | null>(null);
  const [query, setQuery] = React.useState("");
  const card = useStripeCard(restaurant.payments);

  // Instrumentation. Everything below that calls `track` is fire-and-forget by
  // construction — see useTracker for why nothing here can fail an order.
  // An owner redecorating their site is not a visit, and the editor reloads the
  // frame on every theme change. Left on, a fifteen-minute session in the
  // branding editor would be dozens of visits and a wrecked conversion rate on
  // the owner's own analytics page — a number they'd then ask us to explain.
  // `Visit.simulated` exists for the same reason, one layer down.
  const tracker = useTracker(restaurant.slug, !isPreview);
  // Cart value at the moment a screen is entered. A ref rather than a
  // dependency so the view-change effect doesn't re-fire every time somebody
  // bumps a quantity — that would report one visit as reaching checkout nine
  // times.
  const totalsRef = React.useRef(0);

  const itemsById = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Group items into the sections the rail navigates.
  const allSections = React.useMemo(() => {
    const byCat = categories
      .map((c) => ({ id: c.id, name: c.name, items: items.filter((i) => i.categoryId === c.id) }))
      .filter((s) => s.items.length > 0);
    const uncategorized = items.filter((i) => !i.categoryId || !categories.some((c) => c.id === i.categoryId));
    if (uncategorized.length) {
      byCat.push({ id: "more", name: byCat.length ? "More" : "Menu", items: uncategorized });
    }
    return byCat;
  }, [categories, items]);

  // ── Search ──────────────────────────────────────────────────────────
  // Matches name and description, because half of what people search for is
  // an ingredient ("peanut", "gluten") that only ever appears in the blurb.
  // Sections that end up empty drop out entirely rather than rendering a
  // header over nothing.
  const q = query.trim().toLowerCase();
  const sections = React.useMemo(() => {
    if (!q) return allSections;
    const hit = (i: MenuItemDTO) =>
      i.name.toLowerCase().includes(q) || (i.description ?? "").toLowerCase().includes(q);
    return allSections
      .map((s) => ({ ...s, items: s.items.filter(hit) }))
      .filter((s) => s.items.length > 0);
  }, [allSections, q]);

  const resultCount = React.useMemo(
    () => sections.reduce((n, s) => n + s.items.length, 0),
    [sections]
  );

  const activeSection = useScrollSpy(sections.map((s) => s.id));

  // Menu preview for the landing screen: whatever the owner flagged featured,
  // topped up with the first items so the rail is never sparse.
  const highlights = React.useMemo(() => {
    const featured = items.filter((i) => i.featured);
    const seen = new Set(featured.map((i) => i.id));
    const filler = items.filter((i) => !seen.has(i.id));
    return [...featured, ...filler].slice(0, 8);
  }, [items]);

  // The in-menu carousel is stricter than the landing preview: only what the
  // owner actually flagged. Padding it with filler would turn "Popular right
  // now" into a lie, and it's directly above the real menu anyway.
  const featuredItems = React.useMemo(
    () => items.filter((i) => i.featured).slice(0, 10),
    [items]
  );

  // ── Cart persistence ────────────────────────────────────────────────
  // A customer taps through from Maps, gets distracted, comes back. Losing
  // the cart at that moment loses the order.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY(restaurant.slug));
      if (!raw) return;
      const saved: Array<Omit<CartLine, "key">> = JSON.parse(raw);
      const restored = saved
        .filter((l) => itemsById.has(l.itemId))
        .map((l) => ({
          ...l,
          notes: l.notes ?? "",
          optionIds: l.optionIds ?? [],
          key: lineKey(l.itemId, l.optionIds ?? [], l.notes ?? ""),
        }));
      setLines(restored);
      // Mid-order return: don't make them walk through the front door again.
      if (restored.length) setView("menu");
    } catch {
      /* a corrupt cart is not worth breaking the page over */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  React.useEffect(() => {
    try {
      localStorage.setItem(
        CART_KEY(restaurant.slug),
        JSON.stringify(
          lines.map(({ itemId, qty, optionIds, notes }) => ({ itemId, qty, optionIds, notes }))
        )
      );
    } catch {
      /* private mode, quota — neither should break ordering */
    }
  }, [lines, restaurant.slug]);

  // ── Instrumentation ─────────────────────────────────────────────────
  // Derived from the state the storefront already keeps rather than bolted
  // onto every handler: a tracking call inside `setView` would be forgotten
  // the first time somebody added a new way to reach the cart, and a funnel
  // with a silently missing step is worse than no funnel.
  React.useEffect(() => {
    // Landing is already covered by the tracker's own PAGE_VIEW on mount, and
    // emitting VIEW_CHANGE for it as well would be worse than redundant:
    // `milestonesFrom` reads VIEW_CHANGE as "browsed the menu", so every visit
    // — including the ones that bounce off the front door in three seconds —
    // would mark the funnel's second step on arrival, and the step would read
    // 100% forever.
    if (view === "landing") return;

    if (view === "cart") tracker.track("CART_VIEW", { view });
    else if (view === "checkout") tracker.track("CHECKOUT_START", { view, valueCts: totalsRef.current });
    else tracker.track("VIEW_CHANGE", { view });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  React.useEffect(() => {
    // An edit re-opens the same sheet on an item already in the cart; counting
    // it as a fresh look would inflate the view-to-add ratio for exactly the
    // items people fiddle with most.
    if (openItem && !openItem.editingKey) {
      tracker.track("ITEM_VIEW", { itemId: openItem.item.id, view: "item" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openItem?.item.id, openItem?.editingKey]);

  useDebouncedSearchTracking(query, (term) => tracker.track("SEARCH", { view: "menu", label: term }));

  // ── Totals ──────────────────────────────────────────────────────────
  const totals = React.useMemo(() => {
    const subtotalCts = lines.reduce((sum, l) => {
      const item = itemsById.get(l.itemId);
      return item ? sum + unitPriceCts(item, l.optionIds) * l.qty : sum;
    }, 0);

    const raw = Math.round(subtotalCts * restaurant.surchargePct);
    const surchargeCts =
      subtotalCts <= 0
        ? 0
        : Math.min(restaurant.surchargeMaxCts, Math.max(restaurant.surchargeMinCts, raw));
    const taxCts = Math.round(subtotalCts * restaurant.taxPct);

    return { subtotalCts, surchargeCts, taxCts, totalCts: subtotalCts + surchargeCts + taxCts };
  }, [lines, itemsById, restaurant]);

  totalsRef.current = totals.totalCts;

  const count = lines.reduce((a, l) => a + l.qty, 0);

  const qtyByItem = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const l of lines) m.set(l.itemId, (m.get(l.itemId) ?? 0) + l.qty);
    return m;
  }, [lines]);

  // ── Cart operations ─────────────────────────────────────────────────
  function commitItem(v: { qty: number; optionIds: string[]; notes: string }) {
    if (!openItem) return;
    const { item, editingKey } = openItem;
    const key = lineKey(item.id, v.optionIds, v.notes);

    setLines((prev) => {
      // Editing: drop the old line, then fall through to the merge below so
      // an edit that matches an existing line combines instead of duplicating.
      const base = editingKey ? prev.filter((l) => l.key !== editingKey) : prev;
      const existing = base.findIndex((l) => l.key === key);
      if (existing !== -1) {
        const next = [...base];
        next[existing] = { ...next[existing], qty: Math.min(50, next[existing].qty + v.qty) };
        return next;
      }
      return [...base, { key, itemId: item.id, qty: v.qty, optionIds: v.optionIds, notes: v.notes }];
    });

    // Only a genuine add counts. An edit is a customer adjusting something
    // they'd already chosen, and counting it would make fiddly items look like
    // the best converters on the menu.
    if (!editingKey) {
      tracker.track("ITEM_ADD", {
        itemId: item.id,
        view: "item",
        valueCts: unitPriceCts(item, v.optionIds) * v.qty,
      });
    }

    // An edit that began in the cart lands you back in the cart, not adrift on
    // the menu wondering whether the change took.
    const returnTo = openItem.returnTo;
    setOpenItem(null);
    if (returnTo) setView(returnTo);
  }

  /**
   * One-tap add, for items where no group requires a choice.
   *
   * It reuses defaultSelection — the exact selection the sheet would have
   * pre-checked — so the resulting line is byte-identical to one added the
   * long way and merges with it instead of sitting beside it as a near
   * duplicate. Guarded by canQuickAdd so an item with a required group can
   * never slip through without its choices.
   */
  function quickAdd(item: MenuItemDTO) {
    if (!canQuickAdd(item)) {
      setOpenItem({ item });
      return;
    }
    const optionIds = defaultSelection(item);
    const key = lineKey(item.id, optionIds, "");
    setLines((prev) => {
      const existing = prev.findIndex((l) => l.key === key);
      if (existing !== -1) {
        const next = [...prev];
        next[existing] = { ...next[existing], qty: Math.min(50, next[existing].qty + 1) };
        return next;
      }
      return [...prev, { key, itemId: item.id, qty: 1, optionIds, notes: "" }];
    });

    // Tracked as the same kind as a sheet add. The funnel's question is
    // "did this item make it into a cart", and the route it took to get there
    // is the storefront's business, not the analytics'.
    tracker.track("ITEM_ADD", {
      itemId: item.id,
      view: "menu",
      valueCts: unitPriceCts(item, optionIds),
    });
  }

  function setQty(key: string, qty: number) {
    if (qty <= 0) {
      const gone = lines.find((l) => l.key === key);
      // Removals are the other half of the cart story: an item added and then
      // taken back out is a different signal from one never added, and it's
      // usually a price reaction visible nowhere else.
      if (gone) tracker.track("ITEM_REMOVE", { itemId: gone.itemId, view });
    }
    setLines((prev) =>
      qty <= 0 ? prev.filter((l) => l.key !== key) : prev.map((l) => (l.key === key ? { ...l, qty } : l))
    );
  }

  function restoreLine(line: CartLine, index: number) {
    setLines((prev) => {
      if (prev.some((l) => l.key === line.key)) return prev; // already back
      const next = [...prev];
      next.splice(Math.min(index, next.length), 0, line);
      return next;
    });
  }

  function editLine(key: string, returnTo?: View) {
    const line = lines.find((l) => l.key === key);
    const item = line && itemsById.get(line.itemId);
    if (!line || !item) return;
    setOpenItem({ item, editingKey: key, returnTo });
  }

  async function submitOrder(v: { name: string; phone: string; optIn: boolean; notes: string }) {
    // Preview is a rehearsal, and checkout is the one control on this page that
    // isn't reversible: it takes a real card, writes a real Order and texts a
    // real kitchen. An owner clicking through their own preview to see what the
    // button looks like must not put a ticket on their own board.
    if (isPreview) {
      setError("This is a preview of your website. Orders can't be placed here.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const base = {
        slug: restaurant.slug,
        lines: lines.map((l) => ({
          itemId: l.itemId,
          qty: l.qty,
          optionIds: l.optionIds,
          notes: l.notes,
        })),
        phone: v.phone,
        name: v.name || undefined,
        optIn: v.optIn,
        notes: v.notes || undefined,
        // Attribution rides along with the order rather than being inferred
        // server-side from a cookie: the visit and the order are written in the
        // same request that way, so there's no window in which an order exists
        // with no traffic behind it.
        anonId: tracker.anonId,
      };

      // Tokenize the card in the browser first, if we're collecting one. The
      // number never reaches our server — only the resulting pm_... id does.
      let paymentMethodId: string | undefined;
      if (card.ready) {
        try {
          paymentMethodId = await card.createPaymentMethod();
        } catch (e) {
          setError(e instanceof Error ? e.message : "That card couldn't be read.");
          return;
        }
      }

      let res = await placeOrderAction({ ...base, paymentMethodId });

      // The card asked for 3-D Secure. Run the challenge in the browser, then
      // place the order again against the same intent — the second pass
      // finalizes it rather than charging afresh, so there's no double charge
      // and nothing was written on the first pass to unwind.
      if (!res.ok && "requiresAction" in res && res.requiresAction) {
        try {
          const cleared = await card.confirmChallenge(res.clientSecret);
          if (!cleared) {
            setError("Card authentication didn't complete. Nothing was charged - try again.");
            return;
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Card authentication failed.");
          return;
        }
        res = await placeOrderAction({ ...base, paymentIntentId: res.paymentIntentId });
      }

      if (!res.ok) {
        if ("requiresAction" in res) {
          setError("Card authentication didn't complete. Nothing was charged - try again.");
          return;
        }
        // Recorded before the message is shown, and coarse on purpose — the
        // server's own words could name a card or a customer, and neither
        // belongs in a table an owner browses. What's useful here is the shape
        // of the failure, which is what makes a run of them diagnosable.
        tracker.track("CHECKOUT_ERROR", { view: "checkout", label: res.reopens ? "closed" : "declined" });

        // "We're closed" is only half an answer. Telling them when you're
        // open again is the difference between a lost order and a later one.
        setError(res.reopens ? `${res.error} We're open again ${res.reopens}.` : res.error);
        return;
      }

      // The ORDER_PLACED event itself is written server-side by
      // `attachOrderToVisit`, not here. A conversion the browser could claim on
      // its own is a conversion rate anyone can inflate.
      tracker.flush();

      setPlaced(res.order);
      setLines([]);
      setView("menu");
    } catch {
      tracker.track("CHECKOUT_ERROR", { view: "checkout", label: "network" });
      setError("Something went wrong sending your order. Nothing was charged - try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const editingLine = openItem?.editingKey ? lines.find((l) => l.key === openItem.editingKey) : null;

  // ── Render ──────────────────────────────────────────────────────────
  if (placed) {
    return (
      <div className="store" {...storeRootProps(restaurant)}>
        <Confirmation order={placed} info={restaurant} onDone={() => setPlaced(null)} />
      </div>
    );
  }

  if (view === "landing") {
    return (
      <div className="store" {...storeRootProps(restaurant)}>
        <StoreLanding
          info={restaurant}
          itemCount={items.length}
          categoryCount={allSections.length}
          highlights={highlights}
          site={{
            heroHeadline: restaurant.heroHeadline,
            heroCtaLabel: restaurant.heroCtaLabel,
            aboutTitle: restaurant.aboutTitle,
            aboutBody: restaurant.aboutBody,
            galleryUrls: restaurant.galleryUrls,
            showAbout: restaurant.showAbout,
            showGallery: restaurant.showGallery,
          }}
          content={restaurant.content}
          onStart={() => setView("menu")}
          onOpenItem={(item) => {
            setView("menu");
            setOpenItem({ item });
          }}
        />
      </div>
    );
  }

  return (
    <div className="store pb-28" {...storeRootProps(restaurant)}>
      <SiteBar info={restaurant} onBack={() => setView("landing")} />

      <StoreBanner info={restaurant} />

      <ClosedNotice availability={restaurant.availability} phone={restaurant.phone} />

      <StoreNav
        storeName={restaurant.name}
        sections={sections.map((s) => ({ id: s.id, name: s.name }))}
        activeId={activeSection}
        query={query}
        onQuery={setQuery}
        onJump={(id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" })}
      />

      {!q && (
        <FeaturedRail
          items={featuredItems}
          qtyByItem={qtyByItem}
          onOpen={(item) => setOpenItem({ item })}
          onQuickAdd={quickAdd}
        />
      )}

      <main className={SHELL}>
        {allSections.length === 0 ? (
          <EmptyState
            title="This menu isn't up yet"
            body={
              restaurant.phone
                ? `Give them a call at ${restaurant.phone} to order.`
                : "Check back shortly."
            }
          />
        ) : sections.length === 0 ? (
          <EmptyState
            title={`No matches for "${query.trim()}"`}
            body="Try a shorter word, or browse the full menu."
            action={{ label: "Clear search", onClick: () => setQuery("") }}
          />
        ) : (
          sections.map((s, si) => (
            <section key={s.id} id={s.id} className="store-section pt-14">
              <SectionHeading
                eyebrow={
                  q ? `${resultCount} ${resultCount === 1 ? "result" : "results"}` : si === 0 ? "The menu" : "Keep going"
                }
                title={s.name}
                count={s.items.length}
              />
              <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {s.items.map((item, i) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    index={i}
                    qtyInCart={qtyByItem.get(item.id) ?? 0}
                    onOpen={() => setOpenItem({ item })}
                    onQuickAdd={() => quickAdd(item)}
                  />
                ))}
              </div>
            </section>
          ))
        )}
      </main>

      <footer className="mt-20 border-t border-s-line bg-s-accent/[0.07]">
        <div className={SHELL}>
          <div className="py-10 text-center">
            <p className="text-[12.5px] leading-relaxed text-s-mute">
              Pickup orders only. A {restaurant.surchargeLabel.toLowerCase()} is added at checkout
              and shown before you pay.
            </p>
            <StorefrontAccount
              base={restaurant.legalBase}
              slug={restaurant.slug}
              signIn={restaurant.signIn}
            />
            <StorefrontLegalLinks base={restaurant.legalBase} />
          </div>
        </div>
      </footer>

      <CartBar
        count={count}
        totalCts={totals.totalCts}
        onOpen={() => setView("cart")}
        disabledReason={
          restaurant.availability.ok
            ? null
            : restaurant.availability.reopens
              ? `Closed — opens ${restaurant.availability.reopens}`
              : "Not taking orders right now"
        }
      />

      <ItemSheet
        item={openItem?.item ?? null}
        initial={
          editingLine
            ? { qty: editingLine.qty, optionIds: editingLine.optionIds, notes: editingLine.notes }
            : null
        }
        recommendations={
          openItem
            ? openItem.item.recommendedIds
                .map((id) => itemsById.get(id))
                .filter((i): i is MenuItemDTO => Boolean(i))
                .slice(0, 6)
            : []
        }
        onPick={(item) => setOpenItem({ item })}
        onClose={() => setOpenItem(null)}
        onSubmit={commitItem}
      />

      <CartSheet
        open={view === "cart"}
        onClose={() => setView("menu")}
        lines={lines}
        itemsById={itemsById}
        totals={totals}
        surchargeLabel={restaurant.surchargeLabel}
        onQty={setQty}
        onEdit={(key) => {
          setView("menu");
          editLine(key, "cart");
        }}
        onRemove={(key) => setQty(key, 0)}
        onRestore={restoreLine}
        onCheckout={() => setView("checkout")}
      />

      <CheckoutSheet
        open={view === "checkout"}
        onBack={() => setView("cart")}
        onClose={() => setView("menu")}
        lineCount={count}
        totals={totals}
        surchargeLabel={restaurant.surchargeLabel}
        submitting={submitting}
        error={error}
        onSubmit={submitOrder}
        card={{ enabled: card.ready, mounted: card.mounted, error: card.error, CardMount: card.CardMount }}
        prefillName={restaurant.signIn.account?.name ?? null}
      />
    </div>
  );
}
