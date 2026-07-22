/**
 * Tests for the owner help centre.
 *
 * Run with `npx tsx scripts/help-articles.test.ts`. Pure — no Prisma, no
 * network, because the whole module is content plus a substring search.
 *
 * Two things are being defended, and neither is "does search work".
 *
 * **A help centre fails silently.** Every failure mode here looks like a
 * working page: a duplicate slug renders one article and hides another, a
 * broken related-link 404s an owner who was already having a bad day, and a
 * search that finds nothing for "refund" looks exactly like a product with no
 * refunds. Nobody files a ticket saying "your help search is bad" — they file
 * the ticket the article was supposed to prevent, and the article looks fine
 * when you go and read it.
 *
 * **The searches asserted below are the real ones.** They are the words owners
 * type, not the words we used in the headings — which is the entire reason
 * `keywords` exists. "money back" and "where's my money" have to work, and
 * neither phrase appears in a title.
 */

import assert from "node:assert/strict";
import {
  HELP_ARTICLES,
  HELP_CATEGORY_LABELS,
  articleToText,
  articlesByCategory,
  helpArticle,
  helpPath,
  searchArticles,
} from "../src/lib/help-articles";

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

/* ── Registry integrity ─────────────────────────────────────────────────── */

test("slugs are unique", () => {
  // A duplicate does not throw. `helpArticle` returns the first match and the
  // second article becomes unreachable while still appearing in the list — a
  // link that goes to the wrong page, which reads as a bug in the link.
  const slugs = HELP_ARTICLES.map((a) => a.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("slugs are URL-safe", () => {
  for (const a of HELP_ARTICLES) {
    assert.match(a.slug, /^[a-z0-9-]+$/, `${a.slug} is not a clean slug`);
  }
});

test("every article has a title, a symptom and something to read", () => {
  for (const a of HELP_ARTICLES) {
    assert.ok(a.title.trim(), `${a.slug} has no title`);
    // The symptom is the list subtitle *and* a search term. An article without
    // one is findable only by the words we happened to choose.
    assert.ok(a.symptom.trim(), `${a.slug} has no symptom`);
    assert.ok(a.sections.length > 0, `${a.slug} has no sections`);
    const words = a.sections.flatMap((s) => [...s.body, ...(s.steps ?? [])]);
    assert.ok(words.length > 0, `${a.slug} has headings but no prose`);
  }
});

test("every category label is real", () => {
  for (const a of HELP_ARTICLES) {
    assert.ok(HELP_CATEGORY_LABELS[a.category], `${a.slug} has an unknown category`);
  }
});

test("helpArticle round-trips every slug and rejects an unknown one", () => {
  for (const a of HELP_ARTICLES) {
    assert.equal(helpArticle(a.slug)?.slug, a.slug);
    assert.equal(helpPath(a.slug), `/dashboard/support/help/${a.slug}`);
  }
  assert.equal(helpArticle("does-not-exist"), null);
  assert.equal(helpArticle(""), null);
});

/* ── Search ─────────────────────────────────────────────────────────────── */

test("an empty query returns everything", () => {
  // The list page renders `searchArticles("")`. Returning nothing here would be
  // an empty help centre on first load.
  assert.equal(searchArticles("").length, HELP_ARTICLES.length);
  assert.equal(searchArticles("   ").length, HELP_ARTICLES.length);
});

test("the words owners actually type find an article", () => {
  // Each of these is a phrase somebody would type in the box mid-service. None
  // of them is lifted from a heading, which is the point.
  const queries = [
    "refund",
    "money back",
    "where's my money",
    "payout",
    "no show",
    "closed",
    "holiday",
    "timezone",
    "import menu",
    "doordash",
    "locked out",
    "password",
    "domain",
    "logo",
    "opt in",
    "stop",
    "why am I being charged",
    "can't pay",
    "missing order",
  ];
  for (const q of queries) {
    assert.ok(searchArticles(q).length > 0, `no article found for "${q}"`);
  }
});

test("search is case-insensitive", () => {
  assert.deepEqual(
    searchArticles("REFUND").map((a) => a.slug),
    searchArticles("refund").map((a) => a.slug)
  );
});

test("multiple terms narrow rather than widen", () => {
  // AND, not OR. On a set this small an OR search returns most of the list for
  // most queries, which reads as the search being broken rather than as the
  // query being loose.
  const one = searchArticles("refund");
  const two = searchArticles("refund service fee");
  assert.ok(two.length <= one.length);
  assert.ok(two.every((a) => one.some((b) => b.slug === a.slug)));
});

test("a query that matches nothing returns nothing rather than everything", () => {
  // The empty-query shortcut must not swallow a real miss — an unmatched search
  // silently showing all thirteen articles is the worst of both.
  assert.deepEqual(searchArticles("zzzzqqqq"), []);
});

test("search runs over the body, not just the title", () => {
  const hits = searchArticles("carrier");
  assert.ok(hits.length > 0);
  assert.ok(hits.every((a) => !a.title.toLowerCase().includes("carrier")));
});

/* ── Grouping and export ────────────────────────────────────────────────── */

test("grouping loses nobody and skips empty categories", () => {
  const groups = articlesByCategory();
  const total = groups.reduce((n, g) => n + g.articles.length, 0);
  assert.equal(total, HELP_ARTICLES.length);
  assert.ok(groups.every((g) => g.articles.length > 0));
});

test("grouping a filtered set only groups that set", () => {
  const subset = searchArticles("refund");
  const total = articlesByCategory(subset).reduce((n, g) => n + g.articles.length, 0);
  assert.equal(total, subset.length);
});

test("every article renders to non-empty plain text", () => {
  // This is what an agent pastes into a ticket reply. An article that renders
  // as a page and as an empty string is a reply that says nothing.
  for (const a of HELP_ARTICLES) {
    const text = articleToText(a);
    assert.ok(text.length > 100, `${a.slug} renders to almost nothing`);
    assert.ok(text.startsWith(a.title));
  }
});

test("numbered steps survive the plain-text rendering", () => {
  const withSteps = HELP_ARTICLES.find((a) => a.sections.some((s) => s.steps?.length));
  assert.ok(withSteps, "no article has steps — the renderer is untested");
  assert.match(articleToText(withSteps), /^1\. /m);
});

console.log(`help-articles: ${passed} passed`);
