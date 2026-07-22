"use client";

import { useFormState, useFormStatus } from "react-dom";
import { ownerReplyAction } from "../actions";
import { Button, Textarea } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Sending…" : "Reply"}</Button>;
}

export default function ReplyBox({ ticketId, resolved }: { ticketId: string; resolved: boolean }) {
  const [state, action] = useFormState(ownerReplyAction, undefined);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <Textarea
        name="body"
        rows={4}
        required
        placeholder={
          resolved
            ? "Still happening? Reply and this reopens — no need to file a new one."
            : "Add anything else that might help…"
        }
      />
      {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="text-[12px] text-accent">{state.ok}</p>}
      <div>
        <Submit />
      </div>
    </form>
  );
}
