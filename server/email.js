// The emails that go out when a shoot is paid for: one to the owner so he knows
// to show up, one to the customer so he knows it worked.
//
// WHY THIS IS ON THE SERVER AND NOT IN THE BROWSER
// EmailJS is a browser library and the rest of the site uses it that way, in
// js/contact-form.js. These two cannot work that way. The moment a booking
// becomes real is Stripe's webhook, which arrives here with no browser
// involved at all. Send from booked.html instead and every customer who pays
// and closes the tab, or whose phone drops the redirect, gets no confirmation
// and the owner gets no notification, for a shoot that is paid for and on the
// calendar. EmailJS has a REST endpoint for exactly this; the private key is
// what makes it work off a browser.
//
// ENV
//   EMAILJS_SERVICE_ID        the Gmail service, service_dburs96
//   EMAILJS_PUBLIC_KEY        sent as user_id
//   EMAILJS_PRIVATE_KEY       sent as accessToken. Without it nothing sends,
//                             and the site carries on booking as if emails were
//                             never part of the deal.
//   EMAILJS_TEMPLATE_BOOKING  one generic template for both emails. Its To
//                             Email must be {{to_email}}, its subject
//                             {{subject}}, its body {{message}}. The free plan
//                             is short on template slots and two are already
//                             spoken for, so the server decides all three
//                             rather than asking for a template per email.
//   OWNER_EMAIL               where the notification goes. A comma separated
//                             list is allowed and goes out as ONE EmailJS
//                             request with several recipients, because the free
//                             plan counts requests, not addresses, and a second
//                             inbox should not halve the month's quota. If
//                             EmailJS refuses the multi recipient request, the
//                             addresses are retried one at a time.
//
// EmailJS also has to be told to allow this. Account, Security, API access for
// non-browser applications. It is off by default and the call 403s without it.
"use strict";

const ENDPOINT = "https://api.emailjs.com/api/v1.0/email/send";

const SERVICE = process.env.EMAILJS_SERVICE_ID || "";
const PUBLIC = process.env.EMAILJS_PUBLIC_KEY || "";
const PRIVATE = process.env.EMAILJS_PRIVATE_KEY || "";
const TEMPLATE = process.env.EMAILJS_TEMPLATE_BOOKING || "";
// "a@b.com, c@d.com" -> ["a@b.com", "c@d.com"]. The first one is the reply-to
// the customer sees, so order matters.
const OWNERS = (process.env.OWNER_EMAIL || "").split(",").map(s => s.trim()).filter(Boolean);
const OWNER = OWNERS[0] || "";

// Everything must be present or nothing is sent. A half configured emailer that
// throws on every booking is worse than one that says, once, at boot, that it
// is switched off.
function configured() {
  return !!(SERVICE && PUBLIC && PRIVATE && TEMPLATE);
}

function why() {
  const missing = [];
  if (!SERVICE) missing.push("EMAILJS_SERVICE_ID");
  if (!PUBLIC) missing.push("EMAILJS_PUBLIC_KEY");
  if (!PRIVATE) missing.push("EMAILJS_PRIVATE_KEY");
  if (!TEMPLATE) missing.push("EMAILJS_TEMPLATE_BOOKING");
  if (!OWNERS.length) missing.push("OWNER_EMAIL");
  return missing;
}

async function send(toEmail, subject, message, replyTo) {
  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      service_id: SERVICE,
      template_id: TEMPLATE,
      user_id: PUBLIC,
      accessToken: PRIVATE,
      template_params: {
        to_email: toEmail,
        subject: subject,
        message: message,
        reply_to: replyTo || OWNER,
        site_name: "EZ Shots"
      }
    })
  });
  // EmailJS answers with plain text, "OK" or the reason, not JSON.
  const text = await r.text().catch(() => "");
  if (!r.ok) throw new Error(`EmailJS replied ${r.status}: ${text.slice(0, 200)}`);
  return text;
}

function money(n) { return "$" + Number(n || 0).toFixed(2).replace(/\.00$/, ""); }

// A line only when there is something on it, so an intake that skipped half the
// optional questions does not arrive as a column of empty labels.
function lines(pairs) {
  return pairs.filter(p => p[1]).map(p => p[0] + ": " + p[1]).join("\n");
}

function ownerMessage(b, siteUrl) {
  return [
    `${b.name} booked ${b.packageName}.`,
    "",
    lines([
      ["When", b.when],
      ["Address", b.address],
      ["Paid", money(b.amount) + (b.firstShoot ? " (first shoot, half price)" : "")],
      ["Name", b.name],
      ["Email", b.email],
      ["Phone", b.phone],
      ["Brokerage", b.brokerage],
      ["Size", b.size],
      ["Occupancy", b.occupancy],
      ["Access", b.access],
      ["Access notes", b.accessNotes],
      ["Notes", b.notes],
      ["Booking", b.id]
    ]),
    "",
    `Calendar: ${siteUrl}/admin.html`
  ].join("\n");
}

function customerMessage(b, siteUrl) {
  return [
    `Hi ${(b.name || "").split(/\s+/)[0] || "there"},`,
    "",
    `You are booked and paid for. Here are the details:`,
    "",
    lines([
      ["When", b.when],
      ["Where", b.address],
      ["Package", b.packageName],
      ["Paid", money(b.amount)],
      ["Booking", b.id]
    ]),
    "",
    "BEFORE I ARRIVE",
    "The shoot takes about 90 minutes. The house photographs best if it is ready",
    "before I get there, because time spent tidying is time the light is moving:",
    "",
    "- Blinds open, every light on, ceiling fans off.",
    "- Counters and bathroom surfaces clear. No bins, no dish racks, no toiletries.",
    "- Cars off the driveway and out of the front of the shot.",
    "- Bins, hoses and toys out of the yard.",
    "- Pets crated or out of the house if you can manage it.",
    "",
    "I will photograph every room plus the exterior from all sides, and fly the",
    "drone if the weather allows. Finished photos come back within 24 hours.",
    "",
    `Need to change or cancel? ${siteUrl}/manage.html?t=${b.token}`,
    `Add it to your calendar: ${siteUrl}/api/ics?t=${b.token}`,
    "",
    "See you then,",
    "Angelo",
    "EZ Shots"
  ].join("\n");
}

// Both emails for one confirmed booking. Never throws: a failure here must not
// fail the webhook, because a non-200 makes Stripe retry the whole event and
// re-run a confirmation that already happened. The caller logs what comes back.
// Returns what was sent and what was not, for that log.
async function notifyBooked(booking, siteUrl) {
  const out = { owner: false, customer: false, errors: [] };
  if (!configured()) {
    out.errors.push("not configured: " + why().join(", "));
    return out;
  }
  const site = String(siteUrl || "").replace(/\/$/, "");

  if (OWNERS.length) {
    const subject = `Booked: ${booking.when}, ${booking.address}`;
    const body = ownerMessage(booking, site);
    try {
      await send(OWNERS.join(","), subject, body, booking.email);
      out.owner = true;
    } catch (e) {
      out.errors.push("owner: " + e.message);
      // Some EmailJS templates will not take several addresses in To Email. One
      // request each then, which costs more of the monthly quota but is better
      // than the owner finding out about a shoot when he drives past it.
      if (OWNERS.length > 1) {
        for (const addr of OWNERS) {
          await new Promise(r => setTimeout(r, 1100));
          try { await send(addr, subject, body, booking.email); out.owner = true; }
          catch (e2) { out.errors.push(`owner ${addr}: ${e2.message}`); }
        }
      }
    }
  }

  // EmailJS allows one request a second, and these two are back to back.
  await new Promise(r => setTimeout(r, 1100));

  if (booking.email) {
    try {
      await send(booking.email,
        `You are booked for ${booking.when}`,
        customerMessage(booking, site),
        OWNER);
      out.customer = true;
    } catch (e) { out.errors.push("customer: " + e.message); }
  }
  return out;
}

module.exports = { notifyBooked, configured, why };
