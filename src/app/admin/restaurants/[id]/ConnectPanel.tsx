"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge, Button, Card } from "@/components/hearth/ui";
import CopyField from "@/components/hearth/CopyField";
import { adminConnectLinkAction, adminRefreshConnectAction } from "../../actions";

function Submit({
  label,
  pendingLabel,
  variant = "outline",
}: {
  label: string;
  pendingLabel: string;
  variant?: "outline" | "primary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant={variant} disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

function Msg({ state }: { state: { error?: string; ok?: string } | undefined }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p
      className={
        state.error
          ? "mt-3 rounded-sm border border-badLine bg-badBg px-3 py-2 text-[12px] leading-relaxed text-badInk"
          : "mt-3 rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] leading-relaxed text-accent"
      }
    >
      {state.error ?? state.ok}
    </p>
  );
}

/**
 * Stripe Connect, driven from our side.
 *
 * The owner has the same two buttons on their own payments page; this exists
 * because the realistic sequence is a phone call. Setting the account up while
 * you're already talking to someone beats talking them through finding a button
 * in a dashboard they've never opened.
 *
 * The link is deliberately *shown* rather than followed. An admin who completes
 * Stripe's identity form is filling in the restaurant's legal details from
 * memory, which is how a Connect account ends up unverifiable.
 */
export default function ConnectPanel({
  restaurantId,
  mode,
  accountId,
  chargesEnabled,
  payoutsEnabled,
  detailsSubmitted,
}: {
  restaurantId: string;
  mode: "LIVE" | "TEST" | "STUB";
  accountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
}) {
  const [linkState, linkAction] = useFormState(adminConnectLinkAction, undefined);
  const [refreshState, refreshAction] = useFormState(adminRefreshConnectAction, undefined);

  const stage = !accountId
    ? "none"
    : chargesEnabled
      ? "live"
      : detailsSubmitted
        ? "review"
        : "started";

  const STAGE: Record<string, { tone: "good" | "warn" | "neutral"; label: string; blurb: string }> = {
    none: {
      tone: "neutral",
      label: "No account",
      blurb: "Nothing exists at Stripe yet. Generating a link creates the connected account and gives you a URL to send.",
    },
    started: {
      tone: "warn",
      label: "Started",
      blurb: "The account exists but the owner hasn't finished Stripe's form. Re-send the link — the old one has almost certainly expired.",
    },
    review: {
      tone: "warn",
      label: "In review",
      blurb: "Details are submitted and Stripe hasn't enabled charges yet. Usually a verification in flight; occasionally they need another document.",
    },
    live: {
      tone: "good",
      label: "Taking cards",
      blurb: "Charges are enabled. Payments land on their account and our surcharge comes back as the application fee.",
    },
  };

  const s = STAGE[stage];

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-semibold text-ink">Stripe Connect</h3>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">{s.blurb}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={s.tone}>{s.label}</Badge>
          <Badge tone={mode === "STUB" ? "neutral" : mode === "LIVE" ? "good" : "warn"}>
            {mode} mode
          </Badge>
        </div>
      </div>

      {accountId && (
        <dl className="mt-4 grid gap-x-8 gap-y-2 text-[12px] sm:grid-cols-2">
          {[
            ["Account", accountId],
            ["Charges", chargesEnabled ? "enabled" : "not yet"],
            ["Payouts", payoutsEnabled ? "enabled" : "not yet"],
            ["Details submitted", detailsSubmitted ? "yes" : "no"],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 border-b border-line py-1.5">
              <dt className="text-mute">{k}</dt>
              <dd className="truncate font-mono text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <form action={linkAction}>
          <input type="hidden" name="id" value={restaurantId} />
          <Submit
            label={accountId ? "New onboarding link" : "Create account & link"}
            pendingLabel="Talking to Stripe…"
            variant="primary"
          />
        </form>

        {accountId && (
          <>
            <form action={refreshAction}>
              <input type="hidden" name="id" value={restaurantId} />
              <Submit label="Refresh status" pendingLabel="Checking…" />
            </form>
            <a
              href={`https://dashboard.stripe.com/${mode === "TEST" ? "test/" : ""}connect/accounts/${accountId}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center rounded-sm border border-line2 px-3 text-[12px] text-ink hover:bg-surface2"
            >
              Open in Stripe
            </a>
          </>
        )}
      </div>

      <Msg state={linkState} />
      <Msg state={refreshState} />

      {linkState?.link && (
        <div className="mt-3">
          <CopyField
            label={linkState.linkLabel ?? "Stripe onboarding link"}
            value={linkState.link}
            tone="accent"
            hint="Send this to the owner — they should fill in their own business details. Single-use and expires in minutes, so generate it when they're ready rather than in advance."
          />
        </div>
      )}
    </Card>
  );
}
