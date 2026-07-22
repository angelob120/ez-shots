/**
 * Address classification for the SSRF fence.
 *
 * Split out of `menu-fetch.ts` for one reason: that module imports
 * `server-only`, which throws outside a server component, and a pure security
 * predicate with no tests because it lives in an untestable module is the worst
 * of both. This file imports nothing but `node:net` and is covered by
 * `scripts/net-guard.test.ts`.
 */

import { isIP } from "node:net";

/** True for anything that must never be reachable from a user-supplied URL. */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 0) return true; // unparseable — refuse rather than guess

  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10) return true;
    if (a === 127) return true; // loopback
    if (a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a >= 224) return true; // multicast and reserved
    return false;
  }

  const s = ip.toLowerCase();
  if (s === "::" || s === "::1") return true;
  if (s.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(s)) return true; // unique local
  // IPv4-mapped (::ffff:10.0.0.1) — check the embedded address too, or the
  // whole v4 blocklist above is trivially bypassed.
  const mapped = s.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
}

/**
 * Whether a hostname is an IPv4 address written in a form `isIP` does not
 * recognise — decimal, octal, or hexadecimal.
 *
 * `http://2130706433/`, `http://0177.0.0.1/` and `http://0x7f.1/` all reach
 * 127.0.0.1 in every HTTP client, but `isIP` returns 0 for all three, so they
 * fall through the dotted-quad checks above and get treated as hostnames to
 * resolve. Whether the resolver then hands back loopback is a property of the
 * platform's DNS stack, which is not somewhere a security boundary should live.
 *
 * Returns the address in dotted-quad form so the caller can run it through
 * `isPrivateAddress`, or null when the hostname is a genuine name.
 */
export function normalizeNumericHost(hostname: string): string | null {
  const h = hostname.trim().toLowerCase();
  if (!h || /[^0-9a-fx.]/.test(h)) return null;

  const parts = h.split(".");
  if (parts.length > 4) return null;
  if (parts.some((p) => p === "")) return null;

  const nums: number[] = [];
  for (const part of parts) {
    let n: number;
    if (/^0x[0-9a-f]+$/.test(part)) n = parseInt(part.slice(2), 16);
    else if (/^0[0-7]+$/.test(part)) n = parseInt(part.slice(1), 8);
    // A leading zero means octal, so "09" is not the number nine — it is
    // malformed. Reading it as decimal here would make this function disagree
    // with the resolver about what the address is, which is the one thing a
    // normaliser must never do.
    else if (/^0\d+$/.test(part)) return null;
    else if (/^\d+$/.test(part)) n = Number(part);
    else return null;
    if (!Number.isFinite(n) || n < 0) return null;
    nums.push(n);
  }

  // A single dotted-decimal quad of ordinary numbers is already handled by
  // `isIP`; anything else here is one of the compressed forms. Both are
  // converted the same way, which is what every resolver does.
  let value: number;
  if (nums.length === 1) {
    value = nums[0];
  } else {
    // The last part absorbs the remaining octets: 127.1 is 127.0.0.1.
    const head = nums.slice(0, -1);
    const tail = nums[nums.length - 1];
    if (head.some((n) => n > 255)) return null;
    const shift = 8 * (4 - nums.length + 1);
    if (tail >= 2 ** shift) return null;
    value = head.reduce((acc, n, i) => acc + n * 2 ** (8 * (3 - i)), 0) + tail;
  }

  if (value > 0xffffffff) return null;
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ].join(".");
}

/**
 * The whole hostname check, in one call: is this host safe to make a request to
 * before DNS has even been consulted?
 *
 * DNS resolution is still required afterwards for real hostnames — a name can
 * point anywhere — but this catches every form that names a private address
 * directly, including the encoded ones a resolver might otherwise be trusted to
 * reject.
 */
export function hostnameIsBlocked(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;

  if (isIP(h) !== 0) return isPrivateAddress(h);

  const numeric = normalizeNumericHost(h);
  if (numeric) return isPrivateAddress(numeric);

  // Names that resolve to loopback by convention on essentially every machine.
  // Blocked by name as well as by address because a resolver that is slow or
  // unavailable must not turn into a bypass.
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal")) return true;
  // The canonical cloud metadata hostnames, which resolve to 169.254.169.254.
  if (h === "metadata.google.internal" || h === "metadata") return true;

  return false;
}
