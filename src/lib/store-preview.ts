/**
 * The draft the branding editor pushes into a live storefront.
 *
 * ── Why the preview is the real page ────────────────────────────────────────
 *
 * The editor renders `/r/[slug]?preview=1` in an iframe and posts unsaved edits
 * into it. The alternative — a mock storefront drawn inside the editor — is
 * cheaper and wrong for the same reason the admin analytics drilldown renders
 * the owner's components rather than its own: two implementations of "what the
 * storefront looks like" drift, and the first anyone hears of it is an owner
 * saying the preview lied. There is no way to win that support call.
 *
 * Nothing here touches the database. A draft is a message, it lives in the
 * iframe's React state, and closing the tab discards it. That rules out the
 * whole class of bug where a preview token leaks a half-finished redesign to
 * customers, because there is no token and no stored draft to leak.
 *
 * ── Before/After ────────────────────────────────────────────────────────────
 *
 * The comparison is not a second render path. "Before" is the editor posting
 * the *saved* snapshot it was handed on mount; "After" is it posting the
 * current form state. Same route, same components, same merge — so the two
 * halves of the comparison cannot disagree about anything except the fields
 * that actually changed.
 *
 * Pure: no `server-only`, no Prisma. Imported by the editor and by the
 * storefront's preview hook, which are on opposite sides of the iframe.
 */

import {
  emptySiteContent,
  type SiteContent,
  type ValueCard,
} from "@/lib/site-content";
import { DEFAULT_STORE_THEME, type StoreThemeId } from "@/lib/store-theme";

/**
 * Every field the editor can change, and nothing else.
 *
 * Deliberately not `Partial<RestaurantDTO>`. That type also carries the
 * surcharge rates, the Stripe publishable key and the payment mode — none of
 * which an owner may set, all of which would become settable the moment the
 * merge accepted them from a message. An explicit list is the allowlist.
 */
export type StorePreviewDraft = {
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  heroUrl: string | null;
  accentColor: string;
  themePreset: StoreThemeId;
  theme: "LIGHT" | "DARK" | "SYSTEM";
  address: string | null;
  city: string | null;
  phone: string | null;
  hoursNote: string | null;
  heroHeadline: string | null;
  heroCtaLabel: string | null;
  aboutTitle: string | null;
  aboutBody: string | null;
  galleryUrls: string[];
  showAbout: boolean;
  showGallery: boolean;
  content: SiteContent;
};

/** The `type` on the postMessage envelope. Namespaced so a stray message from
 *  an extension or an embedded widget can't be mistaken for a draft. */
export const PREVIEW_MESSAGE = "hearth:store-preview" as const;

export type PreviewEnvelope = {
  type: typeof PREVIEW_MESSAGE;
  draft: StorePreviewDraft;
};

/** The querystring flag that puts the storefront in preview mode. */
export const PREVIEW_PARAM = "preview";

/* ------------------------------------------------------------------ parsing */

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function cards(v: unknown): ValueCard[] {
  if (!Array.isArray(v)) return [];
  return v.map((c) => ({
    title: str((c as ValueCard | undefined)?.title) ?? "",
    body: str((c as ValueCard | undefined)?.body) ?? "",
  }));
}

function content(v: unknown): SiteContent {
  const base = emptySiteContent();
  if (!v || typeof v !== "object") return base;
  const o = v as Record<string, unknown>;
  return {
    homeValues: cards(o.homeValues).length ? cards(o.homeValues) : base.homeValues,
    aboutValues: cards(o.aboutValues).length ? cards(o.aboutValues) : base.aboutValues,
    menuSubtitle: str(o.menuSubtitle) ?? "",
    gallerySubtitle: str(o.gallerySubtitle) ?? "",
    visitSubtitle: str(o.visitSubtitle) ?? "",
    footerTitle: str(o.footerTitle) ?? "",
    footerBody: str(o.footerBody) ?? "",
  };
}

/**
 * Coerce an arbitrary message payload into a draft.
 *
 * This runs on data that arrived from `postMessage`. The origin check in the
 * hook is the real gate, but a message that passes it is still a value from
 * outside React's type system — so every field is narrowed rather than cast.
 * Returns null when the envelope isn't ours, which is the common case: a page
 * receives plenty of messages it did not ask for.
 */
export function parseDraft(data: unknown): StorePreviewDraft | null {
  if (!data || typeof data !== "object") return null;
  const env = data as Record<string, unknown>;
  if (env.type !== PREVIEW_MESSAGE) return null;
  const d = env.draft;
  if (!d || typeof d !== "object") return null;
  const o = d as Record<string, unknown>;

  const preset = str(o.themePreset);
  const theme = str(o.theme);

  return {
    name: str(o.name) ?? "",
    tagline: str(o.tagline),
    logoUrl: str(o.logoUrl),
    heroUrl: str(o.heroUrl),
    accentColor: str(o.accentColor) ?? "#3b82f6",
    themePreset: (preset ?? DEFAULT_STORE_THEME) as StoreThemeId,
    theme:
      theme === "LIGHT" || theme === "DARK" || theme === "SYSTEM" ? theme : "SYSTEM",
    address: str(o.address),
    city: str(o.city),
    phone: str(o.phone),
    hoursNote: str(o.hoursNote),
    heroHeadline: str(o.heroHeadline),
    heroCtaLabel: str(o.heroCtaLabel),
    aboutTitle: str(o.aboutTitle),
    aboutBody: str(o.aboutBody),
    galleryUrls: Array.isArray(o.galleryUrls)
      ? o.galleryUrls.filter((u): u is string => typeof u === "string" && u.length > 0)
      : [],
    showAbout: bool(o.showAbout, true),
    showGallery: bool(o.showGallery, true),
    content: content(o.content),
  };
}

/* -------------------------------------------------------------- change list */

export type FieldChange = { label: string; before: string; after: string };

function shown(v: string | null | undefined, fallback = "—"): string {
  const s = (v ?? "").trim();
  return s.length ? s : fallback;
}

const SIMPLE_FIELDS: Array<{ key: keyof StorePreviewDraft; label: string }> = [
  { key: "name", label: "Restaurant name" },
  { key: "tagline", label: "Tagline" },
  { key: "accentColor", label: "Accent color" },
  { key: "themePreset", label: "Theme" },
  { key: "theme", label: "Light / dark" },
  { key: "logoUrl", label: "Logo" },
  { key: "heroUrl", label: "Banner image" },
  { key: "address", label: "Address" },
  { key: "city", label: "City / ZIP" },
  { key: "phone", label: "Phone" },
  { key: "hoursNote", label: "Hours note" },
  { key: "heroHeadline", label: "Hero headline" },
  { key: "heroCtaLabel", label: "Order button text" },
  { key: "aboutTitle", label: "About heading" },
  { key: "aboutBody", label: "About text" },
];

/**
 * What changed, in the owner's words.
 *
 * The visual Before/After answers "does this look right"; this answers "what
 * did I actually touch", which is the question after twenty minutes of edits
 * across seven panels. An image is reported as changed rather than as two URLs
 * — nobody reads an R2 key and decides from it.
 */
export function describeChanges(
  before: StorePreviewDraft,
  after: StorePreviewDraft
): FieldChange[] {
  const out: FieldChange[] = [];

  for (const { key, label } of SIMPLE_FIELDS) {
    const a = before[key] as string | null;
    const b = after[key] as string | null;
    if ((a ?? "") === (b ?? "")) continue;
    if (key === "logoUrl" || key === "heroUrl") {
      out.push({
        label,
        before: a ? "set" : "none",
        after: b ? "set" : "none",
      });
      continue;
    }
    out.push({ label, before: shown(a), after: shown(b) });
  }

  if (before.showAbout !== after.showAbout) {
    out.push({
      label: "About page",
      before: before.showAbout ? "shown" : "hidden",
      after: after.showAbout ? "shown" : "hidden",
    });
  }
  if (before.showGallery !== after.showGallery) {
    out.push({
      label: "Gallery page",
      before: before.showGallery ? "shown" : "hidden",
      after: after.showGallery ? "shown" : "hidden",
    });
  }
  if (before.galleryUrls.join("|") !== after.galleryUrls.join("|")) {
    out.push({
      label: "Gallery photos",
      before: `${before.galleryUrls.length}`,
      after: `${after.galleryUrls.length}`,
    });
  }

  // Copy blocks are compared whole. Reporting "home highlight 2 body" is
  // precision nobody asked for; "you changed the home highlights" is the
  // sentence an owner can act on.
  const copyBlocks: Array<{ label: string; pick: (c: SiteContent) => string }> = [
    { label: "Home highlights", pick: (c) => JSON.stringify(c.homeValues) },
    { label: "About points", pick: (c) => JSON.stringify(c.aboutValues) },
    { label: "Menu page subtitle", pick: (c) => c.menuSubtitle },
    { label: "Gallery page subtitle", pick: (c) => c.gallerySubtitle },
    { label: "Visit page subtitle", pick: (c) => c.visitSubtitle },
    { label: "Footer heading", pick: (c) => c.footerTitle },
    { label: "Footer subtext", pick: (c) => c.footerBody },
  ];
  for (const { label, pick } of copyBlocks) {
    const a = pick(before.content);
    const b = pick(after.content);
    if (a === b) continue;
    const structural = label === "Home highlights" || label === "About points";
    out.push({
      label,
      before: structural ? "previous wording" : shown(a),
      after: structural ? "edited" : shown(b),
    });
  }

  return out;
}
