"use client";

import * as React from "react";
import { useFormState } from "react-dom";
import { pauseOrdersAction, resumeOrdersAction } from "./actions";

/**
 * The stop-everything button, sitting on the order board because that is the
 * screen someone is looking at when the fryer dies.
 *
 * Always time-boxed. An indefinite pause is how a restaurant discovers on
 * Thursday that it stopped taking orders on Monday.
 */
export function PauseControl({
  pausedUntil,
  pauseReason,
}: {
  pausedUntil: string | null;
  pauseReason: string | null;
}) {
  const [state, action] = useFormState(pauseOrdersAction, undefined);
  const [open, setOpen] = React.useState(false);

  if (pausedUntil) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-warn/30 bg-warn/5 px-4 py-3">
        <span className="text-[13px] text-warn">
          New orders are paused until {pausedUntil}
          {pauseReason ? ` — ${pauseReason}` : ""}.
        </span>
        <form action={resumeOrdersAction} className="ml-auto">
          <button className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-medium text-white">
            Start taking orders again
          </button>
        </form>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mb-6 text-[12.5px] text-mute underline underline-offset-2 hover:text-warn"
      >
        Pause new orders
      </button>
    );
  }

  return (
    <form action={action} className="mb-6 rounded-md border border-line bg-surface p-4">
      <p className="mb-3 text-[12.5px] text-dim">
        Stops new orders coming in. Orders already on the board are untouched — finish those as
        normal.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1 block text-[12px] text-mute">For how long</label>
          <select
            name="minutes"
            defaultValue="30"
            className="rounded-sm border border-line2 bg-surface2 px-3 py-2 text-[13px] text-ink"
          >
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
            <option value="480">The rest of today</option>
          </select>
        </div>

        <div className="min-w-[200px] flex-1">
          <label className="mb-1 block text-[12px] text-mute">
            Reason (customers see this)
          </label>
          <input
            name="reason"
            placeholder="Kitchen slammed — back shortly"
            className="w-full rounded-sm border border-line2 bg-surface2 px-3 py-2 text-[13px] text-ink placeholder:text-mute"
          />
        </div>

        <button
          type="submit"
          className="rounded-sm bg-warn/20 px-4 py-2 text-[13px] font-medium text-warn hover:bg-warn/30"
        >
          Pause
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="px-3 py-2 text-[12.5px] text-mute hover:text-ink"
        >
          Cancel
        </button>
      </div>

      {(state?.error || state?.ok) && (
        <p className={`mt-2 text-[12px] ${state.error ? "text-warn" : "text-accent"}`}>
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}
