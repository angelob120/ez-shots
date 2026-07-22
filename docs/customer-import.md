# The customer database

Working plan for the customer list — import, search, filtering, tags, segments
and notes. **Read this before touching `src/lib/customer-import.ts`,
`src/lib/customers.ts`, or the customer CSV helpers in `src/lib/csv.ts`.**

---

## What exists

- **Import** — CSV upload on `/dashboard/customers`, owner-scoped, upsert by
  phone, with a dry-run preview, a per-upload tag, and an undo.
  `lib/customer-import.ts` is the one door.
- **Export** — `/api/customers/csv`, filter-aware, plus `?template=1` for a
  starter file.
- **Search and filters** — on the owner's list (tenant-scoped) and the
  cross-tenant `/admin/customers`. `lib/customers.ts` is the one door for both.
- **Tags** — per-tenant labels, bulk-appliable, filterable.
- **Saved segments** — a named filter combination, stored as a query string.
- **Notes** — the owner's on `CustomerNote`, ours on `CustomerAdminNote`,
  deliberately two tables.
- **Detail pages** — `/dashboard/customers/[id]` (owner, editable tags and
  notes) and `/admin/customers/[id]` (ours, read-only plus internal notes).
- **Tests** — `scripts/customer-import.test.ts`, 59 cases, pure.

## The rule the whole thing is built around

**An import can never grant messaging consent.** Every imported row lands as
`optInStatus: UNKNOWN`. There is no column, flag, option or checkbox that
changes that, and adding one is not a small change.

Three reasons, in ascending order of what they cost:

1. TCPA consent must be **provable** — who agreed, to what exact wording, when.
   That's why `Customer` carries `optInAt`, `optInSource` and `optInText`
   rather than a boolean. A spreadsheet supplies none of it, so an import
   marking rows OPTED_IN would be manufacturing evidence.
2. The owner uploading usually doesn't know either. "My old POS had these
   numbers" is not consent to be texted by a different business on a different
   number, and the person most likely to believe otherwise is the one clicking
   import.
3. **The failure isn't a fine, it's the number.** Texting a cold list produces
   spam reports; carriers filter the *sending number*; every legitimate order
   notification for that tenant stops arriving — including to the customers who
   did opt in. `lib/sms.ts` already blocks even transactional sends after a
   STOP for exactly this reason. Losing the list to protect the list is the
   whole point.

So imported rows are a **contact record, not an audience**. They give history
and recognition; consent is only ever written by checkout, where a human ticked
a box next to disclosure text we can reproduce.

**The "owner attests to consent" option was considered and rejected for now.**
It's a defensible product (owners migrating off Toast often do have real
written consent), but it needs a place to store the proof, a retention policy,
and a lawyer — not a checkbox in an import function. Don't add it as a
convenience.

The UI says all of this *before* the upload, deliberately. An owner uploading a
list overwhelmingly expects to be able to text it — that's usually why they're
uploading — and finding out afterwards feels like a broken promise. Said first,
it's a known rule.

## Other decisions

**Upsert, never blind create.** `[restaurantId, phone]` is unique, and owners
re-import constantly (usually because the first attempt was missing a column).
Merges **fill gaps only**: a blank cell is an absence of information, not an
instruction to forget a name learned from a real order. Order-derived fields
(`orderCount`, `lifetimeCts`, `firstOrderAt`, `lastOrderAt`) are never touched
by an import.

**Phone normalisation is the dedupe key.** `(555) 010-1234` and `+15550101234`
are one person; an import creating both has silently split someone's history in
half, and nobody reports it because both halves look plausible. Duplicates
*within* a file are collapsed before any write — one row per past order is a
common export shape, so the same person can appear fifty times.

`normalizePhoneForImport` in `csv.ts` is a deliberate copy of `normalizePhone`
in `money.ts`, because `csv.ts` stays pure and dependency-free. A test asserts
the two agree, since drift is the obvious risk of that choice. It also rejects
Excel's `1.5550101234E+10`: stripping non-digits would yield a *plausible*
number that may not be the right one, and a wrong number in a customer list is
worse than a skipped row because it belongs to someone else.

**Unusable rows are counted, not enumerated.** 380 individual warnings is a
wall, not a message. "380 rows had no usable phone number" tells the owner
their file is wrong, which is the actual conversation.

**5,000 rows per upload.** Not a business rule — a guard against a 200k-row
export being processed a row at a time inside a server action with a request
timeout. An owner with more needs a job queue and should hit a clear message
rather than a silent truncation.

**The export carries consent as a read-only column** even though the import
ignores it. "Who can I actually text" is a fair question. The round trip not
being symmetric is the point, and the header name (`consent_status_readonly`)
says so.

## Search

**Tenant scoping is an explicit parameter with no default.** `searchCustomers`
takes `restaurantId: string | null`, where null means cross-tenant and is only
reachable from a route that has already called `requireAdmin()`. A new caller
has to state which it is rather than inherit whichever is less safe.

**A query that looks like a phone number is tried three ways** — normalised to
E.164 for an exact hit, digits-only as a *suffix* for the "I only have the last
four" case, and raw against name/email. Without this, an operator types what's
on their screen, the column holds `+1...`, nothing matches, and the customer
appears not to exist. Suffix rather than substring: a 4-digit fragment is
almost always the tail of a number.

**`/admin/customers` does not list anything by default.** With no search term
it shows the box and nothing else. A paginated dump of every customer on the
platform is not a support tool, it's an exfiltration surface with a pager on
it, and an idle admin tab left open on it is a breach-report paragraph. It is
also entirely read-only — changing a customer's consent belongs to the tenant
that owns the relationship, and an admin quietly editing it would destroy the
audit trail `lib/sms.ts` depends on.

**Stats are unfiltered on purpose.** The headline numbers describe the list,
not the search — a repeat rate that moves as you type is a number nobody can
act on.

## Filters, tags and segments

**A tag, a segment and a filter are never consent.** This is the same rule the
import carries, stated again because the audience-builder is where it's most
tempting to break: tag a group, then text the group. `lib/sms.ts` reads
`optInStatus` and `optOutAt` and nothing else, and no filter output may become
an input to a send decision. A "VIP" tag is the owner's opinion; consent is a
record of what a person agreed to, in wording we can reproduce, at a timestamp.
The filter panel says so on screen, deliberately.

**Multiple tags narrow, they don't widen.** One `where` clause per tag rather
than a single `some` with an `in`. Somebody adding a second criterion expects
fewer people; a list that gets *longer* as you add filters reads as broken. The
UI says "showing customers with all 2" when more than one is active.

**Every filter goes into an `AND` array, not a spread.** Two filters can
constrain the same column — "ordered in the last 7 days" and "nothing in 30" —
and a spread would let the second silently overwrite the first, answering a
question nobody asked. Contradictory filters return nothing, visibly.

**"Lapsed" excludes people who never ordered.** `lastOrderAt: { lt: … }` is
false against NULL in SQL, which is the behaviour we want: someone who has
never ordered isn't lapsed, they're `stage: "none"`. Merging the two makes a
win-back list mostly people with no relationship to win back.

**A tag's slug is its dedupe key.** "VIP" and "vip" are one tag; an owner with
both has a filter returning a third of the people it should and a plausible
number to go with it. Separators normalise but aren't removed — `tagSlug("V.I.P.")`
is `v-i-p`, not `vip`. Collapsing two tags an owner meant to keep apart is a
worse failure than leaving two they meant to merge, because only the first is
invisible to them.

**Tag colours are names from a fixed palette, never hex.** `TagChip` is the
only place a name becomes a class, and every class resolves through `--h-*`
tokens that exist in both palettes — so `scripts/theme.test.ts` covers them. A
hex value in the database is invisible to that test and eventually renders as
dark grey on near-black. Adding a sixth colour means adding a token to *both*
the light and dark blocks in `globals.css`. See `docs/theming.md`.

**A segment is this page's query string with a name on it.** That's the payoff
of the filter bar being a plain GET form. Segments store what `filtersToQuery`
produces — rendered from the *parsed* params, not copied from the incoming URL,
so junk can't round-trip into the database — and reopen through the same
`readCustomerParams` every page load uses. `readCustomerParams` is total on
purpose: a segment saved before a filter was renamed opens showing fewer
filters rather than 500ing.

**Bulk tagging has two scopes and they take different inputs.** "Tag selected"
posts checkbox ids. "Tag all N matching" posts the *filter*, which is
re-evaluated server-side inside the tenant scope — so an operation over rows
nobody looked at can't be widened by editing a hidden field, and the count is
stated on the button.

**Admins can add a note and nothing else.** `/admin/customers` and its detail
page stay read-only on everything the tenant owns — consent, tags, name, email.
The one write is `CustomerAdminNote`, which is a **different table** from the
owner's `CustomerNote` rather than the same table with an `internal` flag,
exactly as `SupportNote` is separate from `SupportMessage`: a visibility boolean
puts a candid note one forgotten `where` clause away from the restaurant
reading it, and that clause would have to be correct in every query written
from now on. Nothing under `src/app/dashboard/` may select from it.

Tag filtering isn't offered on `/admin/customers`, because tag vocabularies are
per-tenant and a cross-tenant tag filter asks a question with no answer.

## Import preview, tagging and undo

**The preview runs the same mapper and the same duplicate collapse as the real
import.** A preview produced by a second code path is a preview of something
else. It reports the column mapping and five sample rows, because the two ways
an import goes wrong — the wrong column read as the phone number, or a
different list than the owner thought — are both obvious from that and from
nothing else afterwards. `willCreate`/`willUpdate`/`unchanged` are separate for
the same reason: "900 rows, 900 new" on a tenant that already has 900 customers
is the signature of a phone column matching nothing.

**Every import writes a `CustomerImportJob` before it writes a customer.**
Creating it afterwards would leave a window where rows exist with no job to
undo them by — the same shape as `lib/orders.ts` reserving a refund amount
before calling the provider.

**Two tags per import.** An automatic dated system tag naming the upload (so
"where did these 900 people come from" has an answer in six months), plus an
optional one the owner names. Both go on every row the file *touched*, created
or merged — tagging only new rows means re-importing a list you already have
tags nobody, which reads as the import failing.

**`Customer.importJobId` is written only on create, never on a merge.** This is
the undo marker and it is the same contract the simulator's `+1555017` block and
`paymentProvider: "sim"` carry: a cleanup is only safe if the marker is exact.
An import that filled in a missing email on a two-year regular did not create
them.

**Undo deletes only rows the job created that have never ordered.** Both halves
are enforced again in the `deleteMany` rather than trusted from the read, since
a customer can place their first order in between. Anyone who has ordered is
kept — they stopped being a spreadsheet row the moment they became a customer,
and deleting them would take an `Order.customerId` with it. The job row
survives with `undoneAt` set, because "we imported 900 and took them back out"
is what explains a gap in the list later.

**The export follows the filter bar.** An export button that ignores the
filters turns a 40-person win-back list into a 3,000-row file with nothing in
the file to indicate it happened. Tags ride along in the `notes` column as
read-only text; they don't round-trip back into real tags and the header
(`tags_readonly`) doesn't pretend otherwise.

## What's left

0. **Migration `26_customer_crm` has never run.** Same shape as every other
   blocked item in this repo: written, idempotent, and inert until
   `npx prisma generate && npm run db:push` happens on a real machine. Until
   then `prisma.customerTag`, `prisma.customerSegment`, `prisma.customerNote`,
   `prisma.customerAdminNote` and `prisma.customerImportJob` don't exist on the
   client, and **no customer page works at all** — not just the new ones, since
   the list query now includes tags. This is the first thing to do.
1. **Nothing has been rendered in a browser**, and no import has run against a
   real database. The parsing, the `where` builders, the slug rules and the
   segment round trip are tested; every write path — import, undo, bulk tag,
   segments, notes — is not.
2. **Import is sequential.** One `create`/`update` per row inside the request.
   Fine at 5,000; the ceiling exists because of it. A `createMany` with
   `skipDuplicates` plus a second pass for the merges would be the fix if it
   ever matters. Tagging afterwards is chunked at 500 for the same reason.
3. **Search is `contains`, not full-text.** No index supports it; at current
   volumes it doesn't matter. If a tenant reaches six figures of customers,
   this is the query to look at first. The filter columns *are* indexed
   (`Customer_restaurantId_*` in the migration), and those shapes should be
   checked against real volume — they were chosen from the queries, not
   measured.
4. **Bulk-tag-all is capped at 5,000** and gives no feedback when it truncates.
   A tenant with more matches than that gets a partial apply reported as a
   number, which is honest but not obviously a truncation.
5. **`tagMatching` isn't transactional.** A filter re-evaluated at apply time
   can differ from the one the count was taken against. Harmless for a label;
   worth knowing before anything consequential is ever driven off it.
6. **No merge for duplicate customers.** Two records for one person with
   different numbers can't be combined, and the phone dedupe can't help. This
   is the most likely next request once owners have used tags for a while.
