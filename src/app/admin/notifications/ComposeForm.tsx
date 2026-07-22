"use client";

import { useFormState } from "react-dom";
import { Button, Field, Input, Select, Textarea } from "@/components/hearth/ui";
import { composeAction, type ComposeResult } from "./actions";

/**
 * Send a notification by hand: a platform announcement to owners or admins, or
 * a reminder to yourself surfaced at a chosen time. Goes through `notify()`
 * like every other alert, so a recipient's channel preferences still apply — a
 * broadcast is not a way around someone's muted email.
 */
export default function ComposeForm() {
  const [state, action] = useFormState<ComposeResult | undefined, FormData>(
    composeAction,
    undefined
  );

  return (
    <form action={action} className="max-w-xl space-y-4">
      <Field label="Send to">
        <Select name="audience" defaultValue="owners">
          <option value="owners">All owners</option>
          <option value="admins">All admins</option>
          <option value="me">Just me (a reminder)</option>
        </Select>
      </Field>

      <Field label="Title">
        <Input name="title" placeholder="Scheduled maintenance Sunday" required />
      </Field>

      <Field label="Message">
        <Textarea name="body" rows={4} placeholder="What you want them to know…" required />
      </Field>

      <Field
        label="Surface at (optional)"
        hint="Leave blank to send now. A future time holds it until then — useful for reminders."
      >
        <Input type="datetime-local" name="scheduledFor" />
      </Field>

      <div className="flex items-center gap-3">
        <Button type="submit">Send</Button>
        {state && (
          <span className={`text-[13px] ${state.ok ? "text-good" : "text-badInk"}`}>
            {state.message}
          </span>
        )}
      </div>
    </form>
  );
}
