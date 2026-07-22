"use client";

import { useFormState, useFormStatus } from "react-dom";
import { updateSalesTaxAction } from "@/app/dashboard/actions";
import { Button, Field, Input } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Saving…" : "Save"}</Button>;
}

/**
 * Sales tax is the only fee input an owner controls. The surcharge — its rate,
 * its clamps, and what it's called on the receipt — is the platform's revenue
 * model and is set in admin.
 */
export default function SalesTaxForm({
  taxPct,
}: {
  /** Stored as a fraction; shown to the owner as a percent. */
  taxPct: number;
}) {
  const [state, action] = useFormState(updateSalesTaxAction, undefined);

  return (
    <form action={action} className="flex flex-wrap items-end gap-4">
      <Field label="State sales tax (%)" hint="Applied to the food subtotal, never to the service fee.">
        <Input
          name="taxPct"
          type="number"
          step="0.01"
          min="0"
          max="20"
          defaultValue={(taxPct * 100).toFixed(2)}
          required
        />
      </Field>
      <Submit />
      {state?.error && <p className="w-full text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="w-full text-[12px] text-accent">{state.ok}</p>}
    </form>
  );
}
