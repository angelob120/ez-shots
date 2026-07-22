# The owner help centre

`src/lib/help-articles.ts` and `/dashboard/support/help`. Read this before
adding or editing an article.

This is the other half of item 7 in `docs/admin-roadmap.md`. That item was
written "articles first, tickets only if articles don't absorb it" and was
deliberately built the other way round — tickets first. **That was the right
order.** You cannot write a useful article before you know what people ask, and
the ticket `category` distribution is what tells you. This is the second half,
now that there is something to write from.

---

## The shape

**Articles are data, not JSX**, exactly as policies are in `lib/legal.ts` and
for the same reason: the same source has to render as a page *and* as plain
text an agent pastes into a ticket reply (`articleToText`). Two renderings of
one answer that can disagree is how a help centre starts contradicting support.

**The categories are the ticket categories**, not a fresh taxonomy, so an
article can be pointed at from the ticket form later without a remapping.

**`symptom` is the owner's words, not ours.** It is the list subtitle and a
search term. Somebody scanning the list is matching their own situation against
it, not learning what the article is about — which is why the row shows the
symptom rather than a summary. Owners search for "customers can't pay", never
for "Stripe Connect onboarding incomplete"; `keywords` carries the synonyms and
the wrong words people reach for, and is never displayed.

**Every article ends in a fix or a route to a human.** A help centre whose
failure mode is a dead end trains owners to skip it, and then the ticket
arrives anyway — later, and angrier. The empty search result is a button to
file a ticket, not an apology.

---

## The pages

`/dashboard/support/help` is behind `requireOwner()` like the rest of the
dashboard. The articles contain no tenant data and would be safe to serve
publicly, but a public copy is a second surface to keep in step and the
audience is owners either way.

The page is a **ladder**, deliberately in this order: search the answers, ask
in writing, book a call. Each rung costs more of our time than the one above,
and the point of the top rung is that the bottom two get spent on things that
need a person. The help card sits **above** the ticket list on
`/dashboard/support` for the same reason — offering it after somebody has
scrolled past their own ticket history is offering it too late to be taken.

### Search

`HelpBrowser.tsx` is a client component filtering in place, which departs from
the GET-form convention the analytics filter bar uses. The trade there is
bookmarkability against latency and it lands the other way here: an analytics
view is something you paste to a colleague, a help search is something you
abandon after two words when you spot the answer in the list.

It calls `searchArticles` from the pure module rather than reimplementing the
match, and the whole article set ships to the browser — thirteen articles, no
endpoint to drift.

The search is **substring AND across every term**, not OR and not ranked. With
a set this small, ranking solves a problem nobody has, and an OR search returns
most of the list for most queries, which reads as the search being broken
rather than as the query being loose.

---

## Booking a call

`BookACall.tsx` reads the existing booking types via `listBookingTypes()`. It
does **not** introduce a second calendar. There is one slot engine
(`lib/booking-slots.ts`) and one writer (`lib/bookings.ts`), and a
support-specific calendar alongside them would be a second way to double-book
the same hour of the same person — the partial unique index in migration 30
prevents that only because everything goes through the one table.

**It renders nothing when no active `BookingType` exists.** That is the honest
answer and it is the recurring failure mode in this codebase stated once more:
a "Book a call" button leading to a calendar with no availability is a surface
that looks finished and is wired to something nobody set up. Create a booking
type in `/admin/calendar` and the card appears on its own, on both the support
page and every article.

**Migration `30_booking_calendar` still has to run** before any of this works —
see `CLAUDE.md`. Until then `listBookingTypes()` throws, which means the support
page throws, which is worse than the card being absent. Check that migration
before debugging anything here.

---

## Tests

`scripts/help-articles.test.ts`, 15 cases, pure.

The thing being defended is not "does search work" — it is that **every failure
mode here looks like a working page**. A duplicate slug renders one article and
silently hides another. A search that finds nothing for "refund" looks exactly
like a product with no refunds. Nobody files a ticket saying the help search is
bad; they file the ticket the article was supposed to prevent, and the article
reads fine when you go and look at it.

The search cases assert **the phrases owners actually type** — "money back",
"where's my money", "locked out", "doordash" — none of which appear in a title.
That list is the reason `keywords` exists. Add to it whenever a ticket arrives
that an existing article would have answered if only it had been findable: that
ticket is a search miss, and it is the only signal this system gives you.

---

## What's left

- **Point the ticket form at articles.** The categories already line up. A
  category selected on `NewTicketForm` could show the two or three articles for
  it before the ticket is filed, which is where deflection actually happens.
- **Track which articles get read**, so the ones nobody opens can be rewritten
  or dropped. There is an analytics pipeline already; this is not on it.
- **The article set is thirteen and guessed from the codebase's own known
  failure modes**, not yet from real ticket volume. Revisit once there is a
  category distribution worth reading.
