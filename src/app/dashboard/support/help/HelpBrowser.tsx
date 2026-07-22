"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  HELP_ARTICLES,
  articlesByCategory,
  helpPath,
  searchArticles,
  type HelpArticle,
} from "@/lib/help-articles";

/**
 * The help centre's search box and list.
 *
 * A client component filtering in place, which is a deliberate departure from
 * the GET-form convention the analytics filter bar uses. The trade there is
 * bookmarkability against latency, and it lands the other way here: an
 * analytics view is a thing you paste to someone else, whereas a help search is
 * a thing you abandon after two words when you spot the answer in the list. A
 * round trip per keystroke on thirteen articles is all cost.
 *
 * The filtering itself is `searchArticles` from `lib/help-articles.ts` — the
 * same function the module exposes to the server — rather than a second
 * implementation inline. The article set is small enough to ship to the browser
 * whole, so there is no endpoint here to get out of step with anything.
 */
export default function HelpBrowser() {
  const [query, setQuery] = useState("");

  const results = useMemo(() => searchArticles(query), [query]);
  const groups = useMemo(() => articlesByCategory(results), [results]);
  const searching = query.trim().length > 0;

  return (
    <div>
      <div className="relative mb-6">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — try “refund”, “hours”, “payout”"
          aria-label="Search help articles"
          className="h-11 w-full rounded-sm border border-line2 bg-surface2 pl-10 pr-4 text-[14px] text-ink placeholder:text-mute focus:border-accent focus:outline-none"
        />
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-mute"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <circle cx="9" cy="9" r="6" />
          <path d="m13.5 13.5 3.5 3.5" strokeLinecap="round" />
        </svg>
      </div>

      {searching && (
        <p className="mb-4 text-[12.5px] text-mute" role="status" aria-live="polite">
          {results.length === 0
            ? "Nothing matched."
            : `${results.length} article${results.length === 1 ? "" : "s"} of ${HELP_ARTICLES.length}.`}
        </p>
      )}

      {results.length === 0 ? (
        // A help centre that dead-ends is worse than no help centre — it
        // teaches owners to skip it and file the ticket later and angrier. So
        // an empty result is a route to a person, not an apology.
        <div className="rounded-sm border border-dashed border-line2 px-5 py-8 text-center">
          <p className="text-[14px] font-medium text-ink">
            No article covers that yet.
          </p>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-dim">
            That&apos;s worth knowing about — gaps here get filled from what people actually ask.
            File a ticket and you&apos;ll get a person rather than a search box.
          </p>
          <Link
            href="/dashboard/support"
            className="mt-4 inline-flex h-9 items-center rounded-sm border border-line2 bg-surface2 px-4 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Ask us instead
          </Link>
        </div>
      ) : (
        <div className="space-y-7">
          {groups.map((g) => (
            <section key={g.category}>
              <h2 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
                {g.label}
              </h2>
              <ul className="divide-y divide-line rounded-sm border border-line">
                {g.articles.map((a) => (
                  <ArticleRow key={a.slug} article={a} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleRow({ article }: { article: HelpArticle }) {
  return (
    <li>
      <Link
        href={helpPath(article.slug)}
        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-surface2"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium text-ink">{article.title}</span>
          {/*
            The symptom rather than a summary. Someone scanning this list is
            matching their own situation against it, not learning what the
            article is about.
          */}
          <span className="mt-0.5 block text-[12.5px] leading-relaxed text-dim">
            {article.symptom}
          </span>
        </span>
        <svg
          viewBox="0 0 16 16"
          aria-hidden
          className="mt-1 h-3.5 w-3.5 shrink-0 text-mute"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
        >
          <path d="m6 3 5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Link>
    </li>
  );
}
