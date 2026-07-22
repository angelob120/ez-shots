import Link from "next/link";

/**
 * What's still standing between an owner and launching.
 *
 * Two states, and the difference matters:
 *
 * - **Blocked** (they tried to launch and couldn't) is loud, because they just
 *   pressed a button and something has to explain why nothing happened. A
 *   button that silently declines is the worst possible response to the one
 *   click the whole wizard exists to earn.
 * - **Progress** (the ordinary case) is quiet. Someone on step 2 of 5 doesn't
 *   need a warning banner about step 4 not being done yet — that's not a
 *   problem, that's the future.
 *
 * Each outstanding item links straight to its step and says what to do in the
 * imperative. "Opening hours: incomplete" tells an owner nothing they can act
 * on; "Set the days and times you're open, so ordering closes when your kitchen
 * does" tells them both the task and the reason.
 */
export default function BlockedNotice({
  blocked,
  steps,
  progress,
}: {
  blocked: boolean;
  steps: Array<{ n: number; label: string; todo: string }>;
  progress: { done: number; total: number; pct: number };
}) {
  if (steps.length === 0) {
    // Nothing outstanding. Worth saying once — the moment everything required
    // is done is the moment the owner is one click from being open, and that
    // deserves to be visible rather than inferred from an enabled button.
    return (
      <div className="mb-6 flex items-center gap-2.5 rounded-md border border-goodLine bg-goodBg px-4 py-2.5">
        <span className="text-[12.5px] font-medium text-good">Everything required is done.</span>
        <span className="text-[12px] text-dim">You can launch whenever you&rsquo;re ready.</span>
      </div>
    );
  }

  if (!blocked) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-line bg-surface px-4 py-2.5">
        <span className="text-[12px] text-dim">
          {progress.done} of {progress.total} required steps done
        </span>
        <span className="h-1 w-24 overflow-hidden rounded-full bg-line2" aria-hidden>
          <span
            className="block h-full rounded-full bg-accent transition-[width] duration-300"
            style={{ width: `${progress.pct}%` }}
          />
        </span>
        <span className="text-[12px] text-mute">
          Still to do: {steps.map((s) => s.label.toLowerCase()).join(", ")}
        </span>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-md border border-warnLine bg-warnBg px-4 py-3.5" role="alert">
      <h2 className="text-[13px] font-semibold text-warnInk">
        You can&rsquo;t open yet — {steps.length === 1 ? "one thing" : `${steps.length} things`} still
        needed
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-warnDim">
        These aren&rsquo;t paperwork. Each one is something that would break your ordering page for a
        real customer on your first night.
      </p>
      <ul className="mt-3 space-y-2.5">
        {steps.map((s) => (
          <li key={s.n} className="flex gap-2.5">
            <span className="mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full border border-warnLine text-[9px] text-warnInk">
              {s.n}
            </span>
            <span className="text-[12.5px] leading-relaxed text-warnDim">
              <Link
                href={`/onboarding?step=${s.n}`}
                className="font-medium text-warnInk underline underline-offset-2"
              >
                {s.label}
              </Link>{" "}
              — {s.todo}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
