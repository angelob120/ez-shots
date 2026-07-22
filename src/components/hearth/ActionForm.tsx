"use client";

import * as React from "react";
import { useFormState } from "react-dom";

type Result = { ok?: string; error?: string } | undefined;
type Action = (prev: Result, formData: FormData) => Promise<Result>;

/**
 * A `<form>` around a server action that has something to say back.
 *
 * React requires a form's `action` to return void, so an action that returns
 * `{ ok }` or `{ error }` has to go through `useFormState` — which needs a
 * client component. Rather than convert every panel that has one small form
 * into a client component, this is the one small client component they all
 * borrow.
 *
 * The alternative, making these actions return void, would work and would be
 * shorter. It would also mean "that's the 100-tag limit" and "that name needs
 * a letter in it" both render as the form quietly doing nothing, which is the
 * failure mode people file bug reports about rather than reading a message.
 */
export default function ActionForm({
  action,
  children,
  className,
  /** Where the message goes. Inline suits a row; block suits a panel. */
  messageClassName = "mt-1 text-[12px]",
}: {
  action: Action;
  children: React.ReactNode;
  className?: string;
  messageClassName?: string;
}) {
  const [state, formAction] = useFormState<Result, FormData>(action, undefined);

  return (
    <form action={formAction} className={className}>
      {children}
      {(state?.error || state?.ok) && (
        <p
          role="status"
          className={`${messageClassName} ${state.error ? "text-badInk" : "text-dim"}`}
        >
          {state.error ?? state.ok}
        </p>
      )}
    </form>
  );
}
