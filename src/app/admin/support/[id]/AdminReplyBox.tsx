"use client";

import { useFormState, useFormStatus } from "react-dom";
import { adminReplyAction } from "../actions";
import { Button, Textarea } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Sending…" : "Send reply"}</Button>;
}

export default function AdminReplyBox({ ticketId }: { ticketId: string }) {
  const [state, action] = useFormState(adminReplyAction, undefined);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <Textarea name="body" rows={5} required placeholder="Write to the owner…" />
      <p className="text-[11.5px] text-mute">
        The owner sees this on their dashboard. Sending moves the ticket to{" "}
        <span className="text-dim">waiting on owner</span> — use a note instead if you&rsquo;re
        recording something for yourself.
      </p>
      {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="text-[12px] text-accent">{state.ok}</p>}
      <div>
        <Submit />
      </div>
    </form>
  );
}
