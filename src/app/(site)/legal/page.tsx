import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY, LEGAL_DOCS, formatLegalDate, type LegalDoc } from "@/lib/legal";
import { LegalReviewBanner } from "@/components/site/legal";

// Not `force-static`: the (site) layout reads the session cookie to decide
// whether the header says "Log in" or "Go to dashboard", which makes the whole
// segment dynamic. Declaring static here would be a promise the route cannot
// keep. The content itself is compile-time constant, so this is cheap anyway.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Policies - EZ Orders",
  description:
    "Terms, privacy, refunds, messaging and the rest — every policy that applies to using EZ Orders.",
};

const GROUPS: Array<{ key: LegalDoc["audience"]; title: string; blurb: string }> = [
  {
    key: "everyone",
    title: "Everyone",
    blurb: "These apply whether you are ordering food or running a restaurant.",
  },
  {
    key: "customers",
    title: "If you are ordering",
    blurb: "",
  },
  {
    key: "restaurants",
    title: "If you run a restaurant on EZ Orders",
    blurb: "These sit on top of the terms above.",
  },
];

export default function LegalIndexPage() {
  return (
    <div className="mx-auto max-w-[760px] px-6 py-16">
      <h1 className="text-[30px] font-semibold leading-tight tracking-tight text-ink">Policies</h1>
      <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-dim">
        Written to be read. Each one opens with the answer people actually arrive looking for.
      </p>

      <hr className="my-10 border-line" />
      <LegalReviewBanner />

      <div className="space-y-12">
        {GROUPS.map((group) => {
          const docs = LEGAL_DOCS.filter((d) => d.audience === group.key);
          if (docs.length === 0) return null;
          return (
            <section key={group.key}>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.1em] text-mute">
                {group.title}
              </h2>
              {group.blurb && <p className="mt-2 text-[13.5px] text-dim">{group.blurb}</p>}

              <ul className="mt-5 divide-y divide-line border-y border-line">
                {docs.map((doc) => (
                  <li key={doc.slug}>
                    <Link
                      href={`/legal/${doc.slug}`}
                      className="group flex flex-col gap-1 py-4 transition-colors"
                    >
                      <span className="flex items-baseline justify-between gap-4">
                        <span className="text-[15px] font-medium text-ink group-hover:underline group-hover:underline-offset-2">
                          {doc.title}
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums text-mute">
                          {formatLegalDate(doc.updated)}
                        </span>
                      </span>
                      <span className="text-[13.5px] leading-relaxed text-dim">{doc.summary}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-12 text-[13px] leading-relaxed text-mute">
        Something unclear or missing? Email{" "}
        <a href={`mailto:${COMPANY.legalEmail}`} className="text-dim underline underline-offset-2">
          {COMPANY.legalEmail}
        </a>
        .
      </p>
    </div>
  );
}
