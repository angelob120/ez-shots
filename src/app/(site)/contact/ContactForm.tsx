"use client";

import { useFormState, useFormStatus } from "react-dom";
import { submitContactAction } from "./actions";

const inputClass =
  "w-full rounded-sm border border-line2 bg-surface2 px-3.5 py-2.5 text-[14px] text-ink placeholder:text-mute outline-none transition-colors focus:border-accentDim";

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <span className="mb-1.5 flex items-baseline justify-between gap-2">
      <span className="text-[12.5px] font-medium text-dim">{children}</span>
      {hint && <span className="text-[11px] text-mute">{hint}</span>}
    </span>
  );
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="inline-flex h-11 items-center rounded-sm bg-accent px-6 text-[14px] font-semibold text-[#ffffff] transition-colors hover:bg-[#60a5fa] disabled:opacity-60"
    >
      {pending ? "Sending…" : "Send message"}
    </button>
  );
}

export default function ContactForm() {
  const [state, action] = useFormState(submitContactAction, undefined);

  // The success state replaces the form rather than sitting above it. A form
  // still standing there after a successful send reads as "that didn't work",
  // and the next thing that happens is a duplicate.
  if (state?.ok) {
    return (
      <div className="rounded-md border border-[#1f5c3a] bg-surface px-6 py-10 text-center">
        <div className="text-[16px] font-semibold text-ink">Message sent.</div>
        <p className="mx-auto mt-2 max-w-[380px] text-[13.5px] leading-relaxed text-dim">
          {state.ok} We read everything ourselves — expect a reply from a person, usually within a
          business day.
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-5">
      {/* Honeypot. Hidden from sight and from screen readers, and never
          autofilled — a browser won't touch a field with no autocomplete
          affordance, but a bot fills every input it finds. */}
      <div className="hidden" aria-hidden>
        <label>
          Company website
          <input name="company_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <Label>Your name</Label>
          <input name="name" required maxLength={120} className={inputClass} placeholder="Maria Alvarez" />
        </label>
        <label className="block">
          <Label>Email</Label>
          <input
            name="email"
            type="email"
            required
            maxLength={120}
            className={inputClass}
            placeholder="maria@therestaurant.com"
          />
        </label>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="block">
          <Label hint="optional">Restaurant</Label>
          <input name="business" maxLength={120} className={inputClass} placeholder="Alvarez Taqueria" />
        </label>
        <label className="block">
          <Label hint="optional">Phone</Label>
          <input name="phone" type="tel" maxLength={40} className={inputClass} placeholder="(555) 010-2233" />
        </label>
      </div>

      <label className="block">
        <Label>What can we help with?</Label>
        <textarea
          name="message"
          required
          rows={6}
          maxLength={8000}
          className={`${inputClass} min-h-[140px] resize-y leading-relaxed`}
          placeholder="We do about 60 pickup orders a week through a tablet from a delivery app and want our own ordering page…"
        />
      </label>

      {state?.error && <p className="text-[13px] text-[#f08a80]">{state.error}</p>}

      <div className="flex flex-wrap items-center gap-4">
        <Submit />
        <span className="text-[12px] text-mute">
          No autoresponder, no sales sequence. One reply from one person.
        </span>
      </div>
    </form>
  );
}
