// Sync a confirmed EZ Shots booking into the owner's HighLevel sub-account.
//
// The website only needs the contacts.write scope. It upserts the contact,
// then adds one tag without replacing any existing tags or touching DND / opt-
// out fields. The published GHL workflow triggered by that tag moves the
// opportunity to Booked and removes the contact from every sales/nurture flow.

// The booking response never waits for HighLevel. Failures retry once and are
// logged, matching the existing owner-CRM integration's failure isolation.

"use strict";

const BASE = "https://services.leadconnectorhq.com";
const TIMEOUT_MS = 5000;
const RETRY_MS = 30 * 1000;

function settings() {
  return {
    locationId: String(process.env.GHL_LOCATION_ID || "").trim(),
    token: String(process.env.GHL_PRIVATE_TOKEN || "").trim(),
    tag: String(process.env.GHL_BOOKED_TAG || "ezshots-booked").trim() || "ezshots-booked",
  };
}

function configured() {
  const s = settings();
  return Boolean(s.locationId && s.token);
}

async function request(path, body, fetchImpl) {
  const s = settings();
  const res = await fetchImpl(BASE + path, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: "Bearer " + s.token,
      Version: "v3",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const error = new Error(`HighLevel answered ${res.status}: ${text.slice(0, 240)}`);
    error.permanent = res.status >= 400 && res.status < 500;
    throw error;
  }
  return res.json().catch(() => ({}));
}

async function sync(booking, fetchImpl = fetch) {
  if (!configured() || !booking || !(booking.email || booking.phone)) return { skipped: true };
  const s = settings();
  const upserted = await request("/contacts/upsert", {
    locationId: s.locationId,
    name: booking.name || "EZ Shots customer",
    email: booking.email || undefined,
    phone: booking.phone || undefined,
    address1: booking.address || undefined,
    source: "EZ Shots website booking",
    createNewIfDuplicateAllowed: false,
  }, fetchImpl);
  const contactId = upserted && upserted.contact && upserted.contact.id;
  if (!contactId) throw new Error("HighLevel upsert returned no contact id");
  await request(`/contacts/${encodeURIComponent(contactId)}/tags`, { tags: [s.tag] }, fetchImpl);
  return { contactId, tag: s.tag };
}

function report(booking) {
  if (!configured() || !booking) return;
  sync(booking).catch((first) => {
    if (first.permanent) {
      console.error(`[ez-shots] HighLevel booking sync for ${booking.id || "unknown"} refused: ${first.message}`);
      return;
    }
    setTimeout(() => sync(booking).catch((second) => {
      console.error(`[ez-shots] HighLevel booking sync for ${booking.id || "unknown"} failed twice: ${second.message} (first: ${first.message})`);
    }), RETRY_MS).unref();
  });
}

module.exports = { configured, report, sync };
