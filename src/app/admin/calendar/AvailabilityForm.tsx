import { Button, Card, Field, Input, inputClass, cx } from "@/components/hearth/ui";
import { DAY_KEYS, DAY_LABELS, parseWeeklyHours } from "@/lib/hours";
import { describeInterval } from "@/lib/booking-slots";
import type { BookingTypeRow } from "@/lib/bookings";
import { saveAvailabilityAction } from "./actions";

/**
 * The availability grid for one booking type.
 *
 * One window per day, deliberately. `WeeklyHours` supports several — a
 * restaurant genuinely has a lunch and a dinner service — but a person's
 * calendar with a morning and an afternoon block is a nicety, and the version
 * of this form that supports it needs add/remove buttons and client state.
 * The data model already allows it, so the day that's worth building it,
 * nothing has to migrate. Until then a single window per day is what the form
 * writes and what it reads back.
 */
export default function AvailabilityForm({ type }: { type: BookingTypeRow }) {
  const hours = parseWeeklyHours(type.availabilityJson);

  return (
    <Card>
      <form action={saveAvailabilityAction} className="space-y-6">
        <input type="hidden" name="typeId" value={type.id} />

        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">{type.name}</h3>
            <p className="mt-1 font-mono text-[11.5px] text-mute">/book/{type.slug}</p>
          </div>
          <label className="flex shrink-0 items-center gap-2 text-[12.5px] text-dim">
            <input type="checkbox" name="active" defaultChecked={type.active} />
            Bookable
          </label>
        </div>

        <div className="space-y-2 border-t border-line pt-5">
          <p className="text-[12px] font-medium text-dim">
            When you take these calls
            <span className="ml-2 font-normal text-mute">
              wall-clock time in {type.timezone}
            </span>
          </p>

          {DAY_KEYS.map((day) => {
            const iv = hours[day]?.[0];
            return (
              <div key={day} className="flex items-center gap-3">
                <label className="flex w-[130px] shrink-0 items-center gap-2 text-[12.5px] text-ink">
                  <input type="checkbox" name={`${day}_on`} defaultChecked={Boolean(iv)} />
                  {DAY_LABELS[day]}
                </label>
                <input
                  type="time"
                  name={`${day}_open`}
                  defaultValue={iv?.open ?? "09:00"}
                  className={cx(inputClass, "w-[120px]")}
                />
                <span className="text-[12px] text-mute">to</span>
                <input
                  type="time"
                  name={`${day}_close`}
                  defaultValue={iv?.close ?? "17:00"}
                  className={cx(inputClass, "w-[120px]")}
                />
                <span className="text-[11.5px] text-mute">
                  {iv ? describeInterval(iv) : "not bookable"}
                </span>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
          <Field label="Call length" hint="Minutes. The slot grid is built from this.">
            <Input name="durationMins" type="number" min={5} max={240} defaultValue={type.durationMins} />
          </Field>
          <Field label="Gap between calls" hint="Minutes of dead time after each one.">
            <Input name="bufferMins" type="number" min={0} max={120} defaultValue={type.bufferMins} />
          </Field>
          <Field
            label="Minimum notice"
            hint="Minutes. A slot bookable ten minutes out is one you won't see in time."
          >
            <Input name="minNoticeMins" type="number" min={0} defaultValue={type.minNoticeMins} />
          </Field>
          <Field label="Book up to" hint="Days ahead the picker runs.">
            <Input name="maxDaysAhead" type="number" min={1} max={120} defaultValue={type.maxDaysAhead} />
          </Field>
          <Field label="Your timezone" hint="An IANA name, e.g. America/New_York.">
            <Input name="timezone" defaultValue={type.timezone} />
          </Field>
          <Field
            label="Meeting link"
            hint="Your Zoom or Meet room. Shown to the booker and on the owner's dashboard."
          >
            <Input name="meetingUrl" defaultValue={type.meetingUrl ?? ""} placeholder="https://..." />
          </Field>
        </div>

        <div className="border-t border-line pt-5">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </Card>
  );
}
