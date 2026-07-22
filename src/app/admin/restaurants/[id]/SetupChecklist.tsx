import Link from "next/link";
import { Card } from "@/components/hearth/ui";
import type { Check } from "@/lib/readiness";

/**
 * What's left before this tenant is a working restaurant.
 *
 * Rendered as a list rather than a percentage because a percentage is not
 * actionable — "62% set up" tells an operator nothing about whether to call
 * them today. Blocking items are visually separated from advisory ones for the
 * same reason: the whole value of the list is that it distinguishes "can't take
 * an order" from "hasn't uploaded a logo", and a flat list of ticks does not.
 */
export default function SetupChecklist({
  checks,
  basePath,
}: {
  checks: Check[];
  basePath: string;
}) {
  const outstanding = checks.filter((c) => !c.done);
  const blockers = outstanding.filter((c) => c.blocking);
  const advisory = outstanding.filter((c) => !c.blocking);
  const done = checks.filter((c) => c.done);

  return (
    <Card>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">Setup</h3>
        <span className="font-mono text-[12px] text-mute">
          {done.length}/{checks.length}
        </span>
      </div>

      {outstanding.length === 0 ? (
        <p className="text-[12.5px] text-accent">
          Everything&rsquo;s in place. This tenant can take orders.
        </p>
      ) : (
        <div className="space-y-4">
          {blockers.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-badInk">
                Blocking — can&rsquo;t take orders
              </p>
              <ul className="space-y-2.5">
                {blockers.map((c) => (
                  <Row key={c.key} check={c} basePath={basePath} tone="bad" />
                ))}
              </ul>
            </div>
          )}

          {advisory.length > 0 && (
            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
                Worth doing
              </p>
              <ul className="space-y-2.5">
                {advisory.map((c) => (
                  <Row key={c.key} check={c} basePath={basePath} tone="warn" />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-3">
          {done.map((c) => (
            <span key={c.key} className="text-[11.5px] text-mute">
              <span className="text-accent">✓</span> {c.label}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

function Row({
  check,
  basePath,
  tone,
}: {
  check: Check;
  basePath: string;
  tone: "bad" | "warn";
}) {
  const body = (
    <>
      <span
        className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${
          tone === "bad" ? "bg-badInk" : "bg-warn"
        }`}
      />
      <span className="min-w-0">
        <span className="text-[12.5px] text-ink">{check.label}</span>
        <span className="mt-0.5 block text-[11.5px] leading-relaxed text-mute">{check.fix}</span>
      </span>
    </>
  );

  return (
    <li>
      {check.tab ? (
        <Link
          href={`${basePath}?tab=${check.tab}`}
          className="flex gap-2.5 rounded-sm transition-colors hover:bg-surface2"
        >
          {body}
        </Link>
      ) : (
        <div className="flex gap-2.5">{body}</div>
      )}
    </li>
  );
}
