import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import {
  SESSION_COOKIE,
  cookieOptions,
  signSession,
  verifySession,
  type SessionPayload,
} from "@/lib/session";
import { recordActivity } from "@/lib/activity";

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash);
}

export async function getSession(): Promise<SessionPayload | null> {
  return verifySession(cookies().get(SESSION_COOKIE)?.value);
}

export async function setSession(payload: SessionPayload) {
  const token = await signSession(payload);
  cookies().set(SESSION_COOKIE, token, cookieOptions);
}

export async function clearSession() {
  cookies().delete(SESSION_COOKIE);
}

/** Guards /admin. */
export async function requireAdmin(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.role !== "ADMIN") redirect("/dashboard");
  // Record the page load as operator activity. Best-effort and self-swallowing
  // — see lib/activity.ts. It reads the pathname from the header middleware set,
  // so a server action (which has no tracked path) is a silent no-op.
  await recordActivity(s.userId);
  return s;
}

/**
 * Guards /dashboard. Returns the session plus the tenant it is scoped to.
 * Every owner query must be filtered by this restaurantId — it is the only
 * thing standing between tenants.
 */
export async function requireOwner(): Promise<{ session: SessionPayload; restaurantId: string }> {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.restaurantId) redirect("/admin");
  await recordActivity(s.userId);
  return { session: s, restaurantId: s.restaurantId };
}

export async function authenticate(email: string, password: string) {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { restaurant: true },
  });
  if (!user) return null;
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return null;
  if (user.restaurant && user.restaurant.status === "SUSPENDED") return null;
  return user;
}
