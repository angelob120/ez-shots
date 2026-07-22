/**
 * Tests for the storefront theme presets.
 *
 * The presets are a split system on purpose — metadata in
 * `src/lib/store-theme.ts`, token values in the `.store[data-preset="…"]`
 * blocks in globals.css — because an inline style would beat the
 * `prefers-color-scheme` media query and pin every SYSTEM tenant on their
 * light palette forever. See the header of store-theme.ts.
 *
 * A split system can drift, and neither half fails loudly when it does:
 *
 * - A preset in the module with **no CSS block** renders as Classic. The
 *   picker offers "Bold", the owner selects it, saves, and their site does not
 *   change. Nothing errors.
 * - A preset with a light block and **no dark twin** renders a white page on a
 *   dark phone. The stylesheet looks complete while it happens, and the owner
 *   probably never sees it — they built the site on a laptop.
 * - A **swatch that disagrees with the stylesheet** makes the picker lie about
 *   what you are choosing, which is worse than having no picker.
 *
 * So all three are asserted against the real globals.css, not a copy of the
 * numbers — same contract `scripts/theme.test.ts` enforces for the operator
 * console, for the same reason.
 *
 * Contrast is held to the same 4.5:1 floor as the operator console, `mute`
 * included. This surface is *more* type-constrained, not less: the storefront
 * footer, the modifier prices and the policy links are all 11–12px, and a
 * customer squinting at a service-fee disclosure is the exact case the floor
 * exists for.
 *
 * Pure; no Prisma, no request context.
 * Run with `npx tsx scripts/store-theme.test.ts`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  DEFAULT_STORE_THEME,
  STORE_THEMES,
  contrastRatio,
  isAlwaysDark,
  readableInkOn,
  storeRootProps,
  storeTheme,
  storeThemeAttr,
  storeVars,
} from "../src/lib/store-theme";

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
// Resolution
// ---------------------------------------------------------------------------

test("every preset resolves to itself", () => {
  for (const t of STORE_THEMES) assert.equal(storeTheme(t.id).id, t.id);
});

test("an unknown preset falls back to the default rather than throwing", () => {
  // The column is a plain String, so a renamed or removed preset leaves rows
  // pointing at nothing. The storefront must not be the thing that discovers
  // it — a customer gets a styled page and we find out from the console.
  for (const v of ["", "Classic", "neon", null, undefined, "night ", "0"]) {
    assert.equal(storeTheme(v).id, DEFAULT_STORE_THEME, `should coerce ${JSON.stringify(v)}`);
  }
});

test("the default preset is one that exists", () => {
  assert.ok(STORE_THEMES.some((t) => t.id === DEFAULT_STORE_THEME));
});

test("preset ids are unique", () => {
  const ids = STORE_THEMES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

// ---------------------------------------------------------------------------
// The always-dark rule
// ---------------------------------------------------------------------------

test("night is always dark and nothing else is", () => {
  for (const t of STORE_THEMES) {
    assert.equal(isAlwaysDark(t.id), t.id === "night", `${t.id}`);
  }
});

test("an always-dark preset overrides the owner's light/dark choice", () => {
  // Otherwise the two settings contradict each other and the owner is offered
  // a control that does nothing. The editor hides it for the same reason.
  for (const theme of ["LIGHT", "DARK", "SYSTEM"]) {
    const props = storeRootProps({ themePreset: "night", theme, accentColor: "#c9a227" });
    assert.equal(props["data-theme"], "dark", `night + ${theme}`);
  }
});

test("a normal preset honours the owner's light/dark choice", () => {
  for (const [theme, expected] of [
    ["LIGHT", "light"],
    ["DARK", "dark"],
    ["SYSTEM", "system"],
  ] as const) {
    const props = storeRootProps({ themePreset: "warm", theme, accentColor: "#b4462a" });
    assert.equal(props["data-theme"], expected);
  }
});

test("storeRootProps carries the preset attribute and the accent together", () => {
  // Four call sites mount a store root. One function so they cannot each get a
  // different subset right — which is what happened before, when the account
  // page set the accent and forgot the theme attribute entirely.
  const props = storeRootProps({ themePreset: "bold", theme: "LIGHT", accentColor: "#e0472c" });
  assert.equal(props["data-preset"], "bold");
  assert.equal(
    (props.style as Record<string, string>)["--store-accent"],
    "224 71 44"
  );
});

test("an unknown preset still yields a renderable attribute", () => {
  assert.equal(storeThemeAttr("nonsense"), DEFAULT_STORE_THEME);
});

// ---------------------------------------------------------------------------
// Accent ink
// ---------------------------------------------------------------------------

test("accent ink flips with the accent's luminance", () => {
  // A mustard button needs black text and a navy one needs white. Getting it
  // wrong makes the order button unreadable, which on this page is the whole
  // product.
  assert.equal(readableInkOn("#ffd400"), "#141414");
  assert.equal(readableInkOn("#0b2a5b"), "#ffffff");
  assert.equal(readableInkOn("#ffffff"), "#141414");
  assert.equal(readableInkOn("#000000"), "#ffffff");
});

test("a malformed accent still produces a readable button", () => {
  // The column is free text and admins can type into it. A garbage value gets
  // the neutral graphite fallback rather than an empty var(), which computes
  // to a transparent button with invisible text.
  assert.equal(readableInkOn("not-a-color"), "#ffffff");
  const vars = storeVars("nope") as Record<string, string>;
  assert.equal(vars["--store-accent"], "47 51 55");
  assert.equal(vars["--store-accent-ink"], "255 255 255");
});

test("every suggested accent is legible against its own preset's button ink", () => {
  for (const t of STORE_THEMES) {
    const ink = readableInkOn(t.suggestedAccent);
    const ratio = contrastRatio(t.suggestedAccent, ink);
    assert.ok(ratio >= 4.5, `${t.id}: ${t.suggestedAccent} on ${ink} is ${ratio.toFixed(2)}:1`);
  }
});

// ---------------------------------------------------------------------------
// The stylesheet
// ---------------------------------------------------------------------------

const CSS = readFileSync(join(__dirname, "../src/app/globals.css"), "utf8");

type RGB = [number, number, number];

/** Pulls the `--s-*` declarations out of the block opened by `selector`. */
function tokens(selector: string): Record<string, RGB> {
  const start = CSS.indexOf(selector);
  assert.notEqual(start, -1, `no block for \`${selector}\` — did the selector change?`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const body = CSS.slice(open + 1, close);

  const out: Record<string, RGB> = {};
  for (const m of body.matchAll(/--(s-[a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    out[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return out;
}

function luminance([r, g, b]: RGB) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: RGB, b: RGB) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function hex([r, g, b]: RGB) {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function darkSelector(id: string) {
  if (id === DEFAULT_STORE_THEME) return '.store[data-theme="dark"] {';
  // Night's block is a three-selector group covering every data-theme value,
  // because the preset has no light palette to fall back to.
  if (isAlwaysDark(id)) return `.store[data-preset="${id}"],`;
  return `.store[data-preset="${id}"][data-theme="dark"] {`;
}

/**
 * The base `.store` block is Classic; every other preset gets its own.
 * An always-dark preset has one block and it is the dark one — asking for its
 * "light" palette is a category error, so it resolves to the same place rather
 * than to a selector that isn't in the file.
 */
function lightSelector(id: string) {
  if (isAlwaysDark(id)) return darkSelector(id);
  return id === DEFAULT_STORE_THEME ? ".store {" : `.store[data-preset="${id}"] {`;
}

const TEXT = ["s-ink", "s-dim", "s-mute"] as const;
const SURFACES = ["s-bg", "s-raised"] as const;

for (const t of STORE_THEMES) {
  test(`${t.id}: has a light block defining every token`, () => {
    const p = tokens(lightSelector(t.id));
    for (const key of [...TEXT, ...SURFACES, "s-line", "s-line-2"]) {
      assert.ok(p[key], `${t.id} light is missing --${key}`);
    }
  });

  test(`${t.id}: has a dark block defining every token`, () => {
    const p = tokens(darkSelector(t.id));
    for (const key of [...TEXT, ...SURFACES]) {
      assert.ok(p[key], `${t.id} dark is missing --${key}`);
    }
  });

  // The one that actually bites. A preset with a light block and no
  // media-query twin renders a white page on a dark phone — and the owner, who
  // built the site on a laptop, never sees it.
  if (!isAlwaysDark(t.id)) {
    test(`${t.id}: SYSTEM follows the device`, () => {
      const selector =
        t.id === DEFAULT_STORE_THEME
          ? '.store:not([data-theme="light"]) {'
          : `.store[data-preset="${t.id}"]:not([data-theme="light"]) {`;
      const p = tokens(selector);
      for (const key of [...TEXT, ...SURFACES]) {
        assert.ok(p[key], `${t.id} has no prefers-color-scheme twin for --${key}`);
      }
    });
  }

  test(`${t.id}: the picker swatch matches the stylesheet`, () => {
    // A picker that lies about the palette is worse than no picker: the owner
    // chooses from the chips, not from the preview they haven't scrolled to.
    const p = tokens(lightSelector(t.id));
    assert.equal(hex(p["s-bg"]), t.swatch.bg, `${t.id} swatch.bg`);
    assert.equal(hex(p["s-raised"]), t.swatch.raised, `${t.id} swatch.raised`);
    assert.equal(hex(p["s-ink"]), t.swatch.ink, `${t.id} swatch.ink`);
  });

  const palettes: Array<[string, string]> = isAlwaysDark(t.id)
    ? [["dark", darkSelector(t.id)]]
    : [
        ["light", lightSelector(t.id)],
        ["dark", darkSelector(t.id)],
      ];

  for (const [name, selector] of palettes) {
    for (const text of TEXT) {
      for (const surface of SURFACES) {
        test(`${t.id} ${name}: --${text} on --${surface} clears AA`, () => {
          const p = tokens(selector);
          const ratio = contrast(p[text], p[surface]);
          assert.ok(
            ratio >= 4.5,
            `${t.id} ${name}: ${text} (${hex(p[text])}) on ${surface} (${hex(
              p[surface]
            )}) is ${ratio.toFixed(2)}:1, needs 4.5`
          );
        });
      }
    }
  }

  test(`${t.id}: defines a corner radius`, () => {
    const start = CSS.indexOf(lightSelector(t.id));
    const body = CSS.slice(CSS.indexOf("{", start) + 1, CSS.indexOf("}", start));
    assert.match(body, /--s-radius:/, `${t.id} has no --s-radius`);
  });
}

console.log(`store-theme: ${passed} passed`);
