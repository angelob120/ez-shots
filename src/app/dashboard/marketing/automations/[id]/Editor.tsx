"use client";

import { Card, Field, Input, Select } from "@/components/hearth/ui";
import { FlowBuilder, type TagOption } from "@/components/hearth/FlowCanvas";
import type { Graph } from "@/lib/automation-flow";
import { saveAutomationAction } from "../actions";

/**
 * The builder plus the settings that belong to the journey rather than to any
 * one block: its name, who may re-enter it, and the hours it may text in.
 *
 * They sit above the canvas rather than in a settings page because both are
 * things an owner gets wrong silently. A journey with `ALWAYS` re-entry aimed
 * at a customer who orders twice a week sends the same "we miss you" twice a
 * week; a quiet-hours window nobody looked at is a text at 3am. Neither shows
 * up in the drawing.
 */
export function AutomationEditor({
  id,
  name,
  graph,
  tags,
  restaurantName,
  reentry,
  reentryDays,
  quietStartMin,
  quietEndMin,
  readOnly,
}: {
  id: string;
  name: string;
  graph: Graph;
  tags: TagOption[];
  restaurantName: string;
  reentry: string;
  reentryDays: number;
  quietStartMin: number;
  quietEndMin: number;
  readOnly: boolean;
}) {
  return (
    <FlowBuilder
      initialGraph={graph}
      tags={tags}
      restaurantName={restaurantName}
      action={saveAutomationAction}
      readOnly={readOnly}
      readOnlyNote="This journey is managed by us. Make a copy if you want to change the wording."
      saveLabel="Save draft"
      extraFields={<input type="hidden" name="id" value={id} />}
      header={
        <Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name">
              <Input name="name" defaultValue={name} disabled={readOnly} />
            </Field>

            <Field label="Can someone go through it again?" hint="Default is once, ever.">
              <Select name="reentry" defaultValue={reentry} disabled={readOnly}>
                <option value="ONCE">Once, ever</option>
                <option value="ONCE_PER_TRIGGER">Once per thing that happened</option>
                <option value="COOLDOWN">After a cooling-off period</option>
                <option value="ALWAYS">Every time they qualify</option>
              </Select>
            </Field>

            <Field label="Cooling-off (days)" hint="Only used by the option above.">
              <Input name="reentryDays" type="number" min={1} defaultValue={reentryDays} disabled={readOnly} />
            </Field>

            <Field label="Texts may go out between" hint="Your local time. A wait that lands outside it is held, not skipped.">
              <div className="flex items-center gap-2">
                <Input
                  name="quietStart"
                  type="time"
                  defaultValue={toTime(quietStartMin)}
                  disabled={readOnly}
                />
                <span className="text-[12px] text-mute">and</span>
                <Input name="quietEnd" type="time" defaultValue={toTime(quietEndMin)} disabled={readOnly} />
              </div>
            </Field>
          </div>

          <p className="mt-3 text-[11px] text-mute">
            Saving never changes what people already in the journey are walking — they finish the version they entered
            on. Switch it on to publish your changes for everyone who enters next.
          </p>
        </Card>
      }
    />
  );
}

function toTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
