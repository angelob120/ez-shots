/**
 * Storefront formatting helpers, plus a re-export of the theme layer.
 *
 * The theming itself moved to `src/lib/store-theme.ts` when presets landed:
 * the branding editor and the onboarding wizard both need to render the theme
 * picker, and neither is a customer-facing component, so the module could not
 * stay under `components/customer/`. Everything that used to live here is
 * re-exported, so the existing call sites keep working and there is still only
 * one definition of what a preset means.
 *
 * `money` and `delta` stay — they are display formatting for the store, not
 * theming. `lib/money.ts` remains the door for money *arithmetic*.
 */

export {
  readableInkOn,
  storeVars,
  storeRootProps,
  storeTheme,
  storeThemeAttr,
  isAlwaysDark,
  contrastRatio,
  STORE_THEMES,
  DEFAULT_STORE_THEME,
  type StoreThemeId,
  type StoreThemeDef,
} from "@/lib/store-theme";

export function money(cts: number): string {
  return `$${(cts / 100).toFixed(2)}`;
}

/** Signed delta for modifier prices: "+$1.50", "-$0.50", or "" for free. */
export function delta(cts: number): string {
  if (cts === 0) return "";
  return cts > 0 ? `+${money(cts)}` : `−${money(Math.abs(cts))}`;
}
