"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import {
  deleteModifierGroupAction,
  deleteModifierOptionAction,
  upsertModifierGroupAction,
  upsertModifierOptionAction,
} from "../actions";
import { Badge, Button, Field, Input } from "@/components/hearth/ui";

export type OptionRow = {
  id: string;
  name: string;
  priceDelta: string;
  isDefault: boolean;
  available: boolean;
};

export type GroupRow = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: OptionRow[];
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

/**
 * The food-native templates an owner actually reasons in. Each one just seeds
 * the underlying group with the right required/multiple shape and example copy;
 * the owner can still tweak everything afterward.
 */
type TemplateKey = "variation" | "toppings" | "choice";

const TEMPLATES: Record<
  TemplateKey,
  { label: string; blurb: string; namePlaceholder: string; choicePlaceholder: string; required: boolean; multiple: boolean }
> = {
  variation: {
    label: "Variation",
    blurb: "Pick one - sizes, proteins, spice level.",
    namePlaceholder: "Size",
    choicePlaceholder: "Large",
    required: true,
    multiple: false,
  },
  toppings: {
    label: "Toppings & add-ons",
    blurb: "Pick several - extra cheese, bacon, sauces.",
    namePlaceholder: "Add-ons",
    choicePlaceholder: "Extra cheese",
    required: false,
    multiple: true,
  },
  choice: {
    label: "Choice / swap",
    blurb: "Pick one, optional - bread, side, prep.",
    namePlaceholder: "Choice of side",
    choicePlaceholder: "Fries",
    required: false,
    multiple: false,
  },
};

/**
 * Modifier editing for one item.
 *
 * The owner never sees "minSelect" or "maxSelect" — they start from a food
 * template (Variation / Toppings / Choice) and see two checkboxes underneath,
 * "Customers must choose" and "Can pick more than one". The numbers are derived
 * on the server.
 */
export default function ModifierEditor({
  menuItemId,
  groups,
}: {
  menuItemId: string;
  groups: GroupRow[];
}) {
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState<TemplateKey | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-[13px] font-semibold text-ink">Variations, toppings &amp; add-ons</h4>
        <p className="text-[11px] text-mute">
          Everything a customer picks for this item. Start from a template:
        </p>
      </div>

      {/* Template chooser — one tap seeds the right kind of group. */}
      <div className="grid gap-2 sm:grid-cols-3">
        {(Object.keys(TEMPLATES) as TemplateKey[]).map((key) => {
          const t = TEMPLATES[key];
          const active = newGroup === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setNewGroup(active ? null : key)}
              className={
                "rounded-sm border px-3 py-2.5 text-left transition-colors " +
                (active ? "border-accent bg-accent/10" : "border-line2 bg-surface2 hover:border-line")
              }
            >
              <div className="text-[12.5px] font-medium text-ink">{t.label}</div>
              <div className="mt-0.5 text-[11px] leading-snug text-mute">{t.blurb}</div>
            </button>
          );
        })}
      </div>

      {newGroup && (
        <GroupForm
          menuItemId={menuItemId}
          template={TEMPLATES[newGroup]}
          onDone={() => setNewGroup(null)}
        />
      )}

      {groups.length === 0 && !newGroup && (
        <p className="rounded-sm border border-dashed border-line2 px-4 py-5 text-center text-[12px] text-mute">
          No options yet. Pick a template above to add sizes, toppings or a choice.
        </p>
      )}

      {groups.map((g) => {
        const single = g.maxSelect === 1;
        const required = g.minSelect > 0;

        return (
          <div key={g.id} className="rounded-sm border border-line2 bg-surface2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-medium text-ink">{g.name}</span>
              <Badge tone={required ? "good" : "neutral"}>
                {required ? "Required" : "Optional"}
              </Badge>
              <Badge tone="neutral">{single ? "Pick one" : `Pick up to ${g.maxSelect}`}</Badge>

              <form action={deleteModifierGroupAction} className="ml-auto">
                <input type="hidden" name="id" value={g.id} />
                <Button size="sm" variant="ghost">
                  Delete group
                </Button>
              </form>
            </div>

            <div className="mt-3 space-y-1.5">
              {g.options.length === 0 && (
                <p className="text-[11px] text-mute">
                  This group has no choices yet, so it won&rsquo;t show to customers.
                </p>
              )}
              {g.options.map((o) => (
                <div
                  key={o.id}
                  className="flex items-center gap-2 rounded-xs border border-line px-3 py-2"
                >
                  <span className="text-[12.5px] text-ink">{o.name}</span>
                  {o.isDefault && single && <Badge tone="neutral">Default</Badge>}
                  {!o.available && <Badge tone="warn">Hidden</Badge>}
                  <span className="ml-auto font-mono text-[12px] text-dim">
                    {o.priceDelta === "0.00" ? "-" : `$${o.priceDelta}`}
                  </span>
                  <form action={deleteModifierOptionAction}>
                    <input type="hidden" name="id" value={o.id} />
                    <Button size="sm" variant="ghost">
                      ✕
                    </Button>
                  </form>
                </div>
              ))}
            </div>

            {addingTo === g.id ? (
              <OptionForm groupId={g.id} single={single} onDone={() => setAddingTo(null)} />
            ) : (
              <Button
                size="sm"
                variant="ghost"
                type="button"
                className="mt-2"
                onClick={() => setAddingTo(g.id)}
              >
                Add a choice
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function GroupForm({
  menuItemId,
  template,
  onDone,
}: {
  menuItemId: string;
  template: (typeof TEMPLATES)[TemplateKey];
  onDone: () => void;
}) {
  const [state, action] = useFormState(upsertModifierGroupAction, undefined);
  const [multiple, setMultiple] = useState(template.multiple);

  if (state?.ok) {
    // Fire once the server confirms, so the list below re-renders first.
    queueMicrotask(onDone);
  }

  return (
    <form action={action} className="rounded-sm border border-line2 bg-surface2 p-4">
      <input type="hidden" name="menuItemId" value={menuItemId} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Group name">
          <Input name="name" placeholder={template.namePlaceholder} required autoFocus />
        </Field>
        {multiple && (
          <Field label="Max choices">
            <Input name="maxSelect" type="number" min={2} max={20} defaultValue={3} />
          </Field>
        )}
      </div>

      <div className="mt-3 flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-[12.5px] text-dim">
          <input
            type="checkbox"
            name="required"
            defaultChecked={template.required}
            
          />
          Customers must choose
        </label>
        <label className="flex items-center gap-2 text-[12.5px] text-dim">
          <input
            type="checkbox"
            name="multiple"
            checked={multiple}
            onChange={(e) => setMultiple(e.target.checked)}
            
          />
          Can pick more than one
        </label>
      </div>

      {state?.error && <p className="mt-2 text-[12px] text-badInk">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <Submit label="Add group" />
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function OptionForm({
  groupId,
  single,
  onDone,
}: {
  groupId: string;
  single: boolean;
  onDone: () => void;
}) {
  const [state, action] = useFormState(upsertModifierOptionAction, undefined);

  if (state?.ok) queueMicrotask(onDone);

  return (
    <form action={action} className="mt-3 rounded-sm border border-line bg-surface p-3">
      <input type="hidden" name="groupId" value={groupId} />
      <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
        <Field label="Choice">
          <Input name="name" placeholder="Large" required autoFocus />
        </Field>
        <Field label="Price change" hint="Blank for free. Use −1.00 to discount.">
          <Input name="priceDelta" placeholder="1.50" className="font-mono" />
        </Field>
      </div>

      {single && (
        <label className="mt-2 flex items-center gap-2 text-[12.5px] text-dim">
          <input type="checkbox" name="isDefault"  />
          Pre-select this one
        </label>
      )}

      {state?.error && <p className="mt-2 text-[12px] text-badInk">{state.error}</p>}

      <div className="mt-3 flex gap-2">
        <Submit label="Add choice" />
        <Button size="sm" variant="ghost" type="button" onClick={onDone}>
          Done
        </Button>
      </div>
    </form>
  );
}
