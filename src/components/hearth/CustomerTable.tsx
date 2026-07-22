"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Table, Td, Th } from "@/components/hearth/ui";
import TagChip from "@/components/hearth/TagChip";

/**
 * The owner's customer list, with selection and bulk tagging.
 *
 * A client component because selection is client state and nothing else. The
 * rows are rendered from props the server already fetched — this does not
 * fetch, filter or sort anything, because a second implementation of "which
 * customers match" is precisely what `lib/customers.ts` exists to prevent, and
 * a client-side filter would only ever see the fifty rows on this page.
 *
 * Two bulk scopes, deliberately distinguished in the UI. "Selected" acts on
 * the checkboxes; "all N matching" acts on the whole filtered set, including
 * rows on pages nobody has looked at. They're one click apart and one is much
 * larger, so the second states its count in the button and posts the *filter*
 * rather than a list of ids — the server recomputes the set inside the tenant
 * scope. See `bulkTagAction`.
 */

export type Row = {
  id: string;
  name: string | null;
  phone: string;
  phoneDisplay: string;
  optInStatus: "UNKNOWN" | "OPTED_IN" | "OPTED_OUT";
  cohort: "TREATMENT" | "HOLDOUT";
  orderCount: number;
  lifetime: string;
  lastOrderLabel: string;
  imported: boolean;
  tags: { id: string; name: string; color: string }[];
};

export default function CustomerTable({
  rows,
  tags,
  total,
  bulkAction,
  href = "/dashboard/customers",
}: {
  rows: Row[];
  tags: { id: string; name: string; color: string }[];
  /** How many rows the current filter matches in total, across all pages. */
  total: number;
  bulkAction: (formData: FormData) => Promise<{ ok?: string; error?: string } | undefined>;
  href?: string;
}) {
  const params = useSearchParams();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [msg, setMsg] = React.useState<string | null>(null);

  // Selection is per-page and is dropped when the filter changes. Carrying it
  // across a filter change would let somebody select 40 people, narrow the
  // list, and act on rows that are no longer on screen.
  const key = params.toString();
  React.useEffect(() => setSelected(new Set()), [key]);

  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function run(formData: FormData) {
    const res = await bulkAction(formData);
    setMsg(res?.error ?? res?.ok ?? null);
    setSelected(new Set());
  }

  const showBulk = selected.size > 0 && tags.length > 0;

  return (
    <>
      {showBulk && (
        <form
          action={run}
          className="mb-3 flex flex-wrap items-center gap-2 rounded-sm border border-accent/40 bg-surface2 p-2"
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="customerId" value={id} />
          ))}
          <input type="hidden" name="query" value={key} />

          <span className="text-[13px] text-ink">
            {selected.size} selected
          </span>

          <select
            name="tagId"
            aria-label="Tag to apply"
            className="h-8 rounded-sm border border-line2 bg-surface px-2 text-[13px] text-ink"
          >
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <button
            type="submit"
            name="mode"
            value="add"
            className="h-8 rounded-sm border border-line2 px-3 text-[13px] text-ink hover:border-accent"
          >
            Tag selected
          </button>
          <button
            type="submit"
            name="mode"
            value="remove"
            className="h-8 rounded-sm border border-line2 px-3 text-[13px] text-dim hover:text-ink"
          >
            Remove tag
          </button>

          {total > rows.length && (
            <button
              type="submit"
              name="scope"
              value="matching"
              formNoValidate
              className="h-8 rounded-sm border border-line2 px-3 text-[13px] text-dim hover:text-ink"
              // Stated as a count rather than "all", because "all" reads as
              // "all my customers" and this is "all that match the filter".
              title="Applies to every customer the current filters match, including pages you haven't opened"
            >
              Tag all {total.toLocaleString()} matching
            </button>
          )}

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-[12px] text-dim underline underline-offset-2 hover:text-ink"
          >
            Clear selection
          </button>
        </form>
      )}

      {msg && (
        <p className="mb-3 text-[13px] text-dim" role="status">
          {msg}
        </p>
      )}

      <Table>
        <thead>
          <tr>
            <Th>
              <input
                type="checkbox"
                checked={allOnPage}
                onChange={() =>
                  setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))
                }
                aria-label="Select every customer on this page"
                className="h-3.5 w-3.5 accent-accentFill"
              />
            </Th>
            <Th>Customer</Th>
            <Th>Tags</Th>
            <Th>Texts</Th>
            <Th className="text-right">Orders</Th>
            <Th className="text-right">Lifetime</Th>
            <Th>Last order</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} data-selected={selected.has(c.id) || undefined}>
              <Td>
                <input
                  type="checkbox"
                  checked={selected.has(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={`Select ${c.name || c.phoneDisplay}`}
                  className="h-3.5 w-3.5 accent-accentFill"
                />
              </Td>
              <Td>
                <Link href={`${href}/${c.id}`} className="font-medium text-ink hover:text-accent">
                  {c.name || "—"}
                </Link>
                <div className="font-mono text-[11px] text-mute">{c.phoneDisplay}</div>
              </Td>
              <Td>
                <div className="flex flex-wrap gap-1">
                  {c.tags.slice(0, 3).map((t) => (
                    <TagChip key={t.id} name={t.name} color={t.color} />
                  ))}
                  {c.tags.length > 3 && (
                    <span className="text-[11px] text-mute">+{c.tags.length - 3}</span>
                  )}
                </div>
              </Td>
              <Td>
                <span
                  className={
                    c.optInStatus === "OPTED_IN"
                      ? "text-[12px] text-good"
                      : c.optInStatus === "OPTED_OUT"
                        ? "text-[12px] text-badInk"
                        : "text-[12px] text-dim"
                  }
                >
                  {c.optInStatus === "OPTED_IN"
                    ? "Opted in"
                    : c.optInStatus === "OPTED_OUT"
                      ? "Opted out"
                      : "No consent"}
                </span>
              </Td>
              <Td className="text-right font-mono tabular-nums">{c.orderCount}</Td>
              <Td className="text-right font-mono tabular-nums">{c.lifetime}</Td>
              <Td className="text-dim">{c.lastOrderLabel}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
