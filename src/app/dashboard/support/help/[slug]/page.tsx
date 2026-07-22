import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireOwner } from "@/lib/auth";
import {
  HELP_ARTICLES,
  HELP_CATEGORY_LABELS,
  helpArticle,
  helpPath,
} from "@/lib/help-articles";
import BookACall from "../../BookACall";

export const dynamic = "force-dynamic";

/**
 * One help article.
 *
 * Rendered from the structured sections in `lib/help-articles.ts` rather than
 * from per-article JSX, which is what lets the same source become the plain
 * text an agent pastes into a ticket reply (`articleToText`). Two renderings of
 * one answer that can disagree is how a help centre starts contradicting
 * support.
 */

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const a = helpArticle(params.slug);
  return { title: a ? `${a.title} - Help` : "Help", robots: { index: false, follow: false } };
}

export default async function HelpArticlePage({ params }: { params: { slug: string } }) {
  await requireOwner();

  const article = helpArticle(params.slug);
  if (!article) notFound();

  // Same category, excluding this one. Cheap, and the thing people want next is
  // reliably adjacent — somebody reading about refunds is often really asking
  // about no-shows.
  const related = HELP_ARTICLES.filter(
    (a) => a.category === article.category && a.slug !== article.slug
  );

  return (
    <div className="max-w-[720px]">
      <nav className="mb-5 flex items-center gap-2 text-[12.5px] text-mute">
        <Link href="/dashboard/support/help" className="hover:text-ink">
          Help
        </Link>
        <span aria-hidden>/</span>
        <span>{HELP_CATEGORY_LABELS[article.category]}</span>
      </nav>

      <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-ink">
        {article.title}
      </h1>
      <p className="mt-2 text-[14px] leading-relaxed text-dim">{article.symptom}</p>

      <div className="mt-7 space-y-6">
        {article.sections.map((s, i) => (
          <section key={i}>
            {s.heading && (
              <h2 className="mb-2 text-[15px] font-semibold text-ink">{s.heading}</h2>
            )}
            {s.body.map((p, j) => (
              <p key={j} className="mb-3 text-[14px] leading-[1.7] text-dim last:mb-0">
                {p}
              </p>
            ))}
            {s.steps && (
              <ol className="mt-3 space-y-2.5">
                {s.steps.map((step, j) => (
                  <li key={j} className="flex gap-3 text-[14px] leading-[1.7] text-dim">
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface2 font-mono text-[11px] text-ink">
                      {j + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        ))}
      </div>

      {related.length > 0 && (
        <div className="mt-9 border-t border-line pt-5">
          <h2 className="mb-2.5 font-mono text-[11px] uppercase tracking-[0.12em] text-mute">
            Related
          </h2>
          <ul className="space-y-1.5">
            {related.map((a) => (
              <li key={a.slug}>
                <Link href={helpPath(a.slug)} className="text-[13.5px] text-ink hover:underline">
                  {a.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-9 space-y-4">
        <div className="rounded-sm border border-line px-5 py-4">
          <h3 className="text-[14px] font-semibold text-ink">Did that not fix it?</h3>
          <p className="mt-1.5 text-[13px] leading-relaxed text-dim">
            {article.nextStep ??
              "File a ticket and say what you already tried from this page — it saves us both a round trip."}
          </p>
          <Link
            href="/dashboard/support"
            className="mt-3.5 inline-flex h-9 items-center rounded-sm border border-line2 bg-surface2 px-3.5 text-[13px] font-medium text-ink hover:bg-surface"
          >
            Open a ticket
          </Link>
        </div>

        <BookACall />
      </div>
    </div>
  );
}
