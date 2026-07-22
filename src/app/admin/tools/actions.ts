"use server";

/**
 * Admin door onto the simulator and the operational sweeps.
 *
 * Thin on purpose: every one of these is `requireAdmin()` plus a call into the
 * module that owns the behaviour, matching how the domain and suspension
 * actions are shaped. The simulator re-checks `testModeEnabled()` itself, so
 * these don't duplicate that gate — hiding the page is a courtesy, the check in
 * `lib/simulator.ts` is the enforcement.
 */

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { runOrderSweeps, retryFailedRefunds, expireStaleOrders, flagOverdueOrders } from "@/lib/orders";
import { retryFailedMessages } from "@/lib/sms";
import { retryFailedEmails } from "@/lib/email";
import { drainCampaigns } from "@/lib/campaigns";
import { drainAutomations } from "@/lib/automations";
import { resolveModeState } from "@/lib/payments";
import {
  simulateOrders,
  advanceOrders,
  injectTrouble,
  wipeSimulatedData,
  cancelSimulatedOrders,
  closeNoShow,
  type SimProfileKey,
  type TroubleKey,
} from "@/lib/simulator";

type Result = { error?: string; ok?: string } | undefined;

function refresh(restaurantId: string) {
  revalidatePath("/admin/tools");
  revalidatePath("/admin/orders");
  revalidatePath(`/admin/restaurants/${restaurantId}`);
  // The owner is looking at the same rows from the other side.
  revalidatePath("/dashboard");
}

export async function simulateOrdersAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!restaurantId) return { error: "Pick a tenant first." };

  const seedRaw = String(formData.get("seed") ?? "").trim();

  const res = await simulateOrders({
    restaurantId,
    count: Number(formData.get("count")),
    days: Number(formData.get("days")),
    newCustomerPct: Number(formData.get("newCustomerPct")),
    profile: String(formData.get("profile") ?? "shift") as SimProfileKey,
    seed: seedRaw ? Number(seedRaw) : undefined,
  });

  if (!res.ok) return { error: res.error };
  refresh(restaurantId);
  return { ok: res.note };
}

export async function advanceOrdersAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!restaurantId) return { error: "Pick a tenant first." };

  const res = await advanceOrders({ restaurantId, steps: Number(formData.get("steps")) });
  if (!res.ok) return { error: res.error };
  refresh(restaurantId);
  return { ok: res.note };
}

export async function injectTroubleAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!restaurantId) return { error: "Pick a tenant first." };

  const res = await injectTrouble({
    restaurantId,
    scenario: String(formData.get("scenario") ?? "") as TroubleKey,
  });
  if (!res.ok) return { error: res.error };
  refresh(restaurantId);
  return { ok: res.value.detail };
}

export async function closeNoShowAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!restaurantId) return { error: "Pick a tenant first." };

  const res = await closeNoShow({
    restaurantId,
    refund: String(formData.get("refund")) === "auto" ? "auto" : "none",
  });
  if (!res.ok) return { error: res.error };
  refresh(restaurantId);
  return { ok: res.value.detail };
}

export async function cancelSimulatedAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!restaurantId) return { error: "Pick a tenant first." };

  const res = await cancelSimulatedOrders(restaurantId);
  if (!res.ok) return { error: res.error };
  refresh(restaurantId);
  return { ok: res.note };
}

export async function wipeSimulatedAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();
  const restaurantId = String(formData.get("restaurantId") ?? "");
  if (!restaurantId) return { error: "Pick a tenant first." };

  // Typing the slug, same guardrail as deleting a tenant. A wipe can't touch
  // real trade, but it can destroy an afternoon of somebody's test setup, and
  // the button sits next to the tenant picker.
  if (String(formData.get("confirm") ?? "") !== String(formData.get("slug") ?? "")) {
    return { error: "Type the tenant's slug to confirm." };
  }

  const res = await wipeSimulatedData(restaurantId);
  if (!res.ok) return { error: res.error };
  refresh(restaurantId);
  return { ok: res.note };
}

/**
 * Run the sweeps by hand.
 *
 * This exists because the Railway cron service still doesn't exist (see
 * `docs/deploy-sweep.md`), which means four finished, tested features —
 * stale-order expiry, the overdue apology, refund retry and send retry — do
 * nothing in production and cannot be demonstrated at all. A button is not a
 * substitute for the cron, and the panel says so; it's how you find out whether
 * the code is right while the cron is still a to-do.
 *
 * Scoped to one tenant when a tenant is picked, so a manual run during a demo
 * can't reach across the platform.
 */
export async function runSweepAction(_prev: Result, formData: FormData): Promise<Result> {
  await requireAdmin();

  const which = String(formData.get("which") ?? "all");
  const scopeAll = String(formData.get("scope") ?? "") === "all";
  const restaurantId = String(formData.get("restaurantId") ?? "");
  const scope = scopeAll ? undefined : restaurantId || undefined;

  if (!scopeAll && !scope) return { error: "Pick a tenant, or switch the scope to the whole platform." };

  try {
    switch (which) {
      case "expire": {
        const n = await expireStaleOrders(scope);
        refresh(restaurantId);
        return { ok: `Expired ${n} unattended order${n === 1 ? "" : "s"}.` };
      }
      case "overdue": {
        const n = await flagOverdueOrders({ restaurantId: scope });
        refresh(restaurantId);
        return { ok: `Apologised for ${n} late order${n === 1 ? "" : "s"}.` };
      }
      case "refunds": {
        const n = await retryFailedRefunds(scope);
        refresh(restaurantId);
        return { ok: `Recovered ${n} failed refund${n === 1 ? "" : "s"}.` };
      }
      case "messages": {
        const n = await retryFailedMessages(scope);
        refresh(restaurantId);
        return { ok: `Re-sent ${n} message${n === 1 ? "" : "s"}.` };
      }
      case "emails": {
        const n = await retryFailedEmails(scope);
        refresh(restaurantId);
        return { ok: `Re-sent ${n} email${n === 1 ? "" : "s"}.` };
      }
      case "campaigns": {
        // Unscoped on purpose, unlike every other sweep here. A campaign drain
        // is a queue drain: the queue is global, the batch is bounded, and
        // filtering it to one tenant would make the button test something the
        // cron never does. The bound is what makes that safe.
        const r = await drainCampaigns();
        refresh(restaurantId);
        return {
          ok: `campaigns started=${r.started} sent=${r.sent} skipped=${r.skipped} failed=${r.failed} completed=${r.completed}`,
        };
      }
      case "automations": {
        // Unscoped, same reasoning as the campaign drain above: the queue is
        // global and the batch is bounded, and a per-tenant version would be
        // testing something the cron never does.
        const r = await drainAutomations();
        refresh(restaurantId);
        return {
          ok: `automations enrolled=${r.enrolled} advanced=${r.advanced} ended=${r.ended}`,
        };
      }
      case "mode": {
        const state = await resolveModeState();
        return {
          ok: `Payment mode is ${state.mode}${state.expiresAt ? `, reverting ${state.expiresAt.toLocaleString()}` : ""}.`,
        };
      }
      default: {
        // The same set the cron runs, in the same order, so a manual run and a
        // scheduled run can't diverge in behaviour.
        const mode = await resolveModeState();
        const { expired, overdue, refundsRecovered } = await runOrderSweeps(scope);
        const messages = await retryFailedMessages(scope);
        const emails = await retryFailedEmails(scope);
        const campaigns = await drainCampaigns();
        const automations = await drainAutomations();
        refresh(restaurantId);
        return {
          ok:
            `mode=${mode.mode} expired=${expired} overdue=${overdue} refunds=${refundsRecovered} ` +
            `messages=${messages} emails=${emails} campaigns=${campaigns.sent}/${campaigns.skipped} ` +
            `automations=${automations.enrolled}/${automations.advanced}`,
        };
      }
    }
  } catch (err) {
    return { error: `Sweep failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}
