import { Card, Button } from "@/components/hearth/ui";
import { addOnboardingNoteAction, deleteOnboardingNoteAction } from "../../actions";

/**
 * An admin-only note stream for one tenant. Used twice with different `kind`:
 * "onboarding" notes while we get them live, "account" notes once they're
 * trading. Both are ours — nothing under `src/app/dashboard/` reads them.
 * Fully server-rendered; every control is a form posting a server action.
 */

type NoteRow = {
  id: string;
  body: string;
  authorName: string | null;
  createdAt: string;
};

const inputCls =
  "w-full rounded-sm border border-line2 bg-surface2 px-2 py-1.5 text-[12px] text-ink outline-none focus:border-accentDim";

export default function NotesPanel({
  restaurantId,
  kind,
  title,
  blurb,
  placeholder,
  notes,
}: {
  restaurantId: string;
  kind: "onboarding" | "account";
  title: string;
  blurb: string;
  placeholder: string;
  notes: NoteRow[];
}) {
  return (
    <Card>
      <div className="mx-auto max-w-2xl">
        <h3 className="mb-1 text-[14px] font-semibold text-ink">{title}</h3>
        <p className="mb-3 text-[12px] leading-relaxed text-mute">{blurb}</p>

        <form action={addOnboardingNoteAction} className="space-y-2">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <input type="hidden" name="kind" value={kind} />
          <textarea
            name="body"
            rows={3}
            required
            placeholder={placeholder}
            className={`${inputCls} resize-y`}
          />
          <div className="flex justify-end">
            <Button size="sm">Add note</Button>
          </div>
        </form>

        <div className="mt-5 space-y-3">
          {notes.length === 0 ? (
            <p className="text-[12px] text-mute">No notes yet.</p>
          ) : (
            notes.map((n) => (
              <div key={n.id} className="border-b border-line pb-3 last:border-0">
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">
                  {n.body}
                </p>
                <div className="mt-1 flex items-center justify-between text-[10.5px] text-dim">
                  <span>
                    {n.authorName ?? "admin"} · {n.createdAt}
                  </span>
                  <form action={deleteOnboardingNoteAction}>
                    <input type="hidden" name="id" value={n.id} />
                    <input type="hidden" name="restaurantId" value={restaurantId} />
                    <button
                      type="submit"
                      className="text-dim hover:text-badInk"
                      aria-label="Delete note"
                    >
                      Delete
                    </button>
                  </form>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </Card>
  );
}
