import Link from "next/link";
import { deleteSegmentAction, saveSegmentAction } from "@/app/dashboard/actions";
import ActionForm from "@/components/hearth/ActionForm";

/**
 * Saved segments — a named filter combination.
 *
 * A segment is nothing but this page's query string with a label on it, which
 * is the whole reason the filter bar is a GET form. Opening one navigates to
 * the identical URL somebody would have reached by clicking, so there is no
 * second code path that could disagree about what "lapsed VIPs" means.
 *
 * The save control only appears when something is actually filtered. A segment
 * that matches everyone is a button that visibly does nothing, and offering to
 * create one is how a list of useless segments accumulates.
 */
export default function SegmentBar({
  segments,
  query,
  filtering,
}: {
  segments: { id: string; name: string; query: string }[];
  /** The current filters, already normalised by `filtersToQuery`. */
  query: string;
  filtering: boolean;
}) {
  if (segments.length === 0 && !filtering) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {segments.length > 0 && <span className="text-[12px] text-mute">Segments</span>}

      {segments.map((s) => (
        <span key={s.id} className="inline-flex items-center gap-1 rounded-full border border-line2 px-2 py-0.5">
          <Link href={`/dashboard/customers?${s.query}`} className="text-[12px] text-ink hover:text-accent">
            {s.name}
          </Link>
          <ActionForm action={deleteSegmentAction} className="flex">
            <input type="hidden" name="segmentId" value={s.id} />
            <button
              type="submit"
              aria-label={`Delete segment ${s.name}`}
              className="px-0.5 text-[12px] leading-none text-mute hover:text-badInk"
            >
              ×
            </button>
          </ActionForm>
        </span>
      ))}

      {filtering && (
        <ActionForm action={saveSegmentAction} className="ml-auto flex items-center gap-1">
          <input type="hidden" name="query" value={query} />
          <input
            name="name"
            placeholder="Save these filters as…"
            maxLength={60}
            required
            className="h-8 w-[190px] rounded-sm border border-line2 bg-surface px-2 text-[12px] text-ink outline-none placeholder:text-mute focus:border-accent"
          />
          <button type="submit" className="h-8 rounded-sm border border-line2 px-2 text-[12px] text-dim hover:text-ink">
            Save
          </button>
        </ActionForm>
      )}
    </div>
  );
}
