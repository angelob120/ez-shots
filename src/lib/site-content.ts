/**
 * Editable copy for the /r/[slug] website that isn't a first-class column.
 *
 * The identity fields (name, hero, accent, about title/body, gallery…) live on
 * the Restaurant row. Everything here is the *template* copy the site used to
 * hardcode — the value cards, the page banner subtitles, the footer call to
 * action. Storing it as one JSON blob keeps the schema flat while letting an
 * owner rewrite any of it from the branding editor.
 *
 * Every field is allowed to be empty. An empty field means "use the built-in
 * default," so a restaurant that never opens this editor sees exactly the
 * template it saw before — the look doesn't change until someone changes it.
 */

export type ValueCard = { title: string; body: string };

export type SiteContent = {
  homeValues: ValueCard[]; // the three cards under the home hero
  aboutValues: ValueCard[]; // the three cards on the About page
  menuSubtitle: string;
  gallerySubtitle: string;
  visitSubtitle: string;
  footerTitle: string;
  footerBody: string;
};

/* The template defaults — the exact copy the site shipped with. These double as
 * placeholders in the editor and as the runtime fallback in StoreLanding. */
export const HOME_VALUE_DEFAULTS: ValueCard[] = [
  { title: "Skip the line", body: "Order from your phone and pick up when it's ready." },
  { title: "Made fresh", body: "Your order hits the kitchen the moment you place it." },
  { title: "No app to install", body: "It all happens right here in your browser." },
];

export const ABOUT_VALUE_DEFAULTS: ValueCard[] = [
  { title: "Made to order", body: "Nothing sits under a lamp. It's cooked when you ask for it." },
  { title: "Regulars welcome", body: "Order once and reordering your usual takes seconds." },
  { title: "Straight from us", body: "No middlemen, no delivery markup - you order us directly." },
];

export const FOOTER_TITLE_DEFAULT = "Hungry? Order in a couple taps.";
export const FOOTER_BODY_DEFAULT =
  "Pickup only. A small service fee is added at checkout and shown before you pay.";

export const VALUE_CARD_COUNT = 3;

/** An all-empty content object — used to seed the editor for a new tenant. */
export function emptySiteContent(): SiteContent {
  const blanks = Array.from({ length: VALUE_CARD_COUNT }, () => ({ title: "", body: "" }));
  return {
    homeValues: blanks.map((c) => ({ ...c })),
    aboutValues: blanks.map((c) => ({ ...c })),
    menuSubtitle: "",
    gallerySubtitle: "",
    visitSubtitle: "",
    footerTitle: "",
    footerBody: "",
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function cardsFrom(raw: unknown): ValueCard[] {
  const out = emptySiteContent().homeValues;
  if (Array.isArray(raw)) {
    for (let i = 0; i < VALUE_CARD_COUNT; i++) {
      const c = raw[i];
      if (c && typeof c === "object") {
        out[i] = {
          title: str((c as Record<string, unknown>).title).slice(0, 60),
          body: str((c as Record<string, unknown>).body).slice(0, 200),
        };
      }
    }
  }
  return out;
}

/** Coerce whatever is in the JSON column into a well-formed SiteContent. */
export function parseSiteContent(raw: unknown): SiteContent {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    homeValues: cardsFrom(o.homeValues),
    aboutValues: cardsFrom(o.aboutValues),
    menuSubtitle: str(o.menuSubtitle).slice(0, 200),
    gallerySubtitle: str(o.gallerySubtitle).slice(0, 200),
    visitSubtitle: str(o.visitSubtitle).slice(0, 200),
    footerTitle: str(o.footerTitle).slice(0, 120),
    footerBody: str(o.footerBody).slice(0, 200),
  };
}

/** Read the editor's inputs back out of a submitted form. */
export function siteContentFromForm(formData: FormData): SiteContent {
  const card = (prefix: string, i: number): ValueCard => ({
    title: String(formData.get(`${prefix}${i}Title`) ?? "").trim().slice(0, 60),
    body: String(formData.get(`${prefix}${i}Body`) ?? "").trim().slice(0, 200),
  });
  const idx = Array.from({ length: VALUE_CARD_COUNT }, (_, i) => i);
  return {
    homeValues: idx.map((i) => card("homeValue", i)),
    aboutValues: idx.map((i) => card("aboutValue", i)),
    menuSubtitle: String(formData.get("menuSubtitle") ?? "").trim().slice(0, 200),
    gallerySubtitle: String(formData.get("gallerySubtitle") ?? "").trim().slice(0, 200),
    visitSubtitle: String(formData.get("visitSubtitle") ?? "").trim().slice(0, 200),
    footerTitle: String(formData.get("footerTitle") ?? "").trim().slice(0, 120),
    footerBody: String(formData.get("footerBody") ?? "").trim().slice(0, 200),
  };
}
