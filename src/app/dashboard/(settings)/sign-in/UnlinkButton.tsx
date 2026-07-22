"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Button } from "@/components/hearth/ui";
import { unlinkProviderAction } from "./actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Disconnecting…" : label}
    </Button>
  );
}

export default function UnlinkButton({
  provider,
  label,
}: {
  provider: "google" | "apple";
  label: string;
}) {
  const [state, action] = useFormState(unlinkProviderAction, undefined);

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <input type="hidden" name="provider" value={provider} />
      <Submit label={label} />
      {state?.error && <p className="text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="max-w-[280px] text-right text-[12px] text-accent">{state.ok}</p>}
    </form>
  );
}
