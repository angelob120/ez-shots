"use client";

import { useFormState, useFormStatus } from "react-dom";

import { Button, Card, Field, Input, Select, Textarea, cx } from "@/components/hearth/ui";
import { FlowBuilder, type TagOption } from "@/components/hearth/FlowCanvas";
import type { Graph } from "@/lib/automation-flow";
import { createTemplateAction, publishTemplateAction, retireTemplateAction, saveTemplateAction } from "./actions";

type Result = { ok?: string; error?: string } | undefined;

function Submit({ children, variant = "outline" }: { children: React.ReactNode; variant?: "primary" | "outline" | "danger" }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant={variant} disabled={pending}>
      {pending ? "Working…" : children}
    </Button>
  );
}

function Outcome({ state }: { state: Result }) {
  if (!state?.ok && !state?.error) return null;
  return <span className={cx("text-[12px]", state.error ? "text-badInk" : "text-accent")}>{state.error ?? state.ok}</span>;
}

export function NewTemplateForm() {
  const [state, action] = useFormState(createTemplateAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Template name" className="max-w-xs" />
      <Submit variant="primary">New template</Submit>
      <Outcome state={state} />
    </form>
  );
}

/**
 * The admin builder.
 *
 * Deliberately the same `FlowBuilder` the owner uses, against the same
 * validator. Two editors would drift, and the way that drift surfaces is a
 * template that validates here and refuses to adopt in every tenant — which
 * looks like a broken product rather than a graph with a problem in it.
 *
 * The tag picker is empty on purpose: a template's tags are slugs typed by
 * hand, because the tenants that will run it have their own tag lists and none
 * of them exist here. `adoptTemplate` creates any missing tag when the owner
 * takes the template.
 */
export function TemplateEditor({
  id,
  name,
  blurb,
  visibility,
  syncPolicy,
  graph,
}: {
  id: string;
  name: string;
  blurb: string | null;
  visibility: string;
  syncPolicy: string;
  graph: Graph;
}) {
  const tags: TagOption[] = [];

  return (
    <FlowBuilder
      initialGraph={graph}
      tags={tags}
      restaurantName="the restaurant"
      action={saveTemplateAction}
      saveLabel="Save draft"
      extraFields={<input type="hidden" name="id" value={id} />}
      header={
        <Card>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Name">
              <Input name="name" defaultValue={name} />
            </Field>
            <Field label="One line for the gallery">
              <Input name="blurb" defaultValue={blurb ?? ""} />
            </Field>
            <Field label="Who can see this" hint="Private = just us. Owners = in their gallery. Preset = done-for-you reordering.">
              <Select name="visibility" defaultValue={visibility}>
                <option value="PRIVATE">Private — admins only</option>
                <option value="OWNERS">Owners — in the gallery to adopt</option>
                <option value="PRESET">Preset — done-for-you reordering</option>
              </Select>
            </Field>
            <Field label="When I publish an update" hint="Recommended: update untouched copies.">
              <Select name="syncPolicy" defaultValue={syncPolicy}>
                <option value="AUTO_UNLESS_CUSTOMIZED">Update copies nobody edited</option>
                <option value="ALWAYS">Update everyone, and keep it read-only</option>
                <option value="OPT_IN">Tell them; let them choose</option>
              </Select>
            </Field>
          </div>

          <p className="mt-3 text-[11px] text-mute">
            Saving touches the draft only. Owners keep seeing the published version until you publish. Nobody
            mid-journey is ever moved.
          </p>
        </Card>
      }
    />
  );
}

export function PublishForm({ id, adoptionCount }: { id: string; adoptionCount: number }) {
  const [state, action] = useFormState(publishTemplateAction, undefined);
  return (
    <Card>
      <p className="text-[13px] font-medium text-ink">Publish</p>
      <p className="mb-3 mt-1 text-[12px] text-dim">
        {adoptionCount === 0
          ? "Nobody has adopted this yet, so publishing only puts it in the gallery."
          : `${adoptionCount} restaurant${adoptionCount === 1 ? " is" : "s are"} running this. The sync policy decides who moves.`}
      </p>
      <form action={action} className="space-y-3">
        <input type="hidden" name="id" value={id} />
        <Field label="What changed" hint="Shown to owners who have to accept the update. Somebody asked to trust rather than to decide will say no.">
          <Textarea name="notes" rows={3} />
        </Field>
        <div className="flex items-center gap-2">
          <Submit variant="primary">Publish</Submit>
          <Outcome state={state} />
        </div>
      </form>
    </Card>
  );
}

export function RetireForm({ id }: { id: string }) {
  const [state, action] = useFormState(retireTemplateAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Submit variant="danger">Retire</Submit>
      <span className="text-[12px] text-mute">Out of the gallery. Anyone running it keeps it.</span>
      <Outcome state={state} />
    </form>
  );
}
