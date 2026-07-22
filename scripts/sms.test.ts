/**
 * Tests for the SMS seam.
 *
 * The stub provider made all of this untestable in the only way that mattered:
 * it returned ok unconditionally, so "we texted them" and "nobody could
 * possibly have received this" produced identical rows. Every case below is a
 * distinction that was invisible until a real provider was put behind the
 * interface.
 *
 * Run with:
 *   npx tsx --tsconfig scripts/tsconfig.sms.json scripts/sms.test.ts
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { queueMessage, recordOptIn, recordOptOut, retryFailedMessages, setSmsProvider, MAX_SEND_RETRIES } from "../src/lib/sms";
import type { ProviderSendInput, SendResult, SmsProvider } from "../src/lib/sms";
import { verifyTwilioSignature } from "../src/lib/sms-twilio";
import { prisma, reset, seedCustomer, seedSuspension, written } from "./test-stubs/prisma-sms";

let passed = 0;
const only = process.argv[2];

async function test(name: string, fn: () => Promise<void>) {
  if (only && !name.includes(only)) return;
  reset();
  calls.length = 0;
  setSmsProvider(recorder);
  try {
    await fn();
    passed++;
  } catch (err) {
    console.error(`FAIL  ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RESTAURANT_ID = "rest_fixed";

/** Records what the provider was handed — the destination especially. */
const calls: ProviderSendInput[] = [];

const recorder: SmsProvider = {
  name: "recorder",
  async send(input) {
    calls.push(input);
    return { ok: true, ref: `SM${calls.length}` };
  },
};

const failing = (result: SendResult): SmsProvider => ({
  name: "failing",
  async send(input) {
    calls.push(input);
    return result;
  },
});

const last = () => written()[written().length - 1];

const TOKEN = "test_auth_token";

/**
 * Independent HMAC-SHA1, via node:crypto rather than WebCrypto.
 *
 * Deliberately a different implementation from the one under test. It can't
 * prove the payload *format* is what Twilio expects — the test above pins that
 * separately by writing the concatenation out by hand — but it does catch the
 * encoding and base64 mistakes that a self-signed round-trip would hide.
 */
function reference(payload: string, token: string): string {
  return createHmac("sha1", token).update(payload, "utf8").digest("base64");
}

async function main() {

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

  await test("STOP blocks transactional messages too, not just marketing", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230001",
      optInStatus: "OPTED_OUT",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "your order is ready",
    });

    // The old gate only ran for marketing kinds, so someone who texted STOP kept
    // getting order updates. Carriers do not make that distinction and neither
    // can we — this is the case that gets a sending number filtered.
    assert.equal(calls.length, 0);
    assert.equal(last().status, "SKIPPED");
    assert.equal(last().error, "opted_out");
  });

  await test("transactional reaches a customer who never opted into marketing", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230002",
      optInStatus: "UNKNOWN",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "your order is ready",
    });

    // "Your order is ready" is not a promotion. Tightening the opt-out rule
    // above must not have tightened this one.
    assert.equal(calls.length, 1);
    assert.equal(last().status, "SENT");
  });

  await test("marketing is refused without an explicit opt-in", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230003",
      optInStatus: "UNKNOWN",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "WIN_BACK",
      body: "we miss you",
    });

    assert.equal(calls.length, 0);
    assert.equal(last().error, "no_opt_in");
  });

  await test("the holdout cohort is never messaged", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230004",
      optInStatus: "OPTED_IN",
      cohort: "HOLDOUT",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "FIRST_REORDER",
      body: "come back",
    });

    assert.equal(calls.length, 0);
    assert.equal(last().error, "holdout_cohort");
  });

// ---------------------------------------------------------------------------
// Destination resolution
// ---------------------------------------------------------------------------

  await test("the destination is resolved from the customer and recorded", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230005",
      optInStatus: "OPTED_IN",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "hello",
    });

    assert.equal(calls[0].to, "+15551230005");
    // Recorded on the row as well as passed to the provider: the number can
    // change afterwards, and the question asked later is where this one went.
    assert.equal(last().to, "+15551230005");
  });

  await test("an unusable number is a skip, not a silent success", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "12345",
      optInStatus: "OPTED_IN",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "hello",
    });

    // Under the stub this customer looked exactly like one who got their text.
    assert.equal(calls.length, 0);
    assert.equal(last().status, "SKIPPED");
    assert.equal(last().error, "no_destination");
  });

  await test("a customerId pointing at nothing is recorded rather than sent blind", async () => {
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: "cust_missing",
      kind: "TRANSACTIONAL",
      body: "hello",
    });

    assert.equal(calls.length, 0);
    assert.equal(last().error, "customer_not_found");
  });

  await test("an explicit destination works with no customer behind it", async () => {
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      kind: "TRANSACTIONAL",
      body: "owner alert",
      to: "(555) 123-0006",
    });

    // Normalised on the way through, so callers don't each have to.
    assert.equal(calls[0].to, "+15551230006");
  });

// ---------------------------------------------------------------------------
// Failure recording
// ---------------------------------------------------------------------------

  await test("a provider failure is recorded as FAILED with no sentAt", async () => {
    setSmsProvider(failing({ ok: false, error: "21614: landline", retryable: false }));

    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230007",
      optInStatus: "OPTED_IN",
    });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "hello",
    });

    assert.equal(last().status, "FAILED");
    assert.equal(last().error, "21614: landline");
    assert.equal(last().sentAt, null);
    // Still carries the destination — a failure you can't attribute to a number
    // is most of the way to no failure record at all.
    assert.equal(last().to, "+15551230007");
  });

// ---------------------------------------------------------------------------
// Opt-out bookkeeping
// ---------------------------------------------------------------------------

  await test("recordOptOut sets the status and keeps the first timestamp", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230008",
      optInStatus: "OPTED_IN",
    });

    await recordOptOut(RESTAURANT_ID, "+15551230008");
    const first = (await prisma.customer.findUnique({ where: { id: c.id } }))!;
    assert.equal(first.optInStatus, "OPTED_OUT");
    const stamp = first.optOutAt;

    await recordOptOut(RESTAURANT_ID, "(555) 123-0008");
    const second = (await prisma.customer.findUnique({ where: { id: c.id } }))!;

    // The first STOP is the one that matters if consent is ever questioned.
    assert.equal(second.optOutAt, stamp);
  });

  await test("START undoes STOP without manufacturing marketing consent", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230009",
      optInStatus: "OPTED_OUT",
      optOutAt: new Date(),
    });

    await recordOptIn(RESTAURANT_ID, "+15551230009");
    const after = (await prisma.customer.findUnique({ where: { id: c.id } }))!;

    // UNKNOWN, not OPTED_IN. Texting START is not the express written consent
    // marketing requires, and recording it as such would invent a consent record
    // that never happened.
    assert.equal(after.optInStatus, "UNKNOWN");
    assert.equal(after.optOutAt, null);
  });

  await test("START does not touch a customer who had opted in properly", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230010",
      optInStatus: "OPTED_IN",
    });

    await recordOptIn(RESTAURANT_ID, "+15551230010");
    const after = (await prisma.customer.findUnique({ where: { id: c.id } }))!;

    // Otherwise a stray START would downgrade a real opt-in to UNKNOWN.
    assert.equal(after.optInStatus, "OPTED_IN");
  });

  await test("opt-out is scoped to one tenant", async () => {
    const a = seedCustomer({ restaurantId: "rest_a", phone: "+15551230011", optInStatus: "OPTED_IN" });
    const b = seedCustomer({ restaurantId: "rest_b", phone: "+15551230011", optInStatus: "OPTED_IN" });

    await recordOptOut("rest_a", "+15551230011");

    // Same person, same number, two restaurants. Telling one to stop is not
    // telling the other — they're separate senders and separate consent.
    assert.equal((await prisma.customer.findUnique({ where: { id: a.id } }))!.optInStatus, "OPTED_OUT");
    assert.equal((await prisma.customer.findUnique({ where: { id: b.id } }))!.optInStatus, "OPTED_IN");
  });

// ---------------------------------------------------------------------------
// Webhook authentication
// ---------------------------------------------------------------------------

  await test("the signed payload is the URL plus params in sorted key order", async () => {
    // Pinning the concatenation rule rather than the hash. This is the part
    // that is easy to get subtly wrong — insertion order instead of sorted,
    // separators between pairs, the query string dropped from the URL — and
    // every one of those mistakes rejects every real Twilio request while
    // still passing a test that only ever checks a signature against itself.
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const params = { Digits: "1234", To: "+18005551212", From: "+14158675310" };

    const expected =
      url + "Digits1234" + "From+14158675310" + "To+18005551212";

    const ok = await verifyTwilioSignature(url, params, reference(expected, TOKEN), TOKEN);
    assert.equal(ok, true);
  });

  await test("signature verification rejects a tampered parameter", async () => {
    const url = "https://mycompany.com/myapp.php?foo=1&bar=2";
    const signed = { Digits: "1234", To: "+18005551212" };
    const signature = reference(url + "Digits1234To+18005551212", TOKEN);

    // Without this check, anyone who learns the webhook URL can opt an
    // arbitrary customer out — or, worse, opt one back in.
    const tampered = { Digits: "1234", To: "+18005551213" };
    assert.equal(await verifyTwilioSignature(url, tampered, signature, TOKEN), false);

    // Sanity: the untampered version does pass, so the assertion above is
    // catching the edit and not some unrelated breakage.
    assert.equal(await verifyTwilioSignature(url, signed, signature, TOKEN), true);
  });

  await test("signature verification rejects a signature from the wrong token", async () => {
    const url = "https://mycompany.com/hook";
    const signature = reference(url + "Digits1", "some-other-account-token");

    assert.equal(await verifyTwilioSignature(url, { Digits: "1" }, signature, TOKEN), false);
  });

  await test("signature verification rejects a malformed signature", async () => {
    assert.equal(await verifyTwilioSignature("https://x/y", {}, "short", TOKEN), false);
  });

// ---------------------------------------------------------------------------
// The retry queue
// ---------------------------------------------------------------------------

  await test("a transient failure is retried and goes through", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230101",
      optInStatus: "OPTED_IN",
    });

    // First attempt times out — retryable.
    setSmsProvider(failing({ ok: false, error: "timeout", retryable: true }));
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A1 is ready",
    });

    assert.equal(last().status, "FAILED");
    assert.equal(last().retryable, true, "a timeout must be marked worth retrying");
    assert.equal(last().attempts, 1);

    // Provider recovers; the sweep re-sends the same row.
    setSmsProvider(recorder);
    const sent = await retryFailedMessages();

    assert.equal(sent, 1);
    assert.equal(last().status, "SENT");
    assert.equal(last().attempts, 2, "the retry counts against the same row");
    assert.equal(last().retryable ?? null, null, "a sent message is no longer in the queue");
    assert.equal(written().length, 1, "retry reuses the row rather than writing a new one");
  });

  await test("a permanent failure is never retried", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230102",
      optInStatus: "OPTED_IN",
    });

    setSmsProvider(failing({ ok: false, error: "21614: not a mobile number", retryable: false }));
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A2 is ready",
    });

    assert.equal(last().retryable, false);

    setSmsProvider(recorder);
    const callsBefore = calls.length;
    const sent = await retryFailedMessages();

    assert.equal(sent, 0, "a landline never gets a second text");
    assert.equal(calls.length, callsBefore, "the sweep must not even reach the provider");
    assert.equal(last().status, "FAILED");
    assert.equal(last().attempts, 1);
  });

  await test("retrying stops at the cap instead of looping forever", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230103",
      optInStatus: "OPTED_IN",
    });

    setSmsProvider(failing({ ok: false, error: "timeout", retryable: true }));
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A3 is ready",
    });

    // Far more sweeps than the cap. attempts must never climb past it.
    for (let i = 0; i < 10; i++) await retryFailedMessages();

    assert.equal(last().attempts, MAX_SEND_RETRIES, "attempts is capped");
    assert.equal(last().status, "FAILED");
    assert.equal(await retryFailedMessages(), 0, "past the cap the sweep leaves it alone");
  });

  await test("a STOP between attempts halts the retry", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230104",
      optInStatus: "OPTED_IN",
    });

    setSmsProvider(failing({ ok: false, error: "timeout", retryable: true }));
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A4 is ready",
    });
    assert.equal(last().retryable, true);

    // The customer replies STOP before the sweep runs again.
    await prisma.customer.update({ where: { id: c.id as string }, data: { optInStatus: "OPTED_OUT" } });

    setSmsProvider(recorder);
    const callsBefore = calls.length;
    const sent = await retryFailedMessages();

    assert.equal(sent, 0, "opt-out beats a pending transactional retry");
    assert.equal(calls.length, callsBefore, "and never reaches the provider");
    assert.equal(last().retryable, false, "the row drops out of the queue");
    assert.equal(last().error, "opted_out");
  });

  // -------------------------------------------------------------------------
  // Service suspension — the platform's switch, not the customer's
  // -------------------------------------------------------------------------

  await test("suspension blocks a transactional send", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230000",
      optInStatus: "OPTED_IN",
    });
    seedSuspension({ restaurantId: RESTAURANT_ID, service: "SMS", reason: "unpaid invoice" });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A4 is ready",
    });

    assert.equal(calls.length, 0, "nothing reaches the provider");
    assert.equal(last().status, "SKIPPED");
    assert.equal(last().error, "service_suspended");
  });

  await test("suspension outranks a valid opt-in", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230001",
      optInStatus: "OPTED_IN",
    });
    seedSuspension({ restaurantId: RESTAURANT_ID, service: "SMS" });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "MARKETING",
      body: "two for one tuesday",
    });

    assert.equal(last().error, "service_suspended", "checked before consent, not after");
    assert.equal(calls.length, 0);
  });

  await test("a suspension on another tenant doesn't leak", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230002",
      optInStatus: "OPTED_IN",
    });
    seedSuspension({ restaurantId: "rest_someone_else", service: "SMS" });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A5 is ready",
    });

    assert.equal(last().status, "SENT");
    assert.equal(calls.length, 1);
  });

  await test("a PAYMENTS suspension does not stop texts", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230003",
      optInStatus: "OPTED_IN",
    });
    seedSuspension({ restaurantId: RESTAURANT_ID, service: "PAYMENTS" });

    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A6 is ready",
    });

    assert.equal(last().status, "SENT", "services are suspended independently");
  });

  await test("the retry sweep skips a suspended tenant but keeps the row", async () => {
    const c = seedCustomer({
      restaurantId: RESTAURANT_ID,
      phone: "+15551230004",
      optInStatus: "OPTED_IN",
    });

    setSmsProvider(failing({ ok: false, error: "timeout", retryable: true }));
    await queueMessage({
      restaurantId: RESTAURANT_ID,
      customerId: c.id as string,
      kind: "TRANSACTIONAL",
      body: "order A7 is ready",
    });
    assert.equal(last().retryable, true);

    // Suspended after the failure, before the sweep.
    seedSuspension({ restaurantId: RESTAURANT_ID, service: "SMS" });

    setSmsProvider(recorder);
    const callsBefore = calls.length;
    const sent = await retryFailedMessages();

    assert.equal(sent, 0, "the sweep must not drain a suspended tenant's backlog");
    assert.equal(calls.length, callsBefore);
    assert.equal(
      last().retryable,
      true,
      "left retryable — unlike an opt-out, service may come back"
    );
  });

}

main().then(
  () => console.log(`sms: ${passed} passed`),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
