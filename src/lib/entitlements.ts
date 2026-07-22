/**
 * Which services a tenant is currently allowed to use, and the only place that
 * changes.
 *
 * A suspension is the platform withdrawing a service from one restaurant —
 * non-payment, abuse, a compliance problem, a carrier complaint. It is
 * deliberately not the same thing as the owner's own switches:
 *
 *   - `Restaurant.cardPaymentsEnabled` is the owner's preference. Theirs to set.
 *   - A PAYMENTS suspension is ours. The owner cannot see a control for it and
 *     no owner-reachable code path writes this table.
 *
 * Everything reads through `serviceState`/`isSuspended` so the asymmetry holds
 * in one place. If you add a new service, add it to the enum and gate it at its
 * own door — a service that nothing checks is a promise we can't keep.
 */

import { prisma } from "@/lib/prisma";
import type { ServiceKind } from "@prisma/client";

export const SERVICES: ServiceKind[] = ["PAYMENTS", "SMS", "EMAIL", "DELIVERY"];

export const SERVICE_LABELS: Record<ServiceKind, string> = {
  PAYMENTS: "Card payments",
  SMS: "Text messaging",
  EMAIL: "Email",
  DELIVERY: "Delivery",
};

/**
 * What each suspension actually costs the tenant. Written for an admin about to
 * pull the switch — the point is that nobody suspends SMS thinking it only
 * stops marketing.
 */
export const SERVICE_CONSEQUENCES: Record<ServiceKind, string> = {
  PAYMENTS:
    "Storefront stops taking cards. Orders fall back to pay-at-counter, which also means no surcharge is collected on them.",
  SMS: "Every text stops, including order confirmations and refund notices. Messages are recorded as skipped, not queued.",
  EMAIL:
    "All outbound email stops, marketing and transactional alike. Campaigns on this tenant refuse to launch rather than queueing a wall of skipped rows, and anything already queued stops on the next drain.",
  DELIVERY:
    "Withdraws delivery from this tenant regardless of their own setting. The ordering flow is pickup-only today, so this is recorded but currently has no effect.",
};

export type ServiceState = {
  service: ServiceKind;
  suspended: boolean;
  /** Owner-facing explanation, when the admin wrote one. */
  reason: string | null;
  internalNote: string | null;
  suspendedAt: Date | null;
  suspendedBy: string | null;
};

/** The live suspension rows for a tenant, keyed by service. */
export async function serviceStates(restaurantId: string): Promise<Record<ServiceKind, ServiceState>> {
  const rows = await prisma.serviceSuspension.findMany({
    where: { restaurantId, liftedAt: null },
  });

  const out = {} as Record<ServiceKind, ServiceState>;
  for (const service of SERVICES) {
    const row = rows.find((r) => r.service === service);
    out[service] = {
      service,
      suspended: !!row,
      reason: row?.reason ?? null,
      internalNote: row?.internalNote ?? null,
      suspendedAt: row?.suspendedAt ?? null,
      suspendedBy: row?.suspendedBy ?? null,
    };
  }
  return out;
}

/**
 * The hot-path check. Kept to a single indexed row lookup because it runs on
 * the storefront render and on every outbound message.
 */
export async function isSuspended(restaurantId: string, service: ServiceKind): Promise<boolean> {
  const row = await prisma.serviceSuspension.findFirst({
    where: { restaurantId, service, liftedAt: null },
    select: { id: true },
  });
  return !!row;
}

/**
 * True when the tenant may actually take cards right now: the owner has it on
 * *and* we haven't suspended them. Callers must use this rather than reading
 * `cardPaymentsEnabled` directly — that column is only half the answer.
 */
export async function cardPaymentsAllowed(restaurant: {
  id: string;
  cardPaymentsEnabled: boolean;
}): Promise<boolean> {
  if (!restaurant.cardPaymentsEnabled) return false;
  return !(await isSuspended(restaurant.id, "PAYMENTS"));
}

/**
 * True when the tenant may actually offer delivery: the owner has it on *and*
 * we haven't suspended them. Same two-switch shape as `cardPaymentsAllowed`.
 *
 * Nothing calls this on the ordering path yet because nothing delivers. When
 * that changes, this is the function the storefront and checkout must read —
 * not `deliveryEnabled`, which is only the owner's half.
 */
export async function deliveryAllowed(restaurant: {
  id: string;
  deliveryEnabled: boolean;
}): Promise<boolean> {
  if (!restaurant.deliveryEnabled) return false;
  return !(await isSuspended(restaurant.id, "DELIVERY"));
}

export type SuspendInput = {
  restaurantId: string;
  service: ServiceKind;
  /** Shown to the owner. */
  reason?: string | null;
  internalNote?: string | null;
  /** User id of the admin pulling the switch. */
  actorId?: string | null;
};

/**
 * Suspend a service. Idempotent by way of the partial unique index: if a live
 * row already exists the insert loses and we report the existing state rather
 * than stacking a second suspension that would need lifting twice.
 */
export async function suspendService(input: SuspendInput): Promise<{ ok?: string; error?: string }> {
  const existing = await prisma.serviceSuspension.findFirst({
    where: { restaurantId: input.restaurantId, service: input.service, liftedAt: null },
  });
  if (existing) return { ok: `${SERVICE_LABELS[input.service]} was already suspended.` };

  try {
    await prisma.serviceSuspension.create({
      data: {
        restaurantId: input.restaurantId,
        service: input.service,
        reason: input.reason?.trim() || null,
        internalNote: input.internalNote?.trim() || null,
        suspendedBy: input.actorId ?? null,
      },
    });
  } catch {
    // Unique violation — another admin suspended it between our read and write.
    // The end state is the one we wanted, so this is not an error to report.
    return { ok: `${SERVICE_LABELS[input.service]} was already suspended.` };
  }

  return { ok: `${SERVICE_LABELS[input.service]} suspended.` };
}

/**
 * Lift every live suspension for that service. `updateMany` rather than a
 * targeted update so a row that slipped past the index — an older database, a
 * manual insert — still gets closed out instead of lingering invisibly.
 */
export async function restoreService(
  restaurantId: string,
  service: ServiceKind,
  actorId?: string | null,
): Promise<{ ok?: string; error?: string }> {
  const res = await prisma.serviceSuspension.updateMany({
    where: { restaurantId, service, liftedAt: null },
    data: { liftedAt: new Date(), liftedBy: actorId ?? null },
  });

  if (res.count === 0) return { ok: `${SERVICE_LABELS[service]} was not suspended.` };
  return { ok: `${SERVICE_LABELS[service]} restored.` };
}

/** Full history for a tenant, newest first. Admin-only reading material. */
export async function suspensionHistory(restaurantId: string) {
  return prisma.serviceSuspension.findMany({
    where: { restaurantId },
    orderBy: { suspendedAt: "desc" },
    take: 50,
  });
}
