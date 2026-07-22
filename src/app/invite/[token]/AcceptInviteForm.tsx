"use client";

import { useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { acceptInviteAction } from "./actions";
import { Button, Field, Input } from "@/components/hearth/ui";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Setting up…" : "Create my login"}
    </Button>
  );
}

export default function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useFormState(acceptInviteAction, undefined);
  const [password, setPassword] = useState("");

  // Length is the only rule we enforce, so it's the only one we show. A meter
  // that demands a symbol teaches people to append "!" and nothing else.
  const tooShort = password.length > 0 && password.length < 8;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      <Field label="Email" hint="This is the address the invite was sent to.">
        <Input value={email} readOnly disabled className="opacity-60" />
      </Field>

      <Field label="Your name" hint="Optional — it's how we address you in the dashboard.">
        <Input name="name" autoComplete="name" placeholder="Angelo" />
      </Field>

      <Field label="Choose a password" hint="At least 8 characters.">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>

      {tooShort && <p className="text-[11px] text-warn">A few more characters.</p>}

      {state?.error && (
        <p className="rounded-sm border border-[#5a2723] bg-[#1c1210] px-3 py-2 text-[12px] text-[#f08a80]">
          {state.error}
        </p>
      )}

      <Submit />

      <p className="text-center text-[11px] leading-relaxed text-mute">
        Setting a password creates your account and signs you in.
      </p>
    </form>
  );
}
