import Link from "next/link";
import { Card } from "@/components/hearth/ui";
import { undoImportAction } from "@/app/dashboard/actions";
import ActionForm from "@/components/hearth/ActionForm";

type Job = {
  id: string;
  filename: string | null;
  created: number;
  updated: number;
  skipped: number;
  undoneAt: Date | null;
  undoneCount: number | null;
  createdAt: Date;
  tag: { id: string; name: string; slug: string } | null;
};

/**
 * What each upload did, and a way to take it back.
 *
 * The undo button is the reason this exists. An owner who imports the wrong
 * file — the supplier list instead of the customer list, or last year's export
 * on top of this year's — currently has no way back, and the alternative to a
 * button is us running a delete against their database from a support ticket.
 *
 * What it removes is stated on the button rather than in a tooltip, because
 * the fear is specific: the owner is not worried about the 900 contacts, they
 * are worried about the regulars. Undo only ever deletes rows the import
 * *created* which have never placed an order — see `undoImport`.
 */
export default function ImportHistory({ jobs }: { jobs: Job[] }) {
  if (jobs.length === 0) return null;

  return (
    <Card className="mb-6">
      <details>
        <summary className="cursor-pointer list-none text-[14px] font-semibold text-ink">
          Import history <span className="font-normal text-mute">— {jobs.length} upload{jobs.length === 1 ? "" : "s"}</span>
        </summary>

        <ul className="mt-4 space-y-2">
          {jobs.map((j) => (
            <li key={j.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line2 pb-2 last:border-0">
              <span className="text-[13px] text-ink">{j.filename ?? "Customer list"}</span>
              <span className="text-[12px] text-mute">{j.createdAt.toISOString().slice(0, 10)}</span>
              <span className="text-[12px] tabular-nums text-dim">
                {j.created} new, {j.updated} updated, {j.skipped} unchanged
              </span>

              {j.tag && (
                <Link
                  href={`/dashboard/customers?tag=${encodeURIComponent(j.tag.slug)}`}
                  className="text-[12px] text-accent underline underline-offset-2"
                >
                  See these customers
                </Link>
              )}

              {j.undoneAt ? (
                <span className="ml-auto text-[12px] text-mute">
                  Undone — {j.undoneCount ?? 0} removed
                </span>
              ) : j.created > 0 ? (
                <ActionForm action={undoImportAction} className="ml-auto">
                  <input type="hidden" name="jobId" value={j.id} />
                  <button
                    type="submit"
                    className="text-[12px] text-dim underline underline-offset-2 hover:text-badInk"
                    title="Removes only the contacts this file created, and only those who have never ordered"
                  >
                    Undo this import
                  </button>
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[12px] leading-relaxed text-mute">
          Undo removes only the contacts an upload created, and only those who have never placed an
          order. Anyone who has ordered since is kept — they stopped being a spreadsheet row the
          moment they became a customer.
        </p>
      </details>
    </Card>
  );
}
