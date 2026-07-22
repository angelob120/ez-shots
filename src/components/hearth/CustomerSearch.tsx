"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import TagChip from "@/components/hearth/TagChip";

/**
 * The customer search and filter bar, shared by the owner's list and the
 * admin's cross-tenant one.
 *
 * It is a **plain GET form**, the same decision `AnalyticsFilters` made: every
 * result set has a URL that can be bookmarked, pasted into a support ticket,
 * or reloaded. A client-side filter over a fetched array would be smoother to
 * type into and would lose all of that — and would also silently only search
 * the rows already on the page, which is the kind of bug that makes an
 * operator swear a customer isn't in the system.
 *
 * That choice is also what makes saved segments almost free: a segment is just
 * this bar's query string with a name on it. Nothing has to be serialized
 * twice, and a segment opens the identical page a person would have reached by
 * clicking.
 *
 * The debounce is a progressive enhancement on top: with JS the results update
 * as you type, without it the Enter key still submits. Typing is deliberately
 * *not* pushing history entries — 12 keystrokes producing 12 back-button steps
 * is its own small hell — so it replaces instead, and only the explicit
 * dropdowns push.
 *
 * The extra filters live behind a "More filters" toggle rather than on the bar
 * permanently. Nine controls across the top of a list is a wall that makes the
 * search box — the thing used ninety percent of the time — harder to find. The
 * toggle opens automatically when a filter inside it is active, so a URL from
 * a colleague never lands showing a filtered list with no visible reason.
 */

type TagOption = { slug: string; name: string; color: string; count: number };

export default function CustomerSearch({
  placeholder = "Search by name, phone, or email",
  showConsentFilter = true,
  showAdvanced = true,
  tags = [],
  total,
  shown,
}: {
  placeholder?: string;
  showConsentFilter?: boolean;
  showAdvanced?: boolean;
  tags?: TagOption[];
  total: number;
  shown: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [q, setQ] = React.useState(params.get("q") ?? "");
  const [pending, startTransition] = React.useTransition();

  // Keep the box in sync when the URL changes underneath us — back button,
  // or a "clear" link elsewhere on the page.
  const urlQ = params.get("q") ?? "";
  React.useEffect(() => setQ(urlQ), [urlQ]);

  const activeTags = params.getAll("tag");
  const advancedKeys = ["stage", "cohort", "source", "email", "minOrders", "minSpend", "withinDays", "lapsedDays"];
  const advancedActive = advancedKeys.some((k) => params.get(k)) || activeTags.length > 0;
  const [open, setOpen] = React.useState(advancedActive);
  React.useEffect(() => {
    if (advancedActive) setOpen(true);
  }, [advancedActive]);

  function apply(next: Record<string, string | undefined>, replace = false) {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === "") sp.delete(k);
      else sp.set(k, v);
    }
    // Any change to the query resets pagination. Landing on page 4 of a search
    // that now has one page shows an empty table and looks like no results.
    sp.delete("page");
    const url = `${pathname}?${sp.toString()}`;
    startTransition(() => (replace ? router.replace(url) : router.push(url)));
  }

  /** Tags are multi-valued, so they toggle rather than replace. */
  function toggleTag(slug: string) {
    const sp = new URLSearchParams(params.toString());
    const current = sp.getAll("tag");
    sp.delete("tag");
    const next = current.includes(slug) ? current.filter((t) => t !== slug) : [...current, slug];
    for (const t of next) sp.append("tag", t);
    sp.delete("page");
    startTransition(() => router.push(`${pathname}?${sp.toString()}`));
  }

  React.useEffect(() => {
    if (q === urlQ) return;
    const t = setTimeout(() => apply({ q }, true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filtering = urlQ !== "" || advancedActive || Boolean(params.get("consent")) || Boolean(params.get("job"));

  function clearAll() {
    const sp = new URLSearchParams(params.toString());
    for (const k of ["q", "consent", "job", "page", ...advancedKeys]) sp.delete(k);
    sp.delete("tag");
    startTransition(() => router.push(`${pathname}${sp.toString() ? `?${sp}` : ""}`));
  }

  const selectClass =
    "h-9 appearance-none rounded-sm border border-line2 bg-surface px-3 text-[13px] text-ink outline-none focus:border-accent";
  const numberClass =
    "h-9 w-[104px] rounded-sm border border-line2 bg-surface px-2 text-[13px] text-ink outline-none placeholder:text-mute focus:border-accent";

  return (
    <form
      method="GET"
      action={pathname}
      onSubmit={(e) => {
        e.preventDefault();
        apply({ q });
      }}
      className="mb-4"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="7" cy="7" r="4.6" />
            <path d="m10.5 10.5 3 3" />
          </svg>
          <input
            type="search"
            name="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            aria-label="Search customers"
            className="h-9 w-full rounded-sm border border-line2 bg-surface pl-9 pr-3 text-[13px] text-ink outline-none placeholder:text-mute focus:border-accent"
          />
        </div>

        {showConsentFilter && (
          <select
            name="consent"
            value={params.get("consent") ?? ""}
            onChange={(e) => apply({ consent: e.target.value || undefined })}
            aria-label="Filter by messaging consent"
            className={selectClass}
          >
            <option value="">All consent states</option>
            <option value="OPTED_IN">Opted in</option>
            <option value="UNKNOWN">No consent</option>
            <option value="OPTED_OUT">Opted out</option>
          </select>
        )}

        <select
          name="sort"
          value={params.get("sort") ?? "recent"}
          onChange={(e) => apply({ sort: e.target.value })}
          aria-label="Sort customers"
          className={selectClass}
        >
          <option value="recent">Most recent</option>
          <option value="orders">Most orders</option>
          <option value="value">Highest value</option>
          <option value="name">Name A–Z</option>
          <option value="joined">Newest on the list</option>
        </select>

        {showAdvanced && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="h-9 shrink-0 rounded-sm border border-line2 px-3 text-[13px] text-dim hover:text-ink"
          >
            {open ? "Fewer filters" : "More filters"}
            {advancedActive && !open ? " •" : ""}
          </button>
        )}

        <span
          className="ml-auto shrink-0 text-[12px] tabular-nums text-mute"
          aria-live="polite"
          data-pending={pending || undefined}
        >
          {/* Stating both numbers is the point: a truncated list that says only
              "50 customers" reads as the whole list. */}
          {shown === total
            ? `${total.toLocaleString()} customer${total === 1 ? "" : "s"}`
            : `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}`}
        </span>

        {filtering && (
          <button
            type="button"
            onClick={clearAll}
            className="shrink-0 text-[12px] text-dim underline underline-offset-2 hover:text-ink"
          >
            Clear
          </button>
        )}
      </div>

      {showAdvanced && open && (
        <div className="mt-3 space-y-3 rounded-sm border border-line2 bg-surface2 p-3">
          {tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[12px] text-mute">Tags</span>
              {tags.map((t) => {
                const on = activeTags.includes(t.slug);
                return (
                  <button
                    key={t.slug}
                    type="button"
                    onClick={() => toggleTag(t.slug)}
                    aria-pressed={on}
                    className={on ? "opacity-100" : "opacity-55 hover:opacity-100"}
                  >
                    <TagChip
                      name={`${t.name} ${t.count}`}
                      color={t.color}
                      className={on ? "ring-1 ring-accent" : undefined}
                    />
                  </button>
                );
              })}
              {/* Multiple tags narrow rather than widen, and that has to be
                  said — a person picking two tags and getting fewer people
                  than one tag gave them will otherwise assume it's broken. */}
              {activeTags.length > 1 && (
                <span className="text-[11px] text-mute">— showing customers with all {activeTags.length}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <select
              name="stage"
              value={params.get("stage") ?? ""}
              onChange={(e) => apply({ stage: e.target.value || undefined })}
              aria-label="Filter by order history"
              className={selectClass}
            >
              <option value="">Any order history</option>
              <option value="none">Never ordered</option>
              <option value="once">Ordered once</option>
              <option value="repeat">Ordered more than once</option>
            </select>

            <select
              name="lapsedDays"
              value={params.get("lapsedDays") ?? ""}
              onChange={(e) => apply({ lapsedDays: e.target.value || undefined, withinDays: undefined })}
              aria-label="Filter by lapsed customers"
              className={selectClass}
            >
              <option value="">Any time since last order</option>
              <option value="30">Nothing in 30 days</option>
              <option value="60">Nothing in 60 days</option>
              <option value="90">Nothing in 90 days</option>
              <option value="180">Nothing in 6 months</option>
            </select>

            <select
              name="withinDays"
              value={params.get("withinDays") ?? ""}
              onChange={(e) => apply({ withinDays: e.target.value || undefined, lapsedDays: undefined })}
              aria-label="Filter by recent orders"
              className={selectClass}
            >
              <option value="">Any recency</option>
              <option value="7">Ordered in 7 days</option>
              <option value="30">Ordered in 30 days</option>
              <option value="90">Ordered in 90 days</option>
            </select>

            <input
              type="number"
              min={1}
              name="minOrders"
              defaultValue={params.get("minOrders") ?? ""}
              onBlur={(e) => apply({ minOrders: e.target.value || undefined })}
              placeholder="Min orders"
              aria-label="Minimum orders"
              className={numberClass}
            />

            <input
              type="number"
              min={0}
              step="0.01"
              name="minSpend"
              defaultValue={params.get("minSpend") ?? ""}
              onBlur={(e) => apply({ minSpend: e.target.value || undefined })}
              placeholder="Min spend"
              aria-label="Minimum lifetime spend in dollars"
              className={numberClass}
            />

            <select
              name="source"
              value={params.get("source") ?? ""}
              onChange={(e) => apply({ source: e.target.value || undefined })}
              aria-label="Filter by how the customer was added"
              className={selectClass}
            >
              <option value="">Added any way</option>
              <option value="organic">Came from an order</option>
              <option value="imported">Imported from a file</option>
            </select>

            <select
              name="email"
              value={params.get("email") ?? ""}
              onChange={(e) => apply({ email: e.target.value || undefined })}
              aria-label="Filter by whether an email address is on file"
              className={selectClass}
            >
              <option value="">Email or not</option>
              <option value="yes">Has an email</option>
              <option value="no">No email</option>
            </select>

            <select
              name="cohort"
              value={params.get("cohort") ?? ""}
              onChange={(e) => apply({ cohort: e.target.value || undefined })}
              aria-label="Filter by experiment cohort"
              className={selectClass}
            >
              <option value="">Both cohorts</option>
              <option value="TREATMENT">Treatment</option>
              <option value="HOLDOUT">Holdout</option>
            </select>
          </div>

          {/* The line that stops the obvious next thought. A filter produces a
              list of people; it says nothing about who agreed to be texted. */}
          <p className="text-[11px] leading-relaxed text-mute">
            Filters and tags describe your customers. They never grant messaging consent — only a
            customer ticking the box at checkout does that, and the consent filter above is the only
            one that says who can be texted.
          </p>
        </div>
      )}

      {/* Preserved so a no-JS submit doesn't silently drop the other filters. */}
      <noscript>
        <button type="submit" className="mt-2 h-9 rounded-sm border border-line2 px-3 text-[13px] text-ink">
          Search
        </button>
      </noscript>
    </form>
  );
}
