// The five things this server says to Stripe, with no SDK: create a Checkout
// Session, read one back, refund one, and check a webhook signature. Node's fetch and
// crypto are enough, and the one dependency this repo had was already too many.
"use strict";

const crypto = require("node:crypto");

// Overridable only so scripts/check-decisions.mjs can point it at a fake Stripe
// and prove the refund path without moving a cent.
const API = (process.env.STRIPE_API_BASE || "https://api.stripe.com").replace(/\/$/, "");

// Stripe wants form encoded bodies with bracketed keys.
function formEncode(obj, prefix = "", out = []) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") formEncode(v, key, out);
    else out.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(v)));
  }
  return out.join("&");
}

async function call(key, method, route, payload, extra = {}) {
  const headers = Object.assign({ authorization: "Bearer " + key }, extra);
  let body;
  if (payload) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = formEncode(payload);
  }
  const r = await fetch(API + route, { method, headers, body });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error((data.error && data.error.message) || ("Stripe replied " + r.status));
    err.stripe = data.error || null;
    throw err;
  }
  return data;
}

// One session per booking. The idempotency key is the booking id, so a retry
// for the same hold gets the same session back instead of a second one.
function createSession(key, payload, bookingId) {
  return call(key, "POST", "/v1/checkout/sessions", payload, { "idempotency-key": "book-" + bookingId });
}

// Money back on the payment a Checkout Session took, in cents. The caller builds
// the idempotency key from the booking and what had already been refunded, so a
// double click is one refund, and a later second partial refund is not mistaken
// for the first.
function refund(key, paymentIntent, cents, idempotencyKey, metadata) {
  return call(key, "POST", "/v1/refunds",
    { payment_intent: paymentIntent, amount: cents, reason: "requested_by_customer", metadata },
    { "idempotency-key": idempotencyKey });
}

function getSession(key, id) {
  return call(key, "GET", "/v1/checkout/sessions/" + encodeURIComponent(id));
}

// As Stripe documents it: the header carries a timestamp and one or more v1
// signatures, each the HMAC SHA256 of "<timestamp>.<raw body>" under the
// endpoint secret. The raw bytes, not a re-serialised object, or nothing
// matches.
function verifySignature(secret, header, raw, now = Date.now(), toleranceSec = 300) {
  const parts = String(header || "").split(",").map(s => s.trim().split("="));
  const t = parts.find(p => p[0] === "t");
  const sigs = parts.filter(p => p[0] === "v1").map(p => p[1] || "");
  if (!t || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t[1])) > toleranceSec) return false;
  const want = crypto.createHmac("sha256", secret).update(t[1] + ".").update(raw).digest("hex");
  return sigs.some(s => s.length === want.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(want)));
}

module.exports = { createSession, getSession, refund, verifySignature };
