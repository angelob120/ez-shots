"use client";

import { useState } from "react";
import { addItemLinkAction, removeItemLinkAction } from "../actions";
import { Badge, Button, Field, Select } from "@/components/hearth/ui";

export type LinkRow = {
  id: string;
  linkedItemId: string;
  kind: "UPSELL" | "CROSS_SELL";
};

/**
 * Upsell / cross-sell editor for one item. The owner points this item at other
 * items on the menu; customers see them as "Pairs well with" on the item
 * screen. Upsell = a natural step up (bigger, add a side); cross-sell = a
 * different thing to add (a drink, a cookie).
 */
export default function LinkEditor({
  itemId,
  links,
  allItems,
}: {
  itemId: string;
  links: LinkRow[];
  allItems: Array<{ id: string; name: string }>;
}) {
  const [adding, setAdding] = useState(false);

  const nameOf = (id: string) => allItems.find((i) => i.id === id)?.name ?? "Removed item";
  const linkedIds = new Set(links.map((l) => l.linkedItemId));
  const candidates = allItems.filter((i) => i.id !== itemId && !linkedIds.has(i.id));

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-[13px] font-semibold text-ink">Upsells &amp; cross-sells</h4>
        <p className="text-[11px] text-mute">
          Other items to suggest with this one - shown as “Pairs well with” at checkout.
        </p>
      </div>

      {links.length > 0 && (
        <div className="space-y-1.5">
          {links.map((l) => (
            <div
              key={l.id}
              className="flex items-center gap-2 rounded-xs border border-line px-3 py-2"
            >
              <span className="text-[12.5px] text-ink">{nameOf(l.linkedItemId)}</span>
              <Badge tone={l.kind === "UPSELL" ? "good" : "neutral"}>
                {l.kind === "UPSELL" ? "Upsell" : "Cross-sell"}
              </Badge>
              <form action={removeItemLinkAction} className="ml-auto">
                <input type="hidden" name="id" value={l.id} />
                <Button size="sm" variant="ghost">
                  ✕
                </Button>
              </form>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <form
          action={addItemLinkAction}
          className="rounded-sm border border-line2 bg-surface2 p-3"
        >
          <input type="hidden" name="itemId" value={itemId} />
          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <Field label="Recommend this item">
              <Select name="linkedItemId" required defaultValue="">
                <option value="" disabled>
                  Choose an item…
                </option>
                {candidates.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="As a">
              <Select name="kind" defaultValue="CROSS_SELL">
                <option value="CROSS_SELL">Cross-sell (add-on)</option>
                <option value="UPSELL">Upsell (step up)</option>
              </Select>
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm">Add</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
              Done
            </Button>
          </div>
        </form>
      ) : candidates.length > 0 ? (
        <Button size="sm" variant="outline" type="button" onClick={() => setAdding(true)}>
          Add a recommendation
        </Button>
      ) : (
        <p className="rounded-sm border border-dashed border-line2 px-4 py-4 text-center text-[11px] text-mute">
          Add more menu items first, then you can recommend them here.
        </p>
      )}
    </div>
  );
}
