"use client";

import { useFormState, useFormStatus } from "react-dom";

import { Button, Input, cx } from "@/components/hearth/ui";
import {
  acceptUpdateAction,
  activateAutomationAction,
  adoptTemplateAction,
  archiveAutomationAction,
  cancelEnrollmentAction,
  createAutomationAction,
  detachAction,
  dismissUpdateAction,
  pauseAutomationAction,
  resumeAutomationAction,
} from "./actions";

/**
 * The small forms around the builder.
 *
 * Each is a plain form posting to a server action. Nothing here holds state
 * that matters — the truth is whatever the next render reads out of the
 * database, the same pattern `/admin/tools` uses.
 */

type Result = { ok?: string; error?: string } | undefined;

function Submit({
  children,
  variant = "outline",
  confirm,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "ghost" | "danger";
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      size="sm"
      variant={variant}
      disabled={pending}
      onClick={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault(); } : undefined}
    >
      {pending ? "Working…" : children}
    </Button>
  );
}

function Outcome({ state }: { state: Result }) {
  if (!state?.ok && !state?.error) return null;
  return (
    <span className={cx("text-[12px]", state.error ? "text-badInk" : "text-accent")}>
      {state.error ?? state.ok}
    </span>
  );
}

export function NewAutomationForm() {
  const [state, action] = useFormState(createAutomationAction, undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <Input name="name" placeholder="Name this journey" className="max-w-xs" />
      <Submit variant="primary">Start from scratch</Submit>
      <Outcome state={state} />
    </form>
  );
}

export function AdoptButton({ templateId }: { templateId: string }) {
  const [state, action] = useFormState(adoptTemplateAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="templateId" value={templateId} />
      <Submit>Use this</Submit>
      <Outcome state={state} />
    </form>
  );
}

/**
 * Activate / pause / resume, plus archive.
 *
 * Pause and archive are deliberately different words on screen because they are
 * different acts: pausing stops new entrants and leaves people mid-journey
 * alone, archiving takes everyone out. Archive asks first, since it is the one
 * that ends something already in motion.
 */
export function LifecycleControls({
  id,
  status,
}: {
  id: string;
  status: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
}) {
  const [activateState, activate] = useFormState(activateAutomationAction, undefined);
  const [pauseState, pause] = useFormState(pauseAutomationAction, undefined);
  const [resumeState, resume] = useFormState(resumeAutomationAction, undefined);
  const [archiveState, archive] = useFormState(archiveAutomationAction, undefined);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {status !== "ACTIVE" && status !== "ARCHIVED" ? (
        <form action={activate} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Submit variant="primary">{status === "PAUSED" ? "Re-publish" : "Switch on"}</Submit>
          <Outcome state={activateState} />
        </form>
      ) : null}

      {status === "ACTIVE" ? (
        <form action={pause} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Submit>Pause</Submit>
          <Outcome state={pauseState} />
        </form>
      ) : null}

      {status === "PAUSED" ? (
        <form action={resume} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Submit>Resume</Submit>
          <Outcome state={resumeState} />
        </form>
      ) : null}

      {status !== "ARCHIVED" ? (
        <form action={archive} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <Submit variant="danger" confirm="Archive this journey? Anyone part-way through will be taken out of it.">
            Archive
          </Submit>
          <Outcome state={archiveState} />
        </form>
      ) : null}
    </div>
  );
}

export function TemplateUpdateBanner({ id, notes }: { id: string; notes: string | null }) {
  const [acceptState, accept] = useFormState(acceptUpdateAction, undefined);
  const [dismissState, dismiss] = useFormState(dismissUpdateAction, undefined);

  return (
    <div className="rounded-sm border border-accentDim bg-surface2 px-3 py-2.5">
      <p className="text-[12px] text-ink">There&rsquo;s a newer version of this template.</p>
      {notes ? <p className="mt-0.5 text-[12px] text-dim">{notes}</p> : null}
      <p className="mt-0.5 text-[11px] text-mute">
        Taking it changes what the next person to enter walks. Anyone already in the journey finishes the version they
        started.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <form action={accept}>
          <input type="hidden" name="id" value={id} />
          <Submit variant="primary">Take the update</Submit>
        </form>
        <form action={dismiss}>
          <input type="hidden" name="id" value={id} />
          <Submit variant="ghost">Keep mine</Submit>
        </form>
        <Outcome state={acceptState ?? dismissState} />
      </div>
    </div>
  );
}

export function DetachButton({ id }: { id: string }) {
  const [state, action] = useFormState(detachAction, undefined);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <Submit confirm="Make this yours? It will stop receiving our updates.">Make a copy I control</Submit>
      <Outcome state={state} />
    </form>
  );
}

export function CancelEnrollmentButton({ id, enrollmentId }: { id: string; enrollmentId: string }) {
  const [state, action] = useFormState(cancelEnrollmentAction, undefined);
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="enrollmentId" value={enrollmentId} />
      <Submit variant="ghost">Take out</Submit>
      <Outcome state={state} />
    </form>
  );
}
