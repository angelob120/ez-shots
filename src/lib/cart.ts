/**
 * The cart's shape and arithmetic, shared by the browser and the server.
 *
 * The browser uses it to show a running total. The server uses it to decide
 * what to charge — and it recomputes from the database every time, so nothing
 * here trusts a price that came off the wire.
 */

export type ModifierOptionDTO = {
  id: string;
  name: string;
  priceDeltaCts: number;
  isDefault: boolean;
};

export type ModifierGroupDTO = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  options: ModifierOptionDTO[];
};

export type MenuItemDTO = {
  id: string;
  name: string;
  description: string | null;
  /** The effective (sale-aware) price the customer pays before modifiers. */
  priceCts: number;
  /** Original list price when the item is on sale; null otherwise. */
  listPriceCts: number | null;
  imageUrl: string | null;
  color: string | null;
  categoryId: string | null;
  featured: boolean;
  groups: ModifierGroupDTO[];
  /** Other item ids this one recommends (upsells first, then cross-sells). */
  recommendedIds: string[];
};

/** A line in the cart. Same item, different choices = different lines. */
export type CartLine = {
  /** Stable identity derived from item + choices + note. */
  key: string;
  itemId: string;
  qty: number;
  optionIds: string[];
  notes: string;
};

/** What actually crosses the wire on checkout. Deliberately price-free. */
export type CartLineInput = {
  itemId: string;
  qty: number;
  optionIds: string[];
  notes?: string;
};

/**
 * Two lines merge only if they are the same item with the same choices and the
 * same note. Sorting the option ids makes the key order-independent.
 */
export function lineKey(itemId: string, optionIds: string[], notes: string): string {
  const opts = [...optionIds].sort().join(",");
  return `${itemId}|${opts}|${notes.trim().toLowerCase()}`;
}

/** Per-unit price: base plus the deltas of everything selected. */
export function unitPriceCts(item: MenuItemDTO, optionIds: string[]): number {
  const selected = new Set(optionIds);
  let total = item.priceCts;
  for (const g of item.groups) {
    for (const o of g.options) {
      if (selected.has(o.id)) total += o.priceDeltaCts;
    }
  }
  return Math.max(0, total);
}

export type GroupProblem = { groupId: string; message: string };

/**
 * Validates a selection against the item's groups. Runs in the sheet to gate
 * the add button, and again on the server where it actually matters.
 */
export function validateSelection(item: MenuItemDTO, optionIds: string[]): GroupProblem[] {
  const selected = new Set(optionIds);
  const problems: GroupProblem[] = [];

  for (const g of item.groups) {
    const n = g.options.filter((o) => selected.has(o.id)).length;
    if (n < g.minSelect) {
      problems.push({
        groupId: g.id,
        message:
          g.minSelect === 1 && g.maxSelect === 1
            ? `Choose a ${g.name.toLowerCase()}`
            : `Choose at least ${g.minSelect}`,
      });
    } else if (n > g.maxSelect) {
      problems.push({ groupId: g.id, message: `Choose up to ${g.maxSelect}` });
    }
  }

  // An option that belongs to no group on this item is not a valid choice.
  const known = new Set(item.groups.flatMap((g) => g.options.map((o) => o.id)));
  if (optionIds.some((id) => !known.has(id))) {
    problems.push({ groupId: "", message: "Some choices are no longer on the menu." });
  }

  return problems;
}

/** The options a sheet should start with: every single-select group's default. */
export function defaultSelection(item: MenuItemDTO): string[] {
  const out: string[] = [];
  for (const g of item.groups) {
    if (g.maxSelect !== 1) continue;
    const pick = g.options.find((o) => o.isDefault) ?? (g.minSelect > 0 ? g.options[0] : undefined);
    if (pick) out.push(pick.id);
  }
  return out;
}

/** Short human summary of the choices, for the cart row. "Large · Oat milk" */
export function summarizeSelection(item: MenuItemDTO, optionIds: string[]): string {
  const selected = new Set(optionIds);
  const names: string[] = [];
  for (const g of item.groups) {
    for (const o of g.options) {
      if (selected.has(o.id)) names.push(o.name);
    }
  }
  return names.join(" · ");
}
