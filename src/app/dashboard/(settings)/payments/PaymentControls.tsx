"use client";

import { useFormState, useFormStatus } from "react-dom";
import {
  startStripeOnboardingAction,
  refreshStripeStatusAction,
  setCardPaymentsAction,
  setDeliveryAction,
} from "@/app/dashboard/actions";
import { Button } from "@/components/hearth/ui";

function Pending({ idle, busy, variant = "primary", disabled }: {
  idle: string;
  busy: string;
  variant?: "primary" | "outline";
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <Button variant={variant} disabled={pending || disabled}>
      {pending ? busy : idle}
    </Button>
  );
}

/** Connect onboarding + refresh. Redirects on success; surfaces errors inline. */
export function ConnectControls({
  started,
  connected,
  stubbed,
}: {
  started: boolean;
  connected: boolean;
  stubbed: boolean;
}) {
  const [startState, startAction] = useFormState(startStripeOnboardingAction, undefined);
  const [refreshState, refreshAction] = useFormState(refreshStripeStatusAction, undefined);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {!connected && (
          <form action={startAction}>
            <Pending
              idle={started ? "Continue Stripe setup" : "Connect with Stripe"}
              busy="Opening Stripe…"
              disabled={stubbed}
            />
          </form>
        )}
        {started && (
          <form action={refreshAction}>
            <Pending idle="Refresh status" busy="Checking…" variant="outline" disabled={stubbed} />
          </form>
        )}
      </div>
      {(startState?.error || refreshState?.error) && (
        <p className="mt-2 text-[12px] text-badInk">{startState?.error ?? refreshState?.error}</p>
      )}
      {refreshState?.ok && <p className="mt-2 text-[12px] text-accent">{refreshState.ok}</p>}
    </>
  );
}

/** The card-payments on/off switch. */
export function CardPaymentsToggle({ enabled }: { enabled: boolean }) {
  const [state, action] = useFormState(setCardPaymentsAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Pending
        idle={enabled ? "Turn card payments off" : "Turn card payments on"}
        busy="Saving…"
        variant="outline"
      />
      {state?.error && <p className="mt-2 text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-[12px] text-accent">{state.ok}</p>}
    </form>
  );
}

/** The delivery on/off switch. Stores intent — nothing serves it yet. */
export function DeliveryToggle({ enabled }: { enabled: boolean }) {
  const [state, action] = useFormState(setDeliveryAction, undefined);
  return (
    <form action={action}>
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <Pending
        idle={enabled ? "Turn delivery off" : "Turn delivery on"}
        busy="Saving…"
        variant="outline"
      />
      {state?.error && <p className="mt-2 text-[12px] text-badInk">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-[12px] text-accent">{state.ok}</p>}
    </form>
  );
}
