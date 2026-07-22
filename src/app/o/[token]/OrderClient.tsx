"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useFormState, useFormStatus } from "react-dom";
import { cancelOrderAction, reportIssueAction, type CustomerResult } from "./actions";
import { ISSUE_LABELS } from "@/lib/order-labels";

/**
 * Keeps the page honest without a websocket.
 *
 * A customer sitting on this screen waiting for "Ready" will not think to
 * refresh, so the page refreshes itself — often while the order is live, and
 * not at all once it's finished, because polling a settled order forever is
 * just a battery drain.
 */
export function AutoRefresh({ live }: { live: boolean }) {
  const router = useRouter();

  React.useEffect(() => {
    if (!live) return;
    const tick = () => {
      // Nothing to update on a backgrounded tab; wait until they look again.
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, 20_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [live, router]);

  return null;
}

function Submit({ children, tone = "accent" }: { children: React.ReactNode; tone?: "accent" | "quiet" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        tone === "accent"
          ? "w-full rounded-md bg-accent px-4 py-2.5 text-[13px] font-medium text-white transition-opacity disabled:opacity-50"
          : "w-full rounded-md border border-line2 px-4 py-2.5 text-[13px] text-dim transition-colors hover:text-ink disabled:opacity-50"
      }
    >
      {pending ? "Working…" : children}
    </button>
  );
}

function Notice({ result }: { result: CustomerResult | null }) {
  if (!result) return null;
  return (
    <p
      className={`mt-3 rounded-sm px-3 py-2 text-[12.5px] leading-relaxed ${
        result.ok ? "bg-accent/10 text-accent" : "bg-warn/10 text-warn"
      }`}
    >
      {result.message}
    </p>
  );
}

/**
 * Cancelling is deliberately a two-step: it's irreversible, and a mis-tap on a
 * phone shouldn't bin someone's dinner.
 */
export function CancelOrder({ token }: { token: string }) {
  const [state, action] = useFormState(cancelOrderAction, null);
  const [confirming, setConfirming] = React.useState(false);

  if (state?.ok) return <Notice result={state} />;

  if (!confirming) {
    return (
      <div>
        <button
          onClick={() => setConfirming(true)}
          className="text-[12.5px] text-mute underline underline-offset-2 hover:text-ink"
        >
          Cancel this order
        </button>
        <Notice result={state} />
      </div>
    );
  }

  return (
    <form action={action} className="rounded-md border border-line2 bg-surface2 p-3">
      <input type="hidden" name="token" value={token} />
      <p className="mb-2 text-[12.5px] text-dim">
        Cancel this order and refund it in full? This can&apos;t be undone.
      </p>
      <input
        name="note"
        placeholder="Reason (optional)"
        className="mb-2 w-full rounded-sm border border-line2 bg-base px-3 py-2 text-[13px] text-ink placeholder:text-mute"
      />
      <div className="flex gap-2">
        <Submit>Yes, cancel it</Submit>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="w-full rounded-md border border-line2 px-4 py-2.5 text-[13px] text-dim hover:text-ink"
        >
          Keep it
        </button>
      </div>
      <Notice result={state} />
    </form>
  );
}

export function ReportIssue({ token, defaultKind }: { token: string; defaultKind: string }) {
  const [state, action] = useFormState(reportIssueAction, null);
  const [open, setOpen] = React.useState(false);

  if (state?.ok) return <Notice result={state} />;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-md border border-line2 px-4 py-2.5 text-[13px] text-dim transition-colors hover:text-ink"
      >
        Something wrong with this order?
      </button>
    );
  }

  return (
    <form action={action} className="rounded-md border border-line2 bg-surface2 p-3">
      <input type="hidden" name="token" value={token} />

      <label className="mb-1.5 block text-[12px] text-mute">What happened?</label>
      <select
        name="kind"
        defaultValue={defaultKind}
        className="mb-3 w-full rounded-sm border border-line2 bg-base px-3 py-2 text-[13px] text-ink"
      >
        {Object.entries(ISSUE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <textarea
        name="body"
        rows={3}
        required
        placeholder="A sentence or two is plenty."
        className="mb-3 w-full resize-none rounded-sm border border-line2 bg-base px-3 py-2 text-[13px] text-ink placeholder:text-mute"
      />

      <Submit>Send to the restaurant</Submit>
      <Notice result={state} />
    </form>
  );
}
