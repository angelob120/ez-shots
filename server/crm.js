// Telling the owner's Realtor CRM what just happened to a shoot, so the sales
// pipeline keeps itself up to date: an agent who books moves to Booked with a
// follow-up on the shoot day, a cancellation puts them back in Follow Up, a
// payment tags them a client and sets a follow-up to ask about the next
// listing. The rules for what each event does live in the CRM
// (realtor-crm, server/bookings.js); this file only reports.
//
// Events: booked, moved, shot, ready, paid, cancelled, unhappy. Each has an id
// (booking:<id>:<event>) the CRM keys on, so a retry never logs twice.
//
// Only when CRM_URL (the CRM's address) and CRM_SITE_KEY (SITE_API_KEY on the
// CRM) are set, so a local run or the check scripts send nothing. Never throws
// and never holds up a booking: it runs after the answer has gone, waits a few
// seconds at most, and tries once more half a minute later if the CRM was
// down or redeploying. Unlike the tracker report, the agent's name, number,
// email and address do go, because the CRM is the owner's own list of them.

const TIMEOUT_MS = 4000;
const RETRY_MS = 30 * 1000;

function configured() {
  return Boolean(String(process.env.CRM_URL || "").trim() && String(process.env.CRM_SITE_KEY || "").trim());
}

async function post(payload) {
  const base = String(process.env.CRM_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.CRM_SITE_KEY || "").trim();
  const res = await fetch(base + "/api/integrations/site/bookings", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // 4xx is a payload or key problem: retrying would get the same answer.
  if (res.status >= 400 && res.status < 500) {
    const text = await res.text().catch(() => "");
    console.error(`[ez-shots] CRM refused the ${payload.event} report (${res.status}) ${text.slice(0, 200)}`);
    return true;
  }
  if (!res.ok) throw new Error(`CRM answered ${res.status}`);
  return true;
}

// A cancellation only sends the agent back to Follow Up if this was their
// only shoot on the books. With another one still coming, the CRM just logs it.
async function otherUpcoming(db, b) {
  try {
    const r = await db.query(
      `SELECT 1 FROM bookings WHERE id <> $1 AND status = 'confirmed' AND coalesce(stage, 'booked') IN ('booked', 'shot', 'ready')
         AND (lower(email) = lower($2) OR regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $3)
       LIMIT 1`,
      [b.id, b.email || "", String(b.phone || "").replace(/\D/g, "").slice(-10) || "-"],
    );
    return r.rows.length > 0;
  } catch (e) { return false; }
}

function reportCancelled(db, b, by) {
  if (!configured() || !b) return;
  otherUpcoming(db, b).then((other) => report("cancelled", b, { by, otherUpcoming: other }));
}

// `b` is publicBooking(...) of the booking after the change.
function report(event, b, extra = {}) {
  if (!configured() || !b || !(b.phone || b.email)) return;
  if (event === "paid" && !b.paid) return;
  const payload = {
    event,
    bookingId: String(b.id),
    name: b.name || "", phone: b.phone || "", email: b.email || "", brokerage: b.brokerage || "",
    address: b.address || "", date: b.date || "", time: b.time || "", when: b.when || "",
    packageName: b.packageName || "", amount: b.amount,
    ...extra,
  };
  // One booking's events go in the order they happened (booked before paid),
  // each waiting for the one before it, retry included.
  const key = String(b.id);
  const run = () => post(payload).catch((e) => new Promise((resolve) => {
    setTimeout(() => post(payload).catch((e2) => {
      console.error(`[ez-shots] CRM ${event} report for ${b.id} failed twice: ${e2.message} (first: ${e.message})`);
    }).then(resolve), RETRY_MS).unref();
  }));
  const next = (queues.get(key) || Promise.resolve()).then(run);
  queues.set(key, next);
  next.then(() => { if (queues.get(key) === next) queues.delete(key); });
}

const queues = new Map();

module.exports = { report, reportCancelled, configured };
