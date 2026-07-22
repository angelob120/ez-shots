"use client";

import { useFormState, useFormStatus } from "react-dom";
import { Badge, Button, Card, Select } from "@/components/hearth/ui";
import {
  adjustPaymentWindowAction,
  setPaymentModeAction,
  setTestModeAction,
} from "../actions";
import type { PaymentMode } from "@/lib/payments";

const WINDOWS = [
  { hours: "0.5", label: "30 minutes" },
  { hours: "2", label: "2 hours" },
  { hours: "8", label: "8 hours" },
  { hours: "24", label: "1 day" },
  { hours: "72", label: "3 days" },
  { hours: "168", label: "7 days (max)" },
];

function Submit({
  label,
  pendingLabel,
  variant = "outline",
  disabled,
  name,
  value,
}: {
  label: string;
  pendingLabel: string;
  variant?: "primary" | "outline" | "danger";
  disabled?: boolean;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button size="sm" variant={variant} disabled={disabled || pending} name={name} value={value}>
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

export default function ModePanel({
  mode,
  expiresAt,
  revertTo,
  revertedAt,
  testModeEnabled,
  configured,
}: {
  mode: PaymentMode;
  expiresAt: string | null;
  revertTo: string | null;
  revertedAt: string | null;
  testModeEnabled: boolean;
  configured: { testSecret: boolean; testPub: boolean; liveSecret: boolean; livePub: boolean };
}) {
  const [modeState, modeAction] = useFormState(setPaymentModeAction, undefined);
  const [windowState, windowAction] = useFormState(adjustPaymentWindowAction, undefined);
  const [testState, testAction] = useFormState(setTestModeAction, undefined);

  const live = mode === "LIVE";

  return (
    <div className="space-y-4">
      {/* ── Where we are ────────────────────────────────────────────── */}
      <Card className={live ? undefined : "border-warnLine"}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Payment mode</h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
              Platform-wide, applies to every restaurant immediately, no redeploy. Existing
              orders keep the mode they were charged in, so a refund always reaches the key set
              that took the money.
            </p>
          </div>
          <Badge tone={live ? "good" : mode === "TEST" ? "warn" : "bad"}>
            {live ? "Live — real money" : mode === "TEST" ? "Stripe test" : "Stubbed — charging nothing"}
          </Badge>
        </div>

        {revertedAt && live && (
          <p className="mt-4 rounded-sm border border-goodLine bg-goodBg px-3 py-2 text-[12px] leading-relaxed text-accent">
            This reverted on its own at {revertedAt} — the window expired. Nobody changed it by
            hand.
          </p>
        )}

        {!live && (
          <div className="mt-4 rounded-sm border border-warnLine bg-warnBg px-3 py-3">
            <p className="text-[12.5px] font-medium text-warnInk">
              {mode === "STUB"
                ? "Right now: a customer checks out, the kitchen cooks, and no charge exists anywhere."
                : "Right now: charges land on the Stripe test keys. Real orders, worthless money."}
            </p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-warnDim">
              {expiresAt ? (
                <>
                  Reverts to <span className="font-mono">{revertTo ?? "LIVE"}</span> at{" "}
                  <span className="font-mono">{expiresAt}</span> without anyone doing anything.
                </>
              ) : (
                <>
                  No expiry set on this window — it will stay this way until someone changes it.
                  Set one below.
                </>
              )}
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <form action={windowAction}>
                <input type="hidden" name="intent" value="revert" />
                <Submit label="Go live now" pendingLabel="Switching…" variant="primary" />
              </form>
              <form action={windowAction} className="flex items-center gap-2">
                <input type="hidden" name="intent" value="extend" />
                <Select name="hours" defaultValue="2" className="h-8 w-auto py-0 text-[12px]">
                  <option value="0.5">+30 min</option>
                  <option value="2">+2 hours</option>
                  <option value="8">+8 hours</option>
                  <option value="24">+1 day</option>
                </Select>
                <Submit label="Extend" pendingLabel="Extending…" />
              </form>
            </div>
            <Msg state={windowState} />
          </div>
        )}
      </Card>

      {/* ── Switching ───────────────────────────────────────────────── */}
      <Card>
        <h3 className="text-[14px] font-semibold text-ink">Switch mode</h3>
        <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
          Leaving live always sets a timer. That isn&rsquo;t configurable to
          &ldquo;never&rdquo; on purpose — an untimed test window is the exact thing that
          costs a restaurant a day of dinners, and making the dangerous option the quick one
          is how it happens.
        </p>

        <form action={modeAction} className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <ModeCard
              mode="LIVE"
              current={mode}
              title="Live"
              blurb="Real money on the live keys."
              tone="good"
              unavailable={!configured.liveSecret}
            />
            <ModeCard
              mode="TEST"
              current={mode}
              title="Stripe test"
              blurb="Real Stripe calls, test keys. Refundable, visible in the test dashboard."
              tone="warn"
              unavailable={!configured.testSecret}
            />
            <ModeCard
              mode="STUB"
              current={mode}
              title="Stub"
              blurb="Charges nothing, reports success. No Stripe record at all."
              tone="bad"
              unavailable={false}
            />
          </div>

          <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
            <label className="block">
              <span className="mb-1 block text-[11px] text-mute">
                Auto-revert after (ignored when going live)
              </span>
              <Select name="windowHours" defaultValue="24" className="h-8 w-auto py-0 text-[12px]">
                {WINDOWS.map((w) => (
                  <option key={w.hours} value={w.hours}>
                    {w.label}
                  </option>
                ))}
              </Select>
            </label>
            <span className="text-[11.5px] text-mute">
              Reverts to live automatically — or to stub if the live key is missing, rather than
              claiming live and quietly charging nobody.
            </span>
          </div>
        </form>

        <Msg state={modeState} />

        <dl className="mt-4 grid gap-x-8 gap-y-1.5 border-t border-line pt-4 text-[12px] sm:grid-cols-2">
          {[
            ["Live secret key", configured.liveSecret],
            ["Live publishable key", configured.livePub],
            ["Test secret key", configured.testSecret],
            ["Test publishable key", configured.testPub],
          ].map(([k, ok]) => (
            <div key={k as string} className="flex justify-between gap-4">
              <dt className="text-mute">{k as string}</dt>
              <dd className={ok ? "text-accent" : "text-badInk"}>{ok ? "set" : "missing"}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* ── Test features ───────────────────────────────────────────── */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[14px] font-semibold text-ink">Test tools</h3>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-mute">
              Autofill on signup and onboarding, demo tenant seeding, and the sample menu CSV.
              Separate from payment mode on purpose: exercising a real Stripe test charge
              shouldn&rsquo;t put an autofill button in front of a restaurant owner signing up
              that afternoon.
            </p>
          </div>
          <Badge tone={testModeEnabled ? "warn" : "neutral"}>
            {testModeEnabled ? "Visible" : "Hidden"}
          </Badge>
        </div>

        {testModeEnabled && (
          <div className="mt-4 rounded-sm border border-warnLine bg-warnBg px-3 py-2">
            <p className="text-[12px] leading-relaxed text-warnInk">
              Currently showing on <span className="font-mono">/signup</span> — a public page.
              Anyone who lands there sees a &ldquo;fill with test data&rdquo; button.
            </p>
          </div>
        )}

        <form action={testAction} className="mt-4">
          <input type="hidden" name="enabled" value={testModeEnabled ? "false" : "true"} />
          <Submit
            label={testModeEnabled ? "Hide test tools" : "Show test tools"}
            pendingLabel="Saving…"
            variant={testModeEnabled ? "danger" : "outline"}
          />
        </form>

        <Msg state={testState} />

        <ul className="mt-4 space-y-1.5 border-t border-line pt-4 text-[12px] leading-relaxed text-dim">
          <li>
            <span className="text-ink">Signup autofill</span> — fills the create-account form with
            a plausible restaurant.
          </li>
          <li>
            <span className="text-ink">Onboarding autofill</span> — fills the wizard&rsquo;s
            basics and branding steps.
          </li>
          <li>
            <span className="text-ink">Seed demo tenant</span> — a whole restaurant with menu,
            photos and an owner login, on the Restaurants page.
          </li>
          <li>
            <span className="text-ink">Sample menu CSV</span> — to feed the importer.
          </li>
        </ul>
      </Card>
    </div>
  );
}

function ModeCard({
  mode,
  current,
  title,
  blurb,
  tone,
  unavailable,
}: {
  mode: PaymentMode;
  current: PaymentMode;
  title: string;
  blurb: string;
  tone: "good" | "warn" | "bad";
  unavailable: boolean;
}) {
  const active = current === mode;
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      name="mode"
      value={mode}
      disabled={active || unavailable || pending}
      className={[
        "rounded-md border p-3 text-left transition-colors",
        active
          ? "border-accent bg-accent/5"
          : unavailable
            ? "cursor-not-allowed border-line opacity-50"
            : "border-line2 hover:bg-surface2",
      ].join(" ")}
    >
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold text-ink">{title}</span>
        {active && <Badge tone={tone}>current</Badge>}
      </div>
      <p className="mt-1 text-[11.5px] leading-relaxed text-mute">
        {blurb}
        {unavailable && <span className="text-badInk"> Secret key not set.</span>}
      </p>
    </button>
  );
}
