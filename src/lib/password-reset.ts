import "server-only";

/**
 * Operator "forgot password" — the one door for resetting a login without
 * knowing the old password.
 *
 * Security shape is copied from `lib/invites.ts` on purpose, because a reset
 * link is exactly as dangerous as an invite: whoever holds it can take the
 * account. So:
 *
 *   - The token is 160 bits from the CSPRNG.
 *   - We store only its SHA-256 and email the raw value once. A database backup
 *     therefore holds no usable links, and there is nothing to enumerate — the
 *     lookup is a single hash equality.
 *   - It expires, and it is single-use. Consumption takes an optimistic lock
 *     (the `usedAt IS NULL` in the `updateMany` WHERE) so a double-tapped link
 *     cannot reset twice or race two password changes.
 *
 * Two rules that are easy to get wrong and both leak information:
 *
 *   - **Requesting a reset never reveals whether an address exists.** The
 *     request path returns the same result whether or not a user was found, and
 *     the caller renders the same "check your email" screen either way. An
 *     endpoint that 404s on unknown addresses is an account-enumeration oracle.
 *   - **A successful reset invalidates every other outstanding link** for that
 *     user, so a reset the real owner just performed can't be undone by an
 *     older link an attacker is sitting on.
 */

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { platformOrigin } from "@/lib/domains";
import { sendOperatorEmail } from "@/lib/operator-email";

/** Long enough to act on after finding the email, short enough that a
 *  forwarded or leaked message doesn't stay dangerous. */
export const RESET_TTL_MINUTES = 60;

const MIN_PASSWORD = 8;

export function newResetToken(): string {
  return randomBytes(20).toString("hex");
}

/** The stored form. Never reversible, so a leaked row is not a leaked link. */
export function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Where the recipient lands. On our host — a reset is an operator login, and a
 *  tenant's custom domain serves only their storefront. */
export function resetUrl(token: string): string {
  const origin = platformOrigin();
  const path = `/reset-password?token=${token}`;
  return origin ? `${origin}${path}` : path;
}

/**
 * Start a reset. Always resolves to the same thing regardless of whether the
 * email matched an account — the caller must not tell the difference apart.
 *
 * When it does match, we mint a token, store its hash, and email the link.
 * Any earlier unused links for that user are consumed first, so a fresh
 * request quietly retires stale ones.
 */
export async function requestPasswordReset(rawEmail: string): Promise<void> {
  const email = rawEmail.toLowerCase().trim();
  if (!email) return;

  const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  if (!user) return; // Silent — no enumeration oracle.

  // Retire any outstanding links for this user before issuing a new one.
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  const token = newResetToken();
  await prisma.passwordResetToken.create({
    data: {
      tokenHash: hashResetToken(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60_000),
    },
  });

  const link = resetUrl(token);
  await sendOperatorEmail({
    to: user.email,
    subject: "Reset your EZ Orders password",
    text:
      `Someone asked to reset the password for your EZ Orders account.\n\n` +
      `If that was you, open this link to set a new password. It expires in ${RESET_TTL_MINUTES} minutes and can only be used once:\n\n` +
      `${link}\n\n` +
      `If it wasn't you, you can ignore this email — your password won't change until the link is used.`,
  });
}

export type ResetTokenState =
  | { ok: true; userId: string }
  | { ok: false; reason: "invalid" | "expired" | "used" };

/** Look up a token for the reset page. Never throws on a bad token. */
export async function resolveResetToken(token: string): Promise<ResetTokenState> {
  if (!token || !/^[0-9a-f]{40}$/.test(token)) return { ok: false, reason: "invalid" };

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { userId: true, expiresAt: true, usedAt: true },
  });

  if (!row) return { ok: false, reason: "invalid" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}

export type CompleteResetResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "expired" | "used" | "weak" | "mismatch"; message: string };

/**
 * Consume a token and set the new password, atomically.
 *
 * The `updateMany ... where usedAt: null` is the optimistic lock: a zero-row
 * result means someone else (a double-tap, a second tab) already consumed it,
 * and we stop rather than write a second password change. Only after the token
 * is claimed do we hash and store the new password.
 */
export async function completePasswordReset(
  token: string,
  password: string,
  confirm: string
): Promise<CompleteResetResult> {
  const state = await resolveResetToken(token);
  if (!state.ok) {
    const message =
      state.reason === "expired"
        ? "That reset link has expired. Request a new one."
        : state.reason === "used"
          ? "That reset link has already been used. Request a new one."
          : "That reset link isn't valid. Request a new one.";
    return { ok: false, reason: state.reason, message };
  }

  if (password.length < MIN_PASSWORD) {
    return { ok: false, reason: "weak", message: `Use at least ${MIN_PASSWORD} characters.` };
  }
  if (password !== confirm) {
    return { ok: false, reason: "mismatch", message: "Those two passwords don't match." };
  }

  const hash = hashResetToken(token);

  // Claim the token first, under the lock. If it was consumed between the read
  // above and now, this updates zero rows and we bail — the same pattern every
  // writer in lib/orders.ts uses.
  const claimed = await prisma.passwordResetToken.updateMany({
    where: { tokenHash: hash, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (claimed.count === 0) {
    return {
      ok: false,
      reason: "used",
      message: "That reset link has already been used. Request a new one.",
    };
  }

  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: state.userId }, data: { passwordHash } });

  // Retire any other outstanding links for this user — a completed reset should
  // leave nothing an attacker sitting on an older link could replay.
  await prisma.passwordResetToken.updateMany({
    where: { userId: state.userId, usedAt: null },
    data: { usedAt: new Date() },
  });

  return { ok: true };
}
