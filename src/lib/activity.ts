import "server-only";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import type { LoginMethod } from "@prisma/client";

/**
 * Operator login history — the one door for recording and reading it.
 *
 * Two writers and one reader, on the same "one door" principle as the rest of
 * this codebase: recording a login and recording a page load both go through
 * here, and every admin query reads through here, so the rules (what a path is
 * allowed to contain, how a session is reconstructed) live in one place rather
 * than being re-derived at each call site.
 *
 * This is an **admin-only** feature. There is no owner-facing surface, and
 * there are no customers yet, so every subject is an operator (ADMIN or OWNER).
 *
 * Nothing here throws into its caller. A failure to record a login must never
 * fail the login itself, and a failure to record a page view must never blank
 * the page — history is diagnostics, not a gate. Every write is best-effort and
 * swallows its own error.
 */

/** Header the middleware stamps with the request pathname (query stripped). */
export const ACTIVITY_PATH_HEADER = "x-hearth-path";

/**
 * Consecutive activity events closer together than this are one working
 * session; a longer gap starts a new one. Also the per-event cap on how much
 * a single page load can contribute to "time spent" — a tab left open
 * overnight must not read as an eight-hour session.
 */
export const IDLE_GAP_MS = 30 * 60_000; // 30 minutes

/** Pull best-effort forensics off the incoming request headers. */
export function requestContext(): { ip: string | null; userAgent: string | null } {
  try {
    const h = headers();
    // x-forwarded-for is a comma list; the client is the first hop.
    const fwd = h.get("x-forwarded-for");
    const ip = (fwd ? fwd.split(",")[0] : h.get("x-real-ip"))?.trim() || null;
    const userAgent = h.get("user-agent");
    return { ip, userAgent: userAgent ? userAgent.slice(0, 400) : null };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Record one authentication. Called from each of the doors that establishes a
 * session — password login, signup, invite redemption, OAuth, and the admin's
 * impersonation swap. `ip`/`userAgent` default to the current request's headers
 * when omitted.
 */
export async function recordLogin(input: {
  userId: string;
  method: LoginMethod;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    const ctx =
      input.ip === undefined || input.userAgent === undefined ? requestContext() : null;
    await prisma.loginEvent.create({
      data: {
        userId: input.userId,
        method: input.method,
        ip: input.ip !== undefined ? input.ip : ctx?.ip ?? null,
        userAgent: input.userAgent !== undefined ? input.userAgent : ctx?.userAgent ?? null,
      },
    });
  } catch {
    // Diagnostics must never break a sign-in.
  }
}

/**
 * Strip a path down to what's safe to store: no query string (it can carry a
 * token or a customer email), no fragment, length-capped. Returns null for
 * anything we deliberately don't log — API routes, static assets, the beacon.
 */
export function cleanPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let p = raw.split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/")) return null;
  // Only operator surfaces are worth recording; everything else is noise.
  const tracked =
    p === "/admin" ||
    p.startsWith("/admin/") ||
    p === "/dashboard" ||
    p.startsWith("/dashboard/") ||
    p === "/onboarding" ||
    p.startsWith("/onboarding/");
  if (!tracked) return null;
  return p.slice(0, 200);
}

/**
 * Record one authenticated page load. Called from `requireAdmin` /
 * `requireOwner`, which every admin and dashboard page passes through. The path
 * comes from the header the middleware set; an untracked or missing path is a
 * silent no-op rather than an error.
 */
export async function recordActivity(userId: string): Promise<void> {
  try {
    const h = headers();
    const path = cleanPath(h.get(ACTIVITY_PATH_HEADER));
    if (!path) return;
    const method = (h.get("x-hearth-method") || "GET").slice(0, 8);
    await prisma.activityEvent.create({ data: { userId, path, method } });
  } catch {
    // Never let recording a page view blank the page.
  }
}

// ---------------------------------------------------------------------------
// Reading — admin only
// ---------------------------------------------------------------------------

export type LoginRow = {
  id: string;
  method: LoginMethod;
  ip: string | null;
  userAgent: string | null;
  at: Date;
  user: { id: string; email: string; name: string | null; role: string };
};

/** The most recent logins across every operator, newest first. */
export async function recentLogins(limit = 100): Promise<LoginRow[]> {
  const rows = await prisma.loginEvent.findMany({
    orderBy: { at: "desc" },
    take: limit,
    include: { user: { select: { id: true, email: true, name: true, role: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    method: r.method,
    ip: r.ip,
    userAgent: r.userAgent,
    at: r.at,
    user: r.user,
  }));
}

export type UserActivitySummary = {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  logins: number;
  lastLoginAt: Date | null;
  pageViews: number;
  /** Reconstructed active time across all sessions, in milliseconds. */
  activeMs: number;
  lastSeenAt: Date | null;
};

/**
 * Per-operator rollup over a window: how often they logged in, how many pages
 * they loaded, and how long they were actually active. "Active time" sums the
 * gaps between consecutive events per user, clamped at `IDLE_GAP_MS` so an
 * abandoned tab doesn't inflate it — the same clamp the storefront analytics
 * apply to dwell time, and for the same reason.
 */
export async function activitySummary(sinceDays = 30): Promise<UserActivitySummary[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 3600_000);

  const [users, logins, events] = await Promise.all([
    prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true },
    }),
    prisma.loginEvent.findMany({
      where: { at: { gte: since } },
      select: { userId: true, at: true },
      orderBy: { at: "asc" },
    }),
    prisma.activityEvent.findMany({
      where: { at: { gte: since } },
      select: { userId: true, at: true },
      orderBy: { at: "asc" },
    }),
  ]);

  const byUser = new Map<string, UserActivitySummary>();
  for (const u of users) {
    byUser.set(u.id, {
      userId: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      logins: 0,
      lastLoginAt: null,
      pageViews: 0,
      activeMs: 0,
      lastSeenAt: null,
    });
  }

  for (const l of logins) {
    const row = byUser.get(l.userId);
    if (!row) continue;
    row.logins += 1;
    if (!row.lastLoginAt || l.at > row.lastLoginAt) row.lastLoginAt = l.at;
  }

  // Events arrive per-user in time order (global asc order preserves per-user
  // order). Walk each user's stream, adding the clamped gap between adjacent
  // events to their active time.
  const lastAt = new Map<string, Date>();
  for (const e of events) {
    const row = byUser.get(e.userId);
    if (!row) continue;
    row.pageViews += 1;
    if (!row.lastSeenAt || e.at > row.lastSeenAt) row.lastSeenAt = e.at;
    const prev = lastAt.get(e.userId);
    if (prev) {
      const gap = e.at.getTime() - prev.getTime();
      if (gap > 0) row.activeMs += Math.min(gap, IDLE_GAP_MS);
    }
    lastAt.set(e.userId, e.at);
  }

  // Only operators who did something in the window are interesting.
  return [...byUser.values()]
    .filter((r) => r.logins > 0 || r.pageViews > 0)
    .sort((a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0));
}

/**
 * The same rollup as `activitySummary`, but scoped to the operators attached to
 * one restaurant — for the Analytics tab of a tenant's admin page, so "who's
 * been in this account and what were they doing" sits next to that account's
 * storefront numbers. Returns the per-user summary and the raw recent sign-ins,
 * both already filtered to this tenant's users.
 */
export async function activityForRestaurant(
  restaurantId: string,
  sinceDays = 30
): Promise<{ summary: UserActivitySummary[]; logins: LoginRow[] }> {
  const since = new Date(Date.now() - sinceDays * 24 * 3600_000);

  const users = await prisma.user.findMany({
    where: { restaurantId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (users.length === 0) return { summary: [], logins: [] };

  const ids = users.map((u) => u.id);

  const [logins, events, loginRows] = await Promise.all([
    prisma.loginEvent.findMany({
      where: { userId: { in: ids }, at: { gte: since } },
      select: { userId: true, at: true },
      orderBy: { at: "asc" },
    }),
    prisma.activityEvent.findMany({
      where: { userId: { in: ids }, at: { gte: since } },
      select: { userId: true, at: true },
      orderBy: { at: "asc" },
    }),
    prisma.loginEvent.findMany({
      where: { userId: { in: ids } },
      orderBy: { at: "desc" },
      take: 50,
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    }),
  ]);

  const byUser = new Map<string, UserActivitySummary>();
  for (const u of users) {
    byUser.set(u.id, {
      userId: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      logins: 0,
      lastLoginAt: null,
      pageViews: 0,
      activeMs: 0,
      lastSeenAt: null,
    });
  }

  for (const l of logins) {
    const row = byUser.get(l.userId);
    if (!row) continue;
    row.logins += 1;
    if (!row.lastLoginAt || l.at > row.lastLoginAt) row.lastLoginAt = l.at;
  }

  const lastAt = new Map<string, Date>();
  for (const e of events) {
    const row = byUser.get(e.userId);
    if (!row) continue;
    row.pageViews += 1;
    if (!row.lastSeenAt || e.at > row.lastSeenAt) row.lastSeenAt = e.at;
    const prev = lastAt.get(e.userId);
    if (prev) {
      const gap = e.at.getTime() - prev.getTime();
      if (gap > 0) row.activeMs += Math.min(gap, IDLE_GAP_MS);
    }
    lastAt.set(e.userId, e.at);
  }

  const summary = [...byUser.values()].sort(
    (a, b) => (b.lastSeenAt?.getTime() ?? 0) - (a.lastSeenAt?.getTime() ?? 0)
  );

  return {
    summary,
    logins: loginRows.map((r) => ({
      id: r.id,
      method: r.method,
      ip: r.ip,
      userAgent: r.userAgent,
      at: r.at,
      user: r.user,
    })),
  };
}

/**
 * Everything the single-user page needs: the rollup for this one operator, its
 * recent sign-ins, and the pages they load most. One door, so the user page and
 * the platform page count the same way.
 */
export async function userActivity(
  userId: string,
  sinceDays = 30
): Promise<{ summary: UserActivitySummary | null; logins: LoginRow[]; topPaths: PathCount[] }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });
  if (!user) return { summary: null, logins: [], topPaths: [] };

  const since = new Date(Date.now() - sinceDays * 24 * 3600_000);

  const [logins, events, loginRows, topPaths] = await Promise.all([
    prisma.loginEvent.findMany({
      where: { userId, at: { gte: since } },
      select: { at: true },
      orderBy: { at: "asc" },
    }),
    prisma.activityEvent.findMany({
      where: { userId, at: { gte: since } },
      select: { at: true },
      orderBy: { at: "asc" },
    }),
    prisma.loginEvent.findMany({
      where: { userId },
      orderBy: { at: "desc" },
      take: 50,
      include: { user: { select: { id: true, email: true, name: true, role: true } } },
    }),
    topPathsForUser(userId, sinceDays, 20),
  ]);

  const summary: UserActivitySummary = {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    logins: logins.length,
    lastLoginAt: logins.length ? logins[logins.length - 1].at : null,
    pageViews: events.length,
    activeMs: 0,
    lastSeenAt: events.length ? events[events.length - 1].at : null,
  };
  for (let i = 1; i < events.length; i++) {
    const gap = events[i].at.getTime() - events[i - 1].at.getTime();
    if (gap > 0) summary.activeMs += Math.min(gap, IDLE_GAP_MS);
  }

  return {
    summary,
    logins: loginRows.map((r) => ({
      id: r.id,
      method: r.method,
      ip: r.ip,
      userAgent: r.userAgent,
      at: r.at,
      user: r.user,
    })),
    topPaths,
  };
}

export type PathCount = { path: string; count: number };

/** What one operator spent their time on: their most-loaded pages in a window. */
export async function topPathsForUser(userId: string, sinceDays = 30, limit = 20): Promise<PathCount[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 3600_000);
  const grouped = await prisma.activityEvent.groupBy({
    by: ["path"],
    where: { userId, at: { gte: since } },
    _count: { path: true },
    orderBy: { _count: { path: "desc" } },
    take: limit,
  });
  return grouped.map((g) => ({ path: g.path, count: g._count.path }));
}
