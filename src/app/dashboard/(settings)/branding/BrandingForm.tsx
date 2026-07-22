"use client";

import { useState } from "react";

import { updateBrandingAction } from "@/app/dashboard/actions";
import { cx } from "@/components/hearth/ui";
import StorefrontEditor, { type EditorInitial } from "@/components/hearth/StorefrontEditor";
import DomainForm, { type DomainInitial } from "./DomainForm";
import LinksPanel, { type LinksInitial } from "./LinksPanel";

/**
 * The owner's branding surface — three things that share a page and nothing
 * else.
 *
 * The website editor is `components/hearth/StorefrontEditor`, shared with the
 * onboarding wizard so an owner meets the same controls both times. Links and
 * Domain stay here: each is its own form against its own action, and folding
 * them into the editor's single Save would mean one button that sometimes
 * re-issues a TLS certificate.
 *
 * This used to be eight tabs of flat form fields with a mock preview strip at
 * the bottom. Seven of those tabs were pages of one website — which is a thing
 * the editor now shows you rather than asks you to hold in your head.
 */

type Tab = "site" | "links" | "domain";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "site", label: "Website" },
  { id: "links", label: "Links & QR" },
  { id: "domain", label: "Domain" },
];

export default function BrandingForm({
  initial,
  slug,
  domain,
  appHost,
  challengePrefix,
  origin,
}: {
  initial: Omit<EditorInitial, "slug">;
  slug: string;
  domain: DomainInitial;
  appHost: string;
  challengePrefix: string;
  origin: string;
}) {
  const [tab, setTab] = useState<Tab>("site");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 border-b border-line pb-3">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cx(
              "rounded-sm px-3.5 py-1.5 text-[13px] font-medium transition-colors",
              tab === t.id
                ? "bg-accentFill text-accentInk"
                : "text-dim hover:bg-surface2 hover:text-ink"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "site" && (
        <StorefrontEditor initial={{ ...initial, slug }} action={updateBrandingAction} />
      )}

      {tab === "links" && (
        <LinksPanel
          initial={
            {
              slug,
              origin,
              customDomain: domain.domain,
              domainVerified: domain.verified,
              showAbout: initial.showAbout,
              showGallery: initial.showGallery,
            } satisfies LinksInitial
          }
          onGoToDomain={() => setTab("domain")}
        />
      )}

      {tab === "domain" && (
        <DomainForm initial={domain} appHost={appHost} challengePrefix={challengePrefix} />
      )}
    </div>
  );
}
