/**
 * Tests for the canonical-origin resolver.
 *
 * Pure env + string logic, no Prisma involved — run with
 * `npx tsx scripts/domains.test.ts`.
 *
 * The thing under test is a business rule, not a formatting helper: a verified
 * custom domain is the tenant's canonical origin, so every link we generate for
 * them has to carry it. The regression this file exists to catch is the one
 * that shipped — an owner points their domain at us, watches it go green, and
 * their customers' order texts still print our hostname.
 */

import assert from "node:assert/strict";
import {
  canonicalOrigin,
  canonicalUrl,
  platformOrigin,
  domainVariants,
  isApexDomain,
} from "../src/lib/domains";

let passed = 0;

const ENV_KEYS = [
  "APP_URL",
  "NEXT_PUBLIC_APP_URL",
  "PRIMARY_DOMAIN",
  "RAILWAY_PUBLIC_DOMAIN",
] as const;

function test(name: string, env: Partial<Record<(typeof ENV_KEYS)[number], string>>, fn: () => void) {
  const saved = ENV_KEYS.map((k) => [k, process.env[k]] as const);
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

const PLATFORM = { APP_URL: "https://ezorders.app" };

// --- The defect itself ------------------------------------------------------

test("a verified custom domain is the canonical origin", PLATFORM, () => {
  const r = { customDomain: "order.theirplace.com", domainVerifiedAt: new Date() };
  assert.equal(canonicalOrigin(r), "https://order.theirplace.com");
  assert.equal(
    canonicalUrl(r, "/o/abc123"),
    "https://order.theirplace.com/o/abc123",
    "order links must print the owner's host, not ours"
  );
});

test("an UNVERIFIED custom domain does not win", PLATFORM, () => {
  // A hostname somebody typed into a form. Emitting links to it would send
  // customers somewhere that doesn't resolve — worse than printing our host.
  const r = { customDomain: "order.theirplace.com", domainVerifiedAt: null };
  assert.equal(canonicalOrigin(r), "https://ezorders.app");
});

test("no custom domain falls back to the platform", PLATFORM, () => {
  assert.equal(canonicalOrigin({ customDomain: null, domainVerifiedAt: null }), "https://ezorders.app");
  assert.equal(canonicalOrigin(null), "https://ezorders.app");
  assert.equal(canonicalOrigin(undefined), "https://ezorders.app");
});

test("a verified-at timestamp with no domain falls back", PLATFORM, () => {
  // Shouldn't happen, but clearing a domain without clearing the timestamp
  // would otherwise produce "https:///o/token".
  assert.equal(canonicalOrigin({ customDomain: "", domainVerifiedAt: new Date() }), "https://ezorders.app");
});

test("domainVerifiedAt is accepted as a serialized string", PLATFORM, () => {
  // It crosses the server/client boundary as JSON in a few DTOs.
  const r = { customDomain: "order.theirplace.com", domainVerifiedAt: new Date().toISOString() };
  assert.equal(canonicalOrigin(r), "https://order.theirplace.com");
});

test("the stored domain is normalized, not trusted verbatim", PLATFORM, () => {
  const r = { customDomain: "  Order.TheirPlace.com.  ", domainVerifiedAt: new Date() };
  assert.equal(canonicalOrigin(r), "https://order.theirplace.com");
});

// --- Platform origin precedence --------------------------------------------

test("APP_URL leads", { ...PLATFORM, PRIMARY_DOMAIN: "marketing.example", RAILWAY_PUBLIC_DOMAIN: "x.up.railway.app" }, () => {
  assert.equal(platformOrigin(), "https://ezorders.app");
});

test("NEXT_PUBLIC_APP_URL is next", { NEXT_PUBLIC_APP_URL: "https://ezorders.app", PRIMARY_DOMAIN: "marketing.example" }, () => {
  assert.equal(platformOrigin(), "https://ezorders.app");
});

test("PRIMARY_DOMAIN takes its first entry and gains a scheme", { PRIMARY_DOMAIN: "ezorders.app, www.ezorders.app" }, () => {
  assert.equal(platformOrigin(), "https://ezorders.app");
});

test("Railway's domain is the last resort", { RAILWAY_PUBLIC_DOMAIN: "hearth-production.up.railway.app" }, () => {
  assert.equal(platformOrigin(), "https://hearth-production.up.railway.app");
});

test("a trailing slash never doubles up", { APP_URL: "https://ezorders.app/" }, () => {
  assert.equal(canonicalUrl(null, "/o/abc123"), "https://ezorders.app/o/abc123");
});

test("localhost keeps http — the dev server isn't on TLS", { APP_URL: "localhost:3000" }, () => {
  assert.equal(platformOrigin(), "http://localhost:3000");
});

test("nothing configured yields a bare path, not a broken absolute URL", {}, () => {
  assert.equal(platformOrigin(), "");
  // config-check.mjs is what refuses to boot on this once SMS is live; here we
  // only assert we don't emit "undefined/o/abc123" into somebody's text.
  assert.equal(canonicalUrl(null, "/o/abc123"), "/o/abc123");
});

// --- The fallback origin must never leak ------------------------------------

test("the Cloudflare fallback origin is never the answer", { HEARTH_FALLBACK_ORIGIN: "origin.hearth.app" } as never, () => {
  // It's the CNAME target we hand tenants, not a public address. If this ever
  // starts returning it, it's being printed on customer receipts.
  process.env.HEARTH_FALLBACK_ORIGIN = "origin.hearth.app";
  assert.equal(platformOrigin(), "");
  delete process.env.HEARTH_FALLBACK_ORIGIN;
});

// --- www coverage -----------------------------------------------------------

test("an apex domain gets a www twin", PLATFORM, () => {
  // Routing already strips www, but Cloudflare issues a cert per hostname —
  // without the twin, a visitor typing www gets a browser security warning on
  // the restaurant's own domain, which is worse than not having one.
  assert.deepEqual(domainVariants("theirplace.com"), {
    primary: "theirplace.com",
    www: "www.theirplace.com",
  });
});

test("a subdomain does not", PLATFORM, () => {
  // Nobody types www.order.theirplace.com, and each registration is billable.
  assert.deepEqual(domainVariants("order.theirplace.com"), {
    primary: "order.theirplace.com",
    www: null,
  });
});

test("variants normalize their input", PLATFORM, () => {
  assert.deepEqual(domainVariants("  Theirplace.COM. "), {
    primary: "theirplace.com",
    www: "www.theirplace.com",
  });
});

test("isApexDomain counts labels, and we know what that costs", PLATFORM, () => {
  assert.equal(isApexDomain("theirplace.com"), true);
  assert.equal(isApexDomain("order.theirplace.com"), false);
  // Knowingly wrong for multi-part TLDs — shipping the public suffix list to
  // fix it costs more than the missing convenience. The failure is "no www
  // twin", not "broken domain".
  assert.equal(isApexDomain("theirplace.co.uk"), false);
});

console.log(`domains: ${passed} passed`);
