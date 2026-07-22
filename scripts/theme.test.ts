/**
 * Tests for the operator theme.
 *
 * Two halves, and the second is the one worth having.
 *
 * The first is the SYSTEM contract: SYSTEM is represented as the *absence* of
 * a `data-h-theme` attribute, because that is what lets the stylesheet's
 * `prefers-color-scheme` query decide with no client-side probe and therefore
 * no flash of the wrong palette. A well-meaning refactor that starts emitting
 * `data-h-theme="system"` would break nothing visible in dark mode on a dark
 * machine — the default palette would still apply — and would silently strand
 * every operator whose laptop is set to light. So it is asserted rather than
 * left to a comment.
 *
 * The second is contrast. A dark palette is forgiving; a light one is not, and
 * this console is built almost entirely from 11–13px type, which is where
 * WCAG's 4.5:1 floor actually bites. The values in globals.css were chosen by
 * eye, and "chosen by eye" is exactly the kind of thing that survives review
 * and fails an accessibility audit a year later. This parses the real
 * stylesheet — not a copy of the numbers — so drifting a token without
 * re-checking it fails here.
 *
 * Pure; no Prisma, no request context. Run with `npx tsx scripts/theme.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isTheme, themeAttr, THEME_COOKIE, type Theme } from "../src/lib/theme";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The SYSTEM contract
// ---------------------------------------------------------------------------

test("system resolves to no attribute, so the media query decides", () => {
  assert.equal(themeAttr("system"), undefined);
});

test("explicit choices resolve to themselves", () => {
  assert.equal(themeAttr("light"), "light");
  assert.equal(themeAttr("dark"), "dark");
});

test("isTheme accepts exactly the three values", () => {
  for (const v of ["light", "dark", "system"] as const) assert.equal(isTheme(v), true);
});

test("isTheme rejects near-misses and junk", () => {
  // A cookie is attacker-writable in the sense that anyone can hand-edit it;
  // the consequence here is only a bad attribute, but the fallback to SYSTEM
  // is what keeps a garbage value from rendering an unstyled page.
  for (const v of ["Light", "DARK", "", "auto", "system ", null, undefined, 0, {}, ["dark"]]) {
    assert.equal(isTheme(v), false, `should reject ${JSON.stringify(v)}`);
  }
});

test("the cookie name is stable", () => {
  // Renaming this silently resets every operator's saved preference back to
  // SYSTEM, with no error anywhere. Worth a test purely as a speed bump.
  assert.equal(THEME_COOKIE, "hearth_theme");
});

// ---------------------------------------------------------------------------
// Contrast
// ---------------------------------------------------------------------------

const CSS = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

/** Pulls one `--h-*` block out of globals.css by its opening selector. */
function tokens(selector: string): Record<string, [number, number, number]> {
  const start = CSS.indexOf(selector);
  assert.notEqual(start, -1, `no block for ${selector} — did the selector change?`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const body = CSS.slice(open + 1, close);

  const out: Record<string, [number, number, number]> = {};
  for (const m of body.matchAll(/--(h-[a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

/** WCAG 2.1 relative luminance. */
function luminance([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = tokens('.hearth-shell[data-h-theme="light"]');
const DARK = tokens(":root,");

// Text tokens that carry real copy, against both surfaces they're drawn on.
// `mute` is held to 4.5 rather than the large-text 3.0 allowance on purpose:
// it is used for 11px uppercase stat labels, which is the opposite of large.
const TEXT = ["h-ink", "h-dim", "h-mute", "h-accent", "h-warn", "h-bad", "h-good"] as const;
const SURFACES = ["h-base", "h-surface", "h-surface-2"] as const;

for (const [themeName, palette] of [
  ["light", LIGHT],
  ["dark", DARK],
] as const) {
  for (const ink of TEXT) {
    for (const bg of SURFACES) {
      test(`${themeName}: ${ink} on ${bg} meets AA`, () => {
        const fg = palette[ink];
        const back = palette[bg];
        assert.ok(fg, `${themeName} is missing --${ink}`);
        assert.ok(back, `${themeName} is missing --${bg}`);

        const ratio = contrast(fg, back);
        assert.ok(
          ratio >= 4.5,
          `--${ink} on --${bg} in ${themeName} is ${ratio.toFixed(2)}:1, below the 4.5:1 floor`
        );
      });
    }
  }

  test(`${themeName}: accent ink is legible on the accent fill`, () => {
    // The primary button. This is checked against `accent-fill` rather than
    // `accent` because they are different colours for exactly this reason —
    // see the note in tailwind.config.ts. Getting it wrong produces
    // white-on-mid-blue, which looks fine to anyone who already knows what
    // the button says.
    const ratio = contrast(palette["h-accent-ink"], palette["h-accent-fill"]);
    assert.ok(ratio >= 4.5, `accentInk on accentFill in ${themeName} is ${ratio.toFixed(2)}:1`);
  });

  test(`${themeName}: the primary button's hover state stays legible`, () => {
    // A hover that darkens on one theme and lightens on the other is the easy
    // mistake; whichever direction it goes, white has to survive it.
    const ratio = contrast(palette["h-accent-ink"], palette["h-accent-hover"]);
    assert.ok(ratio >= 4.5, `accentInk on accentHover in ${themeName} is ${ratio.toFixed(2)}:1`);
  });

  test(`${themeName}: the primary button is visible against the page`, () => {
    // The corollary of darkening the fill for text contrast: darken it too far
    // on a dark page and the button disappears into the background.
    const ratio = contrast(palette["h-accent-fill"], palette["h-base"]);
    assert.ok(ratio >= 1.5, `accentFill on base in ${themeName} is ${ratio.toFixed(2)}:1`);
  });

  test(`${themeName}: the mode banner stays loud`, () => {
    // The strip that says charges aren't real. It is the one piece of chrome
    // in this product that must not be subtle — an owner who misses it cooks
    // food for orders that collected nothing. Amber-on-amber is exactly what
    // a naive light flip destroys, so both the headline and the quieter body
    // line are checked against the band they sit on.
    assert.ok(
      contrast(palette["h-warn-ink"], palette["h-warn-bg"]) >= 4.5,
      `warnInk on warnBg in ${themeName} is too low — the banner headline`
    );
    assert.ok(
      contrast(palette["h-warn-dim"], palette["h-warn-bg"]) >= 4.5,
      `warnDim on warnBg in ${themeName} is too low — the banner body`
    );
    assert.ok(
      contrast(palette["h-bad-ink"], palette["h-warn-bg"]) >= 4.5,
      `badInk on warnBg in ${themeName} is too low — the expiry countdown`
    );
  });

  test(`${themeName}: the destructive button's own three tokens agree`, () => {
    // `danger` is the one variant built from a private trio rather than the
    // shared palette, so nothing else would catch it drifting.
    assert.ok(
      contrast(palette["h-bad-ink"], palette["h-bad-bg"]) >= 4.5,
      `badInk on badBg in ${themeName} is too low`
    );
    assert.ok(
      contrast(palette["h-bad-ink"], palette["h-surface"]) >= 4.5,
      `badInk on surface in ${themeName} is too low — the button's resting state`
    );
  });

  test(`${themeName}: borders are visible against their surfaces`, () => {
    // A non-text requirement, so 3:1 rather than 4.5 — but it has to clear
    // *something*, or a light theme turns into a page of floating text with no
    // card edges, which is the single most common way these go wrong.
    for (const bg of ["h-base", "h-surface"] as const) {
      const ratio = contrast(palette["h-line-2"], palette[bg]);
      assert.ok(
        ratio >= 1.2,
        `--h-line-2 on --${bg} in ${themeName} is ${ratio.toFixed(2)}:1 — invisible`
      );
    }
  });
}

test("both palettes define the same token set", () => {
  // The light block is a copy of the dark one with different numbers, and the
  // failure mode of that shape is adding a token to one and not the other —
  // which renders as `rgb()` with an empty var, i.e. transparent, i.e. text
  // that vanishes on exactly one theme.
  assert.deepEqual(Object.keys(LIGHT).sort(), Object.keys(DARK).sort());
});

test("the system media-query block matches the explicit light block", () => {
  // These are two copies of the same palette, and they have to agree or
  // "System on a light laptop" and "Light" become subtly different themes.
  const viaQuery = tokens('.hearth-shell:not([data-h-theme="dark"])');
  assert.deepEqual(viaQuery, LIGHT);
});

const themes: Theme[] = ["light", "dark", "system"];
test("every theme round-trips through the guard", () => {
  for (const t of themes) assert.equal(isTheme(themeAttr(t) ?? "system"), true);
});

console.log(`theme: ${passed} passed`);
