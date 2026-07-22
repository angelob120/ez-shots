"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import { dismissRefundAction, retryRefundAction } from "./actions";
import { centsToMoney } from "@/lib/money";

/**
 * Money we said we'd give back and didn't.
 *
 * This sits above the order board and above the complaints panel because it
 * outranks both: a customer waiting on food is inconvenienced, a customer
 * who is out of pocket has been wronged. It is deliberately un-dismissable
 * without a note — the only ways out are paying them or saying how you did.
 */

type Row = {
  id: string;
  amountCts: number;
  orderNumber: string;
  createdAt: string;
  attempts: number;
  error: string | null;
};

function Submit({ children, subtle }: { children: React.ReactNode; subtle?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`rounded-sm px-3 py-1.5 text-[12px] font-medium disabled:opacity-50 ${
        subtle ? "border border-line2 text-dim hover:text-ink" : "bg-warn text-white"
      }`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

function RefundRow({ row }: { row: Row }) {
  const [retry, retryAction] = useFormState(retryRefundAction, undefined);
  const [dismiss, dismissAction] = useFormState(dismissRefundAction, undefined);
  const [settling, setSettling] = React.useState(false);

  const done = retry?.ok ?? dismiss?.ok;
  if (done) {
    return <p className="rounded-sm border border-line2 bg-surface2 p-3 text-[12px] text-accent">{done}</p>;
  }

  return (
    <div className="rounded-sm border border-line2 bg-surface2 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">
          {centsToMoney(row.amountCts)} owed on {row.orderNumber}
        </span>
        <span className="font-mono text-[11px] text-mute">{row.createdAt}</span>
      </div>

      <p className="mt-1 text-[11.5px] text-dim">
        The payment provider rejected this refund{row.error ? ` — ${row.error}` : ""}.
        {row.attempts > 1 && ` Tried ${row.attempts} times.`}
      </p>

      {!settling ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <form action={retryAction}>
            <input type="hidden" name="id" value={row.id} />
            <Submit>Try the refund again</Submit>
          </form>
          <button
            type="button"
            onClick={() => setSettling(true)}
            className="rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim hover:text-ink"
          >
            I sorted it another way
          </button>
        </div>
      ) : (
        <form action={dismissAction} className="mt-2">
          <input type="hidden" name="id" value={row.id} />
          <input
            name="note"
            placeholder="How was the customer made whole? (cash back at the counter, etc.)"
            className="mb-2 w-full rounded-sm border border-line2 bg-base px-2 py-1.5 text-[12px] text-ink placeholder:text-mute"
          />
          <div className="flex gap-2">
            <Submit subtle>Close it out</Submit>
            <button
              type="button"
              onClick={() => setSettling(false)}
              className="px-2 text-[11.5px] text-mute hover:text-ink"
            >
              Back
            </button>
          </div>
        </form>
      )}

      {(retry?.error || dismiss?.error) && (
        <p className="mt-2 text-[11.5px] text-warn">{retry?.error ?? dismiss?.error}</p>
      )}
    </div>
  );
}

export function FailedRefunds({ rows }: { rows: Row[] }) {
  if (rows.length === 0) return null;

  const total = rows.reduce((a, r) => a + r.amountCts, 0);

  return (
    <div className="mb-6 rounded-md border border-warn bg-warn/10 p-4">
      <h3 className="mb-1 text-[13px] font-semibold text-warn">
        {rows.length === 1
          ? "A refund didn't go through"
          : `${rows.length} refunds didn't go through`}
      </h3>
      <p className="mb-3 text-[12px] text-dim">
        {centsToMoney(total)} was promised to customers and hasn&apos;t reached them. Nothing else on
        this page matters more.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {rows.map((r) => (
          <RefundRow key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}
