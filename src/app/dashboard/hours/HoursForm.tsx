"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { addClosureAction, saveHoursAction, deleteClosureAction } from "../actions";
import { DAY_KEYS, DAY_LABELS, type WeeklyHours } from "@/lib/hours";
import { Button, Card, Field, Input, inputClass } from "@/components/hearth/ui";

function Save({ label = "Save" }: { label?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p className={`mt-3 text-[12.5px] ${state.error ? "text-warn" : "text-accent"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

/**
 * One row per day, single window each.
 *
 * The data model supports split shifts (lunch, then dinner) but this form
 * deliberately doesn't — most tenants don't need it, and a grid with fourteen
 * time inputs is how hours end up wrong. A restaurant with a split service can
 * set the outer bounds and use the pause button in between.
 */
export function HoursForm({
  hours,
  timezone,
  prepMinutes,
  lastCallMins,
  autoExpireMins,
  autoAccept,
}: {
  hours: WeeklyHours;
  timezone: string;
  prepMinutes: number;
  lastCallMins: number;
  autoExpireMins: number;
  autoAccept: boolean;
}) {
  const [state, action] = useFormState(saveHoursAction, undefined);

  return (
    <form action={action}>
      <Card>
        <h3 className="mb-1 text-[14px] font-semibold text-ink">Opening hours</h3>
        <p className="mb-4 text-[12.5px] leading-relaxed text-dim">
          Ordering switches itself off outside these hours, so nobody pays for food at 3am that
          nobody is there to cook.
        </p>

        <div className="space-y-2">
          {DAY_KEYS.map((day) => {
            const interval = hours[day]?.[0];
            return (
              <div key={day} className="flex items-center gap-3">
                <label className="flex w-32 shrink-0 items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    name={`on_${day}`}
                    defaultChecked={Boolean(interval)}
                    className="h-3.5 w-3.5 accent-current"
                  />
                  {DAY_LABELS[day]}
                </label>

                <input
                  type="time"
                  name={`open_${day}`}
                  defaultValue={interval?.open ?? "11:00"}
                  className={`${inputClass} w-32`}
                />
                <span className="text-[12px] text-mute">to</span>
                <input
                  type="time"
                  name={`close_${day}`}
                  defaultValue={interval?.close ?? "21:00"}
                  className={`${inputClass} w-32`}
                />
              </div>
            );
          })}
        </div>

        <p className="mt-3 text-[11.5px] leading-relaxed text-mute">
          A closing time earlier than the opening time means past midnight — 5:00 PM to 2:00 AM is a
          late-night service, not a mistake.
        </p>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-[14px] font-semibold text-ink">Timing</h3>

          <Field label="Timezone" hint="Every open/closed decision is made in this zone.">
            <Input name="timezone" defaultValue={timezone} />
          </Field>

          <Field
            label="Typical prep time (minutes)"
            hint="What customers are quoted. Promise what you can keep."
          >
            <Input name="prepMinutes" type="number" min={5} max={180} defaultValue={prepMinutes} />
          </Field>

          <Field
            label="Stop taking orders before close (minutes)"
            hint="Blocks tickets that land with no time to cook them."
          >
            <Input name="lastCallMins" type="number" min={0} max={120} defaultValue={lastCallMins} />
          </Field>
        </Card>

        <Card>
          <h3 className="mb-4 text-[14px] font-semibold text-ink">Confirmation</h3>

          <label className="mb-4 flex items-start gap-2.5 text-[13px] text-ink">
            <input
              type="checkbox"
              name="autoAccept"
              defaultChecked={autoAccept}
              className="mt-0.5 h-3.5 w-3.5 accent-current"
            />
            <span>
              Confirm orders automatically
              <span className="mt-0.5 block text-[12px] leading-relaxed text-dim">
                Off means each order waits for someone to press Start. Better control, but somebody
                has to be watching the screen.
              </span>
            </span>
          </label>

          <Field
            label="Auto-cancel unconfirmed orders after (minutes)"
            hint="If nobody touches an order in this long, we cancel and refund it rather than leave the customer waiting on nothing."
          >
            <Input
              name="autoExpireMins"
              type="number"
              min={2}
              max={120}
              defaultValue={autoExpireMins}
            />
          </Field>
        </Card>
      </div>

      <div className="mt-4">
        <Save label="Save hours" />
        <Msg state={state} />
      </div>
    </form>
  );
}

/** Holidays and one-off shutdowns, which beat editing hours and forgetting. */
export function ClosuresPanel({
  closures,
}: {
  closures: Array<{ id: string; startDate: string; endDate: string; reason: string | null }>;
}) {
  const [state, action] = useFormState(addClosureAction, undefined);

  return (
    <Card>
      <h3 className="mb-1 text-[14px] font-semibold text-ink">Holidays &amp; closures</h3>
      <p className="mb-4 text-[12.5px] leading-relaxed text-dim">
        Days you&apos;re shut whatever the schedule says. Ordering is off and the page tells people
        when you&apos;re back.
      </p>

      {closures.length > 0 && (
        <ul className="mb-4 space-y-1.5">
          {closures.map((c) => (
            <li
              key={c.id}
              className="flex items-center justify-between gap-3 rounded-sm border border-line2 bg-surface2 px-3 py-2"
            >
              <span className="text-[12.5px] text-ink">
                <span className="font-mono">{c.startDate}</span>
                {c.endDate !== c.startDate && (
                  <>
                    {" – "}
                    <span className="font-mono">{c.endDate}</span>
                  </>
                )}
                {c.reason && <span className="ml-2 text-mute">{c.reason}</span>}
              </span>
              <form action={deleteClosureAction}>
                <input type="hidden" name="id" value={c.id} />
                <button className="text-[11.5px] text-mute hover:text-warn">Remove</button>
              </form>
            </li>
          ))}
        </ul>
      )}

      <form action={action} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[12px] text-mute">From</label>
          <input type="date" name="startDate" required className={`${inputClass} w-40`} />
        </div>
        <div>
          <label className="mb-1 block text-[12px] text-mute">To (optional)</label>
          <input type="date" name="endDate" className={`${inputClass} w-40`} />
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="mb-1 block text-[12px] text-mute">Reason</label>
          <Input name="reason" placeholder="Thanksgiving" />
        </div>
        <Save label="Add" />
      </form>

      <Msg state={state} />
    </Card>
  );
}
