/**
 * Stand-in for `lib/auth.ts` in the invite tests.
 *
 * The real module pulls in `next/headers` and `next/navigation` for session
 * cookies and redirects, neither of which exists outside a request. The only
 * thing `lib/invites.ts` needs from it is password hashing.
 *
 * Deliberately NOT a no-op: the hash is still one-way and still distinguishes
 * two different passwords, so a test asserting "the stored hash isn't the
 * password" is testing something. It is not bcrypt, and nothing here should be
 * read as a claim about the real hashing — that lives in lib/auth.ts and is
 * exercised by signing in.
 */

import { createHash } from "node:crypto";

export async function hashPassword(plain: string): Promise<string> {
  return `sha256:${createHash("sha256").update(plain).digest("hex")}`;
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return (await hashPassword(plain)) === hash;
}
