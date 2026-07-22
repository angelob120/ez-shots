"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { completeResetAction } from "./actions";
import { Button, Field, Input } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Set new password"}
    </Button>
  );
}

export default function ResetForm({ token }: { token: string }) {
  const [state, action] = useFormState(completeResetAction, undefined);

  if (state?.done) {
    return (
      <div className="space-y-4">
        <div className="rounded-sm border border-goodLine bg-goodBg px-4 py-3 text-[13px] leading-relaxed text-accent">
          Your password has been changed. You can sign in with it now.
        </div>
        <Link href="/login">
          <Button className="w-full">Go to sign in</Button>
        </Link>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" hint="At least 8 characters.">
        <Input name="password" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      <Field label="Confirm new password">
        <Input name="confirm" type="password" autoComplete="new-password" required minLength={8} />
      </Field>
      {state?.error && (
        <p className="rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
