import "server-only";
import { notify } from "@/lib/notifications";

/**
 * Invite links — the one door for provisioning an owner login.
 *
 * The thing this replaces: creating a `User` with a password an admin typed and
 * then telling them the password. That is bad practice (a credential we chose,
 * transmitted over whatever channel was handy, living in a sent-messages folder
 * forever) and a bad first impression of a product whose whole pitch is that it
 * removes friction.
 *
 * Shape of the fix, and why each part is here:
 *
 *   - The token is 160 bits from the CSPRNG, same as `newOrderToken`. This link
 *     creates a *session*, so it is strictly more valuable than an order token
 *     and gets at least the same strength.
 *   - We store SHA-256 of it and hand the token back exactly once. A database
 *     backup therefore contains no usable invites, and there is no prefix for
 *     an attacker to enumerate against — the lookup is a single hash equality.
 *   - It expires, and it is single-use. Redemption takes an optimistic lock the
 *     way every writer in `lib/orders.ts` does, so a double-tapped link cannot
 *     provision two accounts.
 *   - No account exists until redemption. An unredeemed invite leaves nothing
 *     to brute-force.
 *
 * Rows are append-only in spirit: redeeming sets `redeemedAt`, revoking sets
 * `revokedAt`, and neither deletes. "Who did we invite, when, and did they ever
 * accept" is the question that answers a stalled onboarding two weeks later.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { platformOrigin } from "@/lib/domains";
import type { Role } from "@prisma/client";

/** How long a link stays good. Long enough to survive a weekend, short enough
 *  that a forwarded email doesn't stay dangerous for a month. */
export const INVITE_TTL_HOURS = 72;

const MIN_PASSWORD = 8;

export function newInviteToken(): string {
  return randomBytes(20).toString("hex");
}

/** The stored form. Never reversible, so a leaked row is not a leaked invite. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Where the recipient lands. Deliberately `platformOrigin()` and not the
 * tenant's canonical origin: this is a login on our host, and a tenant's custom
 * domain serves only their storefront. See `lib/domains.ts`.
 */
export function inviteUrl(token: string): string {
  const origin = platformOrigin();
  const path = `/invite/${token}`;
  return origin ? `${origin}${path}` : path;
}

export type InviteResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Creating
// ---------------------------------------------------------------------------

export type CreateInviteInput = {
  restaurantId: string;
  email: string;
  role?: Role;
  actorId?: string | null;
  ttlHours?: number;
};

/**
 * Mint a link. Returns the raw token — the only time it exists in readable
 * form, so the caller must surface it immediately or lose it.
 *
 * Any outstanding invite for the same address at the same tenant is revoked
 * first. Two live links for one person means the older one is a mystery when it
 * stops working, and "I clicked the link and it said invalid" is exactly the
 * support call this feature exists to prevent.
 */
export async function createInvite(
  input: CreateInviteInput
): Promise<InviteResult<{ token: string; url: string; inviteId: string; expiresAt: Date }>> {
  const email = input.email.trim().toLowerCase();
  if (!email || !email.includes("@")) return { ok: false, error: "That doesn't look like an email address." };

  const restaurant = await prisma.restaurant.findUnique({
    where: { id: input.restaurantId },
    select: { id: true },
  });
  if (!restaurant) return { ok: false, error: "Restaurant not found." };

  // The account is created at redemption, so a taken address is a conflict we
  // have to catch now rather than at the far end where the recipient sees it.
  const taken = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (taken) return { ok: false, error: "That email already has an account. Reset their password instead." };

  await prisma.invite.updateMany({
    where: { restaurantId: input.restaurantId, email, redeemedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const token = newInviteToken();
  const ttl = Math.max(1, input.ttlHours ?? INVITE_TTL_HOURS);
  const expiresAt = new Date(Date.now() + ttl * 3600_000);

  const invite = await prisma.invite.create({
    data: {
      tokenHash: hashInviteToken(token),
      restaurantId: input.restaurantId,
      email,
      role: input.role ?? "OWNER",
      expiresAt,
      createdById: input.actorId ?? null,
    },
    select: { id: true },
  });

  return { ok: true, value: { token, url: inviteUrl(token), inviteId: invite.id, expiresAt } };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type InviteState =
  | { status: "valid"; email: string; restaurantName: string; expiresAt: Date }
  | { status: "expired" | "used" | "revoked" | "unknown" };

/**
 * What a token is worth, for the redemption page to render.
 *
 * The four failure states are distinguished for the *recipient's* benefit —
 * "this link expired, ask for a new one" is actionable where "invalid" is not.
 * That leaks only whether a 160-bit string was once an invite, which an
 * attacker who can guess one has already won against.
 */
export async function lookupInvite(token: string): Promise<InviteState> {
  if (!token || token.length < 20) return { status: "unknown" };

  const invite = await prisma.invite.findUnique({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      email: true,
      expiresAt: true,
      redeemedAt: true,
      revokedAt: true,
      restaurant: { select: { name: true } },
    },
  });
  if (!invite) return { status: "unknown" };
  if (invite.redeemedAt) return { status: "used" };
  if (invite.revokedAt) return { status: "revoked" };
  if (invite.expiresAt.getTime() <= Date.now()) return { status: "expired" };

  return {
    status: "valid",
    email: invite.email,
    restaurantName: invite.restaurant.name,
    expiresAt: invite.expiresAt,
  };
}

// ---------------------------------------------------------------------------
// Redeeming
// ---------------------------------------------------------------------------

export type RedeemedUser = {
  userId: string;
  email: string;
  role: Role;
  restaurantId: string;
};

/**
 * Consume the invite and create the login.
 *
 * The claim and the account creation run in one transaction. Prisma's
 * `updateMany` with the current state in the WHERE is the same optimistic lock
 * every writer in `lib/orders.ts` takes; a zero-row result means someone else
 * got there first. Wrapping the user creation in with it means a failure at
 * either end rolls back both — unlike a refund, both writes are ours and there
 * is no external provider mid-flight to strand.
 */
export async function redeemInvite(input: {
  token: string;
  password: string;
  name?: string;
}): Promise<InviteResult<RedeemedUser>> {
  if (input.password.length < MIN_PASSWORD) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD} characters.` };
  }

  const tokenHash = hashInviteToken(input.token);
  const invite = await prisma.invite.findUnique({
    where: { tokenHash },
    select: { id: true, email: true, role: true, restaurantId: true, expiresAt: true, redeemedAt: true, revokedAt: true },
  });

  // Deliberately vague to the caller here — the page already told them the
  // state via lookupInvite, and this path shouldn't confirm anything extra.
  if (!invite || invite.redeemedAt || invite.revokedAt || invite.expiresAt.getTime() <= Date.now()) {
    return { ok: false, error: "This invite link is no longer valid. Ask for a fresh one." };
  }

  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const { count } = await tx.invite.updateMany({
        where: { id: invite.id, redeemedAt: null, revokedAt: null },
        data: { redeemedAt: new Date() },
      });
      if (count === 0) throw new Error("invite_race");

      const created = await tx.user.create({
        data: {
          email: invite.email,
          passwordHash,
          name: input.name?.trim() || null,
          role: invite.role,
          restaurantId: invite.restaurantId,
        },
        select: { id: true, email: true, role: true, restaurantId: true },
      });

      await tx.invite.update({
        where: { id: invite.id },
        data: { redeemedById: created.id },
      });

      return created;
    });

    await notify({
      kind: "NEW_OPERATOR",
      audience: { to: "ADMINS" },
      title: "New operator account",
      body: `${user.email} redeemed an invite (${user.role.toLowerCase()}).`,
      link: "/admin/users",
      dedupeKey: `operator:${user.id}`,
    });

    return {
      ok: true,
      value: {
        userId: user.id,
        email: user.email,
        role: user.role,
        restaurantId: user.restaurantId ?? invite.restaurantId,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "invite_race") {
      return { ok: false, error: "This invite link is no longer valid. Ask for a fresh one." };
    }
    // The realistic case is the unique constraint on email — someone created
    // that account between the check above and here.
    return { ok: false, error: "That email already has an account. Try signing in instead." };
  }
}

/** Admin-side cancel. Sets a timestamp rather than deleting; see the file header. */
export async function revokeInvite(inviteId: string): Promise<void> {
  await prisma.invite.updateMany({
    where: { id: inviteId, redeemedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** The live invite for a tenant, if there is one. Drives the admin People tab. */
export async function outstandingInvites(restaurantId: string) {
  return prisma.invite.findMany({
    where: { restaurantId, redeemedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
    select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
  });
}
