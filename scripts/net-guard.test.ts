/**
 * Tests for the SSRF fence.
 *
 * Run with `npx tsx scripts/net-guard.test.ts`. Pure — no network, no DNS.
 *
 * This is the only place in the product where a user-supplied string becomes a
 * request originating from inside our own network. The menu importer takes a
 * URL from a restaurant owner and fetches it, so every one of these cases is a
 * way to point that request at something it must never reach: the cloud
 * metadata endpoint that hands out our credentials, the database on a private
 * subnet, or a service on loopback that assumes anything reaching it is us.
 *
 * The bypasses tested here are the ones a naive check misses, and each is
 * written up with why it works, so the next person to "simplify" this sees what
 * they would be reopening.
 */

import assert from "node:assert/strict";
import { hostnameIsBlocked, isPrivateAddress, normalizeNumericHost } from "../src/lib/net-guard";

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

/* ── IPv4 ───────────────────────────────────────────────────────────────── */

test("blocks the RFC-1918 private ranges", () => {
  for (const ip of ["10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.254", "192.168.1.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});

test("does not over-block the neighbours of 172.16/12", () => {
  // 172.15 and 172.32 are public. A range check written as `a === 172` blocks a
  // real chunk of the internet, which shows up as "the importer says my menu
  // isn't reachable" for whoever is unlucky enough to be hosted there.
  assert.equal(isPrivateAddress("172.15.0.1"), false);
  assert.equal(isPrivateAddress("172.32.0.1"), false);
});

test("blocks loopback, the unspecified address, and multicast", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("127.1.2.3"), true); // all of 127/8, not just .0.1
  assert.equal(isPrivateAddress("0.0.0.0"), true);
  assert.equal(isPrivateAddress("224.0.0.1"), true);
  assert.equal(isPrivateAddress("255.255.255.255"), true);
});

test("blocks link-local, which is where cloud metadata lives", () => {
  // 169.254.169.254 is the AWS/GCP/Azure metadata endpoint. Reaching it from a
  // server-side fetch is how instance credentials get exfiltrated, and it is
  // the single highest-value target for this class of bug.
  assert.equal(isPrivateAddress("169.254.169.254"), true);
  assert.equal(isPrivateAddress("169.254.0.1"), true);
});

test("blocks carrier-grade NAT space", () => {
  assert.equal(isPrivateAddress("100.64.0.1"), true);
  assert.equal(isPrivateAddress("100.127.255.255"), true);
  // 100.63 and 100.128 are ordinary public space.
  assert.equal(isPrivateAddress("100.63.0.1"), false);
  assert.equal(isPrivateAddress("100.128.0.1"), false);
});

test("allows ordinary public addresses", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "93.184.216.34"]) {
    assert.equal(isPrivateAddress(ip), false, ip);
  }
});

/* ── IPv6 ───────────────────────────────────────────────────────────────── */

test("blocks IPv6 loopback, unspecified, link-local and unique-local", () => {
  assert.equal(isPrivateAddress("::1"), true);
  assert.equal(isPrivateAddress("::"), true);
  assert.equal(isPrivateAddress("fe80::1"), true);
  assert.equal(isPrivateAddress("fc00::1"), true);
  assert.equal(isPrivateAddress("fd12:3456::1"), true);
});

test("blocks the IPv4-mapped form, which bypasses a v4-only check", () => {
  // ::ffff:10.0.0.1 is 10.0.0.1. A checker that only understands dotted quads
  // sees an IPv6 address it has no rule for and waves it through.
  assert.equal(isPrivateAddress("::ffff:10.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateAddress("::ffff:169.254.169.254"), true);
  // The same form pointing somewhere public is genuinely fine.
  assert.equal(isPrivateAddress("::ffff:8.8.8.8"), false);
});

test("allows public IPv6", () => {
  assert.equal(isPrivateAddress("2606:4700::1111"), false);
});

test("refuses rather than guesses on unparseable input", () => {
  // Fail closed. An address we cannot classify is not an address we should
  // connect to.
  for (const junk of ["", "not-an-ip", "999.999.999.999", "10.0.0", "::gg"]) {
    assert.equal(isPrivateAddress(junk), true, junk);
  }
});

/* ── Encoded IPv4 forms ─────────────────────────────────────────────────── */

test("normalizeNumericHost decodes the decimal form", () => {
  // http://2130706433/ reaches 127.0.0.1 in every HTTP client, and `isIP`
  // returns 0 for it — so without this it is treated as a hostname and handed
  // to the resolver, and whether that resolves to loopback becomes a property
  // of the platform rather than of our code.
  assert.equal(normalizeNumericHost("2130706433"), "127.0.0.1");
  assert.equal(normalizeNumericHost("3232235777"), "192.168.1.1");
});

test("normalizeNumericHost decodes octal and hex", () => {
  assert.equal(normalizeNumericHost("0177.0.0.1"), "127.0.0.1");
  assert.equal(normalizeNumericHost("0x7f.0.0.1"), "127.0.0.1");
  assert.equal(normalizeNumericHost("0x7f000001"), "127.0.0.1");
});

test("normalizeNumericHost expands the short forms", () => {
  // 127.1 is 127.0.0.1 — the last part absorbs the remaining octets.
  assert.equal(normalizeNumericHost("127.1"), "127.0.0.1");
  assert.equal(normalizeNumericHost("10.1"), "10.0.0.1");
  assert.equal(normalizeNumericHost("192.168.257"), "192.168.1.1");
});

test("normalizeNumericHost leaves real hostnames alone", () => {
  for (const host of ["doordash.com", "example.org", "my-restaurant.co", "a1.example.com"]) {
    assert.equal(normalizeNumericHost(host), null, host);
  }
});

test("normalizeNumericHost rejects out-of-range and malformed input", () => {
  assert.equal(normalizeNumericHost("4294967296"), null); // > 2^32-1
  assert.equal(normalizeNumericHost("999.1.1.1"), null);
  assert.equal(normalizeNumericHost("1.2.3.4.5"), null);
  assert.equal(normalizeNumericHost("1..2"), null);
  assert.equal(normalizeNumericHost("09"), null); // invalid octal
});

/* ── The whole host check ───────────────────────────────────────────────── */

test("hostnameIsBlocked catches every encoding of loopback", () => {
  for (const host of ["127.0.0.1", "2130706433", "0177.0.0.1", "0x7f000001", "127.1", "::1", "[::1]"]) {
    assert.equal(hostnameIsBlocked(host), true, host);
  }
});

test("hostnameIsBlocked catches every encoding of the metadata endpoint", () => {
  for (const host of ["169.254.169.254", "2852039166", "0251.0376.0251.0376", "metadata.google.internal"]) {
    assert.equal(hostnameIsBlocked(host), true, host);
  }
});

test("hostnameIsBlocked blocks names that resolve to loopback by convention", () => {
  // Blocked by name as well as by address, so a slow or unavailable resolver
  // cannot become a bypass.
  for (const host of ["localhost", "foo.localhost", "db.internal", "printer.local", "metadata"]) {
    assert.equal(hostnameIsBlocked(host), true, host);
  }
});

test("hostnameIsBlocked allows the hosts this feature exists to fetch", () => {
  for (const host of [
    "www.doordash.com",
    "www.ubereats.com",
    "order.toasttab.com",
    "my-restaurant.com",
    "8.8.8.8",
  ]) {
    assert.equal(hostnameIsBlocked(host), false, host);
  }
});

test("hostnameIsBlocked fails closed on nothing", () => {
  assert.equal(hostnameIsBlocked(""), true);
  assert.equal(hostnameIsBlocked("   "), true);
});

console.log(`net-guard: ${passed} passed`);
