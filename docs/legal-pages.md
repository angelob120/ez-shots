# Legal pages

Working plan for the policy pages. Read before touching `src/lib/legal*.ts`,
`src/content/legal/`, or the footer.

## What landed

Ten policy documents, server-rendered, linked from the
marketing footer and the storefront footer.

| Slug | Audience | What it is |
|---|---|---|
| `terms` | Everyone | Platform terms. Covers diners and owners in one document; merchant obligations are referenced, not repeated. |
| `privacy` | Everyone | Controller/processor split, retention table, rights. |
| `refunds` | Everyone | Who decides, service-fee treatment, timing, chargebacks. |
| `messaging` | Everyone | The A2P/carrier artefact. Quotes `OPT_IN_TEXT` verbatim. |
| `cookies` | Everyone | Every cookie and local-storage key we set. |
| `acceptable-use` | Everyone | Prohibited conduct, listings, messaging. |
| `restaurant-agreement` | Restaurants | Fees, payouts, customer list ownership, suspension. |
| `subprocessors` | Restaurants | Every vendor and what it receives. |
| `accessibility` | Everyone | Targets, what is verified, and the known gaps. |
| `ip-policy` | Everyone | DMCA notice and counter-notice. |

Routes: `/legal` (index), `/legal/[slug]`. Short aliases (`/terms`,
`/privacy`, `/sms`, `/dmca`, …) are permanent redirects in `next.config.mjs`,
because those are the forms that get typed into carrier registration forms and
app-store listings and are then hard to change.

## Decisions worth not re-litigating

**Policies are data, not JSX.** `src/content/legal/*.ts` export structured
sections; `src/components/site/legal.tsx` renders them. A policy has to be
quotable — "what exactly did this page say on that date" is the question in a
dispute — and `legalToPlainText` exists for exactly that. It also means there
is one list of documents, so a policy cannot exist while being linked from
nowhere.

**`legal-base.ts` is split from `legal.ts` because of an import cycle.** The
registry imports every document; every document needs `COMPANY`. In one file
that resolves with `COMPANY` still in its temporal dead zone and every policy
page throws at import time. Do not merge them back.

**`LEGAL_REVIEW_REQUIRED` is deliberately awkward to remove.** While true,
every page carries a visible "draft, pending legal review" banner. Shipping
generated policy text as though it were reviewed advice is the failure here
that costs real money, and it costs it silently.

**The storefront footer hardcodes its four policy links** rather than importing
the registry. `StoreApp.tsx` is a client component and importing `LEGAL_DOCS`
would ship the full text of ten documents in the storefront bundle — on the
page whose load time decides whether a stranger orders at all.

**Storefront policy links are absolute, to `platformOrigin()`.** The storefront
is frequently served on the tenant's own domain, where `/legal/*` does not
resolve — the host rewrite sends everything to `/r/[slug]`. Same three-origin
distinction as `lib/domains.ts`.

**Pages are `force-dynamic`, and that is not a choice.** The `(site)` layout
reads the session cookie to decide whether the header says "Log in" or "Go to
dashboard", which makes the whole segment dynamic — a child declaring
`force-static` under it is a promise the route cannot keep, and Next will not
honour it. Rendering is cheap regardless because the content is compile-time
constant. If these ever genuinely need to be static (carrier and app-store
reviewers fetch them on a schedule we do not control, and a static page cannot
be down because the database is), move them out of the `(site)` group and give
them their own layout.

## What's left

1. **A lawyer has to read all of it.** Then set `LEGAL_REVIEW_REQUIRED = false`
   and fill in the real entity details in `COMPANY`. Until then the banner
   stays and the pages are testing scaffolding that happens to be accurate.
2. **The entity does not exist yet.** `COMPANY.legalName`, `address` and
   `governingLaw` are placeholders. A policy naming a company that was never
   formed is not enforceable by anyone.
3. **The email addresses do not resolve.** `privacy@`, `legal@` and `abuse@`
   are printed on public pages and nothing routes them. That is a worse failure
   than not printing them, because a privacy request that bounces is a
   compliance problem rather than an inbox problem. P1.
4. **Acceptance is not recorded.** Nobody ticks a box agreeing to these. The
   onboarding wizard is the natural place — an "I agree to the Restaurant
   Agreement" step storing the slug, the document's `updated` date and a
   timestamp against the tenant. Consent to a contract needs the same evidential
   treatment `Customer.optInText` gets for messaging, and for the same reason.
   P2.
5. **No sitemap or `robots.txt` entry.** P3.
6. **Cookie banner.** None, deliberately — we set no advertising cookies and run
   no third-party trackers, so there is nothing to consent to under US rules.
   If the product ever serves the EU this needs revisiting, and the
   `hearth_theme` and analytics local-storage entries are the ones that would
   need a control.

## Adding a subprocessor

Add the row to `src/content/legal/subprocessors.ts` **in the same change that
adds the vendor**, and bump `updated`. A subprocessor in production and not on
that page is the exact gap an enterprise security review looks for.
