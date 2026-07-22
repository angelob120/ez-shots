"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addSupportLogAction } from "../actions";
import { Button, Card, Field, Input, Select } from "@/components/hearth/ui";

function mondayOfThisWeek() {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function Submit() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : "Log hours"}</Button>;
}

export default function SupportLogForm({
  restaurants,
}: {
  restaurants: Array<{ id: string; name: string }>;
}) {
  const [state, action] = useFormState(addSupportLogAction, undefined);

  return (
    <Card>
      <h3 className="mb-4 text-[14px] font-semibold text-ink">Add entry</h3>
      <form action={action} className="grid items-end gap-4 sm:grid-cols-4">
        <Field label="Restaurant">
          <Select name="restaurantId" required>
            <option value="">Select…</option>
            {restaurants.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Week of">
          <Input name="weekOf" type="date" defaultValue={mondayOfThisWeek()} required />
        </Field>
        <Field label="Hours">
          <Input name="hours" type="number" step="0.25" min="0" placeholder="2.5" required />
        </Field>
        <Submit />
        <div className="sm:col-span-4">
          <Field label="Note">
            <Input name="note" placeholder="Menu edits, refund request, POS question…" />
          </Field>
        </div>
        {state?.error && <p className="text-[12px] text-badInk sm:col-span-4">{state.error}</p>}
        {state?.ok && <p className="text-[12px] text-accent sm:col-span-4">{state.ok}</p>}
      </form>
    </Card>
  );
}
