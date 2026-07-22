/**
 * The analytics beacon.
 *
 * Public and unauthenticated, because the thing it measures — a customer
 * browsing a menu — has no account behind it. That makes this the most exposed
 * write path in the product, so the rules are strict and they all live one
 * layer down in `lib/analytics.ts`: the tenant is resolved from a slug rather
 * than accepted as an id, every field is allowlisted, and nothing here can
 * write to any other table.
 *
 * It always returns 204, even when it rejects the payload.
 *
 * That is deliberate. The caller is `navigator.sendBeacon` on a page that is
 * often already unloading — nobody reads the status, and a body would be thrown
 * away. More importantly, a public endpoint that reports *why* it declined
 * something is a public endpoint that will tell an unauthenticated caller which
 * slugs exist. Silence costs us nothing and tells them nothing.
 */

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { recordEvents, MAX_EVENTS_PER_BEACON } from "@/lib/analytics";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A phone that opens a menu, scrolls, and checks out generates maybe fifteen
 * events over a couple of minutes, and the tracker batches them into beacons
 * five seconds apart. Sixty beacons a minute is far above any honest client and
 * far below what it would take to make this table a problem.
 */
const BEACON_LIMIT = 60;
const BEACON_WINDOW_MS = 60_000;

/** Bodies are small by construction. Anything larger is not our tracker. */
const MAX_BODY_BYTES = 16 * 1024;

const NO_CONTENT = () => new NextResponse(null, { status: 204 });

export async function POST(req: Request) {
  try {
    const h = headers();

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return NO_CONTENT();

    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return NO_CONTENT();
    }
    if (!body || typeof body !== "object") return NO_CONTENT();

    const payload = body as Record<string, unknown>;
    const slug = typeof payload.slug === "string" ? payload.slug : null;
    const anonId = typeof payload.anonId === "string" ? payload.anonId : null;
    if (!slug || !anonId) return NO_CONTENT();

    // Keyed on the anon id *and* the forwarded address. Either alone is
    // trivially rotated; together they make a flood cost something. This is the
    // single-process limiter from `lib/rate-limit.ts` — see its header for why
    // that's an accepted trade here rather than a security claim.
    const ip =
      h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      h.get("x-real-ip") ??
      "unknown";
    const limited = checkRateLimit(`track:${anonId}:${ip}`, BEACON_LIMIT, BEACON_WINDOW_MS);
    if (!limited.allowed) return NO_CONTENT();

    const events = Array.isArray(payload.events)
      ? payload.events.slice(0, MAX_EVENTS_PER_BEACON)
      : [];
    if (!events.length) return NO_CONTENT();

    await recordEvents({
      slug,
      anonId,
      source: typeof payload.source === "string" ? payload.source : null,
      // Referrer comes from the header, not the body: the client has no reason
      // to be trusted about where it came from, and this way a spoofed body
      // can't reattribute a tenant's traffic to a channel that didn't send it.
      referrer: h.get("referer"),
      userAgent: h.get("user-agent"),
      events: events as never[],
    });
  } catch {
    // Analytics must never be able to surface an error on a storefront, and a
    // 500 here would show up in monitoring as if ordering were broken.
  }

  return NO_CONTENT();
}
