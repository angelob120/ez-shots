import Link from "next/link";
import { cx } from "@/components/hearth/ui";

export type StepDef = { n: number; label: string; blurb: string; hint: string };

/**
 * The wizard's progress rail.
 *
 * What this replaces was a row of pill buttons that all looked roughly the same
 * whether done, current, or unreachable — so it read as navigation the owner had
 * failed to use rather than as progress they were making. Three changes:
 *
 *   - A filled bar, because progress through a fixed four-step sequence is a
 *     quantity and pills don't express one.
 *   - Completed steps are the only ones that link. A step you can't reach that
 *     looks clickable is a small broken promise on the screen where the product
 *     is asking to be trusted with someone's business.
 *   - The current step says what it wants and how long it takes. Someone
 *     setting this up is standing in a kitchen deciding whether to finish now.
 */
export default function StepRail({
  steps,
  step,
  furthest,
}: {
  steps: StepDef[];
  step: number;
  furthest: number;
}) {
  const current = steps[step - 1];
  const pct = ((step - 1) / steps.length) * 100;

  return (
    <div className="mb-8">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">
            Step {step} of {steps.length}
          </p>
          <h1 className="mt-2 text-[24px] font-semibold tracking-tight text-ink">
            {current.label}
          </h1>
          <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-dim">
            {current.blurb}
          </p>
        </div>
        <span className="hidden shrink-0 rounded-full border border-line2 px-2.5 py-1 text-[11px] text-mute sm:inline">
          {current.hint}
        </span>
      </div>

      <div className="h-1 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>

      <ol className="mt-3 flex gap-x-5 gap-y-1 overflow-x-auto">
        {steps.map((s) => {
          const done = s.n <= furthest && s.n !== step;
          const active = s.n === step;
          const label = (
            <span
              className={cx(
                "flex shrink-0 items-center gap-1.5 text-[12px] transition-colors",
                active && "text-ink",
                done && "text-dim hover:text-ink",
                !active && !done && "text-mute"
              )}
            >
              <span
                className={cx(
                  "grid h-4 w-4 shrink-0 place-items-center rounded-full border text-[9px]",
                  active && "border-accent text-accent",
                  done && "border-accentFill bg-accentFill text-accentInk",
                  !active && !done && "border-line2"
                )}
              >
                {done ? "✓" : s.n}
              </span>
              {s.label}
            </span>
          );

          return (
            <li key={s.n}>
              {done ? <Link href={`/onboarding?step=${s.n}`}>{label}</Link> : label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
