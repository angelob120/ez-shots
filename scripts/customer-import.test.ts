/**
 * Tests for the customer CSV mapper and the search predicate.
 *
 * Two things here are worth more than the rest.
 *
 * **Phone normalisation is a dedupe key.** `(555) 010-1234` and `+15550101234`
 * are one person, and an import that treats them as two has silently split
 * somebody's order history in half — a bug nobody reports because both halves
 * look plausible. Every accepted format has to converge on one string.
 *
 * **The mapper must not parse consent.** `lib/customer-import.ts` refuses to
 * grant opt-in from a spreadsheet, and the enforcement is worth nothing if the
 * mapper quietly starts emitting an `optInStatus` a future writer trusts. The
 * shape of a parsed row is asserted here for that reason.
 *
 * Pure — the CSV layer has no server dependencies. Run with
 * `npx tsx scripts/customer-import.test.ts`.
 */

import assert from "node:assert/strict";
import { mapCustomerCsv, normalizePhoneForImport, CUSTOMER_CSV_HEADER } from "../src/lib/csv";
import { normalizePhone } from "../src/lib/money";
import {
  customerSearchWhere,
  customerWhere,
  filtersToQuery,
  isFiltering,
  readCustomerParams,
  tagSlug,
  TAG_COLORS,
  isTagColor,
} from "../src/lib/customers";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Phone normalisation
// ---------------------------------------------------------------------------

test("every common US format converges on one E.164 string", () => {
  const forms = [
    "5550101234",
    "555-010-1234",
    "(555) 010-1234",
    "555.010.1234",
    "+1 555 010 1234",
    "1-555-010-1234",
    "  5550101234  ",
    "+15550101234",
  ];
  for (const f of forms) {
    assert.equal(normalizePhoneForImport(f), "+15550101234", `${f} didn't normalise`);
  }
});

test("the import normaliser agrees with the one the rest of the app uses", () => {
  // They are deliberately separate implementations — csv.ts stays pure and
  // dependency-free — so the risk is drift, and this is the guard against it.
  const cases = ["5550101234", "555-010-1234", "+15550101234", "15550101234", "+442071234567"];
  for (const c of cases) {
    assert.equal(normalizePhoneForImport(c), normalizePhone(c), `disagreement on ${c}`);
  }
});

test("international numbers survive", () => {
  assert.equal(normalizePhoneForImport("+44 20 7123 4567"), "+442071234567");
});

test("junk is rejected rather than guessed at", () => {
  for (const bad of ["", "   ", "n/a", "abc", "12", "phone", "-", "()"]) {
    assert.equal(normalizePhoneForImport(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test("Excel's scientific notation is rejected, not silently mangled", () => {
  // Excel turns a long number into `1.5550101234E+10`. Stripping non-digits
  // would yield `15550101234` — a *plausible* number that is not necessarily
  // the right one, and a wrong phone number in a customer list is worse than
  // a skipped row, because it's someone else's.
  assert.equal(normalizePhoneForImport("1.5550101234E+10"), null);
  assert.equal(normalizePhoneForImport("1.5550101234e+10"), null);
});

// ---------------------------------------------------------------------------
// CSV mapping
// ---------------------------------------------------------------------------

test("a standard header row maps cleanly", () => {
  const { rows, warnings } = mapCustomerCsv(
    "name,phone,email\nJane Doe,555-010-1234,jane@example.com"
  );
  assert.equal(rows.length, 1);
  assert.equal(warnings.length, 0);
  assert.deepEqual(rows[0], {
    phone: "+15550101234",
    name: "Jane Doe",
    email: "jane@example.com",
    notes: null,
  });
});

test("a parsed row carries no consent field of any kind", () => {
  // The structural half of the rule in lib/customer-import.ts. If a future
  // change adds an `optedIn` column to the mapper, this fails before anything
  // downstream can start trusting it.
  const { rows } = mapCustomerCsv("name,phone\nJane,5550101234");
  assert.deepEqual(Object.keys(rows[0]).sort(), ["email", "name", "notes", "phone"]);
});

test("a consent column in the file is ignored, not honoured", () => {
  const { rows } = mapCustomerCsv(
    "name,phone,opted_in,consent\nJane,5550101234,TRUE,yes"
  );
  assert.equal(rows.length, 1);
  assert.equal(JSON.stringify(rows[0]).toLowerCase().includes("true"), false);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["email", "name", "notes", "phone"]);
});

test("header aliases from real POS exports are recognised", () => {
  for (const h of ["phone", "Phone Number", "MOBILE", "cell", "Telephone", "contact"]) {
    const { rows } = mapCustomerCsv(`${h}\n555-010-1234`);
    assert.equal(rows.length, 1, `didn't recognise "${h}"`);
    assert.equal(rows[0].phone, "+15550101234");
  }
});

test("column order doesn't matter when there's a header", () => {
  const { rows } = mapCustomerCsv("email,notes,phone,name\nj@e.com,VIP,5550101234,Jane");
  assert.deepEqual(rows[0], {
    phone: "+15550101234",
    name: "Jane",
    email: "j@e.com",
    notes: "VIP",
  });
});

test("a headerless file falls back to name,phone", () => {
  const { rows } = mapCustomerCsv("Jane Doe,555-010-1234\nJohn Roe,555-010-9999");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].name, "Jane Doe");
  assert.equal(rows[0].phone, "+15550101234");
});

test("a file with no phone column is rejected with an actionable message", () => {
  const { rows, warnings } = mapCustomerCsv("name,email\nJane,j@e.com");
  assert.equal(rows.length, 0);
  assert.match(warnings[0], /phone/i);
});

test("an empty file is rejected", () => {
  assert.equal(mapCustomerCsv("").rows.length, 0);
  assert.equal(mapCustomerCsv("   \n  \n").rows.length, 0);
});

test("unusable rows are counted once, not complained about individually", () => {
  // 380 separate warnings is not a message, it's a wall. The count is.
  const body = Array.from({ length: 12 }, (_, i) => `Person ${i},not-a-number`).join("\n");
  const { rows, warnings, unusable } = mapCustomerCsv(`name,phone\n${body}`);
  assert.equal(rows.length, 0);
  assert.equal(unusable, 12);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /12 rows/);
});

test("good rows survive alongside bad ones", () => {
  const { rows, unusable } = mapCustomerCsv(
    "name,phone\nJane,5550101234\nBroken,xyz\nJohn,5550109999"
  );
  assert.equal(rows.length, 2);
  assert.equal(unusable, 1);
});

test("quoted fields with commas are handled", () => {
  const { rows } = mapCustomerCsv('name,phone,notes\n"Doe, Jane",5550101234,"Allergic to nuts, no garnish"');
  assert.equal(rows[0].name, "Doe, Jane");
  assert.equal(rows[0].notes, "Allergic to nuts, no garnish");
});

test("a UTF-8 BOM from Excel doesn't break the first header", () => {
  const { rows } = mapCustomerCsv("﻿name,phone\nJane,5550101234");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "Jane");
});

test("CRLF line endings are handled", () => {
  const { rows } = mapCustomerCsv("name,phone\r\nJane,5550101234\r\nJohn,5550109999");
  assert.equal(rows.length, 2);
});

test("an implausible email is dropped rather than stored", () => {
  const { rows } = mapCustomerCsv("name,phone,email\nJane,5550101234,not-an-email");
  assert.equal(rows[0].email, null);
});

test("long values are truncated rather than rejected", () => {
  const long = "x".repeat(500);
  const { rows } = mapCustomerCsv(`name,phone,notes\n${long},5550101234,${long}`);
  assert.ok(rows[0].name!.length <= 120);
  assert.ok(rows[0].notes!.length <= 300);
});

test("the template header is what the mapper accepts", () => {
  // A template nobody can import is a support ticket generator.
  const { rows } = mapCustomerCsv(`${CUSTOMER_CSV_HEADER.join(",")}\nJane,5550101234,j@e.com,VIP`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].phone, "+15550101234");
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

test("an empty search is just the tenant scope", () => {
  assert.deepEqual(customerSearchWhere("r1", ""), { restaurantId: "r1" });
  assert.deepEqual(customerSearchWhere("r1", undefined), { restaurantId: "r1" });
  assert.deepEqual(customerSearchWhere("r1", "   "), { restaurantId: "r1" });
});

test("tenant scope is always present when given", () => {
  // The isolation property. A search must never widen past its tenant.
  const w = customerSearchWhere("r1", "jane") as { restaurantId?: string };
  assert.equal(w.restaurantId, "r1");
});

test("a null tenant means cross-tenant, and is the only way to get there", () => {
  const w = customerSearchWhere(null, "jane") as { restaurantId?: string };
  assert.equal(w.restaurantId, undefined);
});

test("a text search covers name and email", () => {
  const w = customerSearchWhere("r1", "jane") as { OR: Array<Record<string, unknown>> };
  const fields = w.OR.map((c) => Object.keys(c)[0]);
  assert.ok(fields.includes("name"));
  assert.ok(fields.includes("email"));
});

test("a formatted phone number is matched against stored E.164", () => {
  // The bug this prevents: an operator types what's on their screen, the
  // column holds +15550101234, nothing matches, and the customer appears not
  // to exist.
  const w = customerSearchWhere("r1", "(555) 010-1234") as { OR: Array<Record<string, unknown>> };
  assert.ok(
    w.OR.some((c) => c.phone === "+15550101234"),
    "no exact E.164 clause"
  );
});

test("a last-four fragment searches the end of the number", () => {
  const w = customerSearchWhere("r1", "1234") as { OR: Array<{ phone?: { endsWith?: string } }> };
  assert.ok(
    w.OR.some((c) => c.phone?.endsWith === "1234"),
    "no suffix clause"
  );
});

test("a short fragment doesn't become a phone search", () => {
  // "Jo" shouldn't produce a phone clause; two digits would match half the
  // list from anywhere in the number.
  const w = customerSearchWhere("r1", "Jo") as { OR: Array<Record<string, unknown>> };
  assert.equal(
    w.OR.some((c) => "phone" in c),
    false
  );
});

// ---------------------------------------------------------------------------
// Param parsing
// ---------------------------------------------------------------------------

test("bad sort and consent values fall back rather than reaching the query", () => {
  const p = readCustomerParams({ sort: "'; DROP TABLE", consent: "MAYBE" });
  assert.equal(p.sort, "recent");
  assert.equal(p.consent, undefined);
});

test("valid params pass through", () => {
  const p = readCustomerParams({ q: "jane", sort: "value", consent: "OPTED_IN", page: "3" });
  assert.equal(p.q, "jane");
  assert.equal(p.sort, "value");
  assert.equal(p.consent, "OPTED_IN");
  assert.equal(p.page, 3);
  // Everything not asked for is absent rather than defaulted to something.
  // A filter that quietly defaults is a filter nobody can turn off.
  assert.equal(p.stage, undefined);
  assert.equal(p.cohort, undefined);
  assert.equal(p.source, undefined);
  assert.equal(p.hasEmail, undefined);
  assert.deepEqual(p.tags, []);
});

test("page numbers are sanitised to a positive integer", () => {
  for (const [input, want] of [["0", 1], ["-2", 1], ["abc", 1], ["2.7", 2], ["", 1]] as const) {
    assert.equal(readCustomerParams({ page: input }).page, want, `page=${input}`);
  }
});

test("an over-long query is truncated", () => {
  assert.ok(readCustomerParams({ q: "x".repeat(500) }).q.length <= 100);
});

test("array params (?q=a&q=b) take the first rather than resetting to the default", () => {
  // A repeated param is what you get from a form with two inputs of the same
  // name, or a hand-edited URL. Falling back to the default there means
  // `?sort=value&sort=name` silently sorts by neither, which reads as the
  // sort control being broken. `tag` is the one param that's genuinely
  // multi-valued, and it's read separately.
  const p = readCustomerParams({ q: ["a", "b"], sort: ["value"] });
  assert.equal(p.q, "a");
  assert.equal(p.sort, "value");
});

// ---------------------------------------------------------------------------
// Tag slugs
//
// The slug is a dedupe key, and it fails the same way phone normalisation
// does: silently. An owner with "VIP" and "vip" as two tags has a filter that
// returns a third of the people it should and shows a plausible number while
// doing it.
// ---------------------------------------------------------------------------

test("case and surrounding whitespace never make a second tag", () => {
  // The realistic collision. Somebody types "VIP" today and "vip" in March.
  for (const v of ["vip", "VIP", " Vip ", "vIp"]) {
    assert.equal(tagSlug(v), "vip", `${v} should slug to vip`);
  }
});

test("separators are normalised to one form, so spacing variants converge", () => {
  const want = tagSlug("V.I.P.");
  for (const v of ["v i p", "V-I-P", "V.I.P.", "v_i_p"]) {
    assert.equal(tagSlug(v), want, `${v} should slug to ${want}`);
  }
  // Deliberately *not* the same as "vip". Removing separators entirely would
  // merge "no show" into "noshow", which is fine, but also "re order" into
  // "reorder" — and collapsing two tags an owner meant to keep apart is a
  // worse failure than leaving two they meant to merge, because only the
  // first is invisible to them.
  assert.notEqual(want, "vip");
});

test("accents are folded rather than turned into separators", () => {
  // Without the combining-mark strip this is "caf-", which collides with
  // anything else ending in punctuation.
  assert.equal(tagSlug("Café"), "cafe");
});

test("a name of pure punctuation slugs to empty, so callers can reject it", () => {
  // An empty slug would collide with every other empty one, so `ensureTag`
  // refuses it. The important part is that it's detectable, not guessed at.
  assert.equal(tagSlug("!!!"), "");
  assert.equal(tagSlug("   "), "");
});

test("slugs are bounded and carry no leading or trailing separators", () => {
  const s = tagSlug("  " + "long ".repeat(40) + "  ");
  assert.ok(s.length <= 32);
  assert.ok(!s.startsWith("-") && !s.endsWith("-"), s);
});

test("every palette colour is recognised and nothing else is", () => {
  for (const c of TAG_COLORS) assert.equal(isTagColor(c), true, c);
  // A hex value must not sneak in: TagChip maps names to classes, and an
  // unknown name is styleless text.
  assert.equal(isTagColor("#ff0000"), false);
  assert.equal(isTagColor("info"), false);
});

// ---------------------------------------------------------------------------
// The filter `where`
// ---------------------------------------------------------------------------

const AT = new Date("2026-07-20T12:00:00.000Z");

function andOf(f: Parameters<typeof customerWhere>[0]) {
  return (customerWhere(f, AT) as { AND?: Record<string, any>[] }).AND ?? [];
}

test("no filters produce no AND array at all", () => {
  assert.deepEqual(customerWhere({ restaurantId: "r1" }, AT), { restaurantId: "r1" });
});

test("the tenant scope survives every filter", () => {
  const w = customerWhere(
    { restaurantId: "r1", consent: "OPTED_IN", stage: "repeat", tags: ["vip"] },
    AT
  ) as { restaurantId?: string };
  assert.equal(w.restaurantId, "r1");
});

test("a null tenant scope means cross-tenant and is never inferred", () => {
  const w = customerWhere({ restaurantId: null, consent: "OPTED_IN" }, AT) as {
    restaurantId?: string;
  };
  assert.equal(w.restaurantId, undefined);
});

test("multiple tags narrow rather than widen", () => {
  // One clause per tag. A single `some` with an `in` would mean "any of
  // these", and a list that gets longer as you add criteria reads as broken.
  const and = andOf({ restaurantId: "r1", tags: ["vip", "catering"] });
  const tagClauses = and.filter((c) => "tags" in c);
  assert.equal(tagClauses.length, 2);
});

test("two date filters both survive instead of clobbering each other", () => {
  // Spread onto one object, whichever was written last would win silently and
  // the query would answer a question nobody asked. Contradictory filters
  // should return nothing, visibly.
  const and = andOf({ restaurantId: "r1", withinDays: 7, lapsedDays: 30 });
  const dated = and.filter((c) => "lastOrderAt" in c);
  assert.equal(dated.length, 2);
  assert.ok(dated.some((c) => "gte" in c.lastOrderAt));
  assert.ok(dated.some((c) => "lt" in c.lastOrderAt));
});

test("lapsed is reckoned from the injected clock, not the wall clock", () => {
  const and = andOf({ restaurantId: "r1", lapsedDays: 30 });
  const clause = and.find((c) => "lastOrderAt" in c)!;
  assert.equal(
    (clause.lastOrderAt.lt as Date).toISOString(),
    new Date(AT.getTime() - 30 * 864e5).toISOString()
  );
});

test("stage none means zero orders, not 'recently added'", () => {
  // The question this filter answers is "who have I never converted", which a
  // date-based reading would get wrong for anyone who joined in January and
  // still hasn't ordered.
  assert.deepEqual(andOf({ restaurantId: "r1", stage: "none" }), [{ orderCount: 0 }]);
  assert.deepEqual(andOf({ restaurantId: "r1", stage: "once" }), [{ orderCount: 1 }]);
  assert.deepEqual(andOf({ restaurantId: "r1", stage: "repeat" }), [{ orderCount: { gt: 1 } }]);
});

test("source splits on the import marker in both directions", () => {
  assert.deepEqual(andOf({ restaurantId: "r1", source: "imported" }), [
    { importJobId: { not: null } },
  ]);
  assert.deepEqual(andOf({ restaurantId: "r1", source: "organic" }), [{ importJobId: null }]);
});

test("hasEmail false is a filter, not an absent one", () => {
  // `false` is falsy, so a naive `if (f.hasEmail)` would drop it — and "who
  // has no email" is the more useful half of the pair.
  assert.deepEqual(andOf({ restaurantId: "r1", hasEmail: false }), [{ email: null }]);
  assert.deepEqual(andOf({ restaurantId: "r1", hasEmail: true }), [{ email: { not: null } }]);
});

test("zero and negative numeric filters are ignored rather than applied", () => {
  assert.deepEqual(andOf({ restaurantId: "r1", minOrders: 0, minSpendCts: 0 }), []);
  assert.deepEqual(andOf({ restaurantId: "r1", minOrders: -5 }), []);
});

test("the search term still applies alongside filters", () => {
  const w = customerWhere({ restaurantId: "r1", q: "jane", consent: "OPTED_IN" }, AT) as {
    OR?: unknown[];
    AND?: unknown[];
  };
  assert.ok(Array.isArray(w.OR));
  assert.equal(w.AND?.length, 1);
});

// ---------------------------------------------------------------------------
// Segments: the params → query → params round trip
//
// A saved segment stores what `filtersToQuery` produces and reopens it through
// `readCustomerParams`. If those two disagree, a segment quietly means
// something different every time it's opened.
// ---------------------------------------------------------------------------

test("filters survive a round trip through the saved query string", () => {
  const original = readCustomerParams({
    q: "jane",
    consent: "OPTED_IN",
    stage: "repeat",
    cohort: "HOLDOUT",
    source: "imported",
    email: "yes",
    tag: ["vip", "catering"],
    minOrders: "3",
    minSpend: "12.99",
    lapsedDays: "30",
    sort: "value",
  });

  const reopened = readCustomerParams(
    Object.fromEntries(new URLSearchParams(filtersToQuery(original)).entries())
  );

  // Tags are multi-valued, so they don't survive `Object.fromEntries` — check
  // them off the raw params instead, which is what the page actually reads.
  const sp = new URLSearchParams(filtersToQuery(original));
  assert.deepEqual(sp.getAll("tag"), ["vip", "catering"]);

  assert.equal(reopened.q, "jane");
  assert.equal(reopened.consent, "OPTED_IN");
  assert.equal(reopened.stage, "repeat");
  assert.equal(reopened.cohort, "HOLDOUT");
  assert.equal(reopened.source, "imported");
  assert.equal(reopened.hasEmail, true);
  assert.equal(reopened.minOrders, 3);
  assert.equal(reopened.lapsedDays, 30);
  assert.equal(reopened.sort, "value");
});

test("money round-trips through the query string without losing a cent", () => {
  // Dollars in the box, cents in the column. Rounding down here would turn
  // $12.99 into $12.98 every time a segment was reopened.
  const p = readCustomerParams({ minSpend: "12.99" });
  assert.equal(p.minSpendCts, 1299);
  const again = readCustomerParams(
    Object.fromEntries(new URLSearchParams(filtersToQuery(p)).entries())
  );
  assert.equal(again.minSpendCts, 1299);
});

test("an unknown param in a stored segment is ignored, not fatal", () => {
  // Segments outlive filters. One saved before a rename must open showing
  // fewer filters rather than 500ing the page that lists it.
  const p = readCustomerParams({ q: "jane", vipOnly: "1", stage: "banana" });
  assert.equal(p.q, "jane");
  assert.equal(p.stage, undefined);
  assert.equal(filtersToQuery(p), "q=jane");
});

test("an empty filter set produces an empty query, which saveSegment rejects", () => {
  const p = readCustomerParams({});
  assert.equal(filtersToQuery(p), "");
  assert.equal(isFiltering(p), false);
});

test("isFiltering notices every filter, including the falsy one", () => {
  assert.equal(isFiltering(readCustomerParams({ email: "no" })), true);
  assert.equal(isFiltering(readCustomerParams({ tag: "vip" })), true);
  assert.equal(isFiltering(readCustomerParams({ q: "   " })), false);
  assert.equal(isFiltering(readCustomerParams({ sort: "value" })), false);
});

test("tags are capped and lowercased", () => {
  const p = readCustomerParams({ tag: ["A", "B", "C", "D", "E", "F"] });
  assert.equal(p.tags.length, 5);
  assert.deepEqual(p.tags.slice(0, 2), ["a", "b"]);
});

// ---------------------------------------------------------------------------
// The mapper's column report
// ---------------------------------------------------------------------------

test("the mapper reports what each column was read as", () => {
  const r = mapCustomerCsv("name,phone,loyalty_id\nJane,(555) 010-1234,88231");
  assert.deepEqual(
    r.columns.map((c) => c.mappedTo),
    ["name", "phone", null]
  );
  assert.equal(r.totalRows, 1);
});

test("a duplicate column claims the field only once", () => {
  // Two "email" columns would otherwise both read as used, and the preview
  // would tell the owner data is being imported from a column that's ignored.
  const r = mapCustomerCsv("phone,email,email\n5550101234,a@b.co,c@d.co");
  assert.equal(r.columns.filter((c) => c.mappedTo === "email").length, 1);
});

test("a headerless file reports its positional reading", () => {
  const r = mapCustomerCsv("Jane,5550101234,jane@example.com");
  assert.deepEqual(
    r.columns.map((c) => c.mappedTo),
    ["name", "phone", "email"]
  );
});

console.log(`customer-import: ${passed} passed`);
