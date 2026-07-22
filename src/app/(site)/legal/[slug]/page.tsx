import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { legalDoc } from "@/lib/legal";
import { LegalDocument } from "@/components/site/legal";

// Not `force-static`: the (site) layout reads the session cookie to decide
// whether the header says "Log in" or "Go to dashboard", which makes the whole
// segment dynamic. Declaring static here would be a promise the route cannot
// keep. The content itself is compile-time constant, so this is cheap anyway.
export const dynamic = "force-dynamic";

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const doc = legalDoc(params.slug);
  if (!doc) return { title: "Not found - EZ Orders" };
  return {
    title: `${doc.title} - EZ Orders`,
    description: doc.summary,
    alternates: { canonical: `/legal/${doc.slug}` },
  };
}

export default function LegalPage({ params }: { params: { slug: string } }) {
  const doc = legalDoc(params.slug);
  if (!doc) notFound();
  return <LegalDocument doc={doc} />;
}
