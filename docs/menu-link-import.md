# Importing a menu from a delivery platform

Working plan. Read before touching `src/lib/menu-scrape.ts`,
`src/lib/menu-fetch.ts`, or `src/app/dashboard/menu/link-import-actions.ts`.

## Why it exists

Nearly every restaurant that reaches the menu step already has its menu typed
into DoorDash, Uber Eats or Toast. Asking them to type it again — or to export
a CSV they have no idea how to produce — is where an onboarding gets abandoned.
The feature turns forty minutes of typing into pasting a link.

It is now the **default** tab in both the wizard and the dashboard import
modal, ahead of the CSV path.

## Shape

```
link ──▶ fetch ──▶ scavenge JSON ──▶ REVIEW ──▶ commit
              │                          ▲
              └── blocked? ── paste ─────┘
```

| Module | Job |
|---|---|
| `lib/menu-scrape.ts` | Pure. HTML in, candidate rows out. All the heuristics, all the tests. |
| `lib/menu-fetch.ts` | The network door. SSRF fence, byte cap, timeout, redirect handling. |
| `app/dashboard/menu/link-import-actions.ts` | Auth boundary. Preview writes nothing; commit takes reviewed rows. |
| `components/hearth/MenuLinkImport.tsx` | The three-stage UI. |
| `lib/menu-import.ts` → `importMenuRows` | **The one committer.** Shared with the CSV path. |

## Decisions worth not re-litigating

**It is a scavenger, not a per-site scraper.** Every one of these sites ships
its data as JSON embedded in the HTML. The *shape* changes without notice; the
*fact* that it is there has been stable for years. So we find every JSON blob,
walk all of it, and collect anything item-shaped. A per-site selector path
breaks the first time a key is renamed, and it breaks *silently* — returning
zero items, which reads to the owner as "my menu is empty" rather than "the
importer is broken". A scavenger degrades instead.

**The review step is the feature, not a confirmation dialog.** Two judgements
cannot be made reliably by a machine:

- *Cents versus dollars.* DoorDash emits `1650`; JSON-LD emits `"12.50"`. A
  bare `1200` is $12.00 or $1,200.00 and nothing in the document distinguishes
  them. `guessPriceScale` guesses **for the whole menu at once** — a per-item
  guess produces a menu where half the prices are 100x the others, which is far
  harder to notice and fix than a uniformly wrong one — and the review table
  shows the guess with a one-click flip.
- *What is an item.* Modifier options, upsell rails and "also bought" carousels
  are the same shape as dishes. `harvest` stops descending once it recognises an
  item, which is the single most effective noise filter in the module; the rest
  is a name blocklist and the owner's tick boxes.

**The paste fallback is first-class.** These platforms block datacentre traffic
as a matter of course, so on any given day the fetch may simply not work. Paste
involves no request from us at all, which is also the cleaner answer to their
terms of service. Never let a fetch failure be a dead end.

**Both paths end at `importMenuRows`.** A second committer is how the link
importer quietly skips image re-hosting or stops reusing existing categories.

**`fetchMenuPage` re-resolves DNS on every redirect hop.** Blocking by hostname
is not enough — `menu.example.com` can have an A record of `169.254.169.254`,
and a redirect can land anywhere. The byte cap is enforced while streaming,
because `Content-Length` is advisory and a hostile server lies. None of these
limits are configurable from a request.

**Photos.** Re-hosting is on from the dashboard and off during onboarding,
matching the CSV path, and the decision is read from `restaurant.onboardedAt`
server-side rather than from the form.

## Legal position

These platforms' terms prohibit automated access. What we do: fetch one page,
at the explicit request of a restaurant importing *its own* menu, one page at a
time, rate-limited per tenant, with a paste path that involves no fetch at all.
That is the position; it is written down at the top of `menu-scrape.ts` too.
If it ever needs to change, the paste path is the one that survives.

## Tests

`scripts/menu-scrape.test.ts` — 23 cases. Deliberately **not** asserting that
DoorDash's markup looks like the fixtures, because it will not next month.
They assert the properties: whole-menu price scale, modifiers excluded, fee
rows filtered, duplicates collapsed keeping the richer copy, cyclic caches
don't hang the walker, and no input throws.

`scripts/net-guard.test.ts` — 20 cases on the SSRF fence, which now lives in
`src/lib/net-guard.ts` rather than inside the `server-only` module. Covers the
encoded host forms as well as the ranges: `2130706433`, `0177.0.0.1` and
`127.1` all reach loopback in every HTTP client and `isIP` returns 0 for all
three. `fetchMenuPage` itself is still untested — its interesting behaviour is
network-shaped.

## What's left

1. **No real-page fixtures.** Every fixture is synthetic. Saving one real page
   per platform under `scripts/fixtures/` (menus only, no personal data) would
   catch shape drift, at the cost of fixtures that rot. Worth it for the two
   biggest platforms. P2.
2. **Modifiers are dropped entirely.** We have a `ModifierEditor` and the source
   pages carry option groups; importing them is a natural follow-up and a large
   one. P2.
3. **Hours, address and phone are in those payloads too** and are currently
   ignored. Importing them into the onboarding basics step would collapse two
   wizard steps into one paste. P2.
4. **No per-platform metrics.** When DoorDash changes its markup we will find
   out from a support ticket. Counting zero-item previews by platform would tell
   us first. P3.
5. **The rate limiter is the in-memory one** and so is per-instance. Same
   caveat as everywhere else in the repo — see `lib/rate-limit.ts`. P3.
