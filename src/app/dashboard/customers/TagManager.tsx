import { Card } from "@/components/hearth/ui";
import TagChip from "@/components/hearth/TagChip";
import { TAG_COLORS, type TagSummary } from "@/lib/customers";
import { createTagAction, deleteTagAction, setTagColorAction } from "@/app/dashboard/actions";
import ActionForm from "@/components/hearth/ActionForm";

/**
 * Create, recolour and delete tags.
 *
 * A `<details>` rather than a permanent panel: tags get made once and used for
 * months, so the management UI shouldn't occupy space above a list somebody
 * opens every day to look at customers.
 *
 * The count next to each tag is the point of showing them all together. A tag
 * on two people out of three thousand is almost always a misspelling of one on
 * four hundred, and side by side is the only way an owner ever notices.
 *
 * System tags (the automatic per-import ones) can be deleted but not renamed —
 * their name records which upload produced those rows, and a rename makes the
 * import history lie.
 */
export default function TagManager({ tags }: { tags: TagSummary[] }) {
  return (
    <Card className="mb-6">
      <details>
        <summary className="cursor-pointer list-none text-[14px] font-semibold text-ink">
          Tags{" "}
          <span className="font-normal text-mute">
            — {tags.length === 0 ? "none yet" : `${tags.length} in use`}
          </span>
        </summary>

        <div className="mt-4 space-y-4">
          <ActionForm action={createTagAction} className="flex flex-wrap items-center gap-2">
            <input
              name="name"
              placeholder="New tag — VIP, Catering, Complained"
              maxLength={32}
              required
              className="h-9 min-w-[220px] flex-1 rounded-sm border border-line2 bg-surface px-3 text-[13px] text-ink outline-none placeholder:text-mute focus:border-accent"
            />
            <select
              name="color"
              aria-label="Tag colour"
              className="h-9 rounded-sm border border-line2 bg-surface px-3 text-[13px] text-ink"
            >
              {TAG_COLORS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="h-9 rounded-sm border border-line2 px-3 text-[13px] text-ink hover:border-accent"
            >
              Add tag
            </button>
          </ActionForm>

          {tags.length > 0 && (
            <ul className="space-y-1.5">
              {tags.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2">
                  <TagChip name={t.name} color={t.color} />
                  <span className="text-[12px] tabular-nums text-mute">
                    {t.count.toLocaleString()} customer{t.count === 1 ? "" : "s"}
                  </span>
                  {t.system && (
                    <span className="text-[11px] text-mute" title="Created automatically by an import">
                      auto
                    </span>
                  )}

                  <ActionForm action={setTagColorAction} className="ml-auto flex items-center gap-1">
                    <input type="hidden" name="tagId" value={t.id} />
                    <select
                      name="color"
                      defaultValue={t.color}
                      aria-label={`Colour for ${t.name}`}
                      className="h-7 rounded-sm border border-line2 bg-surface px-2 text-[12px] text-dim"
                    >
                      {TAG_COLORS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <button type="submit" className="text-[12px] text-dim underline underline-offset-2 hover:text-ink">
                      Apply
                    </button>
                  </ActionForm>

                  <ActionForm action={deleteTagAction}>
                    <input type="hidden" name="tagId" value={t.id} />
                    <button type="submit" className="text-[12px] text-dim underline underline-offset-2 hover:text-badInk">
                      Delete
                    </button>
                  </ActionForm>
                </li>
              ))}
            </ul>
          )}

          <p className="text-[12px] leading-relaxed text-mute">
            Deleting a tag removes the label, never the customers. Tags are for organising your own
            list — they don&apos;t affect who can be texted.
          </p>
        </div>
      </details>
    </Card>
  );
}
