// Paid bookings into the owner's Google Calendar and a Google Sheet.
//
// HOW
// Not the Google APIs. Those need a Google Cloud project, OAuth consent, a
// service account shared into the calendar and the sheet, and a client library,
// which is a lot of moving parts for one row and one event. Instead the owner
// pastes server/google-apps-script.gs into Extensions, Apps Script on his own
// sheet and deploys it as a web app. It runs as him, so it can already write to
// his sheet and his calendar, and this file only has to POST it some JSON.
//
// WHAT IS SENT
// The whole booking every time, never a diff, with `updatedMs`. The script
// upserts the sheet row by booking id and ignores anything older than what it
// already has, so two syncs that arrive out of order cannot put an accepted
// shoot back to "needs your OK".
//
// Only bookings that were paid for are sent. A hold that nobody paid for is
// noise in a calendar.
//
// ENV
//   GOOGLE_SCRIPT_URL     the web app URL Apps Script gives on deploy
//   GOOGLE_SCRIPT_SECRET  the same string as SECRET in the script's properties
// Either missing and nothing is sent, and the site does not care.
"use strict";

const SCRIPT_URL = (process.env.GOOGLE_SCRIPT_URL || "").trim();
const SECRET = (process.env.GOOGLE_SCRIPT_SECRET || "").trim();
const SHOOT_MS = 90 * 60 * 1000;

function configured() { return !!(SCRIPT_URL && SECRET); }

function why() {
  const missing = [];
  if (!SCRIPT_URL) missing.push("GOOGLE_SCRIPT_URL");
  if (!SECRET) missing.push("GOOGLE_SCRIPT_SECRET");
  return missing;
}

function statusLabel(b) {
  if (b.status === "cancelled") return b.decision === "declined" ? "Declined" : "Cancelled";
  if (b.status === "confirmed") return b.decision === "accepted" ? "Booked" : "Paid, needs your OK";
  return "Awaiting payment";
}

function payload(b, siteUrl) {
  const start = new Date(b.startsAt);
  return {
    id: b.id,
    status: b.status,
    decision: b.decision || "",
    statusLabel: statusLabel(b),
    accepted: b.decision === "accepted",
    onCalendar: b.status === "confirmed",
    date: b.date,
    time: b.time,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + SHOOT_MS).toISOString(),
    address: b.address,
    packageName: b.packageName,
    amount: Number(b.amount || 0),
    refunded: Number(b.refundedCents || 0) / 100,
    firstShoot: !!b.firstShoot,
    name: b.name,
    email: b.email,
    phone: b.phone,
    brokerage: b.brokerage || "",
    size: b.size || "",
    occupancy: b.occupancy || "",
    access: b.access || "",
    accessNotes: b.accessNotes || "",
    notes: b.notes || "",
    adminUrl: String(siteUrl || "").replace(/\/$/, "") + "/admin-bookings.html",
    updatedMs: Date.parse(b.updatedAt) || Date.now()
  };
}

async function push(event, b, siteUrl) {
  // Apps Script answers a POST with a 302 to script.googleusercontent.com. The
  // script has already run by then; following the redirect is how the reply is
  // read, and fetch follows it as a GET, which is what Google expects.
  const r = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: { "content-type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret: SECRET, event, booking: payload(b, siteUrl) }),
    redirect: "follow"
  });
  const text = await r.text().catch(() => "");
  let data = null;
  try { data = JSON.parse(text); } catch { /* an HTML error page from Google */ }
  if (!data) throw new Error(`Google replied ${r.status}: ${text.replace(/\s+/g, " ").slice(0, 160)}`);
  if (!data.ok) throw new Error(data.error || "the script refused it");
  return data;
}

// Fire and forget. A slow or broken Google must never hold up a webhook, a
// customer's success page or the owner's refund button. Every outcome is logged
// with the booking id.
function sync(event, b, siteUrl) {
  if (!configured() || !b || (b.status === "held" && !b.paid)) return;
  push(event, b, siteUrl)
    .then(() => console.log(`[ez-shots] ${b.id} synced to Google, ${event}`))
    .catch(e => console.error(`[ez-shots] ${b.id} Google sync failed, ${event}: ${e.message}`));
}

module.exports = { sync, configured, why, payload, push };
