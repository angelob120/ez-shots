import { Button, Card, Field, Input, Select, Textarea } from "@/components/hearth/ui";
import type { BookingTypeRow } from "@/lib/bookings";
import { createAdminBookingAction } from "./actions";

/**
 * Write down a call that was agreed somewhere else.
 *
 * Deliberately **not** a slot picker. This form exists for the call arranged
 * on the phone, in a support reply, or at 7pm on a Saturday as a favour — and
 * every one of those is a time the availability grid would refuse. Making an
 * admin pick from the same grid a stranger sees would mean the calendar can
 * only record calls that the calendar would have offered, which is exactly
 * backwards: the grid is a convenience for people we don't know, and the admin
 * is the authority.
 *
 * So it's a free datetime field, interpreted in the host's own zone.
 * `createAdminBooking` still refuses a genuine double-book — that one isn't a
 * policy, it's the host being in two places at once — and flags anything
 * outside the usual hours afterwards rather than blocking it, because the
 * commonest way to land out there is a mistyped date.
 */
export default function NewBookingForm({
  types,
  restaurants,
  error,
}: {
  types: BookingTypeRow[];
  restaurants: Array<{ id: string; name: string }>;
  error?: string;
}) {
  const hostZone = types.find((t) => t.active)?.timezone ?? types[0]?.timezone ?? "America/New_York";

  return (
    <Card>
      <form action={createAdminBookingAction} className="space-y-5">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Add a call</h3>
          <p className="mt-1 text-[12.5px] leading-relaxed text-dim">
            For something agreed over the phone or by email. Times are in {hostZone} — your
            availability grid doesn&apos;t apply here, but a clash with an existing booking is
            still refused.
          </p>
        </div>

        {error && (
          <p
            className="rounded-sm border border-danger/30 bg-danger/10 px-3 py-2 text-[13px] text-danger"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Kind of call">
            <Select name="typeSlug" defaultValue={types[0]?.slug}>
              {types.map((t) => (
                <option key={t.id} value={t.slug}>
                  {t.name} ({t.durationMins} min)
                </option>
              ))}
            </Select>
          </Field>

          <Field label="When" hint={`Wall-clock time in ${hostZone}.`}>
            <Input name="at" type="datetime-local" required />
          </Field>

          <Field label="Their name">
            <Input name="name" required />
          </Field>

          <Field label="Email">
            <Input name="email" type="email" required />
          </Field>

          <Field label="Phone" hint="Optional.">
            <Input name="phone" type="tel" />
          </Field>

          {/* Optional on purpose. A booking with no tenant is a lead, which is
              the normal case for anything coming off the contact page — the
              schema allows null for exactly this. */}
          <Field label="Attach to a tenant" hint="Optional. Leave blank for a lead with no account.">
            <Select name="restaurantId" defaultValue="">
              <option value="">No account yet</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Meeting link" hint="Optional. Falls back to the room set on the call type.">
            <Input name="meetingUrl" placeholder="https://..." />
          </Field>
        </div>

        <Field label="Notes" hint="What the call is about. Shown to you before it starts.">
          <Textarea name="note" rows={3} />
        </Field>

        <div className="border-t border-line pt-5">
          <Button type="submit">Add to calendar</Button>
        </div>
      </form>
    </Card>
  );
}
