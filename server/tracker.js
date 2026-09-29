// Telling the owner's tracker (Ez-Tracker) what just happened, so EZ Shots
// income lands in Money by itself instead of being copied over by hand.
//
// Two moments are reported: a booking is paid (a sale of what was paid, id
// `booking:<id>`, plus a signup the first time that client ever pays), and
// money goes back (a refund, id the Stripe refund id). The tracker keys each
// event on its id, so a retry never counts twice.
//
// Only when TRACKER_INGEST_URL (the tracker's base URL) and TRACKER_INGEST_KEY
// (this site's key from the tracker's INGEST_KEYS) are set, so a local run or
// the check scripts send nothing. Never throws and is capped at a few seconds:
// a booking must not fail because the tracker is down. No client name or
// email ever leaves here, only the package.

const TIMEOUT_MS = 3000;

async function send(events) {
  const base = String(process.env.TRACKER_INGEST_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.TRACKER_INGEST_KEY || "").trim();
  if (!base || !key || !events.length) return;
  try {
    const res = await fetch(base + "/api/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
      body: JSON.stringify({ events }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) console.error(`[ez-shots] tracker refused the report (${res.status})`);
  } catch (e) {
    console.error("[ez-shots] tracker report failed:", e.message);
  }
}

// A booking just became paid. `db` is used to ask whether this is the
// client's first paid shoot, which is what counts as a new client.
async function reportPaid(db, b) {
  if (!b || !b.paid) return;
  const at = (b.paidAt ? new Date(b.paidAt) : new Date()).toISOString();
  const events = [{
    type: "sale", id: "booking:" + b.id, amount_cents: Math.round(Number(b.amount || 0) * 100),
    at, label: b.packageName || "Shoot",
  }];
  try {
    const r = await db.query("SELECT count(*)::int AS n FROM bookings WHERE lower(email) = lower($1) AND paid", [b.email || ""]);
    if (r.rows[0] && r.rows[0].n === 1) events.push({ type: "signup", id: "client:" + b.id, at, label: "New client" });
  } catch (e) { /* the sale still goes */ }
  await send(events);
}

async function reportRefund(b, refundId, cents) {
  if (!b || !refundId) return;
  await send([{ type: "refund", id: "refund:" + refundId, amount_cents: Math.round(cents), label: b.packageName || "Shoot" }]);
}

module.exports = { reportPaid, reportRefund };
