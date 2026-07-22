"use client";

import * as React from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  cancelOrderAction,
  markNoShowAction,
  markUnavailableAction,
  refundOrderAction,
  resolveIssueAction,
} from "./actions";
import { centsToMoney } from "@/lib/money";

/**
 * The controls a kitchen reaches for when an order can't happen as ordered.
 *
 * All of it is collapsed behind one small link on the order card. During a
 * rush the common case is "Start / Mark ready / Complete", and burying the
 * destructive actions keeps a busy thumb away from them.
 */

type Line = { id: string; name: string; qty: number; fulfilledQty: number | null; unitCts: number };

const REASONS: Array<{ value: string; label: string }> = [
  { value: "OUT_OF_STOCK", label: "Out of an item" },
  { value: "TOO_BUSY", label: "Kitchen at capacity" },
  { value: "KITCHEN_ISSUE", label: "Kitchen problem (equipment, staffing)" },
  { value: "CLOSING_SOON", label: "Too close to closing" },
  { value: "CLOSED", label: "We're closed" },
  { value: "WEATHER", label: "Weather or power" },
  { value: "DUPLICATE_ORDER", label: "Duplicate order" },
  { value: "PRICING_ERROR", label: "Item priced wrong" },
  { value: "CUSTOMER_REQUEST", label: "Customer asked to cancel" },
  { value: "NO_SHOW", label: "Never picked up" },
  { value: "OTHER", label: "Something else" },
];

function Pending({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`w-full rounded-sm px-3 py-2 text-[12px] font-medium disabled:opacity-50 ${
        danger ? "bg-warn/20 text-warn hover:bg-warn/30" : "bg-accent text-white"
      }`}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p className={`mt-2 text-[11.5px] ${state.error ? "text-warn" : "text-accent"}`}>
      {state.error ?? state.ok}
    </p>
  );
}

export function OrderTrouble({
  orderId,
  lines,
  refundableCts,
}: {
  orderId: string;
  lines: Line[];
  refundableCts: number;
}) {
  const [open, setOpen] = React.useState(false);
  const [mode, setMode] = React.useState<"none" | "86" | "cancel">("none");

  const [eightySix, eightySixAction] = useFormState(markUnavailableAction, undefined);
  const [cancel, cancelAction] = useFormState(cancelOrderAction, undefined);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full text-[11.5px] text-mute underline underline-offset-2 hover:text-warn"
      >
        Something wrong?
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-sm border border-line2 bg-base p-2.5">
      {mode === "none" && (
        <div className="space-y-1.5">
          <button
            onClick={() => setMode("86")}
            className="w-full rounded-sm border border-line2 px-3 py-2 text-[12px] text-dim hover:text-ink"
          >
            We&apos;re out of something
          </button>
          <button
            onClick={() => setMode("cancel")}
            className="w-full rounded-sm border border-line2 px-3 py-2 text-[12px] text-warn hover:bg-warn/10"
          >
            Cancel the whole order
          </button>
          <button
            onClick={() => setOpen(false)}
            className="w-full px-3 py-1 text-[11.5px] text-mute hover:text-ink"
          >
            Never mind
          </button>
        </div>
      )}

      {/* Partial 86. The customer keeps whatever the kitchen can still make,
          and gets the rest of their money back automatically. */}
      {mode === "86" && (
        <form action={eightySixAction}>
          <input type="hidden" name="id" value={orderId} />
          <p className="mb-2 text-[11.5px] text-mute">
            How many of each can you actually make? The difference is refunded automatically.
          </p>

          <div className="mb-2 space-y-1.5">
            {lines.map((l) => {
              const current = l.fulfilledQty ?? l.qty;
              return (
                <label key={l.id} className="flex items-center gap-2 text-[12px]">
                  <input
                    type="number"
                    name={`qty_${l.id}`}
                    defaultValue={current}
                    min={0}
                    max={current}
                    className="w-14 rounded-sm border border-line2 bg-surface px-2 py-1 text-center font-mono text-[12px] text-ink"
                  />
                  <span className="min-w-0 flex-1 truncate text-dim">
                    {l.name} <span className="text-mute">of {current}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-mute">
                    {centsToMoney(l.unitCts)} ea
                  </span>
                </label>
              );
            })}
          </div>

          <Pending danger>Refund the difference</Pending>
          <Msg state={eightySix} />
          <button
            type="button"
            onClick={() => setMode("none")}
            className="mt-1 w-full text-[11.5px] text-mute hover:text-ink"
          >
            Back
          </button>
        </form>
      )}

      {mode === "cancel" && (
        <form action={cancelAction}>
          <input type="hidden" name="id" value={orderId} />
          <p className="mb-2 text-[11.5px] text-mute">
            Refunds {centsToMoney(refundableCts)} in full and texts the customer why.
          </p>

          <select
            name="problem"
            defaultValue="OUT_OF_STOCK"
            className="mb-2 w-full rounded-sm border border-line2 bg-surface px-2 py-1.5 text-[12px] text-ink"
          >
            {REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          <input
            name="note"
            placeholder="Anything to add for the customer?"
            className="mb-2 w-full rounded-sm border border-line2 bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-mute"
          />

          <Pending danger>Cancel and refund</Pending>
          <Msg state={cancel} />
          <button
            type="button"
            onClick={() => setMode("none")}
            className="mt-1 w-full text-[11.5px] text-mute hover:text-ink"
          >
            Back
          </button>
        </form>
      )}
    </div>
  );
}

/**
 * The prompt for a bag that's been sitting on the shelf too long.
 *
 * Sits on the card itself rather than behind "Something wrong?", because
 * nothing is wrong — an order nobody collected is an ordinary end to a service
 * and the board should offer the obvious next move rather than hide it.
 *
 * Two buttons, not one and a policy. Whether to refund someone who didn't turn
 * up depends on whether they're a regular, and only the owner knows that.
 */
export function NoShowPrompt({ orderId, waitingFor }: { orderId: string; waitingFor: string }) {
  const [state, action] = useFormState(markNoShowAction, undefined);
  const [open, setOpen] = React.useState(false);

  if (state?.ok) {
    return <p className="mt-2 text-[11.5px] text-accent">{state.ok}</p>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full rounded-sm border border-line2 px-3 py-1.5 text-[11.5px] text-dim hover:text-ink"
      >
        Ready {waitingFor} — never picked up?
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-sm border border-line2 bg-base p-2.5">
      <p className="mb-2 text-[11.5px] text-mute">
        Closes the order and tells the customer. The food was made, so keeping the charge is the
        default — refund it if you'd rather.
      </p>
      <div className="space-y-1.5">
        <form action={action}>
          <input type="hidden" name="id" value={orderId} />
          <input type="hidden" name="refund" value="none" />
          <Pending>Close it out, keep the charge</Pending>
        </form>
        <form action={action}>
          <input type="hidden" name="id" value={orderId} />
          <input type="hidden" name="refund" value="auto" />
          <Pending danger>Close it out and refund</Pending>
        </form>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="w-full px-3 py-1 text-[11.5px] text-mute hover:text-ink"
        >
          Still waiting
        </button>
      </div>
      <Msg state={state} />
    </div>
  );
}

/** One customer complaint, with the reply box attached. */
export function IssueCard({
  id,
  kindLabel,
  body,
  orderNumber,
  createdAt,
}: {
  id: string;
  kindLabel: string;
  body: string;
  orderNumber: string;
  createdAt: string;
}) {
  const [state, action] = useFormState(resolveIssueAction, undefined);

  if (state?.ok) {
    return <p className="rounded-sm border border-line2 bg-surface2 p-3 text-[12px] text-accent">{state.ok}</p>;
  }

  return (
    <form action={action} className="rounded-sm border border-line2 bg-surface2 p-3">
      <input type="hidden" name="id" value={id} />

      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] font-medium text-ink">{kindLabel}</span>
        <span className="font-mono text-[11px] text-mute">
          {orderNumber} · {createdAt}
        </span>
      </div>

      <p className="mt-1 text-[12px] leading-relaxed text-dim">“{body}”</p>

      <input
        name="resolution"
        placeholder="What did you do about it? The customer sees this."
        className="mt-2 w-full rounded-sm border border-line2 bg-base px-2 py-1.5 text-[12px] text-ink placeholder:text-mute"
      />

      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          name="status"
          value="RESOLVED"
          className="flex-1 rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-white"
        >
          Mark resolved
        </button>
        <button
          type="submit"
          name="status"
          value="ACKNOWLEDGED"
          className="flex-1 rounded-sm border border-line2 px-3 py-1.5 text-[12px] text-dim hover:text-ink"
        >
          Looking into it
        </button>
      </div>

      <Msg state={state} />
    </form>
  );
}

/**
 * Goodwill money on an order that already happened.
 *
 * The live board's refund paths all hang off a reason a customer can feel — an
 * 86'd item, a cancellation. This one is the owner choosing to give something
 * back after the fact: a regular who had a bad night, a mixup that wasn't worth
 * a formal complaint. It rides on `refundOrderAction` with the QUALITY reason,
 * which is the enum's "remake or goodwill" slot, so it reads correctly in the
 * ledger rather than pretending the kitchen was at fault.
 *
 * Collapsed behind a link and defaulted to nothing — a partial refund is a
 * deliberate act, not a default. The amount is clamped server-side to what's
 * still refundable, so a fat-fingered figure can't over-refund; the hint just
 * saves the owner the surprise.
 */
export function GoodwillRefund({
  orderId,
  refundableCts,
}: {
  orderId: string;
  refundableCts: number;
}) {
  const [state, action] = useFormState(refundOrderAction, undefined);
  const [open, setOpen] = React.useState(false);

  if (state?.ok) {
    return <p className="mt-2 text-[11.5px] text-accent">{state.ok}</p>;
  }

  if (refundableCts <= 0) {
    return <p className="mt-2 text-[11.5px] text-mute">Fully refunded.</p>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 w-full text-[11.5px] text-mute underline underline-offset-2 hover:text-accent"
      >
        Refund some of this
      </button>
    );
  }

  return (
    <form action={action} className="mt-2 rounded-sm border border-line2 bg-base p-2.5">
      <input type="hidden" name="id" value={orderId} />
      <input type="hidden" name="problem" value="QUALITY" />
      <p className="mb-2 text-[11.5px] text-mute">
        Goodwill refund — up to {centsToMoney(refundableCts)} left on this order. The customer is
        told and their card is credited.
      </p>
      <input
        name="amount"
        inputMode="decimal"
        placeholder="Amount, e.g. 5.00"
        className="mb-2 w-full rounded-sm border border-line2 bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-mute"
      />
      <input
        name="note"
        placeholder="Anything to add for the customer?"
        className="mb-2 w-full rounded-sm border border-line2 bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-mute"
      />
      <Pending>Send the refund</Pending>
      <Msg state={state} />
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-1 w-full text-[11.5px] text-mute hover:text-ink"
      >
        Never mind
      </button>
    </form>
  );
}
