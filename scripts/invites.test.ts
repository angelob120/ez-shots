/**
 * Tests for invite links.
 *
 * The properties under test are security properties, not calculations, and each
 * one is a way the feature could quietly stop being worth having:
 *
 *   - The token is never stored. If it were, a database backup would be a pile
 *     of working credentials.
 *   - Redemption is single-use. A link that provisions two accounts is a link
 *     that survives being forwarded.
 *   - Expiry is enforced at redemption, not just in the UI. The page's "this
 *     link expired" message is a courtesy; the check that matters is here.
 *   - A failure partway through leaves nothing consumed. Half-redeeming an
 *     invite strands somebody with a dead link and no account.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.invites.json scripts/invites.test.ts
 */

import assert from "node:assert/strict";
import {
  createInvite,
  hashInviteToken,
  lookupInvite,
  newInviteToken,
  redeemInvite,
  revokeInvite,
  outstandingInvites,
  INVITE_TTL_HOURS,
} from "../src/lib/invites";
import { reset, seedRestaurant, seedUser, allInvites, allUsers } from "./test-stubs/prisma-invites";

let passed = 0;
const only = process.argv[2];

async function test(name: string, fn: () => Promise<void>) {
  if (only && !name.includes(only)) return;
  reset();
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

/** The common setup: one restaurant, one fresh invite for it. */
async function invited(email = "owner@angelos.com") {
  const r = seedRestaurant();
  const res = await createInvite({ restaurantId: r.id as string, email });
  assert.equal(res.ok, true, "setup: invite should have been created");
  if (!res.ok) throw new Error("unreachable");
  return { restaurant: r, token: res.value.token, expiresAt: res.value.expiresAt };
}

async function main() {
  // ---------------------------------------------------------------------------
  // Tokens
  // ---------------------------------------------------------------------------

  await test("tokens are 160 bits of hex and don't repeat", async () => {
    const a = newInviteToken();
    const b = newInviteToken();
    assert.equal(a.length, 40);
    assert.match(a, /^[0-9a-f]{40}$/);
    assert.notEqual(a, b);
  });

  await test("the raw token is never stored — only its hash", async () => {
    const { token } = await invited();
    const rows = allInvites();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tokenHash, hashInviteToken(token));
    // The whole point: nothing on the row can be replayed as a link.
    const serialized = JSON.stringify(rows[0]);
    assert.ok(!serialized.includes(token), "the token leaked onto the stored row");
  });

  // ---------------------------------------------------------------------------
  // Creating
  // ---------------------------------------------------------------------------

  await test("creating an invite does not create a user", async () => {
    await invited();
    assert.equal(allUsers().length, 0, "an unredeemed invite must leave nothing to attack");
  });

  await test("refuses an email that already has an account", async () => {
    const r = seedRestaurant();
    seedUser({ email: "taken@angelos.com" });
    const res = await createInvite({ restaurantId: r.id as string, email: "taken@angelos.com" });
    assert.equal(res.ok, false);
  });

  await test("refuses a restaurant that doesn't exist", async () => {
    const res = await createInvite({ restaurantId: "nope", email: "a@b.com" });
    assert.equal(res.ok, false);
  });

  await test("refuses something that isn't an email", async () => {
    const r = seedRestaurant();
    const res = await createInvite({ restaurantId: r.id as string, email: "angelo" });
    assert.equal(res.ok, false);
  });

  await test("email is normalized to lowercase", async () => {
    const r = seedRestaurant();
    await createInvite({ restaurantId: r.id as string, email: "  Owner@Angelos.COM " });
    assert.equal(allInvites()[0].email, "owner@angelos.com");
  });

  await test("a second invite to the same address revokes the first", async () => {
    const r = seedRestaurant();
    const first = await createInvite({ restaurantId: r.id as string, email: "o@a.com" });
    await createInvite({ restaurantId: r.id as string, email: "o@a.com" });

    assert.equal(allInvites().length, 2, "the old row is kept as history, not deleted");
    assert.equal(allInvites().filter((i) => i.revokedAt === null).length, 1);

    // Two live links for one person means the older one is a mystery when it
    // stops working.
    if (!first.ok) throw new Error("unreachable");
    const state = await lookupInvite(first.value.token);
    assert.equal(state.status, "revoked");
  });

  await test("expiry defaults to the documented TTL", async () => {
    const { expiresAt } = await invited();
    const hours = (expiresAt.getTime() - Date.now()) / 3600_000;
    assert.ok(Math.abs(hours - INVITE_TTL_HOURS) < 0.1, `got ${hours}h`);
  });

  // ---------------------------------------------------------------------------
  // Looking up
  // ---------------------------------------------------------------------------

  await test("a valid token reports the tenant and the address", async () => {
    const { token } = await invited();
    const state = await lookupInvite(token);
    assert.equal(state.status, "valid");
    if (state.status !== "valid") throw new Error("unreachable");
    assert.equal(state.email, "owner@angelos.com");
    assert.equal(state.restaurantName, "Angelo's Pizza");
  });

  await test("an unknown token is 'unknown', not an error", async () => {
    await invited();
    const state = await lookupInvite(newInviteToken());
    assert.equal(state.status, "unknown");
  });

  await test("a short token is rejected without touching the database", async () => {
    const state = await lookupInvite("abc");
    assert.equal(state.status, "unknown");
  });

  await test("an expired invite reports expired", async () => {
    const r = seedRestaurant();
    const res = await createInvite({
      restaurantId: r.id as string,
      email: "o@a.com",
      ttlHours: 1,
    });
    if (!res.ok) throw new Error("unreachable");
    // Wind the stored expiry back rather than sleeping.
    allInvites()[0].expiresAt = new Date(Date.now() - 1000);

    const state = await lookupInvite(res.value.token);
    assert.equal(state.status, "expired");
  });

  // ---------------------------------------------------------------------------
  // Redeeming
  // ---------------------------------------------------------------------------

  await test("redeeming creates the user and consumes the invite", async () => {
    const { token, restaurant } = await invited();
    const res = await redeemInvite({ token, password: "a-real-password", name: "Angelo" });

    assert.equal(res.ok, true);
    if (!res.ok) throw new Error("unreachable");
    assert.equal(res.value.email, "owner@angelos.com");
    assert.equal(res.value.restaurantId, restaurant.id);
    assert.equal(res.value.role, "OWNER");

    assert.equal(allUsers().length, 1);
    assert.equal(allUsers()[0].name, "Angelo");
    assert.notEqual(allInvites()[0].redeemedAt, null);
    assert.equal(allInvites()[0].redeemedById, res.value.userId);
  });

  await test("the stored password is not the password", async () => {
    const { token } = await invited();
    await redeemInvite({ token, password: "a-real-password" });
    assert.notEqual(allUsers()[0].passwordHash, "a-real-password");
  });

  await test("a short password is refused before anything is consumed", async () => {
    const { token } = await invited();
    const res = await redeemInvite({ token, password: "short" });
    assert.equal(res.ok, false);
    assert.equal(allUsers().length, 0);
    assert.equal(allInvites()[0].redeemedAt, null, "a rejected attempt must not burn the link");
  });

  await test("SINGLE USE — a second redemption fails and creates nothing", async () => {
    const { token } = await invited();
    const first = await redeemInvite({ token, password: "a-real-password" });
    const second = await redeemInvite({ token, password: "another-password" });

    assert.equal(first.ok, true);
    assert.equal(second.ok, false);
    assert.equal(allUsers().length, 1, "a forwarded link must not provision a second account");
  });

  await test("SINGLE USE under a race — concurrent redemptions yield one account", async () => {
    const { token } = await invited();
    // The optimistic lock in redeemInvite is the only thing standing between a
    // double-tapped link and two accounts.
    const results = await Promise.all([
      redeemInvite({ token, password: "a-real-password" }),
      redeemInvite({ token, password: "a-real-password" }),
      redeemInvite({ token, password: "a-real-password" }),
    ]);

    assert.equal(results.filter((r) => r.ok).length, 1);
    assert.equal(allUsers().length, 1);
  });

  await test("an expired invite cannot be redeemed", async () => {
    const { token } = await invited();
    allInvites()[0].expiresAt = new Date(Date.now() - 1000);

    const res = await redeemInvite({ token, password: "a-real-password" });
    assert.equal(res.ok, false);
    assert.equal(allUsers().length, 0, "the UI check is a courtesy; this is the one that matters");
  });

  await test("a revoked invite cannot be redeemed", async () => {
    const { token } = await invited();
    await revokeInvite(allInvites()[0].id as string);

    const res = await redeemInvite({ token, password: "a-real-password" });
    assert.equal(res.ok, false);
    assert.equal(allUsers().length, 0);
  });

  await test("an unknown token cannot be redeemed", async () => {
    await invited();
    const res = await redeemInvite({ token: newInviteToken(), password: "a-real-password" });
    assert.equal(res.ok, false);
  });

  await test("a failure mid-redemption rolls the claim back", async () => {
    const { token } = await invited();
    // Someone registers the address between the pre-check and the write — the
    // unique constraint fires inside the transaction.
    seedUser({ email: "owner@angelos.com" });

    const res = await redeemInvite({ token, password: "a-real-password" });
    assert.equal(res.ok, false);
    assert.equal(
      allInvites()[0].redeemedAt,
      null,
      "a consumed invite with no account behind it strands the recipient"
    );
  });

  // ---------------------------------------------------------------------------
  // Revoking and listing
  // ---------------------------------------------------------------------------

  await test("revoking is a timestamp, not a delete", async () => {
    await invited();
    await revokeInvite(allInvites()[0].id as string);
    assert.equal(allInvites().length, 1, "'who did we invite and when' is the audit trail");
    assert.notEqual(allInvites()[0].revokedAt, null);
  });

  await test("revoking a redeemed invite does nothing", async () => {
    const { token } = await invited();
    await redeemInvite({ token, password: "a-real-password" });
    await revokeInvite(allInvites()[0].id as string);
    assert.equal(allInvites()[0].revokedAt, null, "a used invite is history, not something to cancel");
  });

  await test("outstanding invites exclude redeemed, revoked and expired", async () => {
    const r = seedRestaurant();
    const id = r.id as string;

    const live = await createInvite({ restaurantId: id, email: "live@a.com" });
    const used = await createInvite({ restaurantId: id, email: "used@a.com" });
    const gone = await createInvite({ restaurantId: id, email: "gone@a.com" });
    const old = await createInvite({ restaurantId: id, email: "old@a.com" });
    if (!live.ok || !used.ok || !gone.ok || !old.ok) throw new Error("unreachable");

    await redeemInvite({ token: used.value.token, password: "a-real-password" });
    await revokeInvite(allInvites().find((i) => i.email === "gone@a.com")!.id as string);
    allInvites().find((i) => i.email === "old@a.com")!.expiresAt = new Date(Date.now() - 1000);

    const out = await outstandingInvites(id);
    assert.deepEqual(
      out.map((i) => i.email),
      ["live@a.com"]
    );
  });

}

main().then(
  () => console.log(`invites: ${passed} passed`),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
