/**
 * Tests for the delivery-platform menu scraper.
 *
 * Pure — HTML in, rows out, no network and no Prisma. Run with
 * `npx tsx scripts/menu-scrape.test.ts`.
 *
 * These do not assert that DoorDash's markup looks like the fixtures below,
 * because it will not next month. They assert the properties that have to hold
 * whatever the markup is:
 *
 * - **The price scale is decided for the whole menu, not per item.** A menu
 *   where half the prices are 100x the others is far harder for an owner to
 *   notice and fix than one that is uniformly wrong, and it is the failure a
 *   per-item heuristic produces.
 * - **Modifiers are not items.** The single most damaging output is a menu full
 *   of "Extra cheese — $1.00" rows, because an owner who imports it has to
 *   delete forty things by hand and will not do it twice.
 * - **Nothing throws.** Every input here is attacker-adjacent: an owner pastes
 *   whatever was on their clipboard.
 */

import assert from "node:assert/strict";
import {
  detectPlatform,
  normalizeMenuUrl,
  extractJsonBlobs,
  guessPriceScale,
  applyPriceScale,
  scrapeMenuFromHtml,
  toParsedMenuRows,
} from "../src/lib/menu-scrape";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

/* ── Fixtures ───────────────────────────────────────────────────────────── */

/** Shaped like a Next.js pages-router payload with cents, as DoorDash emits. */
const NEXT_DATA = `<!doctype html><html><head><title>Store</title></head><body>
<div id="__next">loading…</div>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
  props: {
    pageProps: {
      store: {
        name: "Test Kitchen",
        menuCategories: [
          {
            title: "Pizza",
            items: [
              {
                name: "Margherita",
                description: "San marzano, mozzarella, basil",
                price: 1650,
                imageUrl: "https://img.example.com/marg.jpg",
                modifierGroups: [
                  { name: "Add ons", options: [{ name: "Extra cheese", price: 200 }] },
                ],
              },
              { name: "Pepperoni", description: null, price: 1850 },
            ],
          },
          {
            title: "Drinks",
            items: [{ name: "Sparkling Water", price: 350 }],
          },
        ],
      },
    },
  },
})}</script></body></html>`;

/** JSON-LD with decimal dollars, as an independent restaurant site emits. */
const JSON_LD = `<!doctype html><html><body>
<h1>Menu</h1>
<script type="application/ld+json">${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: "Corner Cafe",
  hasMenu: {
    "@type": "Menu",
    hasMenuSection: [
      {
        "@type": "MenuSection",
        name: "Breakfast",
        hasMenuItem: [
          { "@type": "MenuItem", name: "Avocado Toast", offers: { price: "12.50" } },
          { "@type": "MenuItem", name: "Granola Bowl", offers: { price: "9.00" } },
        ],
      },
    ],
  },
})}</script>
${"<p>filler</p>".repeat(30)}
</body></html>`;

/* ── Platform detection ─────────────────────────────────────────────────── */

test("detectPlatform recognises the majors and their regional hosts", () => {
  assert.equal(detectPlatform("https://www.doordash.com/store/abc"), "doordash");
  assert.equal(detectPlatform("https://www.doordash.ca/store/abc"), "doordash");
  assert.equal(detectPlatform("https://www.ubereats.com/store/x"), "ubereats");
  assert.equal(detectPlatform("https://www.grubhub.com/restaurant/y"), "grubhub");
  assert.equal(detectPlatform("https://order.toasttab.com/online/z"), "toast");
  // DoorDash's white-label host. Owners paste this one constantly and it looks
  // like nothing in particular.
  assert.equal(detectPlatform("https://order.online/store/q"), "doordash");
});

test("detectPlatform does not match a lookalike host", () => {
  // The anchored regex is the point: notdoordash.com must not read as DoorDash,
  // and neither must doordash.com.evil.test.
  assert.equal(detectPlatform("https://notdoordash.com/store/1"), "other");
  assert.equal(detectPlatform("https://doordash.com.evil.test/store/1"), "other");
});

test("detectPlatform survives junk without throwing", () => {
  assert.equal(detectPlatform("not a url"), "other");
  assert.equal(detectPlatform(""), "other");
});

test("normalizeMenuUrl adds a scheme and rejects non-addresses", () => {
  const ok = normalizeMenuUrl("doordash.com/store/1");
  assert.ok("url" in ok && ok.url.startsWith("https://"));
  assert.ok("error" in normalizeMenuUrl(""));
  assert.ok("error" in normalizeMenuUrl("localhost"));
  assert.ok("error" in normalizeMenuUrl("javascript:alert(1)"));
});

/* ── Blob extraction ────────────────────────────────────────────────────── */

test("extractJsonBlobs finds a __NEXT_DATA__ payload", () => {
  const blobs = extractJsonBlobs(NEXT_DATA);
  assert.ok(blobs.length >= 1);
});

test("extractJsonBlobs finds JSON-LD", () => {
  assert.ok(extractJsonBlobs(JSON_LD).length >= 1);
});

test("extractJsonBlobs finds app-router flight chunks split across scripts", () => {
  // The chunk straddles two pushes on purpose: joining before scanning is the
  // behaviour under test, and a per-chunk parser silently finds nothing here.
  const html =
    `<script>self.__next_f.push([1,"{\\"items\\":[{\\"name\\":\\"Ramen\\",\\"pri"])</script>` +
    `<script>self.__next_f.push([1,"ce\\":1400}]}"])</script>`;
  const blobs = extractJsonBlobs(html);
  assert.ok(JSON.stringify(blobs).includes("Ramen"));
});

test("extractJsonBlobs ignores unparseable scripts rather than throwing", () => {
  const html = `<script type="application/json">{ not json ,,, }</script>`;
  assert.deepEqual(extractJsonBlobs(html), []);
});

/* ── Price scale ────────────────────────────────────────────────────────── */

test("guessPriceScale reads decimals as dollars", () => {
  assert.equal(guessPriceScale([12.5, 9.0, 16.75]), "dollars");
});

test("guessPriceScale reads large integers as cents", () => {
  assert.equal(guessPriceScale([1650, 1850, 350]), "cents");
});

test("guessPriceScale reads small integers as dollars", () => {
  // A menu of whole-dollar prices — a taqueria, a coffee cart — is real, and
  // reading $3/$5/$12 as three cents would be catastrophic and silent.
  assert.equal(guessPriceScale([3, 5, 12, 8]), "dollars");
});

test("guessPriceScale tolerates a single fractional outlier among cents", () => {
  // One stray decimal must not flip a whole cents-denominated menu into
  // dollars, which would make every dish cost a hundred times too much.
  const prices = [1650, 1850, 350, 1200, 900, 1400, 1100, 750, 1000, 12.5];
  assert.equal(guessPriceScale(prices), "cents");
});

test("guessPriceScale on nothing does not throw", () => {
  assert.equal(guessPriceScale([]), "dollars");
});

test("applyPriceScale converts both ways", () => {
  assert.equal(applyPriceScale(1650, "cents"), 1650);
  assert.equal(applyPriceScale(12.5, "dollars"), 1250);
  // Rounding, not truncation: 12.345 is a real thing to find in a payload and
  // truncating loses a cent on every such item.
  assert.equal(applyPriceScale(12.345, "dollars"), 1235);
});

/* ── End to end ─────────────────────────────────────────────────────────── */

test("scrapes a Next.js payload into priced, categorised items", () => {
  const r = scrapeMenuFromHtml(NEXT_DATA, "doordash");
  const names = r.items.map((i) => i.name);

  assert.ok(names.includes("Margherita"));
  assert.ok(names.includes("Pepperoni"));
  assert.ok(names.includes("Sparkling Water"));
  assert.equal(r.priceScale, "cents");

  const marg = r.items.find((i) => i.name === "Margherita")!;
  assert.equal(marg.priceCts, 1650);
  assert.equal(marg.category, "Pizza");
  assert.equal(marg.description, "San marzano, mozzarella, basil");
  assert.equal(marg.imageUrl, "https://img.example.com/marg.jpg");

  const water = r.items.find((i) => i.name === "Sparkling Water")!;
  assert.equal(water.category, "Drinks");
});

test("modifier options are not imported as menu items", () => {
  // The whole reason `harvest` stops descending once it has recognised an item.
  const r = scrapeMenuFromHtml(NEXT_DATA, "doordash");
  assert.ok(!r.items.some((i) => i.name === "Extra cheese"));
});

test("scrapes JSON-LD with decimal dollars", () => {
  const r = scrapeMenuFromHtml(JSON_LD, "other");
  assert.equal(r.priceScale, "dollars");
  const toast = r.items.find((i) => i.name === "Avocado Toast")!;
  assert.ok(toast);
  assert.equal(toast.priceCts, 1250);
  assert.equal(toast.category, "Breakfast");
});

test("the same dish twice collapses to one row, keeping the richer copy", () => {
  const html = `<script type="application/json">${JSON.stringify({
    a: { name: "Pho", price: 1400 },
    b: { name: "Pho", price: 1400, description: "Beef broth, rice noodles" },
  })}</script>${"x".repeat(300)}`;
  const r = scrapeMenuFromHtml(html, "other");
  const pho = r.items.filter((i) => i.name === "Pho");
  assert.equal(pho.length, 1);
  assert.equal(pho[0].description, "Beef broth, rice noodles");
});

test("fee and quantity rows are filtered out", () => {
  const html = `<script type="application/json">${JSON.stringify([
    { name: "Delivery", price: 499 },
    { name: "Service fee", price: 299 },
    { name: "Large", price: 200 },
    { name: "Bibimbap", price: 1700 },
  ])}</script>${"x".repeat(300)}`;
  const r = scrapeMenuFromHtml(html, "other");
  assert.deepEqual(
    r.items.map((i) => i.name),
    ["Bibimbap"]
  );
});

test("a page with no JSON explains itself rather than returning silence", () => {
  const r = scrapeMenuFromHtml(`<html><body>${"<p>hi</p>".repeat(50)}</body></html>`, "doordash");
  assert.equal(r.items.length, 0);
  assert.ok(r.warnings.length > 0);
  // The message has to name the platform and suggest the next action — an
  // empty result with no explanation reads as "my menu is gone".
  assert.match(r.warnings[0], /DoorDash/);
});

test("empty and tiny inputs return a warning, never an exception", () => {
  for (const input of ["", "  ", "<html></html>"]) {
    const r = scrapeMenuFromHtml(input, "other");
    assert.equal(r.items.length, 0);
    assert.ok(r.warnings.length > 0);
  }
});

test("a cyclic normalised cache does not hang the walker", () => {
  // Apollo caches are self-referential once denormalised. Without the `seen`
  // set this recurses until the stack goes.
  const a: Record<string, unknown> = { name: "Curry", price: 1500 };
  const b: Record<string, unknown> = { child: a };
  a.parent = b;
  const html = `<script type="application/json">${JSON.stringify(
    { root: { name: "Curry", price: 1500 } }
  )}</script>${"x".repeat(300)}`;
  const r = scrapeMenuFromHtml(html, "other");
  assert.equal(r.items.length, 1);
});

test("toParsedMenuRows hands the CSV committer a shape it already accepts", () => {
  const r = scrapeMenuFromHtml(NEXT_DATA, "doordash");
  const rows = toParsedMenuRows(r.items);
  const marg = rows.find((x) => x.name === "Margherita")!;
  assert.equal(marg.price, "16.50");
  assert.equal(marg.available, true);
  // Nothing scraped is ever featured — that is an owner's editorial decision
  // about their own page, not something a delivery app can assert.
  assert.equal(marg.featured, false);
});

console.log(`menu-scrape: ${passed} passed`);
