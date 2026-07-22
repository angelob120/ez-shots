# Storefront analytics — working plan

Status as of the session that built it. Read this before touching
`src/lib/analytics*.ts`, `src/app/dashboard/analytics/`, or
`src/app/admin/analytics/`.

---

## What exists

Behavioural instrumentation on the customer storefront, plus two reporting
surfaces built on it.

| Piece | File | Role |
|---|---|---|
| Schema | `prisma/schema.prisma`, migration `24_storefront_analytics` | `Visit` + `VisitEvent` |
| Ingest | `src/lib/analytics.ts` | **The only writer.** Validation, session stitching, clamps |
| Date maths | `src/lib/analytics-range.ts` | Pure. Ranges, buckets, deltas, in tenant time |
| Reads | `src/lib/analytics-query.ts` | **The only reader.** Every aggregate on both pages |
| Beacon | `src/app/api/track/route.ts` | Public endpoint. Always 204 |
| Client | `src/components/customer/useTracker.ts` | Queue, batch, heartbeat, `sendBeacon` |
| Charts (static) | `src/components/hearth/charts.tsx` | Server-rendered SVG. No chart library |
| Charts (interactive) | `src/components/hearth/charts.client.tsx` | Line chart + heatmap. The only client JS on either page |
| Filters | `src/components/hearth/AnalyticsFilters.tsx` | GET form, shared by both pages |
| Param resolution | `src/lib/analytics-params.ts` | Querystring → `AnalyticsFilter`. **One place**, three readers |
| Export | `src/lib/analytics-export.ts`, `src/app/api/analytics/csv/route.ts` | CSV, built from the same query functions |
| Export menu | `src/components/hearth/ExportMenu.tsx` | `<details>`, no JS |
| Owner UI | `src/app/dashboard/analytics/page.tsx` | Five tabs |
| Admin UI | `src/app/admin/analytics/page.tsx` | Three tabs |
| Tests | `scripts/analytics.test.ts` | 62 pure cases |

### The data model in one paragraph

`Visit` is one customer, one sitting, one storefront — with the five funnel
milestones denormalized onto it as booleans and the dwell time stored rather
than derived. `VisitEvent` is the append-only detail underneath, one row per
thing that happened. Every headline number reads the small table; only item
funnels, search terms and drop-off touch the big one. A single events table
would have made the dashboard's first paint a full scan of the largest table in
the database.

---

## Decisions worth not re-litigating

**The client never names the tenant.** The beacon carries a slug, resolved
server-side through `tenantWhere`. Accepting a `restaurantId` on a public
unauthenticated endpoint would let anyone write into any tenant's numbers.

**There is no `meta` JSON bag.** Events carry fixed typed columns and a `label`
that only two event kinds may populate (`SEARCH`, `CHECKOUT_ERROR`). An open
JSON field on a public endpoint is how a phone number ends up in an analytics
table, and once it's there it's in every backup. Don't add one "just for
debugging".

**`converted` is written in exactly one place** — `attachOrderToVisit`, called
from `placeOrderAction` after the order commits. Deriving it from the presence
of an `ORDER_PLACED` event would make every tenant's conversion rate a number
the public beacon can inflate.

**Dwell time is clamped at write, not read** (`MAX_DWELL_MS`, 90 minutes). One
overnight tab moves a tenant's average session length more than a hundred honest
visits. Clamping on read leaves the bad row in the table for the next person to
trip over.

**Sessions are stitched server-side** by `SESSION_GAP_MS` (30 minutes) against
`lastSeenAt`. A client-supplied visit id would make "how many people came today"
a number the client decides.

**`anonId` is not a fingerprint.** Random, browser-minted, localStorage, scoped
per tenant. Never joined to `Customer`, never derived from IP or user agent. Two
restaurants get two different ids for the same browser. It exists only to
separate "one person, four visits" from "four people".

**Everything is reckoned in the restaurant's timezone**, not the viewer's —
same rule as `lib/hours.ts`. The heatmap is where this matters most: a two-hour
shift moves the dinner rush onto the wrong roster.

**Ranges are half-open.** `to` is exclusive, always. With an inclusive end, a
midnight order counts in two adjacent days and every period-over-period
comparison inherits the double count.

**Growth from zero is `"new"`, never a percentage.** See `delta()`. A percentage
of nothing is a lie that costs the honest percentages beside it their
credibility.

**No charting library.** Five specific shapes. Still true, and still the reason
not to add one — it would be the largest dependency in the repo.

**Zero client JS was revised, narrowly.** The original decision was that
`<title>` elements substitute for tooltips. In practice they don't: a native
tooltip needs a held hover, shows whichever single element the cursor found,
and never fires on a touchscreen — and on a 90-day chart the points are drawn
at `r=0` precisely because there are too many of them, so the only hover target
left was an invisible band. The line chart and the heatmap therefore moved to
`charts.client.tsx`. The bound on the cost is the part to preserve:

- Only those two components. `Funnel`, `RankedBars`, `Sparkline`, `Metric` and
  `DeltaChip` are still static server markup and should stay that way.
- They are the only client components on either analytics page, so nothing
  ships JS outside `/dashboard/analytics` and `/admin/analytics`.
- Both render fully on the server; hydration adds the crosshair, not the chart.
  The `<title>` elements were **kept**, not replaced — the no-JS and
  screen-reader paths are exactly as they were, plus a live region and arrow-key
  navigation.
- No library. Same hand-rolled SVG.

**Formatters are keys, not functions.** A server component can't pass a function
across the client boundary, so `SeriesDef.format` is `"count" | "money" | "pct"`
and resolves in `applyFormat`. This is why the change touched every call site.
`chartFormatters` still exists for the static components.

**The heatmap's metric is component state, not a URL param** — the only
deliberate exception to the rule below. Both metrics are already in its props,
so a round trip would re-run a dozen queries to render data the browser is
holding. Conversion is disabled on the platform grid: a cross-tenant rate for
7pm Friday averages a dozen different menus and catchments, and means nothing
anyone can act on.

**The filter bar is a GET form.** Every view has a URL that can be bookmarked
and pasted. That was the first thing anyone would have asked for. The preset
chips, the active-filter chips and the export menu are all links or `<details>`
for the same reason — a filtered page and an empty period look identical when
the filter is a select you set yesterday and a bookmark restored this morning,
so each active filter states itself and removes itself.

**An export is the page, not a second query.** `lib/analytics-export.ts` calls
the same query functions the page renders from, with the filter resolved by the
same `resolveAnalyticsFilter`. A hand-written `findMany` there would be a second
implementation of "which visits count", and the first anyone would hear of the
drift is a spreadsheet that disagrees with a dashboard. Every file carries a
provenance header naming the range, the timezone, the active filters and
whether seeded traffic is included, because a CSV outlives the URL that made it.

**The export endpoint takes the tenant from the session, never the query.** The
single exception is an admin passing `restaurant=<id>`, reachable only after the
role check. `restaurantId` is a scope, not a filter — same rule as
`lib/customers.ts`.

**Simulated traffic is excluded by default** and carries `Visit.simulated`, the
same contract as `+1555017` phones and `paymentProvider: "sim"`. That flag is the
only thing making `wipeSimulatedAnalytics` safe on a tenant with real trade.
A generator that forgets to stamp it leaves rows nobody can clean up.

**Item revenue is raw SQL, and has to be.** `OrderItem` has no line-total
column — a line is worth `(unitPriceCts + modifiersCts) * qty`, which is
`lineFoodCts` in `lib/orders.ts` — so `_sum` can't compute it. It also carries
`fulfilledQty`, null normally and *lower* than `qty` when the kitchen 86'd part
of a line. `soldByItem` coalesces to it, which is the difference between "what
we sold" and "what was ordered before we ran out". The first version of this
used `prisma.orderItem.groupBy({ by: ["itemId"] })` against a column called
`menuItemId` and failed the production build; the sandbox couldn't catch it
because the generated client is stale there.

**Don't parameterise a Prisma `groupBy` field.** `bySource` and `byDevice` are
written out twice on purpose. Prisma derives the result type from the *literal*
passed to `by`, so a `field: "source" | "device"` argument yields a result with
no usable keys — and it typechecks fine against the stale sandbox client before
failing the real build. Only the arithmetic is shared, in `combine`.

**Considered and rejected:** scroll depth (interesting, never actionable on a
menu that fits two screens); session replay (would require recording things this
product has no business recording); a rollup table (premature — the indexes
carry it, and a rollup that drifts from its source is worse than a slow query).

---

## What's left

Ordered by what would hurt first.

1. **P1 — `npx prisma generate && npm run db:push` on a real machine.** The
   sandbox can't generate (`binaries.prisma.sh` 403s), so `prisma.visit` and
   `prisma.visitEvent` are missing from the client until you do. Migration
   `24_storefront_analytics` is written and idempotent; it just hasn't run.
   **Nothing on either analytics page works until this happens.**

2. **P1 — verify the raw SQL against a real Postgres.** Four `$queryRaw` calls
   (`series`, `heatmap`, `dropOff`, `platformSeries`, `platformHeatmap`) are the
   first raw SQL in this repo and have never executed. The bucket round-trip
   (`bucketExpr`) is the risky one: it truncates in the tenant's zone and shifts
   straight back, and it has to agree exactly with `truncateLocal` in JS. The
   DST cases are covered on the JS side by `scripts/analytics.test.ts`; the SQL
   side is unverified.

3. **P2 — retention.** `pruneAnalytics()` exists and nothing calls it.
   `VisitEvent` is now the fastest-growing table in the database. This belongs
   in the sweep cron — which, note, [still doesn't exist](./deploy-sweep.md).
   Decide the window deliberately: `Visit` rows are cheap and carry every
   headline number, so events should expire long before visits do.

4. **P2 — an index review once there's real volume.** The indexes were chosen
   from the queries, not from a query plan. `VisitEvent(restaurantId, kind, at)`
   is the one carrying the item funnels and is the most likely to need help.

5. **P3 — `dropOff` uses a `JOIN LATERAL`** to find each visit's last event.
   Correct, and the only query here that scales with the events table rather
   than the visits table. If it becomes slow, the fix is a `lastView` column on
   `Visit` maintained at ingest, not an index.

6. **P3 — the beacon rate limiter is per-process** (`lib/rate-limit.ts`), same
   caveat as everywhere else it's used. Running more than one web instance gives
   each its own counter. Acceptable: under-limiting a beacon costs a few extra
   rows, not a security boundary.

7. ~~**P3 — no export.**~~ **Done.** `GET /api/analytics/csv?dataset=…` plus
   the whole filter querystring. Six owner datasets (traffic, items, visits,
   sources, funnel, searches) and two admin ones (leaderboard, platform
   traffic); an admin with `restaurant=<id>` gets that tenant's owner datasets
   in that tenant's timezone. Visits are capped at 5000 rows and the file
   **says so in its header** rather than timing out. Untested against a real
   database like everything else here.

8. **P3 — `searchTerms` takes at most 5000 rows** and aggregates in memory.
   Fine at current volume, wrong eventually; the replacement is a `GROUP BY` in
   SQL with the same normalization applied there.

---

9. **P2 — every page now runs the series query twice.** The dashed previous-
   period overlay is a genuinely separate `series` / `platformSeries` call, and
   `TenantAnalytics` gained a second `headline` on top. That's deliberate — the
   headline row already says visits fell 12%, and the only follow-up is whether
   they fell on one bad Saturday or every day, which nothing but a shape
   comparison answers — but it doubles the most expensive query on the page and
   it hasn't been measured against real volume. If it hurts, the fix is one
   query over the union of both ranges split in JS, not dropping the overlay.

10. **P3 — the interactive charts have no tests.** `scripts/analytics.test.ts`
    covers pure functions and the two components in `charts.client.tsx` are
    neither pure nor headless-testable without a DOM harness this repo doesn't
    have. The riskiest part is `indexFromClientX`, which inverts the x scale
    through a `getBoundingClientRect` — an off-by-one there reads the wrong
    bucket's numbers into the tooltip, which is worse than no tooltip. Verify by
    hand against a chart with an obvious spike.

---

## Related change in the same session

`/admin/test-mode` was merged into `/admin/tools` as its first tab, and the old
route is now a redirect. They were one question — "is what I'm looking at
real?" — asked on two pages, and the split meant the switch that arms the
testing tools lived somewhere other than the tools. See the header comment in
`src/app/admin/tools/page.tsx`.
