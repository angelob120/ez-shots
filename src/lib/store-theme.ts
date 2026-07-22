/**
 * Storefront theme presets — the "same skeleton, different look" layer.
 *
 * Every tenant's website is the same structure (StoreLanding + StoreApp). What
 * a preset changes is the surface: the neutral palette the accent sits on, the
 * type, and how round the corners are. That is deliberately the whole list. An
 * owner picking a look should not be able to produce a storefront that is
 * broken, and the fastest way to hand them one is to let them move the parts
 * that hold the page together.
 *
 * ── Where the tokens actually live ──────────────────────────────────────────
 *
 * This module holds preset *metadata*. The token values are CSS, in the
 * `.store[data-preset="…"]` blocks in globals.css, and that split is not
 * organisational tidiness — it is the only arrangement that works.
 *
 * The SYSTEM theme (the default) follows the visitor's device through a
 * `prefers-color-scheme` media query. An inline `style` attribute beats any
 * stylesheet rule, media query or not. So a preset that emitted `--s-bg`
 * inline would pin every tenant on SYSTEM to their light palette forever, on a
 * phone in dark mode, and nothing about the code would look wrong.
 *
 * The accent is the exception and has to be inline: it is per tenant, from the
 * database, and cannot be enumerated in a stylesheet.
 *
 * The cost of the split is that a preset id here and a CSS block there can
 * drift apart. `scripts/store-theme.test.ts` parses the real globals.css and
 * fails if any preset is missing a block, in either palette, or if any text
 * token on it falls under WCAG AA — the same contract scripts/theme.test.ts
 * enforces for the operator console.
 *
 * Pure: no `server-only`, no Prisma. The editor imports it in the browser to
 * render the picker, and the storefront imports it on the server to render the
 * page. Both have to agree about what "warm" means.
 */

import type { CSSProperties } from "react";

/* ------------------------------------------------------------------ presets */

export type StoreThemeId = "classic" | "warm" | "bold" | "fresh" | "night";

export type StoreThemeDef = {
  id: StoreThemeId;
  label: string;
  /** One line in the picker. What kind of restaurant this suits. */
  blurb: string;
  /**
   * Swatches for the picker card, as hex. These are a *copy* of the CSS block's
   * bg/raised/ink, purely so the editor can draw a preview chip without
   * mounting a storefront. The test asserts they match the stylesheet, because
   * a picker that lies about the palette is worse than no picker.
   */
  swatch: { bg: string; raised: string; ink: string };
  /** Suggested accent when an owner picks this preset and has never set one. */
  suggestedAccent: string;
};

export const STORE_THEMES: StoreThemeDef[] = [
  {
    id: "classic",
    label: "Classic",
    blurb: "Clean paper white with crisp edges. Suits almost anything.",
    swatch: { bg: "#fbfbfa", raised: "#ffffff", ink: "#141414" },
    suggestedAccent: "#2563eb",
  },
  {
    id: "warm",
    label: "Warm",
    blurb: "Soft cream and rounded corners. Bakeries, cafés, comfort food.",
    swatch: { bg: "#fdfaf5", raised: "#ffffff", ink: "#1c1815" },
    suggestedAccent: "#b4462a",
  },
  {
    id: "bold",
    label: "Bold",
    blurb: "Heavy type, square corners, high contrast. Pizza, burgers, BBQ.",
    swatch: { bg: "#f7f7f5", raised: "#ffffff", ink: "#0b0b0b" },
    suggestedAccent: "#c4351d",
  },
  {
    id: "fresh",
    label: "Fresh",
    blurb: "Airy, cool, generous spacing. Salads, juice, poke, health food.",
    swatch: { bg: "#f8fbfa", raised: "#ffffff", ink: "#12211c" },
    suggestedAccent: "#0b7a56",
  },
  {
    id: "night",
    label: "Night",
    blurb: "Dark by default, photos pop. Bars, late-night, fine dining.",
    swatch: { bg: "#0e0f10", raised: "#17191b", ink: "#f2f3f4" },
    suggestedAccent: "#e0b455",
  },
];

export const DEFAULT_STORE_THEME: StoreThemeId = "classic";

const BY_ID = new Map(STORE_THEMES.map((t) => [t.id, t]));

/**
 * Coerce whatever is in the database to a preset that exists.
 *
 * The column is a plain String rather than an enum so a preset can be added or
 * renamed without a migration on every tenant row. The consequence is that a
 * removed preset leaves rows pointing at nothing, and the storefront must not
 * be the thing that discovers it — an unknown value falls back to Classic and
 * the page renders.
 */
export function storeTheme(id: string | null | undefined): StoreThemeDef {
  return BY_ID.get((id ?? "") as StoreThemeId) ?? BY_ID.get(DEFAULT_STORE_THEME)!;
}

/** The `data-preset` attribute value for the store root. */
export function storeThemeAttr(id: string | null | undefined): StoreThemeId {
  return storeTheme(id).id;
}

/**
 * Whether a preset is dark whatever the visitor's device says.
 *
 * `Restaurant.theme` (LIGHT/DARK/SYSTEM) is the owner's answer to "which
 * palette", and Night is a preset whose *only* palette is dark. The two would
 * contradict each other — a Night storefront set to LIGHT — so the preset
 * wins and the editor hides the light/dark control while Night is selected,
 * rather than offering a choice that does nothing.
 */
export function isAlwaysDark(id: string | null | undefined): boolean {
  return storeTheme(id).id === "night";
}

/* ------------------------------------------------------- accent computation */

function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channels(hex: string): string | null {
  const rgb = parseHex(hex);
  return rgb ? rgb.join(" ") : null;
}

function luminance([r, g, b]: [number, number, number]): number {
  const [rr, gg, bb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
}

/** WCAG contrast ratio between two hex colors. 1 = identical, 21 = black/white. */
export function contrastRatio(a: string, b: string): number {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return 1;
  const la = luminance(ca);
  const lb = luminance(cb);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Which ink the primary button needs — black or white.
 *
 * A mustard-yellow accent needs black text; a navy one needs white. Guessing
 * wrong makes the order button unreadable, which on this surface is the whole
 * product.
 *
 * Decided by measuring both, not by a luminance threshold. The threshold this
 * replaced sat at 0.45 and was wrong for exactly the colours restaurants pick:
 * a gold like #c9a227 fell just under it and got white text at 2.42:1, when
 * black would have given 8.7:1. Comparing the two ratios can't have that
 * failure mode, and costs one extra luminance calculation on a value computed
 * once per page render.
 */
export function readableInkOn(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return "#ffffff";
  return contrastRatio(hex, "#141414") >= contrastRatio(hex, "#ffffff")
    ? "#141414"
    : "#ffffff";
}

/**
 * Inline custom properties for the store root element.
 *
 * Accent only — see the note at the top of this file for why the palette must
 * not be emitted here. Values are RGB channel triplets, not hex, so Tailwind's
 * alpha modifiers (`bg-s-accent/10`) resolve against them.
 */
export function storeVars(accentColor: string): CSSProperties {
  const accent = channels(accentColor) ?? "47 51 55";
  const ink = channels(readableInkOn(parseHex(accentColor) ? accentColor : "#2f3337"))!;
  return {
    ["--store-accent" as string]: accent,
    ["--store-accent-ink" as string]: ink,
  };
}

/**
 * Everything the store root needs: the preset attribute, the light/dark
 * choice, and the accent.
 *
 * One function so the four callers that mount a store root (the storefront,
 * the landing page, the account page, the order status page) cannot each get a
 * different subset right. Note `data-theme` is forced to dark for an
 * always-dark preset — see `isAlwaysDark`.
 */
export function storeRootProps(r: {
  themePreset?: string | null;
  theme: string;
  accentColor: string;
}): { "data-preset": StoreThemeId; "data-theme": string; style: CSSProperties } {
  const preset = storeThemeAttr(r.themePreset);
  return {
    "data-preset": preset,
    "data-theme": isAlwaysDark(preset) ? "dark" : r.theme.toLowerCase(),
    style: storeVars(r.accentColor),
  };
}
