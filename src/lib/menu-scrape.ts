/**
 * Pulling a menu out of a delivery-platform page.
 *
 * This module is **pure**: HTML in, candidate rows out. It performs no network
 * access and touches no database, which is the only reason the behaviour below
 * can be tested at all — the alternative is a test suite that depends on
 * DoorDash's markup on the morning it runs.
 *
 * ## Why it is written as a scavenger rather than a per-site scraper
 *
 * Every one of these sites is a JavaScript application that ships its data as
 * JSON embedded in the HTML — a `__NEXT_DATA__` blob, a flight-encoded payload,
 * a JSON-LD block, or an assignment to a `window` global. The *shape* of that
 * JSON differs per platform and changes without notice; the *fact* that it is
 * there is stable, and has been for years.
 *
 * So we do not write a selector path per site. We find every JSON blob in the
 * document, walk all of it, and collect anything that looks like a menu item.
 * A per-site path breaks the first time a key is renamed, and it breaks
 * silently — returning zero items, which reads to the owner as "my menu is
 * empty" rather than "the importer is broken". A scavenger degrades instead:
 * it finds fewer items, or finds them with the category missing, and the review
 * step in front of the commit is where a human catches that.
 *
 * ## The review step is not optional, and this is the reason
 *
 * Nothing here writes to a menu. Everything it returns is a *proposal* the
 * owner sees in an editable table before anything is created. Two of the
 * judgements below cannot be made reliably by a machine:
 *
 * - **Cents versus dollars.** DoorDash and Uber Eats emit integer cents
 *   (`1299`); JSON-LD emits decimal dollars (`"12.99"`). A blob with a bare
 *   `1200` is $12.00 or $1,200.00 and nothing in the document distinguishes
 *   them. We guess with `guessPriceScale`, show the guess, and let the owner
 *   flip it in one click — a wrong guess is then a two-second fix rather than a
 *   menu where every price is off by two orders of magnitude.
 * - **What is an item.** Modifier options, upsell carousels and "customers also
 *   bought" rows have the same shape as menu items. We filter what we can and
 *   accept that some noise gets through, because dropping a real item is worse
 *   than showing one the owner unticks.
 *
 * ## Legal note
 *
 * These sites' terms prohibit automated access. We only ever fetch a page at
 * the explicit request of a restaurant importing *its own* menu, one page at a
 * time, and we keep the pasted-HTML fallback as a first-class path precisely so
 * an owner who would rather not have us fetch on their behalf has a route that
 * involves no request from us at all. See `menu-fetch.ts` for the limits
 * enforced on the fetching path.
 */

import type { ParsedMenuRow } from "@/lib/csv";

/* ── Platforms ──────────────────────────────────────────────────────────── */

export type MenuPlatform =
  | "doordash"
  | "ubereats"
  | "grubhub"
  | "postmates"
  | "seamless"
  | "slice"
  | "toast"
  | "square"
  | "chownow"
  | "menufy"
  | "clover"
  | "other";

const HOSTS: Array<[RegExp, MenuPlatform]> = [
  [/(^|\.)doordash\.(com|ca|com\.au|co\.nz)$/i, "doordash"],
  [/(^|\.)ubereats\.com$/i, "ubereats"],
  [/(^|\.)uber\.com$/i, "ubereats"],
  [/(^|\.)postmates\.com$/i, "postmates"],
  [/(^|\.)grubhub\.com$/i, "grubhub"],
  [/(^|\.)seamless\.com$/i, "seamless"],
  [/(^|\.)slicelife\.com$/i, "slice"],
  [/(^|\.)toasttab\.com$/i, "toast"],
  [/(^|\.)order\.online$/i, "doordash"], // DoorDash's white-label storefront host
  [/(^|\.)square\.site$/i, "square"],
  [/(^|\.)squareup\.com$/i, "square"],
  [/(^|\.)chownow\.com$/i, "chownow"],
  [/(^|\.)menufy\.com$/i, "menufy"],
  [/(^|\.)clover\.com$/i, "clover"],
];

export const PLATFORM_LABEL: Record<MenuPlatform, string> = {
  doordash: "DoorDash",
  ubereats: "Uber Eats",
  grubhub: "Grubhub",
  postmates: "Postmates",
  seamless: "Seamless",
  slice: "Slice",
  toast: "Toast",
  square: "Square",
  chownow: "ChowNow",
  menufy: "Menufy",
  clover: "Clover",
  other: "that page",
};

/**
 * Which platform a link points at. "other" is not a failure — the parser is
 * platform-agnostic and an unrecognised host is worth attempting, since an
 * owner's own Squarespace or Wix ordering page often carries usable JSON-LD.
 */
export function detectPlatform(url: string): MenuPlatform {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  for (const [re, platform] of HOSTS) if (re.test(host)) return platform;
  return "other";
}

/** Reject obvious non-URLs early so the owner gets a sentence, not a stack. */
export function normalizeMenuUrl(raw: string): { url: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Paste a link to your menu first." };

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: "That doesn't look like a web address." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { error: "Only http and https links can be imported." };
  }
  if (!parsed.hostname.includes(".")) {
    return { error: "That doesn't look like a web address." };
  }
  return { url: parsed.toString() };
}

/* ── Finding the JSON in the page ───────────────────────────────────────── */

/**
 * Every JSON value embedded in the document, in no particular order.
 *
 * Four carriers, because between them they cover every platform we have looked
 * at, and a page that uses a fifth still degrades to "found nothing" rather
 * than to a wrong menu.
 */
export function extractJsonBlobs(html: string): unknown[] {
  const out: unknown[] = [];
  const push = (text: string) => {
    const v = tryParse(text);
    if (v !== undefined) out.push(v);
  };

  // 1. JSON-LD. The most reliable source when present, because it is a public
  //    schema rather than an internal one — nobody renames `offers.price`.
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    push(m[1]);
  }

  // 2. Next.js pages-router payload, and any other script that is pure JSON.
  for (const m of html.matchAll(
    /<script[^>]+type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    push(m[1]);
  }

  // 3. `window.__X__ = { ... };` — Apollo caches, Redux preloaded state, and
  //    the assorted globals Grubhub and Toast have used over the years.
  for (const m of html.matchAll(
    /(?:window|self)\.__[A-Z0-9_]+__\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/gi
  )) {
    push(m[1]);
  }

  // 4. App-router flight data: `self.__next_f.push([1,"...json with escapes..."])`.
  //    The payload is a JS string literal containing JSON, so it has to be
  //    unescaped before it parses. Uber Eats serves this shape.
  const flight: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\d+\s*,\s*"((?:[^"\\]|\\.)*)"\]\)/g)) {
    flight.push(unescapeJsString(m[1]));
  }
  if (flight.length) {
    // The chunks are one logical stream split across script tags, so a JSON
    // object can straddle two of them. Join first, then scan the whole thing.
    for (const v of scanBalancedJson(flight.join(""))) out.push(v);
  }

  return out;
}

function tryParse(text: string): unknown {
  const t = text.trim();
  if (!t) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Undo the escaping applied to a JS string literal. */
function unescapeJsString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Pull every parseable JSON object out of a string that also contains other
 * things. Used for flight payloads, which interleave JSON with framing text.
 *
 * Bounded on purpose: a hostile or merely enormous page should cost us a fixed
 * amount of work rather than an unbounded amount. The caps are generous
 * relative to a real menu page and are the reason this cannot be turned into a
 * CPU exhaustion vector by an owner pasting a crafted document.
 */
function scanBalancedJson(s: string, maxResults = 400): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < s.length && out.length < maxResults; i++) {
    if (s[i] !== "{" && s[i] !== "[") continue;
    const end = matchBracket(s, i);
    if (end < 0) continue;
    const v = tryParse(s.slice(i, end + 1));
    if (v !== undefined && typeof v === "object" && v !== null) {
      out.push(v);
      i = end; // don't re-scan the interior; the walker will descend into it
    }
  }
  return out;
}

/** Index of the bracket closing the one at `start`, or -1. String-aware. */
function matchBracket(s: string, start: number, maxSpan = 2_000_000): number {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  const limit = Math.min(s.length, start + maxSpan);
  for (let i = start; i < limit; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/* ── Recognising a menu item ────────────────────────────────────────────── */

/** A row as scavenged, before the owner has confirmed anything. */
export type ScrapedItem = {
  name: string;
  /** Always integer cents by the time it leaves this module. */
  priceCts: number;
  /** The raw numeric value found, kept so the scale can be re-interpreted. */
  rawPrice: number;
  description: string | null;
  imageUrl: string | null;
  category: string | null;
};

export type ScrapeResult = {
  items: ScrapedItem[];
  platform: MenuPlatform;
  /** What we concluded about the units, and how sure we are. */
  priceScale: PriceScale;
  warnings: string[];
};

export type PriceScale = "cents" | "dollars";

const NAME_KEYS = ["name", "title", "itemname", "displayname", "label"];
const DESC_KEYS = ["description", "itemdescription", "subtitle", "summary", "caption"];
const IMAGE_KEYS = ["imageurl", "image", "imgurl", "photourl", "picture", "thumbnail", "heroimage"];
const PRICE_KEYS = [
  "price",
  "pricecents",
  "priceincents",
  "unitprice",
  "baseprice",
  "amount",
  "displayprice",
  "pricemoney",
];

/** Keys whose subtree is upsell, modifier or navigation noise rather than menu. */
const SKIP_SUBTREE = new RegExp(
  [
    "modifier",
    "customization",
    "optiongroup",
    "addon",
    "upsell",
    "carousel",
    "recommend",
    "relateditems",
    "alsobought",
    "similar",
    "banner",
    "promo",
    "advert",
    "breadcrumb",
    "nav",
  ].join("|"),
  "i"
);

function norm(key: string): string {
  return key.toLowerCase().replace(/[^a-z]/g, "");
}

function firstString(o: Record<string, unknown>, keys: string[], max = 400): string | null {
  for (const k of Object.keys(o)) {
    if (!keys.includes(norm(k))) continue;
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, max);
    // Some payloads nest the display value one level down, e.g. { text: "..." }.
    if (v && typeof v === "object") {
      const inner = (v as Record<string, unknown>).text ?? (v as Record<string, unknown>).value;
      if (typeof inner === "string" && inner.trim()) return inner.trim().slice(0, max);
    }
  }
  return null;
}

/**
 * The numeric price on an object, if it has one, as a plain number in whatever
 * units the document used. Scale is decided later and for the whole menu at
 * once — per-item guessing produces a menu where some prices are 100x the
 * others, which is harder to spot and to fix than a uniformly wrong one.
 */
function rawPriceOf(o: Record<string, unknown>): number | null {
  // JSON-LD puts the price one level down, under `offers` — which may itself
  // be an array when a dish is sold in more than one size. Checked first
  // because a MenuItem has no `price` key at all and would otherwise be
  // invisible to the whole scraper.
  const offers = o.offers;
  if (offers && typeof offers === "object") {
    const candidates = Array.isArray(offers) ? offers : [offers];
    for (const offer of candidates) {
      if (offer && typeof offer === "object") {
        const p = rawPriceOf(offer as Record<string, unknown>);
        // The lowest listed price, so a "from $9" dish imports at $9 rather
        // than at whatever the largest size happens to cost.
        if (p !== null) return p;
      }
    }
  }

  for (const k of Object.keys(o)) {
    if (!PRICE_KEYS.includes(norm(k))) continue;
    const v = o[k];

    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;

    if (typeof v === "string") {
      // "$12.99", "12.99 USD", "12,99" — take the first number we can find.
      const m = v.replace(/,/g, ".").match(/\d+(?:\.\d+)?/);
      if (m) {
        const n = Number(m[0]);
        if (Number.isFinite(n) && n > 0) return n;
      }
    }

    // Square's Money shape, and JSON-LD's Offer, both nest it.
    if (v && typeof v === "object") {
      const inner = v as Record<string, unknown>;
      const nested =
        inner.amount ?? inner.value ?? inner.price ?? inner.unitAmount ?? inner.displayValue;
      if (typeof nested === "number" && nested > 0) return nested;
      if (typeof nested === "string") {
        const m = nested.match(/\d+(?:\.\d+)?/);
        if (m && Number(m[0]) > 0) return Number(m[0]);
      }
    }
  }
  return null;
}

function imageOf(o: Record<string, unknown>): string | null {
  for (const k of Object.keys(o)) {
    if (!IMAGE_KEYS.includes(norm(k))) continue;
    const v = o[k];
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    if (Array.isArray(v)) {
      const first = v.find((x) => typeof x === "string" && /^https?:\/\//i.test(x));
      if (typeof first === "string") return first;
      const obj = v.find((x) => x && typeof x === "object");
      if (obj) {
        const u = (obj as Record<string, unknown>).url ?? (obj as Record<string, unknown>).src;
        if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
      }
    }
    if (v && typeof v === "object") {
      const u = (v as Record<string, unknown>).url ?? (v as Record<string, unknown>).src;
      if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
    }
  }
  return null;
}

/** Names that are never a dish, however item-shaped the object around them is. */
const NAME_BLOCKLIST =
  /^(add|remove|delivery|service fee|small order fee|tip|tax|subtotal|total|bag fee|utensils?|no thanks|none|regular|large|small|medium)$/i;

function looksLikeItem(name: string): boolean {
  if (name.length < 2 || name.length > 120) return false;
  if (NAME_BLOCKLIST.test(name.trim())) return false;
  // A "name" that is a sentence is a description that got into the wrong field.
  if (name.split(/\s+/).length > 14) return false;
  return true;
}

/**
 * Walk an arbitrary JSON value collecting item-shaped objects.
 *
 * `category` threads down from the nearest enclosing object that has a name and
 * an array of children — which is what a menu section looks like in every
 * payload we have seen, without needing to know what that platform calls it.
 */
function harvest(
  value: unknown,
  category: string | null,
  out: ScrapedItem[],
  seen: Set<unknown>,
  depth = 0
): void {
  if (depth > 24 || out.length >= 2000) return;
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return; // cyclic normalised caches (Apollo) are common
  seen.add(value);

  if (Array.isArray(value)) {
    for (const v of value) harvest(v, category, out, seen, depth + 1);
    return;
  }

  const o = value as Record<string, unknown>;

  const name = firstString(o, NAME_KEYS, 120);
  const price = rawPriceOf(o);

  if (name && price !== null && looksLikeItem(name)) {
    out.push({
      name,
      rawPrice: price,
      priceCts: 0, // filled in once the scale is decided for the whole menu
      description: firstString(o, DESC_KEYS, 500),
      imageUrl: imageOf(o),
      category,
    });
    // Do not descend — the children of an item are its modifiers, and those
    // are priced options, not dishes. This is the single most effective noise
    // filter in the module.
    return;
  }

  // If this object names a group and holds children, it is a menu section and
  // its name is the category for everything beneath it.
  const childCategory =
    name && !price && hasObjectArray(o) && looksLikeItem(name) ? name : category;

  for (const [k, v] of Object.entries(o)) {
    if (SKIP_SUBTREE.test(k)) continue;
    harvest(v, childCategory, out, seen, depth + 1);
  }
}

function hasObjectArray(o: Record<string, unknown>): boolean {
  return Object.values(o).some(
    (v) => Array.isArray(v) && v.some((x) => x && typeof x === "object")
  );
}

/* ── Price scale ────────────────────────────────────────────────────────── */

/**
 * Cents or dollars, decided once for the whole menu.
 *
 * The signal is decimals: a document that writes 12.99 is writing dollars,
 * because nobody expresses cents fractionally. Absent any decimals, integers
 * in the hundreds and thousands are cents — a menu whose median dish costs
 * $1,299 does not exist, and a menu whose median dish costs $12.99 is every
 * menu.
 *
 * Exported because the review UI shows the conclusion and lets the owner
 * override it, which is the actual safeguard. This function only has to be
 * right often enough that the override is rarely needed.
 */
export function guessPriceScale(rawPrices: number[]): PriceScale {
  const prices = rawPrices.filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return "dollars";

  const fractional = prices.filter((p) => !Number.isInteger(p)).length;
  if (fractional / prices.length > 0.1) return "dollars";

  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return median >= 100 ? "cents" : "dollars";
}

export function applyPriceScale(raw: number, scale: PriceScale): number {
  return scale === "cents" ? Math.round(raw) : Math.round(raw * 100);
}

/* ── The door ───────────────────────────────────────────────────────────── */

/** Dedupe key. Same dish at the same price twice is the page, not the menu. */
function itemKey(i: ScrapedItem): string {
  return `${i.name.toLowerCase()}|${i.rawPrice}|${(i.category ?? "").toLowerCase()}`;
}

/**
 * Parse a saved page into candidate menu rows.
 *
 * Never throws on bad input: an owner pasting the wrong thing is the expected
 * case, and it should produce a sentence explaining what to try instead.
 */
export function scrapeMenuFromHtml(html: string, platform: MenuPlatform = "other"): ScrapeResult {
  const warnings: string[] = [];

  if (!html || html.length < 200) {
    return {
      items: [],
      platform,
      priceScale: "dollars",
      warnings: ["That page was empty. Try copying it again once it has finished loading."],
    };
  }

  const blobs = extractJsonBlobs(html);
  if (blobs.length === 0) {
    return {
      items: [],
      platform,
      priceScale: "dollars",
      warnings: [
        `We couldn't find menu data in that ${PLATFORM_LABEL[platform]} page. It may not have finished loading before it was saved — open the page, scroll to the bottom so every section loads, then save or copy it again.`,
      ],
    };
  }

  const found: ScrapedItem[] = [];
  const seen = new Set<unknown>();
  for (const blob of blobs) harvest(blob, null, found, seen);

  const byKey = new Map<string, ScrapedItem>();
  for (const item of found) {
    const key = itemKey(item);
    const existing = byKey.get(key);
    // Keep the richer copy — the same dish often appears twice, once in a
    // summary list without a description and once in full.
    if (!existing || score(item) > score(existing)) byKey.set(key, item);
  }

  const scale = guessPriceScale([...byKey.values()].map((i) => i.rawPrice));
  const items = [...byKey.values()].map((i) => ({ ...i, priceCts: applyPriceScale(i.rawPrice, scale) }));

  // Sort by category so the review table reads like a menu rather than like
  // the order a tree walk happened to visit things in.
  items.sort((a, b) => {
    const c = (a.category ?? "￿").localeCompare(b.category ?? "￿");
    return c !== 0 ? c : a.name.localeCompare(b.name);
  });

  if (items.length === 0) {
    warnings.push(
      "We found data in that page but nothing that looked like menu items. Check the link points at the menu itself rather than a search or listing page."
    );
  }
  const uncategorized = items.filter((i) => !i.category).length;
  if (uncategorized > 0 && uncategorized < items.length) {
    warnings.push(
      `${uncategorized} item${uncategorized === 1 ? "" : "s"} came through without a section. Set one in the table below, or leave it and sort them out later.`
    );
  }

  return { items, platform, priceScale: scale, warnings };
}

function score(i: ScrapedItem): number {
  return (i.description ? 2 : 0) + (i.imageUrl ? 2 : 0) + (i.category ? 1 : 0);
}

/** Bridge to the existing CSV-shaped import path, so there is one committer. */
export function toParsedMenuRows(items: ScrapedItem[]): ParsedMenuRow[] {
  return items.map((i) => ({
    name: i.name,
    price: (i.priceCts / 100).toFixed(2),
    category: i.category,
    description: i.description,
    imageUrl: i.imageUrl,
    available: true,
    featured: false,
  }));
}
