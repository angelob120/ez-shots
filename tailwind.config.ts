import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Operator surfaces (dashboard, admin, marketing). These read CSS
        // custom properties for the same reason the store tokens below do —
        // the palette flips between light and dark at runtime, and a rebuilt
        // stylesheet per theme would mean shipping two of everything.
        //
        // Values are RGB channel triplets, not hex, because Tailwind needs
        // `rgb(var(--x) / <alpha-value>)` for opacity modifiers like
        // `bg-warn/15` — of which there are a couple of dozen already.
        base: "rgb(var(--h-base) / <alpha-value>)",
        surface: "rgb(var(--h-surface) / <alpha-value>)",
        surface2: "rgb(var(--h-surface-2) / <alpha-value>)",
        line: "rgb(var(--h-line) / <alpha-value>)",
        line2: "rgb(var(--h-line-2) / <alpha-value>)",
        ink: "rgb(var(--h-ink) / <alpha-value>)",
        dim: "rgb(var(--h-dim) / <alpha-value>)",
        mute: "rgb(var(--h-mute) / <alpha-value>)",
        accent: "rgb(var(--h-accent) / <alpha-value>)",
        accentDim: "rgb(var(--h-accent-dim) / <alpha-value>)",
        accentInk: "rgb(var(--h-accent-ink) / <alpha-value>)",
        accentHover: "rgb(var(--h-accent-hover) / <alpha-value>)",

        // The primary button's fill, and deliberately *not* `accent`.
        // `accent` is tuned to be readable as text on a dark page; a fill
        // has to be readable underneath white text, and on dark those two
        // pull in opposite directions — #3b82f6 is a good link colour and
        // a 3.68:1 button. Splitting them lets each meet its own bar.
        accentFill: "rgb(var(--h-accent-fill) / <alpha-value>)",
        warn: "rgb(var(--h-warn) / <alpha-value>)",
        bad: "rgb(var(--h-bad) / <alpha-value>)",
        good: "rgb(var(--h-good) / <alpha-value>)",

        // The destructive button's three surfaces. Separate tokens rather than
        // opacity over `bad`, because the hover fill has to be a *tint* on
        // white and a *shade* on near-black — the same alpha cannot produce
        // both, and a translucent red over a white card comes out pink.
        badLine: "rgb(var(--h-bad-line) / <alpha-value>)",
        badInk: "rgb(var(--h-bad-ink) / <alpha-value>)",
        badBg: "rgb(var(--h-bad-bg) / <alpha-value>)",

        // Same treatment for the mode banner — the strip that says charges
        // aren't real. It's the one piece of chrome that must not be subtle,
        // and amber-on-amber is precisely what a naive light flip destroys.
        warnLine: "rgb(var(--h-warn-line) / <alpha-value>)",
        warnInk: "rgb(var(--h-warn-ink) / <alpha-value>)",
        warnDim: "rgb(var(--h-warn-dim) / <alpha-value>)",
        warnBg: "rgb(var(--h-warn-bg) / <alpha-value>)",
        goodLine: "rgb(var(--h-good-line) / <alpha-value>)",
        goodBg: "rgb(var(--h-good-bg) / <alpha-value>)",

        // Customer store. These read CSS custom properties so a tenant's
        // accent can change at runtime without a rebuild.
        s: {
          bg: "rgb(var(--s-bg) / <alpha-value>)",
          raised: "rgb(var(--s-raised) / <alpha-value>)",
          ink: "rgb(var(--s-ink) / <alpha-value>)",
          dim: "rgb(var(--s-dim) / <alpha-value>)",
          mute: "rgb(var(--s-mute) / <alpha-value>)",
          line: "rgb(var(--s-line) / <alpha-value>)",
          line2: "rgb(var(--s-line-2) / <alpha-value>)",
          accent: "rgb(var(--store-accent) / <alpha-value>)",
          accentInk: "rgb(var(--store-accent-ink) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "20px",
        // Storefront-only, and preset-driven. `rounded-s` on a store surface
        // resolves through the theme preset (see the .store[data-preset] blocks
        // in globals.css), which is how Bold gets square corners and Warm gets
        // soft ones without either shipping its own components. Do not use
        // these on operator surfaces — the var is undefined there, and an
        // undefined radius silently computes to 0.
        s: "var(--s-radius)",
        "s-lg": "var(--s-radius-lg)",
      },
    },
  },
  plugins: [],
};
export default config;
