"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addContactNoteAction, addTicketNoteAction } from "./actions";
import { Button, Textarea } from "@/components/hearth/ui";

/**
 * Internal notes. Nothing here is ever rendered on an owner surface — these
 * rows live in `SupportNote`, a table no `/dashboard` query touches.
 *
 * Append-only, and the UI says so. A note you can quietly rewrite afterwards is
 * worth nothing in the conversation it exists for, which is usually the one
 * six months later about why we did what we did.
 */

type Note = {
  id: string;
  body: string;
  authorEmail: string | null;
  createdAt: Date;
};

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant="outline" disabled={pending}>
      {pending ? "Saving…" : "Add note"}
    </Button>
  );
}

export default function NoteBox({
  target,
  notes,
}: {
  target: { ticketId: string } | { contactId: string };
  notes: Note[];
}) {
  const isTicket = "ticketId" in target;
  const [state, action] = useFormState(
    isTicket ? addTicketNoteAction : addContactNoteAction,
    undefined
  );

  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-[14px] font-semibold text-ink">Internal notes</h3>
        <span className="text-[11px] text-mute">Never shown to the owner</span>
      </div>

      <form action={action} className="mb-4 grid gap-2">
        {isTicket ? (
          <input type="hidden" name="ticketId" value={target.ticketId} />
        ) : (
          <input type="hidden" name="contactId" value={target.contactId} />
        )}
        <Textarea
          name="body"
          rows={3}
          required
          placeholder="Reproduced on staging — refund button posts but the provider call 500s. Same root cause as #1043."
        />
        {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
        <div>
          <Submit />
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="text-[12.5px] text-mute">No notes yet.</p>
      ) : (
        <ul className="space-y-2.5">
          {notes.map((n) => (
            <li key={n.id} className="rounded-sm border border-line bg-base px-3 py-2.5">
              <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px] text-mute">
                <span>{n.authorEmail ?? "unknown"}</span>
                <span>
                  {n.createdAt.toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-dim">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
