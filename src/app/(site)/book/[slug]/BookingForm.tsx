"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { Button, Field, Input, Textarea } from "@/components/hearth/ui";
import SlotPicker, { type WireDay } from "./SlotPicker";
import { createBookingAction, type BookingFormState } from "./actions";

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={disabled || pending}>
      {pending ? "Booking…" : "Confirm this time"}
    </Button>
  );
}

/**
 * Pick a time, then say who you are.
 *
 * One form rather than two steps on two pages. The details are only revealed
 * once a slot is chosen, because asking for a name before showing whether any
 * time works is how a booking page collects abandoned forms — but they're the
 * same submission, so a slot going stale between choosing and confirming
 * returns an error with the details still filled in rather than losing them.
 */
export default function BookingForm({
  typeSlug,
  days,
  hostTimezone,
  prefill,
  restaurantId,
}: {
  typeSlug: string;
  days: WireDay[];
  hostTimezone: string;
  prefill?: { name?: string | null; email?: string | null; phone?: string | null };
  restaurantId?: string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [viewerZone, setViewerZone] = useState<string>(hostTimezone);
  const [state, setState] = useState<BookingFormState | null>(null);

  async function action(formData: FormData) {
    const result = await createBookingAction(formData);
    // Only failures come back — a success redirects from the server action, so
    // there is no state to set and no way to double-submit by going back.
    setState(result);
  }

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="typeSlug" value={typeSlug} />
      <input type="hidden" name="startsAt" value={selected ?? ""} />
      <input type="hidden" name="bookerTimezone" value={viewerZone} />
      {restaurantId && <input type="hidden" name="restaurantId" value={restaurantId} />}

      <SlotPicker
        days={days}
        hostTimezone={hostTimezone}
        selected={selected}
        onSelect={(iso, tz) => {
          setSelected(iso);
          setViewerZone(tz);
          setState(null);
        }}
      />

      {selected && (
        <div className="space-y-4 border-t border-line pt-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Your name">
              <Input name="name" required defaultValue={prefill?.name ?? ""} autoComplete="name" />
            </Field>
            <Field label="Email">
              <Input
                name="email"
                type="email"
                required
                defaultValue={prefill?.email ?? ""}
                autoComplete="email"
              />
            </Field>
          </div>

          <Field label="Phone" hint="Optional — a backup if the video link plays up.">
            <Input name="phone" type="tel" defaultValue={prefill?.phone ?? ""} autoComplete="tel" />
          </Field>

          <Field
            label="Anything we should know?"
            hint="Optional. What you're running, what you're stuck on, what you want out of the call."
          >
            <Textarea name="note" rows={3} />
          </Field>

          {state && !state.ok && (
            <p
              className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
              role="alert"
            >
              {state.message}
            </p>
          )}

          <Submit disabled={!selected} />
        </div>
      )}
    </form>
  );
}
