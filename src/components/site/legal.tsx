import Link from "next/link";
import {
  COMPANY,
  LEGAL_REVIEW_REQUIRED,
  formatLegalDate,
  type LegalBlock,
  type LegalDoc,
} from "@/lib/legal";

/**
 * Renderer for the structured policy documents in `src/content/legal`.
 *
 * Server-rendered with no JavaScript. A policy page that needs hydration to
 * show its text is a policy page that is blank to anything reading it in a
 * dispute — including the carrier reviewer checking the messaging terms, who
 * is often running a fetch rather than a browser.
 */

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "p":
      return <p className="text-[14.5px] leading-[1.75] text-dim">{block.text}</p>;

    case "list":
      return (
        <ul className="space-y-2.5 text-[14.5px] leading-[1.7] text-dim">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span aria-hidden className="mt-[10px] h-1 w-1 shrink-0 rounded-full bg-mute" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );

    case "steps":
      return (
        <ol className="space-y-2.5 text-[14.5px] leading-[1.7] text-dim">
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-[2px] shrink-0 text-[12px] font-semibold tabular-nums text-mute">
                {i + 1}.
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );

    case "callout":
      return (
        <p className="rounded-sm border-l-2 border-accent bg-surface2 px-4 py-3 text-[14px] font-medium leading-[1.7] text-ink">
          {block.text}
        </p>
      );

    case "table":
      return (
        <div className="overflow-x-auto rounded-sm border border-line">
          <table className="w-full min-w-[520px] border-collapse text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-line bg-surface2">
                {block.head.map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-mute"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-line last:border-0">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`px-4 py-3 align-top leading-[1.6] ${
                        j === 0 ? "font-medium text-ink" : "text-dim"
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function LegalReviewBanner() {
  if (!LEGAL_REVIEW_REQUIRED) return null;
  return (
    <div className="mb-10 rounded-sm border border-warnLine bg-warnBg px-4 py-3 text-[13px] leading-relaxed text-warnInk">
      <span className="font-semibold">Draft — pending legal review.</span> This policy has not yet
      been reviewed by a qualified attorney and the registered entity details are not final. It is
      published so the product can be tested end to end. Do not rely on it as legal advice.
    </div>
  );
}

/** Table of contents. Anchors are the section ids, which never get renumbered. */
function Contents({ doc }: { doc: LegalDoc }) {
  return (
    <nav aria-label="On this page" className="mb-12 rounded-sm border border-line bg-surface p-5">
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-mute">
        On this page
      </div>
      <ol className="grid gap-1.5 text-[13.5px] sm:grid-cols-2">
        {doc.sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="text-dim underline-offset-2 transition-colors hover:text-ink hover:underline"
            >
              {s.heading}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function LegalDocument({ doc }: { doc: LegalDoc }) {
  return (
    <article className="mx-auto max-w-[760px] px-6 py-16">
      <Link
        href="/legal"
        className="text-[13px] text-mute underline-offset-2 transition-colors hover:text-ink hover:underline"
      >
        &larr; All policies
      </Link>

      <h1 className="mt-5 text-[30px] font-semibold leading-tight tracking-tight text-ink">
        {doc.title}
      </h1>
      <p className="mt-3 text-[15px] leading-relaxed text-dim">{doc.summary}</p>
      <p className="mt-4 text-[12.5px] text-mute">
        {COMPANY.name} &middot; Last updated{" "}
        <time dateTime={doc.updated}>{formatLegalDate(doc.updated)}</time>
      </p>

      <hr className="my-10 border-line" />

      <LegalReviewBanner />
      <Contents doc={doc} />

      <div className="space-y-12">
        {doc.sections.map((s) => (
          <section key={s.id} id={s.id} className="scroll-mt-24">
            <h2 className="mb-4 text-[17px] font-semibold tracking-tight text-ink">{s.heading}</h2>
            <div className="space-y-4">
              {s.blocks.map((b, i) => (
                <Block key={i} block={b} />
              ))}
            </div>
          </section>
        ))}
      </div>

      <hr className="my-12 border-line" />

      <p className="text-[13px] leading-relaxed text-mute">
        Questions about this policy? Email{" "}
        <a href={`mailto:${COMPANY.legalEmail}`} className="text-dim underline underline-offset-2">
          {COMPANY.legalEmail}
        </a>{" "}
        or use the{" "}
        <Link href="/contact" className="text-dim underline underline-offset-2">
          contact form
        </Link>
        . See all policies at{" "}
        <Link href="/legal" className="text-dim underline underline-offset-2">
          /legal
        </Link>
        .
      </p>
    </article>
  );
}
