"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea, cx, inputClass } from "@/components/hearth/ui";
import ImageUpload from "@/components/hearth/ImageUpload";
import StorefrontEditor, { type EditorInitial } from "@/components/hearth/StorefrontEditor";
import { useTestMode } from "@/components/hearth/TestMode";
import {
  saveBasicsAction,
  saveBrandingAction,
  seedFullMenuAction,
  saveOnboardingHoursAction,
  submitMenuForBuildAction,
  saveReorderAction,
} from "./actions";
import { DAY_KEYS, DAY_LABELS, type WeeklyHours } from "@/lib/hours";
import { REORDER_MODES, MODE_LABEL, MODE_BLURB, coerceMode, type ReorderMode } from "@/lib/reorder";

function Err({ msg }: { msg?: string }) {
  if (!msg) return null;
  return (
    <p className="rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk">
      {msg}
    </p>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

// Demo scaffolding. Visible only while an admin has test tools switched on at
// /admin/tools (Mode tab) — see components/hearth/TestMode.tsx for why that's a
// platform switch rather than a "remove before launch" comment.
function FillTestButton({ onClick }: { onClick: () => void }) {
  if (!useTestMode()) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] font-medium uppercase tracking-wide text-warnInk hover:bg-warnBg"
    >
      Fill test data · dev only
    </button>
  );
}

const pick = (a: string[]) => a[Math.floor(Math.random() * a.length)];
const rToken = () => Math.random().toString(36).slice(2, 6);

// DEV / TESTING ONLY — one click seeds a full realistic menu with offline images.
function SeedMenuButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] font-medium uppercase tracking-wide text-warnInk hover:bg-warnBg disabled:opacity-60"
    >
      {pending ? "Seeding full menu…" : "Seed full menu · 16 items + categories, with images · dev only"}
    </button>
  );
}

/** Standalone seed button for the step-3 (MenuManager) page. Test tools only. */
export function SeedMenuCard() {
  const [state, action] = useFormState(seedFullMenuAction, undefined);
  const testMode = useTestMode();
  if (!testMode) return null;
  return (
    <form action={action}>
      <SeedMenuButton />
      {state?.ok && (
        <p className="mt-2 rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] text-accent">
          {state.ok}
        </p>
      )}
      <Err msg={state?.error} />
    </form>
  );
}

export function BasicsStep({
  defaults,
}: {
  defaults: {
    name: string;
    phone: string;
    address: string;
    city: string;
    hours: string;
    tagline: string;
  };
}) {
  const [state, action] = useFormState(saveBasicsAction, undefined);
  const [name, setName] = useState(defaults.name);
  const [tagline, setTagline] = useState(defaults.tagline);
  const [address, setAddress] = useState(defaults.address);
  const [city, setCity] = useState(defaults.city);
  const [phone, setPhone] = useState(defaults.phone);
  const [hours, setHours] = useState(defaults.hours);

  function fillTestData() {
    setName(`${pick(["Ember", "Basil", "Harbor", "Copper", "Maple"])} ${pick(["Grill", "Cafe", "Kitchen", "Diner"])} ${rToken().toUpperCase()}`);
    setTagline(pick(["Small-batch coffee and pastry", "Wood-fired everything", "Neighborhood comfort food", "Fresh, fast, local"]));
    setAddress(`${100 + Math.floor(Math.random() * 800)} ${pick(["Grand River Ave", "Elm St", "Woodward Ave", "Main St"])}`);
    setCity(pick(["Detroit, MI", "Ann Arbor, MI", "Ferndale, MI", "Royal Oak, MI"]));
    setPhone(`(313) 555-0${100 + Math.floor(Math.random() * 899)}`);
    setHours(pick(["Mon–Fri 7a–3p", "Daily 11a–10p", "Tue–Sun 8a–8p", "Mon–Sat 10a–9p"]));
  }

  return (
    <form action={action} className="space-y-4">
      <FillTestButton onClick={fillTestData} />
      <Field label="Restaurant name">
        <Input name="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </Field>
      <Field label="Tagline" hint="One line under your name on the ordering page.">
        <Input name="tagline" value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="Small-batch coffee and pastry" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Pickup address">
          <Input name="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="118 Grand River Ave" required />
        </Field>
        <Field label="City">
          <Input name="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Detroit, MI" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone">
          <Input name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(313) 555-0134" required />
        </Field>
        <Field label="Hours" hint="Free text for now.">
          <Input name="hours" value={hours} onChange={(e) => setHours(e.target.value)} placeholder="Mon–Fri 7a–3p" />
        </Field>
      </div>
      <Err msg={state?.error} />
      <Submit label="Continue" pendingLabel="Saving…" />
    </form>
  );
}

/**
 * Step 2 — the website.
 *
 * Renders the same editor as /dashboard/branding, trimmed to the sections an
 * owner can answer before they have any content: theme, identity, home page.
 * The trimming is a prop, not a second component — a wizard step that looked
 * nothing like the settings page it wrote to is how an owner ends up unable to
 * find the control they used yesterday.
 *
 * Still skippable. An owner without their logo file to hand at 11pm should
 * still be able to open tomorrow; see docs/onboarding.md.
 */
export function BrandingStep({ initial }: { initial: EditorInitial }) {
  return (
    <StorefrontEditor
      initial={initial}
      action={saveBrandingAction}
      variant="essentials"
      submitLabel="Continue"
    />
  );
}

/**
 * The step-3 top-level chooser used by the onboarding page.
 *
 * The manual builder (SeedMenuCard + MenuManager) is server-rendered and passed
 * in as `children`, so this stays a thin client wrapper that only owns the
 * toggle. "Have us do it" is the default and recommended path — retyping a whole
 * menu is where onboarding gets abandoned.
 */
export function MenuChoice({ children }: { children: React.ReactNode }) {
  const [path, setPath] = useState<"forus" | "myself">("forus");

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setPath("forus")}
          className={cx(
            "rounded-md border p-4 text-left transition-colors",
            path === "forus" ? "border-accent bg-accent/5" : "border-line hover:border-line2"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-ink">Have us do it for you</span>
            <span className="rounded-full bg-accentFill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accentInk">
              Free · Recommended
            </span>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
            Send us what you already have and we build your whole menu for you before your setup
            call. Nothing to type.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setPath("myself")}
          className={cx(
            "rounded-md border p-4 text-left transition-colors",
            path === "myself" ? "border-accent bg-accent/5" : "border-line hover:border-line2"
          )}
        >
          <div className="text-[14px] font-semibold text-ink">Add it myself</div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-dim">
            Type items in, import a CSV, or pull from a delivery app. Not recommended for a big
            menu.
          </p>
        </button>
      </div>

      {path === "forus" ? <MenuSubmissionForm /> : children}
    </div>
  );
}

/**
 * The "have us build it for you" submission form.
 *
 * Collects whatever the owner already has — links, pasted menu text, photos of
 * a printed menu — and saves a MenuSubmission for us to build by hand. The copy
 * leans hard on "don't type it all in" because that instinct is exactly what
 * makes people abandon this step. The more they give us the better, but any one
 * of the three is enough to move on.
 */
function MenuSubmissionForm() {
  const [state, action] = useFormState(submitMenuForBuildAction, undefined);
  const [photos, setPhotos] = useState<number[]>([0]);

  if (state?.ok) {
    return (
      <div className="rounded-md border border-goodLine bg-goodBg px-4 py-4 text-[13px] leading-relaxed text-accent">
        <p className="font-semibold">{state.ok}</p>
        <p className="mt-1.5 text-dim">
          You can move on to the next step now — you don&apos;t need to add any items yourself.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <div className="flex items-start gap-3 rounded-md border border-accentDim/40 bg-accent/5 px-4 py-3">
        <span className="mt-0.5 text-[16px]">✋</span>
        <p className="text-[12.5px] leading-relaxed text-dim">
          <span className="font-semibold text-ink">Don&apos;t type your menu in by hand.</span> Just
          give us whatever you already have below — a link, a photo, or copy-and-pasted text — and
          we&apos;ll build the whole thing for you and walk through it on your setup call. The more
          you give us, the better we get it right the first time.
        </p>
      </div>

      <Field
        label="Links to your menu"
        hint="One per line — your DoorDash / Uber Eats / Toast page, your website, a Google Doc, anything."
      >
        <Textarea
          name="links"
          rows={3}
          placeholder={"https://www.doordash.com/store/...\nhttps://yourrestaurant.com/menu"}
        />
      </Field>

      <Field
        label="Or paste your menu text"
        hint="Copy it straight off your website or a document — names, prices, descriptions, whatever you have."
      >
        <Textarea
          name="pastedText"
          rows={6}
          placeholder={"Cheeseburger — 9.50\nDouble, American, house sauce\n\nFries — 4.00"}
        />
      </Field>

      <div>
        <p className="text-[13px] font-medium text-ink">Photos of your menu</p>
        <p className="mt-0.5 text-[12px] text-dim">
          A clear photo of each page of a printed menu works great. Optional, but helpful.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {photos.map((id) => (
            <ImageUpload key={id} name="photo" kind="HERO" label="" />
          ))}
        </div>
        {photos.length < 6 && (
          <button
            type="button"
            onClick={() => setPhotos((p) => [...p, (p[p.length - 1] ?? 0) + 1])}
            className="mt-2 text-[12px] text-accent underline underline-offset-2"
          >
            + Add another photo
          </button>
        )}
      </div>

      <Field label="Anything else we should know?" hint="Optional.">
        <Textarea
          name="notes"
          rows={2}
          placeholder="Prices went up last week — use the ones on the website, not DoorDash."
        />
      </Field>

      <Err msg={state?.error} />
      <Submit label="Send us my menu" pendingLabel="Sending…" />
    </form>
  );
}

/**
 * Step 4 — opening hours.
 *
 * A deliberately narrower form than the dashboard's. That one also carries
 * prep time, last call, auto-accept and auto-cancel; all four have sane
 * defaults and none of them are worth asking about before a restaurant has
 * taken a single order. The wizard asks the one question that can't be
 * defaulted — when are you open — and leaves the rest to be discovered.
 *
 * The times default to a plausible service rather than blank, because a grid
 * of empty time inputs is slow to fill and invites the "just tick them all and
 * move on" response this step exists to prevent.
 */
export function HoursStep({
  hours,
  timezone,
}: {
  hours: WeeklyHours;
  timezone: string;
}) {
  const [state, action] = useFormState(saveOnboardingHoursAction, undefined);

  return (
    <form action={action}>
      <h2 className="text-[17px] font-semibold tracking-tight text-ink">When are you open?</h2>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-dim">
        This is the one setting that switches ordering off at night. Without it your page keeps
        taking orders around the clock — including at 3am, into a kitchen with nobody in it.
      </p>

      <div className="mt-5 space-y-2">
        {DAY_KEYS.map((day) => {
          const interval = hours[day]?.[0];
          return (
            <div key={day} className="flex flex-wrap items-center gap-3">
              <label className="flex w-32 shrink-0 items-center gap-2 text-[13px] text-ink">
                <input
                  type="checkbox"
                  name={`on_${day}`}
                  defaultChecked={interval ? true : day !== "sun"}
                  className="h-3.5 w-3.5"
                />
                {DAY_LABELS[day]}
              </label>
              <input
                type="time"
                name={`open_${day}`}
                defaultValue={interval?.open ?? "11:00"}
                className={`${inputClass} w-32`}
                aria-label={`${DAY_LABELS[day]} opening time`}
              />
              <span className="text-[12px] text-mute">to</span>
              <input
                type="time"
                name={`close_${day}`}
                defaultValue={interval?.close ?? "21:00"}
                className={`${inputClass} w-32`}
                aria-label={`${DAY_LABELS[day]} closing time`}
              />
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
        A closing time earlier than the opening time means past midnight — 5:00 PM to 2:00 AM is a
        late-night service, not a mistake.
      </p>

      <div className="mt-5 max-w-sm">
        <Field
          label="Timezone"
          hint="Every open/closed decision is made in this zone — your kitchen's clock, not ours."
        >
          <Input name="timezone" defaultValue={timezone} />
        </Field>
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Submit label="Save hours and continue" pendingLabel="Saving…" />
        {state?.error && <span className="text-[12.5px] text-warn">{state.error}</span>}
      </div>
    </form>
  );
}

/**
 * Step 6 — the reordering choice.
 *
 * Required-to-answer, recommend yes: there is deliberately no skip button, and
 * "yes" is the default selection. The level picker only appears once yes is
 * chosen — the owner sees a single dial, not a form. The action writes the
 * on/off, the level, and the choice timestamp; the wizard advances to launch.
 *
 * This is not launch-gating (see lib/onboarding.ts). An owner who never reaches
 * this step can still open — the dashboard nags instead. But in the normal flow
 * they pass through here and make the call.
 */
export function ReorderStep({
  initialOn,
  initialMode,
}: {
  initialOn: boolean;
  initialMode: string;
}) {
  const [on, setOn] = useState(initialOn);
  const [mode, setMode] = useState<ReorderMode>(coerceMode(initialMode));
  const [state, formAction] = useFormState(saveReorderAction, undefined);

  return (
    <form action={formAction} className="space-y-6">
      <div>
        <h2 className="text-[17px] font-semibold tracking-tight text-ink">
          Bringing customers back
        </h2>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-dim">
          Every order hands you a customer you can reach again — that&apos;s the whole point of the
          list you&apos;re building. Getting people to reorder is where it pays off, and you
          shouldn&apos;t have to do it by hand. Let us run it for you, and dial it up or down (or off)
          anytime from your dashboard.
        </p>
      </div>

      {/* The on/off. Yes carries the recommendation and is pre-selected. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setOn(true)}
          className={cx(
            "rounded-md border px-4 py-3.5 text-left transition",
            on ? "border-accent bg-accentFill/40" : "border-line bg-surface hover:border-dim"
          )}
        >
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-ink">Yes, run it for me</span>
            <span className="rounded-full bg-accentFill px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accentInk">
              Recommended
            </span>
          </div>
          <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
            We win back customers who&apos;ve drifted, on a rhythm you set. Nothing to write.
          </p>
        </button>

        <button
          type="button"
          onClick={() => setOn(false)}
          className={cx(
            "rounded-md border px-4 py-3.5 text-left transition",
            !on ? "border-accent bg-accentFill/40" : "border-line bg-surface hover:border-dim"
          )}
        >
          <span className="text-[13.5px] font-semibold text-ink">I&apos;ll handle it myself</span>
          <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
            Keep reordering in your own hands — write and send your own campaigns later.
          </p>
        </button>
      </div>

      {/* The intensity dial. Only meaningful, and only shown, when on. */}
      {on && (
        <div className="space-y-2.5">
          <p className="text-[12.5px] font-medium text-ink">How hard should we push?</p>
          <div className="grid gap-2.5 sm:grid-cols-3">
            {REORDER_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={cx(
                  "rounded-md border px-3.5 py-3 text-left transition",
                  mode === m ? "border-accent bg-accentFill/40" : "border-line bg-surface hover:border-dim"
                )}
              >
                <span className="text-[13px] font-semibold text-ink">{MODE_LABEL[m]}</span>
                <p className="mt-1 text-[12px] leading-relaxed text-dim">{MODE_BLURB[m]}</p>
              </button>
            ))}
          </div>
          <p className="text-[11.5px] leading-relaxed text-dim">
            You can change this — or switch it off — anytime. When things get busy, dial it down.
          </p>
        </div>
      )}

      {/* Hidden fields carry the state the buttons set, since they're the real
          form inputs the server action reads. */}
      <input type="hidden" name="reorderCampaigns" value={on ? "on" : "off"} />
      <input type="hidden" name="reorderMode" value={mode} />

      <div className="flex items-center gap-3">
        <Submit label="Continue" pendingLabel="Saving…" />
        {state?.error && <span className="text-[12.5px] text-warn">{state.error}</span>}
      </div>
    </form>
  );
}
