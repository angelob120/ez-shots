import { Card, Button, Badge } from "@/components/hearth/ui";
import type { EditableStep } from "@/lib/onboarding-checklist";
import { updateOnboardingStepTextAction } from "../actions";

/**
 * The editor for the master onboarding checklist wording. Platform-wide — one
 * template drives every tenant's Onboarding tab — so it lives here rather than
 * on a restaurant page. Each step is its own form posting a server action;
 * saving with both fields blank resets that step to its shipped default.
 */

const inputCls =
  "w-full rounded-md border border-line2 bg-surface2 px-3 py-2 text-[13px] text-ink outline-none transition-colors focus:border-accentDim";
const fieldLabel = "mb-1 block text-[11px] font-medium uppercase tracking-[0.06em] text-mute";

export default function StepTemplateEditor({ steps }: { steps: EditableStep[] }) {
  // Group the flat list back into its sections for a legible layout.
  const sections: { title: string; steps: EditableStep[] }[] = [];
  for (const step of steps) {
    let group = sections.find((s) => s.title === step.sectionTitle);
    if (!group) {
      group = { title: step.sectionTitle, steps: [] };
      sections.push(group);
    }
    group.steps.push(step);
  }

  const editedCount = steps.filter((s) => s.isEdited).length;

  return (
    <div className="space-y-8">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-[12.5px] leading-relaxed text-mute">
            These are the words every account sees on its Onboarding tab. Edit any step below —
            changes apply everywhere. Clear both fields and save to restore a step&rsquo;s original
            wording. Adding or removing whole steps is still a code change.
          </p>
          <span className="shrink-0 text-[12px] text-dim">
            {steps.length} steps · {editedCount} edited
          </span>
        </div>
      </Card>

      {sections.map((section) => (
        <section key={section.title}>
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-dim">
            {section.title}
          </h2>
          <div className="space-y-3">
            {section.steps.map((step) => (
              <Card key={step.key}>
                <form action={updateOnboardingStepTextAction} className="space-y-3">
                  <input type="hidden" name="key" value={step.key} />

                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-mute">{step.key}</span>
                    {step.isEdited && <Badge tone="neutral">edited</Badge>}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className={fieldLabel}>Label</label>
                      <input
                        name="label"
                        defaultValue={step.label}
                        maxLength={120}
                        placeholder="Step label"
                        className={inputCls}
                      />
                    </div>
                    <div>
                      <label className={fieldLabel}>Detail</label>
                      <textarea
                        name="detail"
                        defaultValue={step.detail}
                        maxLength={300}
                        rows={2}
                        placeholder="The one-line why / how"
                        className={`${inputCls} resize-y`}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button size="sm">Save</Button>
                  </div>
                </form>
              </Card>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
