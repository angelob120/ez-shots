"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { requestResetAction } from "./actions";
import { Button, Field, Input } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Send reset link"}
    </Button>
  );
}

export default function ForgotForm() {
  const [state, action] = useFormState(requestResetAction, undefined);

  // Same screen regardless of whether the address exists — see the action.
  if (state?.done) {
    return (
      <div className="space-y-4">
        <div className="rounded-sm border border-goodLine bg-goodBg px-4 py-3 text-[13px] leading-relaxed text-accent">
          If an account exists for that email, we&apos;ve sent a link to reset your password. It
          expires in an hour.
        </div>
        <p className="text-[13px] leading-relaxed text-dim">
          Didn&apos;t get it? Check your spam folder, or wait a minute and{" "}
          <Link href="/forgot-password" className="text-ink underline underline-offset-2">
            try again
          </Link>
          .
        </p>
        <p className="text-center text-[13px] text-dim">
          <Link href="/login" className="text-ink underline underline-offset-2">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <Field label="Email">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@restaurant.com"
          required
        />
      </Field>
      {state?.error && (
        <p className="rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] text-badInk">
          {state.error}
        </p>
      )}
      <Submit />
      <p className="text-center text-[13px] text-dim">
        Remembered it?{" "}
        <Link href="/login" className="text-ink underline underline-offset-2">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
