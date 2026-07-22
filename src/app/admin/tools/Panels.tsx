"use client";

/**
 * The client half of /admin/tools.
 *
 * All five panels share one result strip and one pending pattern, so they live
 * in a single file rather than five near-identical ones. Each is a plain form
 * posting to a server action — nothing here holds state that matters, because
 * the truth is whatever the next page render reads out of the database.
 */

import { useFormState, useFormStatus } from "react-dom";
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  inputClass,
  cx,
} from "@/components/hearth/ui";
import { SIM_PROFILES, TROUBLE_SCENARIOS, type SimProfileKey, type TroubleKey } from "@/lib/simulator-data";
import {
  simulateOrdersAction,
  advanceOrdersAction,
  injectTroubleAction,
  wipeSimulatedAction,
  cancelSimulatedAction,
  closeNoShowAction,
  runSweepAction,
} from "./actions";

type Result = { error?: string; ok?: string } | undefined;

function Submit({
  children,
  variant = "primary",
  pendingLabel,
}: {
  children: React.ReactNode;
  variant?: "primary" | "outline" | "ghost" | "danger";
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button variant={variant} disabled={pending}>
      {pending ? pendingLabel ?? "Working…" : children}
    </Button>
  );
}

function Outcome({ state }: { state: Result }) {
  if (!state?.error && !state?.ok) return null;
  return (
    <p
      className={cx(
        "mt-3 rounded-sm border px-3 py-2 text-[12px]",
        state.error
          ? "border-badLine bg-badBg text-badInk"
          : "border-goodLine bg-goodBg text-accent"
      )}
    >
      {state.error ?? state.ok}
    </p>
  );
}

function PanelHead({ title, body }: { title: string; body: string }) {
  return (
    <>
      <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
      <p className="mb-4 mt-1 text-[12px] text-dim">{body}</p>
    </>
  );
}

// ---------------------------------------------------------------------------

export function SimulatorPanel({ restaurantId }: { restaurantId: string }) {
  const [state, action] = useFormState(simulateOrdersAction, undefined);

  return (
    <Card>
      <PanelHead
        title="Seed orders"
        body="Invents customers and orders against this tenant's real menu, with real surcharge and tax arithmetic. Every simulated number is in the unroutable 555-01xx block, so nothing can reach a real handset."
      />
      <form action={action} className="space-y-4">
        <input type="hidden" name="restaurantId" value={restaurantId} />

        <Field label="Profile" hint="What the run should look like.">
          <Select name="profile" defaultValue="shift">
            {(Object.keys(SIM_PROFILES) as SimProfileKey[]).map((k) => (
              <option key={k} value={k}>
                {SIM_PROFILES[k].label} — {SIM_PROFILES[k].description}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Orders" hint="1–250">
            <Input name="count" type="number" min={1} max={250} defaultValue={20} />
          </Field>
          <Field label="Spread over (days)" hint="Live tickets stay recent regardless.">
            <Input name="days" type="number" min={0} max={365} defaultValue={14} />
          </Field>
          <Field label="New customers %" hint="The rest are repeat buyers.">
            <Input name="newCustomerPct" type="number" min={0} max={100} defaultValue={40} />
          </Field>
        </div>

        <Field label="Seed (optional)" hint="Same seed reproduces the same run — useful when chasing something you only saw once.">
          <Input name="seed" type="number" placeholder="leave blank for random" />
        </Field>

        <Submit pendingLabel="Seeding…">Seed orders</Submit>
      </form>
      <Outcome state={state} />
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function ShiftPanel({ restaurantId }: { restaurantId: string }) {
  const [advState, advance] = useFormState(advanceOrdersAction, undefined);
  const [noShowState, noShow] = useFormState(closeNoShowAction, undefined);
  const [cancelState, cancelAll] = useFormState(cancelSimulatedAction, undefined);

  return (
    <Card>
      <PanelHead
        title="Drive the shift"
        body="Moves simulated tickets through the state machine using the same doors the dashboard uses — transitionOrder, markNoShow, cancelOrder. Real orders are never touched."
      />

      <div className="space-y-4">
        <form action={advance} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <div className="w-28">
            <Field label="Steps">
              <Input name="steps" type="number" min={1} max={5} defaultValue={1} />
            </Field>
          </div>
          <Submit pendingLabel="Moving…">Advance tickets</Submit>
          <span className="pb-2 text-[12px] text-mute">
            received → accepted → preparing → ready → completed
          </span>
        </form>
        <Outcome state={advState} />

        <div className="h-px bg-line" />

        <form action={noShow} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <div className="w-56">
            <Field label="Close oldest READY as a no-show" hint="Keeping the money is the default — the food exists.">
              <Select name="refund" defaultValue="none">
                <option value="none">Keep the charge</option>
                <option value="auto">Refund in full</option>
              </Select>
            </Field>
          </div>
          <Submit variant="outline" pendingLabel="Closing…">Mark no-show</Submit>
        </form>
        <Outcome state={noShowState} />

        <div className="h-px bg-line" />

        <form action={cancelAll} className="flex flex-wrap items-center gap-3">
          <input type="hidden" name="restaurantId" value={restaurantId} />
          <Submit variant="outline" pendingLabel="Clearing…">Cancel &amp; refund every live simulated ticket</Submit>
          <span className="text-[12px] text-mute">Clears the board without deleting the history.</span>
        </form>
        <Outcome state={cancelState} />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function TroublePanel({ restaurantId }: { restaurantId: string }) {
  const [state, action] = useFormState(injectTroubleAction, undefined);
  const keys = Object.keys(TROUBLE_SCENARIOS) as TroubleKey[];

  return (
    <Card>
      <PanelHead
        title="Inject trouble"
        body="Each of these produces one broken state that is otherwise hard or slow to reach on purpose — you can't ask a payment provider to fail, and waiting ten minutes for an unattended ticket every time you touch the board isn't testing."
      />
      <div className="space-y-2">
        {keys.map((k) => (
          <form
            key={k}
            action={action}
            className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5"
          >
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="scenario" value={k} />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">{TROUBLE_SCENARIOS[k].label}</div>
              <div className="text-[12px] text-dim">{TROUBLE_SCENARIOS[k].description}</div>
              <div className="mt-0.5 font-mono text-[11px] text-mute">
                exercises {TROUBLE_SCENARIOS[k].exercises}
              </div>
            </div>
            <Submit variant="outline" pendingLabel="Injecting…">Inject</Submit>
          </form>
        ))}
      </div>
      <Outcome state={state} />
    </Card>
  );
}

// ---------------------------------------------------------------------------

const SWEEPS: Array<{ key: string; label: string; body: string }> = [
  { key: "all", label: "Everything (what the cron runs)", body: "Mode expiry, stale orders, overdue apologies, refund retry, send retry, email retry, campaign drain, automation drain — same order as scripts/sweep.ts." },
  { key: "expire", label: "Expire unattended orders", body: "expireStaleOrders — cancels and refunds tickets the restaurant never acknowledged." },
  { key: "overdue", label: "Apologise for late orders", body: "flagOverdueOrders — one message, once, per badly late order." },
  { key: "refunds", label: "Retry failed refunds", body: "retryFailedRefunds — bounded by the attempts cap." },
  { key: "messages", label: "Retry failed sends", body: "retryFailedMessages — only rows marked retryable." },
  { key: "emails", label: "Retry failed email", body: "retryFailedEmails — only rows marked retryable, lower attempts cap than SMS." },
  {
    key: "campaigns",
    label: "Drain marketing campaigns",
    body: "drainCampaigns — promotes due schedules, sends one bounded batch, closes finished campaigns. Always platform-wide; the queue is global and the batch is capped.",
  },
  {
    key: "automations",
    label: "Advance automations",
    body: "drainAutomations — enrolls anyone who now qualifies for a time-based trigger, then walks every journey whose timer has expired. Platform-wide and bounded, same as the campaign drain.",
  },
  { key: "mode", label: "Check payment mode", body: "resolveModeState — applies an expired TEST/STUB window and reports the result." },
];

export function SweepPanel({ restaurantId, cronMissing }: { restaurantId: string; cronMissing: boolean }) {
  const [state, action] = useFormState(runSweepAction, undefined);

  return (
    <Card>
      <PanelHead
        title="Run sweeps"
        body="The scheduled jobs, on demand. Scope defaults to the selected tenant so a run during a demo can't reach across the platform."
      />

      {cronMissing && (
        <p className="mb-4 rounded-sm border border-warnLine bg-warnBg px-3 py-2 text-[12px] text-warn">
          These buttons are not the cron. Until a second Railway service runs <span className="font-mono">npm run sweep</span> on a
          schedule (see <span className="font-mono">docs/deploy-sweep.md</span>), nothing here runs unless a person presses it —
          which is the opposite of what these sweeps are for.
        </p>
      )}

      <div className="space-y-2">
        {SWEEPS.map((s) => (
          <form
            key={s.key}
            action={action}
            className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-line px-3 py-2.5"
          >
            <input type="hidden" name="restaurantId" value={restaurantId} />
            <input type="hidden" name="which" value={s.key} />
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-ink">{s.label}</div>
              <div className="font-mono text-[11px] text-mute">{s.body}</div>
            </div>
            <div className="flex items-center gap-2">
              <select name="scope" defaultValue="tenant" className={cx(inputClass, "h-8 w-[130px] py-0")}>
                <option value="tenant">This tenant</option>
                <option value="all">Whole platform</option>
              </select>
              <Submit variant="outline" pendingLabel="Running…">Run</Submit>
            </div>
          </form>
        ))}
      </div>
      <Outcome state={state} />
    </Card>
  );
}

// ---------------------------------------------------------------------------

export function WipePanel({ restaurantId, slug, counts }: { restaurantId: string; slug: string; counts: string }) {
  const [state, action] = useFormState(wipeSimulatedAction, undefined);

  return (
    <Card className="border-badLine">
      <PanelHead
        title="Remove simulated data"
        body="Deletes only rows carrying a simulator marker — customers in the 555-01xx block and orders tagged as simulated. Real customers and real orders are matched by neither and are left alone."
      />
      <p className="mb-4 text-[12px] text-dim">
        About to remove: <span className="font-mono text-ink">{counts}</span>
      </p>
      <form action={action} className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="restaurantId" value={restaurantId} />
        <input type="hidden" name="slug" value={slug} />
        <div className="w-64">
          <Field label={`Type "${slug}" to confirm`}>
            <Input name="confirm" placeholder={slug} autoComplete="off" />
          </Field>
        </div>
        <Submit variant="danger" pendingLabel="Wiping…">Wipe simulated data</Submit>
      </form>
      <Outcome state={state} />
    </Card>
  );
}
