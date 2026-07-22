"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { fileTicketAction } from "./actions";
import { Button, Card, Field, Input, Select, Textarea } from "@/components/hearth/ui";
// From `support-labels`, not `support` — this is a client component and that
// module is `server-only`. See the comment at the top of the labels file.
import { CATEGORIES, CATEGORY_LABELS, PRIORITIES, PRIORITY_LABELS } from "@/lib/support-labels";

function Submit() {
  const { pending } = useFormStatus();
  return <Button disabled={pending}>{pending ? "Sending…" : "Send it"}</Button>;
}

/**
 * Collapsed by default. The support page's main job is showing an owner where
 * their existing tickets stand — a form occupying the first screen makes
 * "file another one" the obvious action even when the answer is already
 * sitting two inches below it.
 */
export default function NewTicketForm({
  defaultName,
  defaultEmail,
}: {
  defaultName: string;
  defaultEmail: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useFormState(fileTicketAction, undefined);

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} variant="primary">
        Report a problem
      </Button>
    );
  }

  return (
    <Card className="mb-6">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">Report a problem</h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-mute hover:text-ink"
        >
          Cancel
        </button>
      </div>

      <form action={action} className="grid gap-4">
        <Field label="What's it about">
          <Select name="category" defaultValue="BUG">
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Short title">
          <Input name="subject" maxLength={140} required placeholder="Refund button does nothing" />
        </Field>

        <Field label="What happened" hint="What you did, what you expected, what you got instead.">
          <Textarea
            name="body"
            rows={6}
            required
            placeholder="I hit Refund on order 1042 and the page reloaded with the order still showing as paid…"
          />
        </Field>

        <Field label="How urgent" hint="Be honest — this is what decides the order we work in.">
          <Select name="priority" defaultValue="NORMAL">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {PRIORITY_LABELS[p]}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name">
            <Input name="contactName" defaultValue={defaultName} maxLength={120} />
          </Field>
          <Field label="Reply to" hint="Where we'll answer if you're not logged in.">
            <Input name="contactEmail" type="email" defaultValue={defaultEmail} maxLength={120} />
          </Field>
        </div>

        {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
        <div>
          <Submit />
        </div>
      </form>
    </Card>
  );
}
