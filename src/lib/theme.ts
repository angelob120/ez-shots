import { cookies } from "next/headers";

/**
 * Operator theme preference (dashboard, admin, and the other `.hearth-shell`
 * surfaces). The customer storefront has its own, unrelated theme — that one
 * is the *owner's* branding choice about what their customers see, stored on
 * `Restaurant.theme`. This one is a personal display preference belonging to
 * whoever is sitting in front of the screen. They must not be conflated: an
 * owner reading their order board in a bright kitchen has not thereby decided
 * anything about their storefront's appearance.
 */
export type Theme = "light" | "dark" | "system";

export const THEME_COOKIE = "hearth_theme";

const VALUES: readonly Theme[] = ["light", "dark", "system"];

export function isTheme(v: unknown): v is Theme {
  return typeof v === "string" && (VALUES as readonly string[]).includes(v);
}

/**
 * SYSTEM is the default, and it is represented as the *absence* of a resolved
 * value rather than a third state the CSS has to test for. `themeAttr` returns
 * undefined for it, the root layout omits `data-h-theme` entirely, and the
 * `prefers-color-scheme` query in globals.css is left as the only thing that
 * decides. That is what makes this flash-free without an inline script: the
 * device's preference is applied by the stylesheet at parse time, and the
 * user's explicit override arrives in the first byte of HTML.
 */
export function themeAttr(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}

/** Reads the preference. Unset or corrupt cookie means SYSTEM. */
export function getTheme(): Theme {
  const raw = cookies().get(THEME_COOKIE)?.value;
  return isTheme(raw) ? raw : "system";
}

/**
 * A year, and deliberately not tied to the session cookie. Signing out should
 * not reset the display back to dark — the person is very often signing back
 * in on the same machine minutes later, and a preference that evaporates is
 * one they stop bothering to set.
 *
 * Not `httpOnly`, because there is nothing here to protect: the worst thing a
 * script that can already run on the page could do with it is change the
 * colours. `lax` still keeps it off cross-site requests.
 */
export function setThemeCookie(theme: Theme) {
  cookies().set(THEME_COOKIE, theme, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}
