/**
 * Tests for the pure half of marketing campaigns.
 *
 * Four things are covered here, and each one is a way for real money or a
 * tenant's sending reputation to be lost quietly:
 *
 *   1. **The status machine.** The absent edges are the point. Nothing returns
 *      from SENT, CANCELED or FAILED, and there is no SENDING → DRAFT — a
 *      campaign whose messages are on the wire cannot go back to being a draft,
 *      and an edge that allowed it would let an owner rewrite a message that
 *      people are currently receiving.
 *   2. **Segment arithmetic.** SMS is billed per segment per recipient and the
 *      boundary is invisible: one curly apostrophe drops the budget from 160
 *      characters to 70 and triples the bill across a whole list. A counter
 *      that under-reports is worse than no counter, because it is trusted.
 *   3. **Merge fields**, and specifically the fallback. An empty `{{name}}` is
 *      a customer receiving "Hi , we miss you" — and most customers have no
 *      name on file, so this is the common case rather than the edge.
 *   4. **The validator.** Every branch that returns no errors is a message
 *      going out under a restaurant's name to its entire customer list.
 *
 * Pure — no Prisma, no request context, which is why the pure half lives in
 * `lib/campaign-format.ts` rather than in the `server-only` module beside it.
 *
 *   npx tsx scripts/campaigns.test.ts
 */

import assert from "node:assert/strict";
import {
  MAX_SMS_SEGMENTS,
  canTransition,
  isEditable,
  isGsm7,
  isTerminal,
  renderMergeFields,
  skipReasonLabel,
  smsLength,
  validateCampaign,
  worstCaseBody,
  type CampaignDraft,
} from "../src/lib/campaign-format";

let passed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// The status machine
// ---------------------------------------------------------------------------

test("a draft can be scheduled, sent or canceled", () => {
  assert.equal(canTransition("DRAFT", "SCHEDULED"), true);
  assert.equal(canTransition("DRAFT", "SENDING"), true);
  assert.equal(canTransition("DRAFT", "CANCELED"), true);
});

test("a schedule can be undone back to a draft — nothing has been sent yet", () => {
  assert.equal(canTransition("SCHEDULED", "DRAFT"), true);
});

test("SENDING never returns to DRAFT", () => {
  // The edge this file exists to keep absent. Recipient rows exist and some
  // have already left the building; "put it back in drafts" is a lie about
  // what happened, and it would let the body be rewritten mid-send.
  assert.equal(canTransition("SENDING", "DRAFT"), false);
  assert.equal(canTransition("SENDING", "SCHEDULED"), false);
});

test("SENDING can finish, be stopped, or fail", () => {
  assert.equal(canTransition("SENDING", "SENT"), true);
  assert.equal(canTransition("SENDING", "CANCELED"), true);
  assert.equal(canTransition("SENDING", "FAILED"), true);
});

test("terminal states are terminal", () => {
  for (const s of ["SENT", "CANCELED", "FAILED"] as const) {
    assert.equal(isTerminal(s), true, `${s} should be terminal`);
    for (const to of ["DRAFT", "SCHEDULED", "SENDING", "SENT"] as const) {
      assert.equal(canTransition(s, to), false, `${s} → ${to} must not be allowed`);
    }
  }
});

test("a sent campaign cannot be resent", () => {
  assert.equal(canTransition("SENT", "SENDING"), false);
});

test("only drafts and schedules are editable", () => {
  assert.equal(isEditable("DRAFT"), true);
  assert.equal(isEditable("SCHEDULED"), true);
  assert.equal(isEditable("SENDING"), false);
  assert.equal(isEditable("SENT"), false);
  assert.equal(isEditable("CANCELED"), false);
  assert.equal(isEditable("FAILED"), false);
});

// ---------------------------------------------------------------------------
// Segment arithmetic
// ---------------------------------------------------------------------------

test("plain ASCII is GSM-7", () => {
  assert.equal(isGsm7("Pizza night! Half price till 8."), true);
});

test("a curly apostrophe is not GSM-7", () => {
  // The single most common real cause: pasted from a word processor, visually
  // identical to the straight quote beside it, and it halves the segment size
  // for the entire message.
  assert.equal(isGsm7("Don’t miss it"), false);
  assert.equal(isGsm7("Don't miss it"), true);
});

test("an em dash is not GSM-7", () => {
  assert.equal(isGsm7("Open late — come by"), false);
});

test("emoji force UCS-2", () => {
  assert.equal(isGsm7("Pizza 🍕"), false);
});

test("160 GSM-7 characters is one segment", () => {
  const r = smsLength("a".repeat(160));
  assert.equal(r.segments, 1);
  assert.equal(r.encoding, "GSM-7");
});

test("161 GSM-7 characters is two segments, not one and a bit", () => {
  // The concatenation header costs 7 characters per segment, so the budget
  // drops to 153 — which is why 161 is two rather than one plus a remainder.
  assert.equal(smsLength("a".repeat(161)).segments, 2);
  assert.equal(smsLength("a".repeat(306)).segments, 2);
  assert.equal(smsLength("a".repeat(307)).segments, 3);
});

test("70 UCS-2 characters is one segment, 71 is two", () => {
  const base = "’"; // curly apostrophe — forces UCS-2
  assert.equal(smsLength(base.repeat(70)).segments, 1);
  assert.equal(smsLength(base.repeat(71)).segments, 2);
  assert.equal(smsLength(base.repeat(67 * 2)).segments, 2);
});

test("extended GSM characters cost two septets each", () => {
  // A message of 100 braces is 200 septets, which is two segments — counting
  // them as one each would report one segment and bill for two.
  const r = smsLength("{".repeat(100));
  assert.equal(r.encoding, "GSM-7");
  assert.equal(r.chars, 200);
  assert.equal(r.segments, 2);
});

test("the euro sign is GSM-7 extended, not UCS-2", () => {
  const r = smsLength("€");
  assert.equal(r.encoding, "GSM-7");
  assert.equal(r.chars, 2);
});

test("an empty body is zero segments", () => {
  assert.equal(smsLength("").segments, 0);
});

test("the offending character is reported so an owner can fix it", () => {
  const r = smsLength("Open late — come by");
  assert.equal(r.encoding, "UCS-2");
  assert.equal(r.nonGsmSample, "—");
});

test("nonGsmSample is null when the message is clean", () => {
  assert.equal(smsLength("all fine").nonGsmSample, null);
});

// ---------------------------------------------------------------------------
// Merge fields
// ---------------------------------------------------------------------------

test("{{name}} renders the first name only", () => {
  const out = renderMergeFields("Hi {{name}}!", {
    customerName: "Ada Lovelace",
    restaurantName: "Sal's",
  });
  assert.equal(out, "Hi Ada!");
});

test("{{name}} falls back rather than rendering empty", () => {
  // The failure this guards is "Hi , we miss you" — and since most customers
  // arrive through checkout with no name, it is the common path, not the edge.
  for (const name of [null, "", "   "]) {
    const out = renderMergeFields("Hi {{name}}!", {
      customerName: name,
      restaurantName: "Sal's",
    });
    assert.equal(out, "Hi there!", `name=${JSON.stringify(name)}`);
  }
});

test("{{restaurant}} renders the restaurant name", () => {
  assert.equal(
    renderMergeFields("Thanks from {{restaurant}}", {
      customerName: "Ada",
      restaurantName: "Sal's Pizza",
    }),
    "Thanks from Sal's Pizza",
  );
});

test("merge tokens are matched loosely and case-insensitively", () => {
  const out = renderMergeFields("{{ NAME }} at {{Restaurant}}", {
    customerName: "Ada",
    restaurantName: "Sal's",
  });
  assert.equal(out, "Ada at Sal's");
});

test("every occurrence is replaced, not just the first", () => {
  const out = renderMergeFields("{{name}} {{name}}", {
    customerName: "Ada",
    restaurantName: "Sal's",
  });
  assert.equal(out, "Ada Ada");
});

test("an unknown token is left alone rather than blanked", () => {
  // Leaving it visible means the owner sees their typo in the preview. Blanking
  // it means they ship "Come in on  for " and find out from a customer.
  const out = renderMergeFields("See you {{day}}", {
    customerName: "Ada",
    restaurantName: "Sal's",
  });
  assert.equal(out, "See you {{day}}");
});

test("worstCaseBody substitutes a long name rather than leaving the token", () => {
  // The token itself is not a fair stand-in for what it renders to, and the
  // direction of the error is not even constant: `{` and `}` are GSM-7
  // *extended* characters costing two septets each, so `{{name}}` counts as 12
  // while "Ada" counts as 3 — the template can read longer than the message.
  // What matters is that the estimate is made against a rendered message at
  // all, because a short-name estimate is billed against everybody's name.
  const out = worstCaseBody("Hi {{name}}, from {{restaurant}}", "Sal's");
  assert.ok(!out.includes("{{"), "no tokens should survive worst-case rendering");
  assert.ok(out.includes("Sal's"));
  assert.ok(out.length > "Hi Ada, from Sal's".length, "should assume a long name");
});

test("a long name can push a borderline message over the segment limit", () => {
  // 604 a's plus the rendered name is 615 characters — over the 612 that four
  // GSM-7 segments hold. An owner who wrote this and was told "4 segments"
  // would be billed for 5 on every customer with a long first name.
  const body = `${"a".repeat(604)}{{name}}`;
  assert.ok(smsLength(worstCaseBody(body, "Sal's")).segments > MAX_SMS_SEGMENTS);
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function draft(over: Partial<CampaignDraft> = {}): CampaignDraft {
  return {
    name: "Tuesday special",
    channel: "SMS",
    body: "Half price pizza tonight.",
    ...over,
  };
}

const fieldsOf = (errs: { field: string }[]) => errs.map((e) => e.field);

test("a reasonable SMS draft validates", () => {
  assert.deepEqual(validateCampaign(draft()), []);
});

test("a campaign needs a name", () => {
  assert.ok(fieldsOf(validateCampaign(draft({ name: "   " }))).includes("name"));
});

test("a campaign needs a body", () => {
  assert.ok(fieldsOf(validateCampaign(draft({ body: "  \n " }))).includes("body"));
});

test("an over-long SMS is refused, not merely warned about", () => {
  const errs = validateCampaign(draft({ body: "a".repeat(160 * MAX_SMS_SEGMENTS + 200) }));
  assert.ok(fieldsOf(errs).includes("body"));
});

test("a UCS-2 message hits the segment limit far sooner", () => {
  // 300 curly apostrophes is ~5 UCS-2 segments but would be 2 in GSM-7. If the
  // validator ignored encoding this would pass, and the owner would be billed
  // for more than double what the composer implied.
  const body = "’".repeat(300);
  assert.ok(fieldsOf(validateCampaign(draft({ body }))).includes("body"));
});

test("email requires a subject", () => {
  const errs = validateCampaign(draft({ channel: "EMAIL", subject: "" }));
  assert.ok(fieldsOf(errs).includes("subject"));
});

test("a whitespace-only subject is not a subject", () => {
  const errs = validateCampaign(draft({ channel: "EMAIL", subject: "   " }));
  assert.ok(fieldsOf(errs).includes("subject"));
});

test("a valid email draft passes", () => {
  assert.deepEqual(
    validateCampaign(draft({ channel: "EMAIL", subject: "Half price Tuesday" })),
    [],
  );
});

test("email is not held to the SMS segment limit", () => {
  // The limit exists because texts are billed per segment. Applying it to email
  // would refuse an ordinary newsletter.
  const errs = validateCampaign(
    draft({ channel: "EMAIL", subject: "Newsletter", body: "a".repeat(5000) }),
  );
  assert.deepEqual(errs, []);
});

test("a subject on an SMS campaign is an error, not silently dropped", () => {
  // Silently dropping it means an owner who switched channel mid-compose loses
  // their subject line without being told.
  const errs = validateCampaign(draft({ channel: "SMS", subject: "Oops" }));
  assert.ok(fieldsOf(errs).includes("subject"));
});

test("an over-long email subject is refused", () => {
  const errs = validateCampaign(
    draft({ channel: "EMAIL", subject: "x".repeat(200), body: "hi" }),
  );
  assert.ok(fieldsOf(errs).includes("subject"));
});

test("an over-long email body is refused", () => {
  const errs = validateCampaign(
    draft({ channel: "EMAIL", subject: "Hi", body: "x".repeat(20_001) }),
  );
  assert.ok(fieldsOf(errs).includes("body"));
});

test("validation counts merge fields at their rendered length", () => {
  // Right at the boundary: the raw body fits, the rendered one doesn't.
  const body = `${"a".repeat(MAX_SMS_SEGMENTS * 153 - 8)}{{name}}`;
  const errs = validateCampaign(draft({ body }));
  assert.ok(
    fieldsOf(errs).includes("body"),
    "a body that only fits before merge substitution must be refused",
  );
});

// ---------------------------------------------------------------------------
// Skip reasons
// ---------------------------------------------------------------------------

test("every skip reason the send gates can write has owner-facing wording", () => {
  // The gates in lib/sms.ts and lib/email.ts write these strings. An unlabelled
  // one renders as a raw identifier on the results page, which reads as the
  // platform being broken rather than as the law working.
  const written = [
    "no_opt_in",
    "opted_out",
    "unsubscribed",
    "bounced",
    "complained",
    "holdout_cohort",
    "no_destination",
    "no_subject",
    "service_suspended",
    "campaign_canceled",
    "customer_not_found",
    "restaurant_not_found",
  ];
  for (const r of written) {
    const label = skipReasonLabel(r);
    assert.notEqual(label, r, `${r} has no human label`);
    assert.ok(label.length > 3, `${r} label is too short to explain anything`);
  }
});

test("an unrecognised reason falls back to itself rather than to nothing", () => {
  assert.equal(skipReasonLabel("something_new"), "something_new");
  assert.equal(skipReasonLabel(null), "Unknown");
});

console.log(`campaigns: ${passed} passed`);
