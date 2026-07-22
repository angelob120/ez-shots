"use client";

import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import { loginAction } from "./actions";
import { Button, Field, Input } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export default function LoginForm({ next }: { next: string }) {
  const [state, action] = useFormState(loginAction, undefined);

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" placeholder="you@restaurant.com" required />
      </Field>
      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>
      <div className="text-right">
        <Link
          href="/forgot-password"
          className="text-[12px] text-dim underline underline-offset-2 hover:text-ink"
        >
          Forgot password?
        </Link>
      </div>
      {state?.error && (
        <p className="rounded-sm border border-[#5a2723] bg-[#1c1210] px-3 py-2 text-[12px] text-[#f08a80]">
          {state.error}
        </p>
      )}
      <Submit />
    </form>
  );
}
