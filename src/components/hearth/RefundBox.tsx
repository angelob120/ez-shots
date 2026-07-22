"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { centsToMoney } from "@/lib/money";
import { Button } from "@/components/hearth/ui";

type RefundState = { error?: string; ok?: string } | undefined;
type RefundAction = (prev: RefundState, formData: FormData) => Promise<RefundState>;

const REASONS = [
  { value: "OTHER", label: "Goodwill / other" },
  { value: "QUALITY", label: "Quality issue" },
  { value: "OUT_OF_STOCK", label: "Item unavailable" },
  { value: "CUSTOMER_REQUEST", label: "Customer request" },
  { value: "PRICING_ERROR", label: "Priced wrong" },
  { value: "DUPLICATE_ORDER", label: "Duplicate order" },
  { value: "NO_SHOW", label: "Never picked up" },
  { value: "KITCHEN_ISSUE", label: "Kitchen problem" },
];

function Submit() {
  const { pending } = useFormStatus();
  return <Button size="sm" disabled={pending}>{pending ? "Refunding…" : "Send refund"}</Button>;
}

/**
 * Full or partial refund on one order, for any reason. The same box on the
 * owner and admin sides — only the bound `action` differs (tenant-scoped vs
 * platform-wide). Prefills the full remaining balance so the common case (a
 * full refund) is one click, but any lesser amount is allowed.
 */
export default function RefundBox({
  orderId,
  refundableCts,
  action,
}: {
  orderId: string;
  refundableCts: number;
  action: RefundAction;
}) {
  const [state, formAction] = useFormState(action, undefined);
  const [open, setOpen] = React.useState(false);

  if (state?.ok) return <p className="text-[12px] text-accent">{state.ok}</p>;
  if (refundableCts <= 0) return <p className="text-[12px] text-mute">Fully refunded.</p>;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-[12px] text-dim underline underline-offset-2 hover:text-accent"
      >
        Refund…
      </button>
    );
  }

  return (
    <form action={formAction} className="rounded-sm border border-line2 bg-base p-3">
      <input type="hidden" name="id" value={orderId} />
      <p className="mb-2 text-[11.5px] text-mute">
        Up to {centsToMoney(refundableCts)} left. The customer is texted and their card credited.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          name="amount"
          inputMode="decimal"
          defaultValue={(refundableCts / 100).toFixed(2)}
          placeholder="Amount"
          className="h-8 w-24 rounded-sm border border-line2 bg-surface px-2 text-[12px] text-ink placeholder:text-mute"
        />
        <select
          name="problem"
          defaultValue="OTHER"
          className="h-8 rounded-sm border border-line2 bg-surface px-2 text-[12px] text-ink"
        >
          {REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
      </div>
      <input
        name="note"
        placeholder="Note for the customer (optional)"
        className="mt-2 w-full rounded-sm border border-line2 bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-mute"
      />
      <div className="mt-2 flex items-center gap-3">
        <Submit />
        <button type="button" onClick={() => setOpen(false)} className="text-[12px] text-mute hover:text-ink">
          Cancel
        </button>
      </div>
      {state?.error && <p className="mt-2 text-[12px] text-badInk">{state.error}</p>}
    </form>
  );
}
