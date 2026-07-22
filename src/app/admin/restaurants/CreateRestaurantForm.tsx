"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createRestaurantAction } from "../actions";
import { Button, Card, Field, Input, Select } from "@/components/hearth/ui";
import CopyField from "@/components/hearth/CopyField";
import ImageUpload from "@/components/hearth/ImageUpload";

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

// The four US zones that cover essentially every pilot, plus the two that
// otherwise generate a support ticket the first time hours behave oddly.
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
];

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending}>{pending ? "Creating…" : "Create & invite owner"}</Button>
  );
}

/**
 * The new-tenant form.
 *
 * Two structural changes from the version this replaces. The old one was a flat
 * nine-field grid where the owner's password sat between the city and the phone
 * number, so the single security-relevant decision on the page looked exactly
 * like the address. Fields are now grouped by who needs them and when, and the
 * only required ones are the two we genuinely can't proceed without.
 *
 * And success is a *state*, not a toast. Creating a restaurant produces an
 * invite link that is shown exactly once — a green flash that disappears on the
 * next render would lose it. So the form is replaced by a hand-off panel.
 */
export default function CreateRestaurantForm() {
  const [state, action] = useFormState(createRestaurantAction, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  const [open, setOpen] = useState(false);

  const effectiveSlug = touched ? slug : slugify(name);

  // ── Done: hand the operator what they came for ──────────────────────
  if (state?.ok && state.restaurantId) {
    return (
      <Card className="border-accentDim/50">
        <h2 className="text-[15px] font-semibold text-ink">{state.ok}</h2>

        {state.link ? (
          <div className="mt-4">
            <CopyField
              label={state.linkLabel ?? "Invite link"}
              value={state.link}
              tone="accent"
              hint="Single use, expires in 72 hours. They set their own password — nothing to read out over the phone. If it's lost, generate a new one from the tenant's People tab."
            />
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/restaurants/${state.restaurantId}`}
            className="inline-flex h-9 items-center rounded-sm bg-accentFill px-4 text-[13px] font-medium text-accentInk transition-colors hover:bg-accentHover"
          >
            Open this restaurant
          </Link>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-9 items-center rounded-sm border border-line2 px-4 text-[13px] font-medium text-ink transition-colors hover:bg-surface2"
          >
            Create another
          </button>
        </div>

        <p className="mt-4 border-t border-line pt-3 text-[11.5px] leading-relaxed text-mute">
          The account starts in setup. It won&rsquo;t take orders until the owner
          accepts the invite and finishes the wizard — the tenant page tracks what&rsquo;s
          still outstanding.
        </p>
      </Card>
    );
  }

  // ── Collapsed: this page is mostly for reading the tenant list ───────
  if (!open) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">New restaurant</h2>
            <p className="mt-0.5 text-[12px] text-dim">
              Creates the tenant with starter categories, and emails you a link to invite the owner.
            </p>
          </div>
          <Button variant="outline" onClick={() => setOpen(true)}>
            New restaurant
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">New restaurant</h2>
          <p className="mt-0.5 text-[12px] text-dim">
            Only the name and the owner&rsquo;s email are required. Everything else the owner
            can fill in themselves — and mostly should.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-dim hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <form action={action} className="space-y-6">
        {/* ── Identity ────────────────────────────────────────────── */}
        <section className="space-y-4">
          <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
            Identity
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Restaurant name">
              <Input
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Angelo's Pizza"
                required
                autoFocus
              />
            </Field>
            <Field
              label="Ordering link"
              hint={effectiveSlug ? `/r/${effectiveSlug}` : "Derived from the name."}
            >
              <Input
                name="slug"
                value={effectiveSlug}
                onChange={(e) => {
                  setTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                placeholder="angelos-pizza"
              />
            </Field>
          </div>
        </section>

        {/* ── Access ──────────────────────────────────────────────── */}
        <section className="space-y-4 border-t border-line pt-5">
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
              Owner access
            </h3>
            <p className="mt-1 text-[11.5px] leading-relaxed text-mute">
              No password to choose. They get a single-use link and set their own — so
              the only person who ever knows it is them.
            </p>
          </div>
          <div className="sm:max-w-[340px]">
            <Field label="Owner email">
              <Input name="ownerEmail" type="email" placeholder="owner@angelos.com" required />
            </Field>
          </div>
        </section>

        {/* ── Optional details ────────────────────────────────────── */}
        <section className="space-y-4 border-t border-line pt-5">
          <div>
            <h3 className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
              Details <span className="normal-case tracking-normal text-mute">— optional</span>
            </h3>
            <p className="mt-1 text-[11.5px] text-mute">
              Save the owner some typing if you have these to hand.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Address">
              <Input name="address" placeholder="118 Elm St" />
            </Field>
            <Field label="City / ZIP">
              <Input name="city" placeholder="Detroit, MI 48226" />
            </Field>
            <Field label="Phone">
              <Input name="phone" placeholder="(313) 555-0118" />
            </Field>
            <Field
              label="Timezone"
              hint="Every hours decision is made in this zone. Awkward to change later."
            >
              <Select name="timezone" defaultValue="America/New_York">
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {tz.split("/")[1].replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Accent color" hint="The owner can change this in Branding.">
              <Input name="accentColor" type="color" defaultValue="#3b82f6" className="h-10 p-1" />
            </Field>
          </div>

          <ImageUpload
            name="heroUrl"
            kind="HERO"
            label="Hero image"
            hint="Optional — the owner can change it from their dashboard."
          />
        </section>

        {state?.error && (
          <p className="rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk">
            {state.error}
          </p>
        )}

        <div className="border-t border-line pt-5">
          <Submit />
        </div>
      </form>
    </Card>
  );
}
