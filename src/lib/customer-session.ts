import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { FEATURES } from "@/lib/features";

/**
 * The storefront sign-in cookie.
 *
 * Separate from `hearth_session` on purpose, and not merely by name. Two
 * properties fall out of the separation that would be lost if a diner and an
 * owner shared a session shape:
 *
 * - **A customer session names its tenant and is worthless anywhere else.**
 *   Every read checks the restaurant it was issued for. A cookie minted on one
 *   storefront cannot address another's data even though both are served by the
 *   same application under whatever host the tenant has pointed at us.
 * - **A customer session can never satisfy `requireOwner`.** The dashboard
 *   guards read `hearth_session` and nothing else, so there is no code path
 *   where a diner's cookie is examined for a role. Sharing one cookie would
 *   make that a matter of every guard checking a field correctly, forever.
 *
 * It grants exactly one thing: seeing your own past orders at the restaurant
 * you signed in at, and having your name and email prefilled at checkout. It
 * does not grant messaging consent — that has one door, the checkout checkbox,
 * and `lib/sms.ts` reads `optInStatus` and nothing else.
 */

export const CUSTOMER_COOKIE = "hearth_customer";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export type CustomerSession = {
  accountId: string;
  /** The tenant this session is valid for. Checked on every read. */
  restaurantId: string;
  email: string | null;
  name: string | null;
};

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is missing or too short (need 16+ chars).");
  }
  return new TextEncoder().encode(s);
}

export const customerCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE_SECONDS,
};

export async function setCustomerSession(payload: CustomerSession) {
  const token = await new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secret());
  cookies().set(CUSTOMER_COOKIE, token, customerCookieOptions);
}

export function clearCustomerSession() {
  cookies().delete(CUSTOMER_COOKIE);
}

/**
 * The signed-in customer, **for a specific tenant**.
 *
 * `restaurantId` is a required argument rather than something the caller can
 * omit and check later. A signature-valid cookie from another storefront is
 * exactly the case this guards, and making the check optional is how it gets
 * skipped in the one place it mattered.
 */
export async function getCustomerSession(restaurantId: string): Promise<CustomerSession | null> {
  // MVP: customer accounts are hidden. See `lib/features.ts` — this is the
  // choke point. Returning null is "nobody is signed in", which is the ordinary
  // case on a storefront and therefore a branch every caller already handles.
  // Deliberately gated on the *read* rather than the write: a diner who signed
  // in before the feature was hidden is simply signed out, not shown a
  // half-working account page.
  if (!FEATURES.customerAccounts) return null;
  const token = cookies().get(CUSTOMER_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const p = payload as Record<string, unknown>;
    if (typeof p.accountId !== "string" || typeof p.restaurantId !== "string") return null;
    if (p.restaurantId !== restaurantId) return null;
    return {
      accountId: p.accountId,
      restaurantId: p.restaurantId,
      email: typeof p.email === "string" ? p.email : null,
      name: typeof p.name === "string" ? p.name : null,
    };
  } catch {
    return null;
  }
}
