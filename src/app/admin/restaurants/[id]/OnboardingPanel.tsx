import Link from "next/link";
import { Card, Badge } from "@/components/hearth/ui";
import type { ChecklistState } from "@/lib/onboarding-checklist";
import { toggleOnboardingStepAction } from "../../actions";

/**
 * The manual onboarding checklist for one tenant.
 *
 * Deliberately distinct from `SetupChecklist` (which renders derived readiness):
 * this is the operator's *own* tracking — steps they tick as they work through a
 * setup call, saved until they're done. Fully server-rendered; each control is a
 * form posting a server action, so there's no client bundle and no boundary to
 * trip over.
 *
 * Notes live on their own tabs (Onboarding notes / Account notes) and the
 * wording of the steps is edited platform-wide at `/admin/onboarding`, so this
 * panel is just the checklist itself.
 */

export default function OnboardingPanel({
  restaurantId,
  basePath,
  checklist,
}: {
  restaurantId: string;
  basePath: string;
  checklist: ChecklistState;
}) {
  const pct = checklist.total ? Math.round((checklist.done / checklist.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* ── The checklist ─────────────────────────────────────────── */}
      <div className="space-y-4">
        <Card>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-[14px] font-semibold text-ink">Onboarding checklist</h3>
              <p className="mt-0.5 text-[12px] text-mute">
                Your steps for taking this restaurant live. Saved until you finish.
              </p>
            </div>
            <div className="text-right">
              <span className="font-mono text-[13px] text-ink">
                {checklist.done}/{checklist.total}
              </span>
              {checklist.complete && (
                <div className="mt-1">
                  <Badge tone="good">Complete</Badge>
                </div>
              )}
            </div>
          </div>

          <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface2">
            <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
          </div>

          <div className="space-y-5">
            {checklist.sections.map((section) => (
              <div key={section.key}>
                <div className="mb-2 flex items-baseline justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-mute">
                    {section.title}
                  </p>
                  <span className="font-mono text-[11px] text-mute">
                    {section.done}/{section.total}
                  </span>
                </div>
                <ul className="space-y-1">
                  {section.steps.map((step) => (
                    <li key={step.key}>
                      <div className="flex gap-2.5 rounded-sm px-1 py-1.5 hover:bg-surface2">
                        <form action={toggleOnboardingStepAction} className="mt-[1px] shrink-0">
                          <input type="hidden" name="restaurantId" value={restaurantId} />
                          <input type="hidden" name="key" value={step.key} />
                          <input type="hidden" name="done" value={step.done ? "false" : "true"} />
                          <button
                            type="submit"
                            aria-label={step.done ? "Mark not done" : "Mark done"}
                            className={[
                              "flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] transition-colors",
                              step.done
                                ? "border-accent bg-accent text-white"
                                : "border-line2 bg-surface2 text-transparent hover:border-accentDim",
                            ].join(" ")}
                          >
                            ✓
                          </button>
                        </form>
                        <div className="min-w-0 grow">
                          <div className="flex items-center gap-2">
                            <span
                              className={`text-[12.5px] ${
                                step.done ? "text-mute line-through" : "text-ink"
                              }`}
                            >
                              {step.label}
                            </span>
                            {step.tab && (
                              <Link
                                href={`${basePath}?tab=${step.tab}`}
                                className="text-[11px] text-accent hover:underline"
                              >
                                open →
                              </Link>
                            )}
                          </div>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-mute">
                            {step.detail}
                          </span>
                          {step.done && step.completedByName && (
                            <span className="mt-0.5 block text-[10.5px] text-dim">
                              ✓ {step.completedByName}
                              {step.completedAt
                                ? ` · ${new Date(step.completedAt).toLocaleDateString("en-US", {
                                    dateStyle: "medium",
                                  })}`
                                : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>

        <p className="px-1 text-[11.5px] text-mute">
          Need to change the wording of these steps?{" "}
          <Link href="/admin/onboarding" className="text-accent hover:underline">
            Edit the master checklist →
          </Link>
        </p>
      </div>
    </div>
  );
}
