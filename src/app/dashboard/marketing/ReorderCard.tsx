"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { Card, cx } from "@/components/hearth/ui";
import { setReorderAction } from "./actions";
import { REORDER_MODES, MODE_LABEL, MODE_BLURB, coerceMode, type ReorderMode } from "@/lib/reorder";

/**
 * The owner's one-tap reordering dial.
 *
 * Mirrors the onboarding step but lives where an owner comes back to it. The
 * whole point is that changing it is trivial: flip on/off, pick a level, save.
 * "Dial it down when trade is heavy" has to be faster than opening the builder,
 * or nobody does it and the journey keeps sending into a full kitchen.
 *
 * The status line reports the *running* state, which can lag the preference —
 * if messaging is suspended, the owner chose On but the journey can't start,
 * and the card says so instead of pretending.
 */
function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-3.5 py-2 text-[12.5px] font-semibold text-accentInk hover:opacity-90 disabled:opacity-60"
    >
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export default function ReorderCard({
  enabled,
  mode,
  running,
  enteredCount,
  inFlight,
}: {
  enabled: boolean;
  mode: string;
  running: boolean;
  enteredCount: number;
  inFlight: number;
}) {
  const [on, setOn] = useState(enabled);
  const [level, setLevel] = useState<ReorderMode>(coerceMode(mode));
  const [state, action] = useFormState(setReorderAction, undefined);

  const status = !enabled
    ? "Off"
    : running
      ? `On · ${MODE_LABEL[coerceMode(mode)]}`
      : `On · ${MODE_LABEL[coerceMode(mode)]} · not sending yet`;

  return (
    <Card className="mb-6">
      <form action={action} className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Automatic reordering</h3>
            <p className="mt-1 max-w-xl text-[12.5px] leading-relaxed text-dim">
              We win back customers who&apos;ve drifted, so you don&apos;t have to. Turn it up when
              it&apos;s slow, down when you&apos;re slammed, off anytime.
            </p>
          </div>
          <span
            className={cx(
              "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold",
              enabled && running
                ? "bg-goodBg text-accent"
                : enabled
                  ? "bg-warnBg text-warnInk"
                  : "bg-surface text-dim"
            )}
          >
            {status}
          </span>
        </div>

        {enabled && (
          <p className="text-[12px] text-dim">
            {enteredCount === 0
              ? "No customers have entered yet — they enter once they've been away a while."
              : `${enteredCount} customer${enteredCount === 1 ? "" : "s"} reached so far · ${inFlight} in a sequence right now.`}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setOn(true)}
            className={cx(
              "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition",
              on ? "border-accent bg-accentFill/40 text-ink" : "border-line text-dim hover:border-dim"
            )}
          >
            On
          </button>
          <button
            type="button"
            onClick={() => setOn(false)}
            className={cx(
              "rounded-md border px-3 py-1.5 text-[12.5px] font-medium transition",
              !on ? "border-accent bg-accentFill/40 text-ink" : "border-line text-dim hover:border-dim"
            )}
          >
            Off
          </button>
        </div>

        {on && (
          <div className="grid gap-2 sm:grid-cols-3">
            {REORDER_MODES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setLevel(m)}
                className={cx(
                  "rounded-md border px-3 py-2.5 text-left transition",
                  level === m ? "border-accent bg-accentFill/40" : "border-line bg-surface hover:border-dim"
                )}
              >
                <span className="text-[12.5px] font-semibold text-ink">{MODE_LABEL[m]}</span>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-dim">{MODE_BLURB[m]}</p>
              </button>
            ))}
          </div>
        )}

        <input type="hidden" name="enabled" value={on ? "on" : "off"} />
        <input type="hidden" name="mode" value={level} />

        <div className="flex items-center gap-3">
          <Save />
          {state?.ok && <span className="text-[12px] text-accent">{state.ok}</span>}
          {state?.error && <span className="text-[12px] text-warn">{state.error}</span>}
        </div>
      </form>
    </Card>
  );
}
