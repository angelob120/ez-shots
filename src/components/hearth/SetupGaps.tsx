import Link from "next/link";

/**
 * A persistent banner for a tenant that has launched but has since lost
 * something required — usually hours cleared during a refit, or the last menu
 * item deleted while rebuilding a menu.
 *
 * **This never blocks, and it must never learn to.** `/dashboard` is the live
 * order board. An owner reaching it at 7pm on a Friday is looking at tickets
 * for food that is already being cooked; putting a form in front of that to
 * demand a schedule be re-entered would stop them serving customers. The gate
 * belongs before launch, where the cost of stopping falls on somebody who
 * isn't trading yet. `lib/onboarding.ts` is where that split is decided and
 * explained.
 *
 * It is also **not dismissable**. A dismiss button on a banner like this is a
 * button that says "stop telling me my ordering page never closes" — the
 * problem doesn't go away, only the knowledge of it does. It disappears when
 * the thing is fixed and not before, which is the only honest trigger.
 */
export default function SetupGaps({
  steps,
}: {
  steps: Array<{ key: string; label: string; todo: string }>;
}) {
  if (steps.length === 0) return null;

  // Where to send them. These are dashboard destinations, not wizard steps —
  // the wizard is gone for good once they've launched.
  const HREF: Record<string, string> = {
    basics: "/dashboard/branding",
    menu: "/dashboard/menu",
    hours: "/dashboard/hours",
    branding: "/dashboard/branding",
  };

  return (
    <div className="mb-6 rounded-md border border-warnLine bg-warnBg px-4 py-3.5" role="status">
      <h2 className="text-[13px] font-semibold text-warnInk">
        {steps.length === 1
          ? "One setting needs your attention"
          : `${steps.length} settings need your attention`}
      </h2>
      <ul className="mt-2.5 space-y-2">
        {steps.map((s) => (
          <li key={s.key} className="text-[12.5px] leading-relaxed text-warnDim">
            <Link
              href={HREF[s.key] ?? "/dashboard"}
              className="font-medium text-warnInk underline underline-offset-2"
            >
              {s.label}
            </Link>{" "}
            — {s.todo}
          </li>
        ))}
      </ul>
    </div>
  );
}
