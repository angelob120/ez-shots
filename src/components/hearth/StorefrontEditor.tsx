"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";

import { Button, Card, Field, Input, Textarea, cx } from "@/components/hearth/ui";
import ImageUpload from "@/components/hearth/ImageUpload";
import {
  HOME_VALUE_DEFAULTS,
  ABOUT_VALUE_DEFAULTS,
  FOOTER_TITLE_DEFAULT,
  FOOTER_BODY_DEFAULT,
  VALUE_CARD_COUNT,
  type SiteContent,
  type ValueCard,
} from "@/lib/site-content";
import {
  STORE_THEMES,
  isAlwaysDark,
  readableInkOn,
  storeTheme,
  type StoreThemeId,
} from "@/lib/store-theme";
import {
  PREVIEW_MESSAGE,
  describeChanges,
  type StorePreviewDraft,
} from "@/lib/store-preview";

/**
 * The one surface for customizing a storefront.
 *
 * Rendered in two places — the onboarding wizard and /dashboard/branding — on
 * purpose. An owner who picks a look during setup and later wants to change it
 * should meet the same controls in the same order, not a wizard step and then
 * an unrelated settings page that happens to write the same columns.
 * `variant="essentials"` trims the sections rather than the component, so the
 * two can't drift.
 *
 * ── The shape of it ─────────────────────────────────────────────────────────
 *
 * Controls left, the real storefront right, in an iframe, updating as you type
 * — see `lib/store-preview.ts` for why the preview is the real page rather
 * than a mock. Sections are a vertical list, not a strip of tabs: the old
 * editor had eight tabs across the top and no way to tell which of them you
 * had already filled in, so the common failure was an owner launching with a
 * default About page they never knew existed. The list shows every section at
 * once and marks the ones still carrying template copy.
 *
 * Every input is controlled, because the preview has to see a keystroke. They
 * still carry `name` attributes and still submit as ordinary FormData to the
 * same server action as before — the draft is a mirror of the form, not a
 * replacement for it.
 */

/* ------------------------------------------------------------------- types */

export type EditorInitial = {
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string;
  heroUrl: string;
  accentColor: string;
  themePreset: string;
  theme: "LIGHT" | "DARK" | "SYSTEM";
  address: string;
  city: string;
  phone: string;
  hours: string;
  heroHeadline: string;
  heroCtaLabel: string;
  aboutTitle: string;
  aboutBody: string;
  gallery: string[];
  showAbout: boolean;
  showGallery: boolean;
  content: SiteContent;
};

type Draft = EditorInitial;

type Result = { ok?: string; error?: string } | undefined;
type Action = (prev: Result, formData: FormData) => Promise<Result>;

type SectionId = "theme" | "identity" | "home" | "menu" | "about" | "gallery" | "visit";

const MAX_GALLERY = 6;

const SECTIONS: Array<{ id: SectionId; label: string; blurb: string; essential: boolean }> = [
  { id: "theme", label: "Look & feel", blurb: "Theme, color, light or dark", essential: true },
  { id: "identity", label: "Name & contact", blurb: "Logo, banner, address, phone", essential: true },
  { id: "home", label: "Home page", blurb: "Headline, order button, highlights", essential: true },
  { id: "menu", label: "Menu page", blurb: "Intro text above your dishes", essential: false },
  { id: "about", label: "About page", blurb: "Your story, or hide the page", essential: false },
  { id: "gallery", label: "Photos", blurb: "Up to six, or hide the page", essential: false },
  { id: "visit", label: "Visit page", blurb: "Intro text above your info cards", essential: false },
];

/* --------------------------------------------------------------- draft glue */

function toPreviewDraft(d: Draft): StorePreviewDraft {
  const nil = (s: string) => (s.trim().length ? s : null);
  return {
    name: d.name,
    tagline: nil(d.tagline),
    logoUrl: nil(d.logoUrl),
    heroUrl: nil(d.heroUrl),
    accentColor: d.accentColor,
    themePreset: storeTheme(d.themePreset).id,
    theme: isAlwaysDark(d.themePreset) ? "DARK" : d.theme,
    address: nil(d.address),
    city: nil(d.city),
    phone: nil(d.phone),
    hoursNote: nil(d.hours),
    heroHeadline: nil(d.heroHeadline),
    heroCtaLabel: nil(d.heroCtaLabel),
    aboutTitle: nil(d.aboutTitle),
    aboutBody: nil(d.aboutBody),
    galleryUrls: d.gallery.filter(Boolean),
    showAbout: d.showAbout,
    showGallery: d.showGallery,
    content: d.content,
  };
}

/* -------------------------------------------------------------- the editor */

export default function StorefrontEditor({
  initial,
  action,
  variant = "full",
  submitLabel = "Save changes",
}: {
  initial: EditorInitial;
  action: Action;
  /** "essentials" drops the per-page copy sections — see the onboarding note. */
  variant?: "full" | "essentials";
  submitLabel?: string;
}) {
  const [state, formAction] = useFormState(action, undefined);

  // The saved snapshot never changes for the life of the form. It is the
  // "Before" half of the comparison and the baseline for the change list, so
  // it is captured once on mount rather than read from `initial` on every
  // render — a parent re-render mid-edit would otherwise silently redefine
  // what "before" means.
  const [saved] = React.useState<Draft>(() => structuredCloneish(initial));
  const [draft, setDraft] = React.useState<Draft>(() => structuredCloneish(initial));

  const [section, setSection] = React.useState<SectionId>("theme");
  const [device, setDevice] = React.useState<"phone" | "desktop">("phone");
  const [showing, setShowing] = React.useState<"after" | "before">("after");

  const set = React.useCallback(
    <K extends keyof Draft>(key: K, value: Draft[K]) =>
      setDraft((d) => ({ ...d, [key]: value })),
    []
  );
  const setContent = React.useCallback(
    <K extends keyof SiteContent>(key: K, value: SiteContent[K]) =>
      setDraft((d) => ({ ...d, content: { ...d.content, [key]: value } })),
    []
  );
  const setCard = React.useCallback(
    (which: "homeValues" | "aboutValues", i: number, patch: Partial<ValueCard>) =>
      setDraft((d) => {
        const list = [...d.content[which]];
        while (list.length < VALUE_CARD_COUNT) list.push({ title: "", body: "" });
        list[i] = { ...list[i], ...patch };
        return { ...d, content: { ...d.content, [which]: list } };
      }),
    []
  );

  const changes = React.useMemo(
    () => describeChanges(toPreviewDraft(saved), toPreviewDraft(draft)),
    [saved, draft]
  );

  const sections = SECTIONS.filter((s) => variant === "full" || s.essential);
  const active = sections.some((s) => s.id === section) ? section : sections[0].id;

  return (
    <form action={formAction} className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ── Controls ──────────────────────────────────────────────────── */}
      <div className="min-w-0 space-y-4">
        <SectionList
          sections={sections}
          active={active}
          onPick={setSection}
          draft={draft}
        />

        <Card>
          <div className="space-y-5">
            {active === "theme" && (
              <ThemePanel draft={draft} set={set} />
            )}
            {active === "identity" && (
              <IdentityPanel draft={draft} set={set} setContent={setContent} />
            )}
            {active === "home" && (
              <HomePanel draft={draft} set={set} setCard={setCard} />
            )}
            {active === "menu" && (
              <MenuPanel draft={draft} setContent={setContent} />
            )}
            {active === "about" && (
              <AboutPanel draft={draft} set={set} setCard={setCard} />
            )}
            {active === "gallery" && (
              <GalleryPanel draft={draft} set={set} setContent={setContent} />
            )}
            {active === "visit" && (
              <VisitPanel draft={draft} setContent={setContent} />
            )}
          </div>
        </Card>

        {/* Fields belonging to panels that aren't mounted still have to reach
            the server. A hidden mirror of the whole draft is the alternative to
            keeping every panel rendered and merely hidden — which is what the
            old editor did, and is why it shipped seven `<Panel hidden>` blocks
            and a form that submitted stale values whenever a panel unmounted.
            One place, every field, always present. */}
        <HiddenFields draft={draft} mounted={active} />

        <ChangeList changes={changes} />

        {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
        {state?.ok && <p className="text-[12px] text-accent">{state.ok}</p>}

        <div className="flex items-center gap-3">
          <Submit label={submitLabel} />
          {changes.length > 0 && (
            <button
              type="button"
              onClick={() => setDraft(structuredCloneish(saved))}
              className="text-[12px] text-dim underline underline-offset-2 hover:text-ink"
            >
              Discard changes
            </button>
          )}
        </div>
      </div>

      {/* ── Preview ───────────────────────────────────────────────────── */}
      <div className="min-w-0">
        <PreviewPane
          slug={draft.slug}
          draft={toPreviewDraft(showing === "after" ? draft : saved)}
          device={device}
          onDevice={setDevice}
          showing={showing}
          onShowing={setShowing}
          changeCount={changes.length}
        />
      </div>
    </form>
  );
}

/** A structured clone that works on the shapes here without the DOM API,
 *  which isn't available during SSR of a client component's initial state. */
function structuredCloneish(d: EditorInitial): Draft {
  return {
    ...d,
    gallery: [...d.gallery],
    content: {
      ...d.content,
      homeValues: d.content.homeValues.map((c) => ({ ...c })),
      aboutValues: d.content.aboutValues.map((c) => ({ ...c })),
    },
  };
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : label}</Button>;
}

/* --------------------------------------------------------------- preview */

function PreviewPane({
  slug,
  draft,
  device,
  onDevice,
  showing,
  onShowing,
  changeCount,
}: {
  slug: string;
  draft: StorePreviewDraft;
  device: "phone" | "desktop";
  onDevice: (d: "phone" | "desktop") => void;
  showing: "after" | "before";
  onShowing: (s: "after" | "before") => void;
  changeCount: number;
}) {
  const frame = React.useRef<HTMLIFrameElement | null>(null);
  const [ready, setReady] = React.useState(false);

  // The frame tells us when its listener is mounted. Posting on a timer
  // instead would race differently on a slow connection, and the failure —
  // a preview stuck on the saved site while the owner types — reads as the
  // editor being broken rather than as a lost first message.
  React.useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if ((e.data as { type?: string })?.type === `${PREVIEW_MESSAGE}:ready`) setReady(true);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  React.useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, draft },
      window.location.origin
    );
  }, [ready, draft]);

  return (
    <div className="lg:sticky lg:top-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <Segmented
          value={showing}
          onChange={(v) => onShowing(v as "after" | "before")}
          options={[
            { value: "before", label: "Before" },
            { value: "after", label: changeCount ? `After (${changeCount})` : "After" },
          ]}
        />
        <Segmented
          value={device}
          onChange={(v) => onDevice(v as "phone" | "desktop")}
          options={[
            { value: "phone", label: "Phone" },
            { value: "desktop", label: "Desktop" },
          ]}
        />
      </div>

      <div
        className={cx(
          "overflow-hidden rounded-md border bg-surface2 transition-colors",
          showing === "before" ? "border-line2" : "border-accentDim"
        )}
      >
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <span className="h-2 w-2 rounded-full bg-line2" />
          <span className="truncate text-[11px] text-mute">/r/{slug}</span>
          {showing === "before" && (
            <span className="ml-auto rounded-sm bg-surface px-1.5 py-0.5 text-[10px] font-medium text-dim">
              Saved version
            </span>
          )}
        </div>

        <div className="grid place-items-center bg-surface2 p-3">
          <iframe
            ref={frame}
            // Preview mode is a querystring flag rather than its own route, so
            // this is byte-for-byte the page a customer gets — a separate
            // /preview route would be a second render path and would start
            // drifting the day someone edits one of them.
            src={`/r/${encodeURIComponent(slug)}?preview=1`}
            title="Website preview"
            className={cx(
              "border-0 bg-white transition-[width,height] duration-200",
              device === "phone" ? "h-[600px] w-[320px] rounded-[22px]" : "h-[600px] w-full rounded-sm"
            )}
          />
        </div>
      </div>

      <p className="mt-2 text-[11px] leading-relaxed text-mute">
        This is your real website with unsaved changes applied. Nothing here is live
        until you save, and orders can&rsquo;t be placed from a preview.
      </p>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="inline-flex rounded-sm border border-line2 bg-surface2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-sm px-3 py-1 text-[12px] font-medium transition-colors",
            value === o.value ? "bg-accentFill text-accentInk" : "text-dim hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------ change list */

function ChangeList({ changes }: { changes: ReturnType<typeof describeChanges> }) {
  if (changes.length === 0) {
    return (
      <p className="text-[12px] text-mute">No changes yet.</p>
    );
  }
  return (
    <details className="rounded-sm border border-line2 bg-surface2 px-3 py-2" open>
      <summary className="cursor-pointer text-[12px] font-medium text-ink">
        {changes.length} unsaved {changes.length === 1 ? "change" : "changes"}
      </summary>
      <ul className="mt-2 space-y-1">
        {changes.map((c) => (
          <li key={c.label} className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-2 text-[12px]">
            <span className="truncate text-dim">{c.label}</span>
            <span className="truncate">
              <span className="text-mute line-through">{c.before}</span>
              <span className="mx-1.5 text-mute">→</span>
              <span className="text-ink">{c.after}</span>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/* --------------------------------------------------------------- sections */

function SectionList({
  sections,
  active,
  onPick,
  draft,
}: {
  sections: typeof SECTIONS;
  active: SectionId;
  onPick: (s: SectionId) => void;
  draft: Draft;
}) {
  // "Untouched" means the owner has never written anything here, so the page
  // is still showing template copy. Surfacing it is the whole reason this is a
  // list and not a tab strip: the old editor gave no way to notice you had
  // launched with a stranger's About page.
  const untouched: Record<SectionId, boolean> = {
    theme: false,
    identity: !draft.logoUrl && !draft.heroUrl,
    home: !draft.heroHeadline && !draft.content.homeValues.some((c) => c.title),
    menu: !draft.content.menuSubtitle,
    about: draft.showAbout && !draft.aboutBody,
    gallery: draft.showGallery && draft.gallery.filter(Boolean).length === 0,
    visit: !draft.content.visitSubtitle,
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {sections.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s.id)}
          title={s.blurb}
          className={cx(
            "flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[13px] font-medium transition-colors",
            active === s.id
              ? "bg-accentFill text-accentInk"
              : "text-dim hover:bg-surface2 hover:text-ink"
          )}
        >
          {s.label}
          {untouched[s.id] && (
            <span
              aria-label="still using the default"
              className={cx(
                "h-1.5 w-1.5 rounded-full",
                active === s.id ? "bg-accentInk/60" : "bg-warn"
              )}
            />
          )}
        </button>
      ))}
    </div>
  );
}

function PanelIntro({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-[15px] font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-[12px] leading-relaxed text-dim">{body}</p>
    </div>
  );
}

/* ── Look & feel ─────────────────────────────────────────────────────────── */

function ThemePanel({
  draft,
  set,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
}) {
  const alwaysDark = isAlwaysDark(draft.themePreset);

  return (
    <>
      <PanelIntro
        title="Look & feel"
        body="Every EZ Orders website is built the same way — same pages, same ordering flow. A theme changes the surface it all sits on."
      />

      <div className="grid gap-2 sm:grid-cols-2">
        {STORE_THEMES.map((t) => {
          const selected = storeTheme(draft.themePreset).id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => set("themePreset", t.id)}
              className={cx(
                "flex items-start gap-3 rounded-sm border p-3 text-left transition-colors",
                selected
                  ? "border-accentDim bg-accentFill/10"
                  : "border-line2 bg-surface2 hover:border-accentDim/60"
              )}
            >
              <span
                className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-sm border"
                style={{ background: t.swatch.bg, borderColor: t.swatch.raised }}
              >
                <span
                  className="h-4 w-4 rounded-full"
                  style={{ background: draft.accentColor }}
                />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold text-ink">{t.label}</span>
                <span className="block text-[11px] leading-relaxed text-dim">{t.blurb}</span>
              </span>
            </button>
          );
        })}
      </div>
      <input type="hidden" name="themePreset" value={storeTheme(draft.themePreset).id} />

      <Field label="Accent color" hint="Buttons, links, and highlights. Everything else stays neutral so your food photos lead.">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="color"
            value={draft.accentColor}
            onChange={(e) => set("accentColor", e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-sm border border-line2 bg-surface2"
            aria-label="Accent color"
          />
          <Input
            name="accentColor"
            value={draft.accentColor}
            onChange={(e) => set("accentColor", e.target.value)}
            className="w-32 font-mono"
          />
          {/* A preview of the actual button, with the ink the storefront will
              compute. A mustard accent needs black text and a navy one needs
              white; guessing wrong makes the order button unreadable, which on
              this page is the entire product. */}
          <span
            className="rounded-full px-4 py-1.5 text-[12px] font-medium"
            style={{
              background: draft.accentColor,
              color: readableInkOn(draft.accentColor),
            }}
          >
            {draft.heroCtaLabel || "Order pickup"}
          </span>
        </div>
      </Field>

      <Field label="Light or dark" hint="Auto follows each customer's phone setting.">
        <input
          type="hidden"
          name="theme"
          value={alwaysDark ? "DARK" : draft.theme}
        />
        {alwaysDark ? (
          <p className="text-[12px] text-dim">
            The <span className="font-medium text-ink">Night</span> theme is always dark,
            on every device. Pick another theme to offer a light version.
          </p>
        ) : (
          <div className="inline-flex rounded-sm border border-line2 bg-surface2 p-1">
            {(
              [
                ["LIGHT", "Light"],
                ["DARK", "Dark"],
                ["SYSTEM", "Auto"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => set("theme", value)}
                className={cx(
                  "rounded-sm px-4 py-1.5 text-[13px] font-medium transition-colors",
                  draft.theme === value ? "bg-accentFill text-accentInk" : "text-dim hover:text-ink"
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </Field>
    </>
  );
}

/* ── Name & contact ──────────────────────────────────────────────────────── */

function IdentityPanel({
  draft,
  set,
  setContent,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  setContent: <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => void;
}) {
  return (
    <>
      <PanelIntro
        title="Name & contact"
        body="Your identity and details. These appear on every page of your website."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Restaurant name">
          <Input name="name" value={draft.name} onChange={(e) => set("name", e.target.value)} required />
        </Field>
        <Field label="Tagline">
          <Input
            name="tagline"
            value={draft.tagline}
            onChange={(e) => set("tagline", e.target.value)}
            placeholder="Wood-fired since 1998"
          />
        </Field>
        <Field label="Address">
          <Input name="address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
        </Field>
        <Field label="City / ZIP">
          <Input name="city" value={draft.city} onChange={(e) => set("city", e.target.value)} />
        </Field>
        <Field label="Phone">
          <Input name="phone" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
        </Field>
        {/* Real hours live on the Hours page and decide whether ordering is
            open. This is only an aside printed underneath them, so the two
            can't contradict each other. */}
        <Field
          label="Hours note (optional)"
          hint="Printed under your hours. Your real schedule is set on the Hours page."
        >
          <Input
            name="hours"
            value={draft.hours}
            onChange={(e) => set("hours", e.target.value)}
            placeholder="Kitchen closes 30 min early on match days"
          />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ImageUpload
          name="logoUrl"
          kind="LOGO"
          label="Logo"
          hint="Square. Sits over your banner."
          value={draft.logoUrl}
          onChange={(u) => set("logoUrl", u)}
        />
        <ImageUpload
          name="heroUrl"
          kind="HERO"
          label="Banner image"
          hint="Wide. The photo behind every page's title."
          value={draft.heroUrl}
          onChange={(u) => set("heroUrl", u)}
        />
      </div>

      <div className="border-t border-line pt-5">
        <h4 className="text-[13px] font-semibold text-ink">Footer call-to-action</h4>
        <p className="mt-0.5 mb-3 text-[12px] text-dim">The banner at the bottom of every page.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Heading">
            <Input
              name="footerTitle"
              value={draft.content.footerTitle}
              onChange={(e) => setContent("footerTitle", e.target.value)}
              placeholder={FOOTER_TITLE_DEFAULT}
            />
          </Field>
          <Field label="Subtext">
            <Input
              name="footerBody"
              value={draft.content.footerBody}
              onChange={(e) => setContent("footerBody", e.target.value)}
              placeholder={FOOTER_BODY_DEFAULT}
            />
          </Field>
        </div>
      </div>
    </>
  );
}

/* ── Home ────────────────────────────────────────────────────────────────── */

function HomePanel({
  draft,
  set,
  setCard,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  setCard: (which: "homeValues" | "aboutValues", i: number, patch: Partial<ValueCard>) => void;
}) {
  return (
    <>
      <PanelIntro
        title="Home page"
        body="The first thing customers see. The banner image and logo come from Name & contact."
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hero headline" hint="The big title. Defaults to your name.">
          <Input
            name="heroHeadline"
            value={draft.heroHeadline}
            onChange={(e) => set("heroHeadline", e.target.value)}
            placeholder={draft.name || "Your restaurant"}
          />
        </Field>
        <Field label="Order button text" hint='Defaults to "Order pickup".'>
          <Input
            name="heroCtaLabel"
            value={draft.heroCtaLabel}
            onChange={(e) => set("heroCtaLabel", e.target.value)}
            placeholder="Order pickup"
          />
        </Field>
      </div>

      <CardRows
        title="The three highlights"
        blurb="The row of selling points under the hero."
        prefix="homeValue"
        which="homeValues"
        cards={draft.content.homeValues}
        defaults={HOME_VALUE_DEFAULTS}
        setCard={setCard}
      />
    </>
  );
}

/* ── Menu ────────────────────────────────────────────────────────────────── */

function MenuPanel({
  draft,
  setContent,
}: {
  draft: Draft;
  setContent: <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => void;
}) {
  return (
    <>
      <PanelIntro
        title="Menu page"
        body="Dishes and prices are managed under Menu in the sidebar. Here you set the page's intro text."
      />
      <Field label="Menu page subtitle" hint="Sits under the “What people order” heading.">
        <Input
          name="menuSubtitle"
          value={draft.content.menuSubtitle}
          onChange={(e) => setContent("menuSubtitle", e.target.value)}
          placeholder="Made to order, packed for pickup."
        />
      </Field>
      <p className="rounded-sm border border-line2 bg-surface2 px-4 py-3 text-[12px] leading-relaxed text-dim">
        Photos and prices for each dish come from your menu items. Add or edit them under{" "}
        <span className="font-medium text-ink">Menu</span> in the sidebar and they appear here
        automatically.
      </p>
    </>
  );
}

/* ── About ───────────────────────────────────────────────────────────────── */

function AboutPanel({
  draft,
  set,
  setCard,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  setCard: (which: "homeValues" | "aboutValues", i: number, patch: Partial<ValueCard>) => void;
}) {
  return (
    <>
      <PanelIntro
        title="About page"
        body="Tell customers who you are. The page image uses your first photo, then your banner."
      />
      <Toggle
        name="showAbout"
        checked={draft.showAbout}
        onChange={(v) => set("showAbout", v)}
        label="Show “About” in the navigation"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="About heading">
          <Input
            name="aboutTitle"
            value={draft.aboutTitle}
            onChange={(e) => set("aboutTitle", e.target.value)}
            placeholder="Good food, ready when you are."
          />
        </Field>
        <Field label="About text">
          <Textarea
            name="aboutBody"
            value={draft.aboutBody}
            onChange={(e) => set("aboutBody", e.target.value)}
            placeholder="Who you are, what you're known for, how long you've been around…"
          />
        </Field>
      </div>

      <CardRows
        title="The three points"
        blurb="The cards further down the About page."
        prefix="aboutValue"
        which="aboutValues"
        cards={draft.content.aboutValues}
        defaults={ABOUT_VALUE_DEFAULTS}
        setCard={setCard}
      />
    </>
  );
}

/* ── Gallery ─────────────────────────────────────────────────────────────── */

function GalleryPanel({
  draft,
  set,
  setContent,
}: {
  draft: Draft;
  set: <K extends keyof Draft>(k: K, v: Draft[K]) => void;
  setContent: <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => void;
}) {
  const slots =
    draft.gallery.filter(Boolean).length < MAX_GALLERY && draft.gallery.every(Boolean)
      ? [...draft.gallery, ""]
      : draft.gallery;

  return (
    <>
      <PanelIntro
        title="Photos"
        body={`Up to ${MAX_GALLERY} photos of your food, your space, or your team. Turn it off to hide the page.`}
      />
      <Toggle
        name="showGallery"
        checked={draft.showGallery}
        onChange={(v) => set("showGallery", v)}
        label="Show “Gallery” in the navigation"
      />
      <Field label="Gallery page subtitle">
        <Input
          name="gallerySubtitle"
          value={draft.content.gallerySubtitle}
          onChange={(e) => setContent("gallerySubtitle", e.target.value)}
          placeholder="A look inside the kitchen."
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        {slots.map((url, i) => (
          <ImageUpload
            key={i}
            name="gallery"
            kind="HERO"
            value={url}
            hint="A dish, the room, your team…"
            onChange={(u) =>
              set(
                "gallery",
                Object.assign([...slots], { [i]: u }).filter(
                  (v, idx) => Boolean(v) || idx < slots.length - 1
                )
              )
            }
          />
        ))}
      </div>
    </>
  );
}

/* ── Visit ───────────────────────────────────────────────────────────────── */

function VisitPanel({
  draft,
  setContent,
}: {
  draft: Draft;
  setContent: <K extends keyof SiteContent>(k: K, v: SiteContent[K]) => void;
}) {
  return (
    <>
      <PanelIntro
        title="Visit page"
        body="Hours, address, and phone come from Name & contact and show as cards here."
      />
      <Field label="Visit page subtitle">
        <Input
          name="visitSubtitle"
          value={draft.content.visitSubtitle}
          onChange={(e) => setContent("visitSubtitle", e.target.value)}
          placeholder="Order ahead, then swing by."
        />
      </Field>
    </>
  );
}

/* ------------------------------------------------------------------- bits */

function Toggle({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-2.5 text-[13px] text-ink">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      {label}
    </label>
  );
}

function CardRows({
  title,
  blurb,
  prefix,
  which,
  cards,
  defaults,
  setCard,
}: {
  title: string;
  blurb: string;
  prefix: string;
  which: "homeValues" | "aboutValues";
  cards: ValueCard[];
  defaults: ValueCard[];
  setCard: (which: "homeValues" | "aboutValues", i: number, patch: Partial<ValueCard>) => void;
}) {
  return (
    <div className="border-t border-line pt-5">
      <h4 className="text-[13px] font-semibold text-ink">{title}</h4>
      <p className="mt-0.5 mb-3 text-[12px] text-dim">{blurb}</p>
      <div className="space-y-3">
        {defaults.map((d, i) => (
          <div
            key={i}
            className="grid gap-3 rounded-sm border border-line2 bg-surface2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]"
          >
            <Input
              name={`${prefix}${i}Title`}
              value={cards[i]?.title ?? ""}
              onChange={(e) => setCard(which, i, { title: e.target.value })}
              placeholder={d.title}
            />
            <Input
              name={`${prefix}${i}Body`}
              value={cards[i]?.body ?? ""}
              onChange={(e) => setCard(which, i, { body: e.target.value })}
              placeholder={d.body}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Every field the currently-mounted panel isn't rendering.
 *
 * Only one panel is mounted at a time, which is what makes the editor feel
 * light — but an unmounted `<input name="aboutBody">` submits nothing, and the
 * server action reads `formData.get("aboutBody") || null`. Without this, saving
 * from the Theme panel would blank the About page. The old editor avoided it by
 * keeping all seven panels mounted-but-hidden; this keeps the DOM small and
 * pays for it with one explicit mirror.
 *
 * Checkboxes are the subtle half: an unchecked box submits nothing either, and
 * `showAbout: formData.get("showAbout") === "on"` reads a missing value as
 * false — so the mirror has to emit them only when true, exactly as a real
 * checkbox would.
 */
function HiddenFields({ draft, mounted }: { draft: Draft; mounted: SectionId }) {
  const owned: Record<SectionId, string[]> = {
    theme: ["themePreset", "accentColor", "theme"],
    identity: [
      "name",
      "tagline",
      "address",
      "city",
      "phone",
      "hours",
      "logoUrl",
      "heroUrl",
      "footerTitle",
      "footerBody",
    ],
    home: [
      "heroHeadline",
      "heroCtaLabel",
      ...idx.flatMap((i) => [`homeValue${i}Title`, `homeValue${i}Body`]),
    ],
    menu: ["menuSubtitle"],
    about: [
      "showAbout",
      "aboutTitle",
      "aboutBody",
      ...idx.flatMap((i) => [`aboutValue${i}Title`, `aboutValue${i}Body`]),
    ],
    gallery: ["showGallery", "gallerySubtitle", "gallery"],
    visit: ["visitSubtitle"],
  };

  const values: Record<string, string> = {
    themePreset: storeTheme(draft.themePreset).id,
    accentColor: draft.accentColor,
    theme: isAlwaysDark(draft.themePreset) ? "DARK" : draft.theme,
    name: draft.name,
    tagline: draft.tagline,
    address: draft.address,
    city: draft.city,
    phone: draft.phone,
    hours: draft.hours,
    logoUrl: draft.logoUrl,
    heroUrl: draft.heroUrl,
    footerTitle: draft.content.footerTitle,
    footerBody: draft.content.footerBody,
    heroHeadline: draft.heroHeadline,
    heroCtaLabel: draft.heroCtaLabel,
    menuSubtitle: draft.content.menuSubtitle,
    aboutTitle: draft.aboutTitle,
    aboutBody: draft.aboutBody,
    gallerySubtitle: draft.content.gallerySubtitle,
    visitSubtitle: draft.content.visitSubtitle,
    ...Object.fromEntries(
      idx.flatMap((i) => [
        [`homeValue${i}Title`, draft.content.homeValues[i]?.title ?? ""],
        [`homeValue${i}Body`, draft.content.homeValues[i]?.body ?? ""],
        [`aboutValue${i}Title`, draft.content.aboutValues[i]?.title ?? ""],
        [`aboutValue${i}Body`, draft.content.aboutValues[i]?.body ?? ""],
      ])
    ),
  };

  // Every section except the mounted one, in both variants. In "essentials"
  // the trimmed sections are never editable, but their values still have to be
  // submitted — otherwise finishing onboarding would blank the About and
  // Gallery copy the tenant was seeded with.
  const hidden = SECTIONS.filter((s) => s.id !== mounted).flatMap((s) => owned[s.id]);

  return (
    <>
      {hidden.map((field) => {
        if (field === "gallery") {
          return draft.gallery
            .filter(Boolean)
            .map((url, i) => (
              <input key={`gallery-${i}`} type="hidden" name="gallery" value={url} />
            ));
        }
        if (field === "showAbout") {
          return draft.showAbout ? (
            <input key={field} type="hidden" name="showAbout" value="on" />
          ) : null;
        }
        if (field === "showGallery") {
          return draft.showGallery ? (
            <input key={field} type="hidden" name="showGallery" value="on" />
          ) : null;
        }
        return <input key={field} type="hidden" name={field} value={values[field] ?? ""} />;
      })}
    </>
  );
}

const idx = Array.from({ length: VALUE_CARD_COUNT }, (_, i) => i);
