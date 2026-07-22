# Operator theming — light, dark, and system

Working plan for the theme on `/dashboard`, `/admin`, and the other
`.hearth-shell` surfaces. Read this before touching `src/lib/theme.ts`,
the `--h-*` tokens in `src/app/globals.css`, or the palette in
`tailwind.config.ts`.

---

## What exists

A three-way Light / Dark / System toggle in the top bar of the dashboard,
the admin console, and the onboarding wizard. The preference is a cookie
(`hearth_theme`, one year, not tied to the session), read server-side by
each operator layout and applied as `data-h-theme` on the shell element.

The whole operator palette — `base`, `surface`, `surface2`, `line`,
`line2`, `ink`, `dim`, `mute`, `accent`, `warn`, `bad` — moved from
hardcoded hex in `tailwind.config.ts` to `rgb(var(--h-*) / <alpha-value>)`,
matching the shape the storefront's `s-*` tokens already used. Every
existing class name kept working; nothing had to be rewritten page by page.

## Decisions worth not re-litigating

**There are two unrelated themes in this product and they must not be
merged.** `Restaurant.theme` is the *owner's branding decision* about what
their customers see on `/r/[slug]`. `hearth_theme` is a *personal display
preference* belonging to whoever is at the keyboard. An owner reading their
order board in a bright kitchen has not thereby decided anything about their
storefront's appearance, and an admin impersonating a tenant certainly
hasn't. Do not "unify" these.

**SYSTEM is the absence of an attribute, not a third value.** The layouts
omit `data-h-theme` entirely for SYSTEM, and the `prefers-color-scheme`
query in `globals.css` is the only thing that decides. This is what makes
the whole feature flash-free with no inline script and no client-side probe:
the device's preference is applied by the stylesheet at parse time, and an
explicit override arrives in the first byte of HTML. A refactor that starts
emitting `data-h-theme="system"` breaks nothing visible on a dark machine
and silently strands every operator on a light one — `scripts/theme.test.ts`
asserts against it for that reason.

**Tokens are scoped to `.hearth-shell`, not `:root`.** Putting them on the
document would mean reading the theme cookie in the root layout, and reading
*any* cookie there opts every route into dynamic rendering — including
`/r/[slug]`, the customer storefront, which is the one page in this product
that has to be fast on a phone on cell data. The operator layouts are all
`force-dynamic` already, so scoping costs nothing.

**Light is a real palette, not an inversion.** Accent, warn, bad and good
all darken, because this console is built almost entirely from 11–13px type
and that is where WCAG's 4.5:1 floor actually bites.

**`accentFill` is separate from `accent`, and `bad{Line,Ink,Bg}` are
separate from `bad`.** A colour tuned to be readable *as text* and one
tuned to be readable *underneath white text* pull in opposite directions on
dark — `#3b82f6` is a good link colour and a 3.68:1 button. Splitting them
lets each meet its own bar. Likewise, the destructive button's hover fill
has to be a tint on white and a shade on near-black, and no single alpha
over `bad` produces both — a translucent red over a white card comes out
pink.

**The QR code is not themed.** `QrCode.tsx` stays fixed dark-on-light and
its callers keep the white wrapper. It exists to be printed on a table
tent; the operator's screen preference has no bearing on a sheet of paper.

## Contrast is tested, not eyeballed

`scripts/theme.test.ts` parses the real `globals.css` — not a copy of the
numbers — and asserts WCAG AA (4.5:1) for every text token against every
surface, on both themes, plus the button and destructive-variant trios.
Drifting a token without re-checking it fails the suite.

It caught three genuine defects on the way in, **two of which predate this
work and were live in dark mode**:

- `--h-mute` was 3.59:1 on dark. It carries the 11px uppercase stat labels
  on every `Stat` card. Lightened to `126 134 144`.
- White on `--h-accent` was 3.68:1 on dark — every primary button in the
  product. Fixed by splitting `accentFill` out.
- `--h-mute` and `--h-warn` in the new light palette, both fixed before
  landing.

If you add a token, add it to both blocks. The suite checks that the two
palettes define the same key set, because the failure mode of a
copy-with-different-numbers is adding to one and not the other — which
renders as an empty `var()`, i.e. transparent, i.e. text that vanishes on
exactly one theme.

## The sweep through hardcoded hex

About 40 files carried literal dark-mode hex in Tailwind arbitrary values —
`text-[#f08a80]` for every error line, `border-[#5a2723] bg-[#1c1210]` for
every destructive card, `bg-[#241d0e]` for every warning band. All of it
would have been invisible on white. It came down to a vocabulary of ~20
colours, now mapped to token trios (`bad{Line,Ink,Bg}`,
`warn{Line,Ink,Dim,Bg}`, `good{Line,Bg}`) and substituted mechanically.

The `ModeBanner` band was the one that mattered most: it is the strip that
says charges aren't real, the one piece of chrome in this product that must
not be subtle, and amber-on-amber is exactly what a naive light flip
destroys. Its three tokens are contrast-tested.

`accent-color` on checkboxes moved to a `.hearth-shell input[...]` rule in
`globals.css`, mirroring what the store block already did — it had been an
`accent-[#3b82f6]` utility repeated at eight call sites. A checkbox added
later is now themed by default.

**If you add a colour, use a token.** An arbitrary hex value is a dark-mode
assumption that the contrast test cannot see, because it only parses
`globals.css`.

## What's left

All P3, none of it blocking:

1. **Nothing here has been looked at in a browser.** The palette is
   contrast-tested and Tailwind compiles it, but no page has been rendered.
   The charts in particular are server-rendered SVG using `rgb(var(--h-*))`
   in `fill` and `stroke`, which works and needs no client component but has
   only been reasoned about. Worth an eyeball on `/dashboard/analytics` in
   light mode first.
2. **No per-user persistence.** The cookie is per-browser, so an owner who
   uses a tablet on the pass and a laptop in the office sets it twice. A
   column on `User` would fix it at the cost of a query and a migration —
   and migrations are already the thing backed up in this repo. Deliberately
   deferred.
3. **`/o/[token]` and `/r/[slug]` are untouched** — they're customer
   surfaces on the storefront's own token set, and they have their own
   theme story already.
4. **`viewport.themeColor` in the root layout is still the hardcoded dark
   `#0b0c0e`.** It only affects the mobile browser chrome bar, and making
   it responsive means either a `generateViewport` that reads the cookie
   (which re-opens the dynamic-rendering problem above) or accepting it.
   Left alone on purpose.
