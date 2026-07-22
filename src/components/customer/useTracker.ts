"use client";

import * as React from "react";

/**
 * Storefront instrumentation, client side.
 *
 * Three constraints shaped this, and they're worth stating because each one
 * rules out the obvious implementation:
 *
 * 1. **It must never slow the storefront down.** Events are queued in a ref and
 *    flushed on a timer, so no render ever waits on a network call and no state
 *    update is triggered by tracking. A hook that re-rendered the menu every
 *    time somebody scrolled would cost more than the data is worth.
 *
 * 2. **It must never break ordering.** Every path here is wrapped and
 *    swallowed. A customer with localStorage disabled, a blocked request, a
 *    sandboxed iframe — all of them still get to buy lunch. The tracker
 *    degrades to silence, never to an error.
 *
 * 3. **It must survive the page going away.** The most interesting event is
 *    usually the last one, and the last one happens as the tab closes. A
 *    normal `fetch` at that moment is cancelled; `sendBeacon` is not, which is
 *    why the flush path prefers it and only falls back to `fetch(keepalive)`.
 *
 * On identity: `anonId` is 22 random characters, minted here, kept in
 * localStorage under a per-tenant key. It is not a fingerprint and not derived
 * from anything about the device or the person. Two different restaurants get
 * two different ids for the same browser, so nothing about a customer follows
 * them between tenants — the ids exist to separate "one person, four visits"
 * from "four people", and that question only has meaning inside one storefront.
 */

export type TrackKind =
  | "PAGE_VIEW"
  | "VIEW_CHANGE"
  | "ITEM_VIEW"
  | "ITEM_ADD"
  | "ITEM_REMOVE"
  | "CART_VIEW"
  | "CHECKOUT_START"
  | "CHECKOUT_ERROR"
  | "SEARCH"
  | "HEARTBEAT";

type QueuedEvent = {
  kind: TrackKind;
  at: number;
  itemId?: string;
  view?: string;
  valueCts?: number;
  dwellMs?: number;
  label?: string;
};

const ANON_KEY = (slug: string) => `hearth.anon.${slug}`;
const ENDPOINT = "/api/track";

/** Flush cadence. Long enough to batch a burst of taps, short enough that a
 *  customer who closes the tab mid-session has already been counted. */
const FLUSH_MS = 5_000;

/** Force a flush at this many queued events, whatever the timer says. */
const FLUSH_AT = 15;

/**
 * Heartbeat interval, sent only while the tab is visible.
 *
 * Dwell time is the whole reason this exists: without a periodic signal, a
 * visit's duration is the gap between its first and last *action*, so somebody
 * who opened the menu and read it for four minutes before ordering registers as
 * having spent no time at all. Twenty seconds is a compromise — fine enough
 * that "how long do people actually read the menu" is answerable, coarse enough
 * that it isn't a meaningful battery or data cost on a phone.
 */
const HEARTBEAT_MS = 20_000;

function randomId(): string {
  try {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
      .replace(/[+/=]/g, "")
      .slice(0, 22);
  } catch {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 22);
  }
}

function readAnonId(slug: string): string {
  try {
    const existing = localStorage.getItem(ANON_KEY(slug));
    if (existing && /^[A-Za-z0-9_-]{12,64}$/.test(existing)) return existing;
    const fresh = randomId();
    localStorage.setItem(ANON_KEY(slug), fresh);
    return fresh;
  } catch {
    // Private mode, or storage denied. A per-load id still measures this visit
    // correctly; it just can't recognise the same person coming back, which
    // costs a returning-visitor number and nothing else.
    return randomId();
  }
}

/**
 * The acquisition tag, read once from the URL and remembered for the session.
 *
 * It's stripped from the address bar afterwards — `?src=qr` in a URL a customer
 * might share or bookmark would attribute their friend's visit to a QR code
 * nobody scanned, and it makes for an ugly link on a receipt.
 */
function readSource(): string | null {
  try {
    const url = new URL(window.location.href);
    const src = url.searchParams.get("src");
    if (!src) return null;
    url.searchParams.delete("src");
    window.history.replaceState({}, "", url.toString());
    return src.slice(0, 24);
  } catch {
    return null;
  }
}

export type Tracker = {
  /** Stable anonymous id for this browser and tenant. Sent with the order so
   *  the visit that produced it can be attributed — see `attachOrderToVisit`. */
  anonId: string;
  track: (kind: TrackKind, detail?: Omit<QueuedEvent, "kind" | "at">) => void;
  /** Push everything queued immediately. Called before navigating away. */
  flush: () => void;
};

export function useTracker(slug: string, enabled = true): Tracker {
  const queue = React.useRef<QueuedEvent[]>([]);
  const anonId = React.useRef<string>("");
  const source = React.useRef<string | null>(null);
  const lastEventAt = React.useRef<number>(Date.now());

  if (!anonId.current && typeof window !== "undefined") {
    anonId.current = readAnonId(slug);
  }

  const send = React.useCallback(
    (events: QueuedEvent[]) => {
      if (!events.length || typeof window === "undefined") return;
      const body = JSON.stringify({
        slug,
        anonId: anonId.current,
        source: source.current,
        events,
      });

      try {
        // sendBeacon survives the page unloading; fetch generally doesn't.
        if (navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: "application/json" }))) {
          return;
        }
      } catch {
        /* fall through */
      }

      try {
        void fetch(ENDPOINT, {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
          keepalive: true,
        }).catch(() => {});
      } catch {
        /* nothing more to try, and nothing worth telling the customer */
      }
    },
    [slug]
  );

  const flush = React.useCallback(() => {
    if (!queue.current.length) return;
    const batch = queue.current;
    // Swapped out before the send, not after: a slow request must not let a
    // second flush ship the same events twice.
    queue.current = [];
    send(batch);
  }, [send]);

  const track = React.useCallback(
    (kind: TrackKind, detail: Omit<QueuedEvent, "kind" | "at"> = {}) => {
      if (!enabled || typeof window === "undefined") return;
      const now = Date.now();
      queue.current.push({
        kind,
        at: now,
        // Time since the previous event is the per-screen dwell number. Derived
        // here rather than on the server because only the client knows the gap
        // was spent on the page rather than in a queue waiting to be flushed.
        dwellMs: Math.min(30 * 60 * 1000, Math.max(0, now - lastEventAt.current)),
        ...detail,
      });
      lastEventAt.current = now;
      if (queue.current.length >= FLUSH_AT) flush();
    },
    [enabled, flush]
  );

  // ── Lifecycle ─────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    source.current = readSource();
    track("PAGE_VIEW", { view: "landing" });

    const timer = window.setInterval(flush, FLUSH_MS);

    const heartbeat = window.setInterval(() => {
      // Only while visible. A backgrounded tab is not a customer reading a
      // menu, and counting it would turn "average visit: 90 seconds" into
      // "average visit: 40 minutes" for anyone who leaves tabs open.
      if (document.visibilityState === "visible") track("HEARTBEAT");
    }, HEARTBEAT_MS);

    // `pagehide` rather than `unload`: iOS Safari never fires `unload` for a
    // tab the user swipes away, which is most of how a phone leaves a page.
    const onHide = () => flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.clearInterval(timer);
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      flush();
    };
    // Mount only. Re-running this would double the timers and re-fire PAGE_VIEW.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { anonId: anonId.current, track, flush };
}

/**
 * Debounce for the search box.
 *
 * Recording a SEARCH event per keystroke would fill the events table with the
 * prefixes of words — "b", "bu", "bur", "burg" — and bury the term the customer
 * actually meant. Waiting for them to stop typing is what makes "what did
 * people search for" a readable list instead of a histogram of first letters.
 */
export function useDebouncedSearchTracking(
  query: string,
  onSettled: (term: string) => void,
  delayMs = 900
) {
  const settled = React.useRef<string>("");

  React.useEffect(() => {
    const term = query.trim();
    if (term.length < 2 || term === settled.current) return;
    const t = window.setTimeout(() => {
      settled.current = term;
      onSettled(term);
    }, delayMs);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, delayMs]);
}
