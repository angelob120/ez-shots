"use client";

import * as React from "react";

import {
  PREVIEW_MESSAGE,
  PREVIEW_PARAM,
  parseDraft,
  type StorePreviewDraft,
} from "@/lib/store-preview";

/**
 * Receives branding drafts from the editor and merges them over the server's
 * DTO, so the storefront in the preview iframe is the storefront — same route,
 * same components, unsaved values.
 *
 * Three guards, each closing a different hole:
 *
 * - **`?preview=1` only.** Without it the listener never mounts, so a customer
 *   on the live page cannot be sent a redecorated storefront by anything on
 *   the internet.
 * - **Same origin only.** The editor always frames the *platform* origin
 *   (`platformOrigin()`), never the tenant's custom domain, precisely so this
 *   check is a plain equality rather than a list of hosts to keep current.
 * - **Framed only.** A preview URL pasted into a browser bar has no parent to
 *   post to it, so it just renders the saved site — which is the correct
 *   answer, not an error state.
 *
 * The merge is one-way and in memory. Nothing here writes, so a draft cannot
 * outlive the tab and there is no stored preview for a customer to stumble on.
 */
export function usePreviewDraft(): { isPreview: boolean; draft: StorePreviewDraft | null } {
  const [draft, setDraft] = React.useState<StorePreviewDraft | null>(null);
  // Read once on mount rather than during render: the server has no
  // querystring and would disagree with the client, which is a hydration
  // mismatch on the storefront's first paint.
  const [isPreview, setIsPreview] = React.useState(false);

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get(PREVIEW_PARAM) !== "1") return;
    if (window.parent === window) return;
    setIsPreview(true);

    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      const next = parseDraft(e.data);
      if (next) setDraft(next);
    }

    window.addEventListener("message", onMessage);
    // The editor mounts before the iframe finishes loading about half the
    // time, so its first post lands on nothing. Rather than have it retry on a
    // timer — which races differently on a slow connection — the frame asks
    // once it is ready, and the editor answers.
    window.parent.postMessage({ type: `${PREVIEW_MESSAGE}:ready` }, window.location.origin);

    return () => window.removeEventListener("message", onMessage);
  }, []);

  return { isPreview, draft };
}

/**
 * Apply a draft to the shape StoreApp already renders from.
 *
 * Generic over the DTO so this module doesn't have to import it — StoreApp is
 * a large client component and the preview layer has no business depending on
 * its type. Every key written here is on the allowlist in
 * `lib/store-preview.ts`; nothing else in the DTO is reachable from a message.
 */
export function mergeDraft<
  T extends {
    name: string;
    accentColor: string;
    theme: "LIGHT" | "DARK" | "SYSTEM";
    themePreset: string;
  },
>(dto: T, draft: StorePreviewDraft | null): T {
  if (!draft) return dto;
  return {
    ...dto,
    name: draft.name || dto.name,
    tagline: draft.tagline,
    logoUrl: draft.logoUrl,
    heroUrl: draft.heroUrl,
    accentColor: draft.accentColor,
    themePreset: draft.themePreset,
    theme: draft.theme,
    address: draft.address,
    city: draft.city,
    phone: draft.phone,
    heroHeadline: draft.heroHeadline,
    heroCtaLabel: draft.heroCtaLabel,
    aboutTitle: draft.aboutTitle,
    aboutBody: draft.aboutBody,
    galleryUrls: draft.galleryUrls,
    showAbout: draft.showAbout,
    showGallery: draft.showGallery,
    content: draft.content,
    // `hours` is an object on the DTO (the parsed schedule) and the editor only
    // owns the free-text note printed underneath it. Replacing the whole object
    // would blank the actual opening times in the preview, which is the one
    // thing on that page an owner might read as a bug in their real hours.
    hours: { ...(dto as { hours?: object }).hours, note: draft.hoursNote },
  };
}
