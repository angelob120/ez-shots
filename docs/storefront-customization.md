# Storefront customization — theme presets and the live editor

Working plan for how an owner customizes their website. **Read this before
touching `src/lib/store-theme.ts`, `src/lib/store-preview.ts`,
`src/components/hearth/StorefrontEditor.tsx`, or the `.store[data-preset]`
blocks in `globals.css`.**

---

## What exists

Every tenant's website is one skeleton — `StoreLanding` for the marketing
pages, `StoreApp` for ordering — wearing one of five **theme presets**. An
owner picks a preset, an accent, and then edits copy and photos. There is no
layout control and there is deliberately not going to be one.

Three modules:

| Module | Job |
|---|---|
| `src/lib/store-theme.ts` | Preset metadata, accent maths, the store root's props. Pure. |
| `src/lib/store-preview.ts` | The draft the editor posts into the preview, and the change list. Pure. |
| `src/components/hearth/StorefrontEditor.tsx` | The editor. Rendered by both `/dashboard/branding` and onboarding step 2. |

Plus `src/components/customer/usePreviewDraft.ts`, the receiving half inside
the storefront.

---

## The rules

**A preset moves the palette, the corner radius and the display weight. That is
the entire list.** Not spacing, not section order, not which sections exist. The
fastest way to hand an owner a broken storefront is to let them move the parts
that hold the page together, and "my order button disappeared" is a support call
we would deserve.

**Preset tokens live in CSS, not in the module, and that is not tidiness.**
An inline `style` attribute beats any stylesheet rule including one inside a
media query. `Restaurant.theme = SYSTEM` — the default — follows the visitor's
device through `prefers-color-scheme`. So a preset that emitted `--s-bg` inline
would pin every SYSTEM tenant to their **light** palette forever, on a phone in
dark mode, and nothing in the code would look wrong. The accent is the one
exception and has to be inline: it is per tenant, from the database, and cannot
be enumerated in a stylesheet.

The cost is drift between a preset id in the module and a CSS block in
`globals.css`. `scripts/store-theme.test.ts` (90 cases) parses the real
stylesheet and fails on a missing block, a missing `prefers-color-scheme` twin,
a picker swatch that disagrees with the palette, or any text token under WCAG
AA. Same contract `scripts/theme.test.ts` enforces for the operator console,
and it found the same class of bug: `--s-mute` was live at **3.07:1** on every
storefront.

**Night is always dark, and the light/dark control hides rather than lying.**
`Restaurant.theme` and a preset with only a dark palette contradict each other.
`isAlwaysDark()` decides, `storeRootProps()` forces `data-theme="dark"`, and the
editor hides the control — because offering a switch that does nothing is worse
than not offering one.

**`themePreset` is a String, not an enum, and unknown values coerce.** A preset
can be added or renamed without a migration touching every row. The cost is that
a removed preset leaves rows pointing at nothing, so `storeTheme()` falls back
to Classic. **The storefront must never be the thing that discovers a preset went
away** — a customer gets a styled page and we find out from the console.

**Mount a store root through `storeRootProps()`, never by hand.** Four pages do
it (`/r/[slug]`, its account page, the closed-store notice, `/o/[token]`), and
before this existed the account page set the accent and forgot the theme
attribute entirely. Same pairing rule as `cardPaymentsAllowed()`.

---

## The preview is the real page

The editor frames `/r/[slug]?preview=1` and posts unsaved edits into it over
`postMessage`. The alternative — a mock storefront drawn inside the editor — is
cheaper and wrong for the same reason the admin analytics drilldown renders the
owner's components rather than its own. Two implementations of "what the
storefront looks like" drift, and the first anyone hears of it is an owner
saying the preview lied.

**Nothing is stored.** A draft is a message, it lives in the iframe's React
state, and closing the tab discards it. That removes the whole class of bug
where a preview token leaks a half-finished redesign to customers, because there
is no token and no stored draft.

Four guards, each closing a different hole:

- **`?preview=1` only.** Without it the listener never mounts, so nothing on the
  internet can redecorate a storefront a customer is looking at.
- **Same origin only.** The editor always frames `platformOrigin()`, never the
  tenant's custom domain, precisely so this is a plain equality check rather
  than a host list to keep current.
- **An explicit allowlist, not `Partial<RestaurantDTO>`.** That type also
  carries surcharge rates and the Stripe publishable key. `StorePreviewDraft`
  names every field an owner may set, and the merge accepts nothing else.
- **Ownership, server-side, for the status bypass.** `?preview=1` lets an owner
  see their **PENDING** restaurant — which is what makes the preview useful
  during onboarding, since "Check back soon" is not a website anyone can design
  against. That bypass is gated on the session owning the tenant, or being an
  admin. Without it, seven characters would expose a suspended tenant's menu.

Two things are switched off in preview and both are load-bearing:

- **Analytics.** `useTracker(slug, !isPreview)`. The editor reloads nothing but
  the owner clicks around for fifteen minutes; left on, that is dozens of visits
  and a wrecked conversion rate on the owner's own analytics page — a number
  they would then ask us to explain. Same reasoning as `Visit.simulated`.
- **Checkout.** Preview is a rehearsal; checkout is the one control on the page
  that isn't reversible. An owner clicking through to see what the button looks
  like must not put a real ticket on their own board.

**Before/After is not a second render path.** "Before" is the editor posting the
*saved* snapshot it was handed on mount; "After" is it posting current form
state. Same route, same components, same merge — so the two halves cannot
disagree about anything except what actually changed. `describeChanges()`
produces the written summary beside it, because after twenty minutes of edits
the question is "what did I touch", which a picture doesn't answer.

---

## Decisions worth not re-litigating

**One editor, two surfaces, trimmed by a prop.** Onboarding step 2 and
`/dashboard/branding` render the same component; `variant="essentials"` drops
the per-page copy sections. Previously the wizard collected three fields and the
dashboard collected thirty, against the same columns — so an owner who chose a
look during setup met an unrecognisable page when they wanted to change it.

**Only one panel is mounted, and `HiddenFields` mirrors the rest.** An unmounted
`<input name="aboutBody">` submits nothing and the action reads
`formData.get("aboutBody") || null`, so saving from the Theme panel would blank
the About page. The old editor avoided this by keeping all seven panels
mounted-but-hidden. Checkboxes are the subtle half: an unchecked box also
submits nothing and `=== "on"` reads that as false, so the mirror emits them
only when true — exactly as a real checkbox would.

**The section list marks untouched sections.** The old editor was eight tabs
across the top with no way to tell which you had filled in, and the common
failure was an owner launching with a default About page they never knew
existed. A dot is cheaper than a support call.

**`readableInkOn` measures both inks rather than thresholding luminance.** The
0.45 threshold it replaced was wrong for exactly the colours restaurants pick: a
gold like `#c9a227` fell just under it and got white text at 2.42:1 when black
would have given 8.7:1.

---

## What to do next

1. **Migration `32_store_theme_presets` has never run.** One column, idempotent,
   backfilling every existing row to `classic` — which is the palette the
   storefront has always shipped, so no tenant's site changes on deploy. Needs
   `npx prisma generate && npm run db:push` on a real machine, same as
   `22`, `24`–`28`, `30` and `31`.
2. **`--s-radius` is defined and barely consumed.** The presets set it and
   `rounded-s` / `rounded-s-lg` resolve through it, but the storefront
   components still carry hardcoded `rounded-3xl` and `rounded-[28px]` in most
   places — so Bold's square corners and Warm's soft ones are currently a
   smaller difference than the picker implies. Sweeping
   `components/customer/*.tsx` onto the tokens is P2 and purely mechanical.
   Do not use `rounded-s` on operator surfaces: the var is undefined there and
   an undefined radius computes to 0.
3. **No preset has been seen in a browser.** Every palette is verified for
   contrast by test and by nothing else. The layout consequences of a 4px radius
   against a 32px one are exactly the kind of thing a test cannot see.
4. **The `suggestedAccent` on each preset is unused.** It exists so picking a
   theme can offer a matching accent to a tenant who never set one; the editor
   currently just keeps whatever accent is already there. P3.
