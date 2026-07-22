/**
 * Rules for the tenant slug — the thing that makes /r/[slug] work.
 *
 * An owner can change this from the dashboard, which means it is no longer a
 * value only we generate. Two things have to hold: the result must be a legal
 * slug, and it must not collide with a first-class route on this app. If a
 * tenant took "login", /r/login would still work, but every printed shortcut
 * and every future top-level route becomes a trap. Cheaper to reserve.
 */

import { slugify } from "@/lib/money";

export const SLUG_MIN = 3;
export const SLUG_MAX = 48;

/** Top-level routes and words we may want to claim later. */
export const RESERVED_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "dashboard",
  "login",
  "logout",
  "signup",
  "onboarding",
  "pricing",
  "support",
  "help",
  "about",
  "contact",
  "terms",
  "privacy",
  "static",
  "public",
  "assets",
  "media",
  "r",
  "www",
  "mail",
  "settings",
  "account",
  "billing",
  "order",
  "orders",
  "menu",
  "checkout",
  "cart",
  "new",
  "edit",
  "test",
]);

export type SlugCheck = { ok: true; slug: string } | { ok: false; error: string };

/**
 * Normalize and validate a slug an owner typed. Returns the cleaned value so
 * callers store exactly what was validated — never the raw input.
 */
export function checkSlug(raw: string): SlugCheck {
  const slug = slugify(raw);
  if (!slug) {
    return { ok: false, error: "Use letters and numbers — that address is empty after cleanup." };
  }
  if (slug.length < SLUG_MIN) {
    return { ok: false, error: `Too short — use at least ${SLUG_MIN} characters.` };
  }
  if (slug.length > SLUG_MAX) {
    return { ok: false, error: `Too long — keep it under ${SLUG_MAX} characters.` };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `"${slug}" is reserved. Pick something closer to your name.` };
  }
  return { ok: true, slug };
}
