import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { hostnameIsBlocked, isPrivateAddress } from "@/lib/net-guard";

/**
 * The one door that fetches a page on an owner's behalf.
 *
 * Everything that makes this dangerous is here rather than at the call site.
 * An owner pastes a URL and we make a request from inside our own network to
 * whatever it names — which is a server-side request forgery primitive unless
 * it is fenced. The fence is:
 *
 * - **Public addresses only, checked after DNS resolution, on every hop.**
 *   Blocking by hostname is not enough: `menu.example.com` can have an A record
 *   of `169.254.169.254`, and a redirect can land anywhere regardless of where
 *   the first request went. So redirects are followed manually and every hop is
 *   re-resolved and re-checked. Cloud metadata endpoints, loopback, link-local
 *   and RFC-1918 space are all unreachable through here.
 * - **A byte cap enforced while streaming**, not after. Checking
 *   `Content-Length` is advisory — a hostile server simply lies, or omits it —
 *   so the body is read incrementally and abandoned once the cap is hit.
 * - **A wall-clock timeout**, so a server that accepts the connection and then
 *   trickles one byte a minute cannot hold a request handler open.
 *
 * None of these limits are configurable from a request. That is the point.
 */

const MAX_BYTES = 6 * 1024 * 1024; // a heavy menu page is ~2MB; this is headroom
const TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;

/**
 * A desktop browser user agent.
 *
 * Not to hide what we are — we fetch one page, at a person's explicit request,
 * for their own restaurant. It is because these sites serve a stripped page to
 * anything they consider a bot, and the stripped page has no menu data in it,
 * so a truthful UA yields an empty import and an owner who thinks the feature
 * is broken.
 */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type FetchPageResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; error: string; blocked?: boolean };

async function assertPublicHost(hostname: string): Promise<string | null> {
  // Everything that names a private address directly — dotted quads, IPv6,
  // and the decimal/octal/hex forms of both — is rejected before DNS is
  // consulted at all. Leaving the encoded forms to the resolver makes the
  // security boundary a property of the platform's DNS stack.
  if (hostnameIsBlocked(hostname)) return "That address isn't reachable from here.";
  if (isIP(hostname) !== 0) return null;

  try {
    const results = await lookup(hostname, { all: true });
    if (results.length === 0) return "We couldn't find that site.";
    // Every address, not just the first — a host with one public and one
    // private record would otherwise be a coin flip.
    if (results.some((r) => isPrivateAddress(r.address))) {
      return "That address isn't reachable from here.";
    }
    return null;
  } catch {
    return "We couldn't find that site. Check the link and try again.";
  }
}

/**
 * Fetch a page's HTML, or explain in one sentence why we couldn't.
 *
 * Errors are written for a restaurant owner, not an engineer, because this is
 * the failure they will hit most often: these platforms block datacentre
 * traffic aggressively and it is entirely normal for this to return a 403.
 * When it does, the caller must offer the paste-the-page fallback — a dead end
 * here is a dead end for the whole feature.
 */
export async function fetchMenuPage(url: string): Promise<FetchPageResult> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return { ok: false, error: "That doesn't look like a web address." };
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { ok: false, error: "Only http and https links can be imported.", blocked: true };
    }

    const blockedReason = await assertPublicHost(parsed.hostname);
    if (blockedReason) return { ok: false, error: blockedReason, blocked: true };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = err instanceof Error && err.name === "AbortError";
      return {
        ok: false,
        error: aborted
          ? "That page took too long to respond."
          : "We couldn't reach that page. Check the link, or paste the page instead.",
      };
    }

    if (res.status >= 300 && res.status < 400) {
      clearTimeout(timer);
      const location = res.headers.get("location");
      if (!location) return { ok: false, error: "That link redirected nowhere." };
      current = new URL(location, current).toString();
      continue;
    }

    if (res.status === 403 || res.status === 429 || res.status === 401) {
      clearTimeout(timer);
      return {
        ok: false,
        error:
          "That site turned us away — it blocks automated requests. Open the page in your browser and use the paste option instead; it works every time and takes about twenty seconds.",
        blocked: true,
      };
    }
    if (!res.ok) {
      clearTimeout(timer);
      return {
        ok: false,
        error: `That page returned an error (${res.status}). Check the link is the public menu page.`,
      };
    }

    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml|text\/plain/i.test(type)) {
      clearTimeout(timer);
      return { ok: false, error: "That link isn't a web page." };
    }

    try {
      const html = await readCapped(res, controller);
      return { ok: true, html, finalUrl: current };
    } catch {
      return { ok: false, error: "That page was too large or stopped part-way through." };
    } finally {
      clearTimeout(timer);
    }
  }

  return { ok: false, error: "That link redirected too many times." };
}

/** Read a body up to MAX_BYTES, abandoning the request rather than buffering on. */
async function readCapped(res: Response, controller: AbortController): Promise<string> {
  const body = res.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      controller.abort();
      // Truncated HTML is still worth parsing — the embedded JSON blob is
      // usually early in the document, and half a menu beats none.
      break;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total > MAX_BYTES ? chunks.reduce((n, c) => n + c.byteLength, 0) : total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(merged);
}
