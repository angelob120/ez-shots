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
//                             {{subject}}, and its content exactly
//                             {{{message_html}}}, three braces, which is how
//                             EmailJS inserts HTML without escaping it. The
//                             server builds the whole email. The free plan
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

async function send(toEmail, subject, message, html, replyTo) {
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
        // Plain text, for a template that still says {{message}}.
        message: message,
        // The designed email, for a template that says {{{message_html}}}.
        message_html: html,
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

// Every value in the HTML came from a customer typing into a form, so every
// value is escaped. A note that says <b> arrives as the text <b>.
function esc(v) {
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// A row only when there is something on it, so an intake that skipped half the
// optional questions does not arrive as a column of empty labels.
function filled(pairs) { return pairs.filter(p => p[1]); }
function lines(pairs) { return filled(pairs).map(p => p[0] + ": " + p[1]).join("\n"); }

// ---------------------------------------------------------------------------
// The words. Text and HTML are built from the same rows and the same prep list,
// so the two versions of an email can never say different things.
// ---------------------------------------------------------------------------
const PREP = [
  "Blinds open, every light on, ceiling fans off.",
  "Counters and bathroom surfaces clear. No bins, no dish racks, no toiletries.",
  "Cars off the driveway and out of the front of the shot.",
  "Bins, hoses and toys out of the yard.",
  "Pets crated or out of the house if you can manage it."
];
const PREP_INTRO = "The shoot takes about 90 minutes. The house photographs best if it is ready " +
  "before I get there, because time spent tidying is time the light is moving.";
const PREP_AFTER = "I will photograph every room plus the exterior from all sides, and fly the " +
  "drone if the weather allows. Finished photos come back within 24 hours.";

function firstName(b) { return (b.name || "").split(/\s+/)[0] || "there"; }

function ownerRows(b) {
  return [
    ["When", b.when],
    ["Address", b.address],
    ["Package", b.packageName],
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
  ];
}

function customerRows(b) {
  return [
    ["When", b.when],
    ["Where", b.address],
    ["Package", b.packageName],
    ["Paid", money(b.amount)],
    ["Booking", b.id]
  ];
}

function ownerMessage(b, siteUrl) {
  return [
    `${b.name} booked ${b.packageName}.`,
    "",
    lines(ownerRows(b)),
    "",
    `Bookings: ${siteUrl}/admin-bookings.html`
  ].join("\n");
}

function customerMessage(b, siteUrl) {
  return [
    `Hi ${firstName(b)},`,
    "",
    "You are booked and paid for. Here are the details:",
    "",
    lines(customerRows(b)),
    "",
    "BEFORE I ARRIVE",
    PREP_INTRO,
    "",
    PREP.map(p => "- " + p).join("\n"),
    "",
    PREP_AFTER,
    "",
    `Need to change or cancel? ${siteUrl}/manage.html?t=${b.token}`,
    `Add it to your calendar: ${siteUrl}/api/ics?t=${b.token}`,
    "",
    "See you then,",
    "Angelo",
    "EZ Shots"
  ].join("\n");
}

// ---------------------------------------------------------------------------
// HTML. Email clients are not browsers: Gmail strips <style> in places and
// Outlook lays out with Word, so this is tables and inline styles on purpose.
// Colours are the light palette from styles.css.
// ---------------------------------------------------------------------------
const C = {
  page: "#f4f7fc", card: "#ffffff", ink: "#0a1729", muted: "#5b6b82",
  line: "#e2e8f2", brand: "#1d4ed8", brandDk: "#1e3a8a", soft: "#e9f0fa"
};
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function htmlRows(pairs) {
  return filled(pairs).map((p, i) =>
    `<tr>` +
    `<td valign="top" style="padding:10px 12px 10px 0;${i ? `border-top:1px solid ${C.line};` : ""}font:600 13px/1.4 ${FONT};color:${C.muted};white-space:nowrap;width:110px;">${esc(p[0])}</td>` +
    `<td valign="top" style="padding:10px 0;${i ? `border-top:1px solid ${C.line};` : ""}font:15px/1.45 ${FONT};color:${C.ink};word-break:break-word;">${esc(p[1])}</td>` +
    `</tr>`).join("");
}

function button(href, label, primary) {
  const bg = primary ? C.brand : C.card;
  const fg = primary ? "#ffffff" : C.brand;
  const border = primary ? C.brand : C.line;
  return `<td style="padding:0 8px 8px 0;">` +
    `<a href="${esc(href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;border:1px solid ${border};background:${bg};color:${fg};font:600 15px/1 ${FONT};text-decoration:none;">${esc(label)}</a>` +
    `</td>`;
}

function layout({ preheader, eyebrow, heading, intro, body, buttons, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `</head><body style="margin:0;padding:0;background:${C.page};">` +
    // The line an inbox shows under the subject, hidden in the email itself.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">` +
    // Wordmark
    `<tr><td style="padding:0 4px 16px;font:800 20px/1 ${FONT};color:${C.ink};letter-spacing:-0.2px;">` +
    `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${C.brand};margin-right:8px;vertical-align:middle;"></span>` +
    `EZ <span style="color:${C.brand};">Shots</span></td></tr>` +
    // Card
    `<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;overflow:hidden;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="height:4px;background:${C.brand};font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td style="padding:28px 28px 8px;">` +
    `<div style="font:700 12px/1 ${FONT};letter-spacing:1px;text-transform:uppercase;color:${C.brand};">${esc(eyebrow)}</div>` +
    `<h1 style="margin:10px 0 0;font:800 24px/1.25 ${FONT};color:${C.ink};">${esc(heading)}</h1>` +
    (intro ? `<p style="margin:12px 0 0;font:16px/1.55 ${FONT};color:${C.ink};">${intro}</p>` : "") +
    `</td></tr>` +
    `<tr><td style="padding:16px 28px 8px;">${body}</td></tr>` +
    (buttons && buttons.length
      ? `<tr><td style="padding:12px 28px 20px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${buttons.join("")}</tr></table></td></tr>`
      : "") +
    `</table></td></tr>` +
    `<tr><td style="padding:18px 8px 0;font:13px/1.5 ${FONT};color:${C.muted};text-align:center;">${footer}</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

function detailsBox(pairs) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};border:1px solid ${C.line};border-radius:10px;">` +
    `<tr><td style="padding:6px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${htmlRows(pairs)}</table></td></tr></table>`;
}

function ownerHtml(b, siteUrl) {
  const contact = [];
  if (b.phone) contact.push(button("tel:" + String(b.phone).replace(/[^\d+]/g, ""), "Call " + firstName(b), false));
  if (b.email) contact.push(button("mailto:" + b.email, "Email " + firstName(b), false));
  return layout({
    preheader: `${b.packageName}, ${b.when}, ${b.address}`,
    eyebrow: "New booking, paid",
    heading: `${b.name} booked ${b.packageName}`,
    intro: `<strong>${esc(b.when)}</strong><br>${esc(b.address)}`,
    body: detailsBox(ownerRows(b)),
    buttons: [button(`${siteUrl}/admin-bookings.html`, "Open bookings", true)].concat(contact),
    footer: "Sent by ezshots.org when Stripe confirmed the payment. Reply to this email to reach the customer."
  });
}

function customerHtml(b, siteUrl) {
  const prep = PREP.map(p =>
    `<tr><td valign="top" style="padding:6px 10px 6px 0;font:700 15px/1.45 ${FONT};color:${C.brand};">&#10003;</td>` +
    `<td style="padding:6px 0;font:15px/1.45 ${FONT};color:${C.ink};">${esc(p)}</td></tr>`).join("");
  const body = detailsBox(customerRows(b)) +
    `<div style="margin:28px 0 0;font:700 12px/1 ${FONT};letter-spacing:1px;text-transform:uppercase;color:${C.brand};">Before I arrive</div>` +
    `<p style="margin:10px 0 6px;font:15px/1.55 ${FONT};color:${C.ink};">${esc(PREP_INTRO)}</p>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0">${prep}</table>` +
    `<p style="margin:14px 0 0;padding:14px 16px;background:${C.soft};border-radius:10px;font:15px/1.55 ${FONT};color:${C.brandDk};">${esc(PREP_AFTER)}</p>` +
    `<p style="margin:24px 0 0;font:15px/1.55 ${FONT};color:${C.ink};">See you then,<br><strong>Angelo</strong><br>EZ Shots</p>`;
  return layout({
    preheader: `Your shoot is booked for ${b.when}. Here is how to get the house ready.`,
    eyebrow: "Booked and paid",
    heading: `You are booked, ${firstName(b)}`,
    intro: `I will see you on <strong>${esc(b.when)}</strong>.`,
    body,
    buttons: [
      button(`${siteUrl}/api/ics?t=${b.token}`, "Add to calendar", true),
      button(`${siteUrl}/manage.html?t=${b.token}`, "Change or cancel", false)
    ],
    footer: "Questions? Just reply to this email.<br>EZ Shots, real estate photography in Metro Detroit"
  });
}

// Everything that would be sent for one booking, without sending it. Used by
// notifyBooked and by scripts/preview-emails.mjs.
function render(booking, siteUrl) {
  const b = booking, site = String(siteUrl || "").replace(/\/$/, "");
  return {
    owner: {
      subject: `Booked: ${b.when}, ${b.address}`,
      text: ownerMessage(b, site),
      html: ownerHtml(b, site)
    },
    customer: {
      subject: `You are booked for ${b.when}`,
      text: customerMessage(b, site),
      html: customerHtml(b, site)
    }
  };
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
  const mail = render(booking, siteUrl);

  if (OWNERS.length) {
    const m = mail.owner;
    try {
      await send(OWNERS.join(","), m.subject, m.text, m.html, booking.email);
      out.owner = true;
    } catch (e) {
      out.errors.push("owner: " + e.message);
      // Some EmailJS templates will not take several addresses in To Email. One
      // request each then, which costs more of the monthly quota but is better
      // than the owner finding out about a shoot when he drives past it.
      if (OWNERS.length > 1) {
        for (const addr of OWNERS) {
          await new Promise(r => setTimeout(r, 1100));
          try { await send(addr, m.subject, m.text, m.html, booking.email); out.owner = true; }
          catch (e2) { out.errors.push(`owner ${addr}: ${e2.message}`); }
        }
      }
    }
  }

  // EmailJS allows one request a second, and these two are back to back.
  await new Promise(r => setTimeout(r, 1100));

  if (booking.email) {
    const m = mail.customer;
    try {
      await send(booking.email, m.subject, m.text, m.html, OWNER);
      out.customer = true;
    } catch (e) { out.errors.push("customer: " + e.message); }
  }
  return out;
}

// Both emails for a made up booking, sent to the owner inboxes only, never to a
// customer. Behind the admin sign in as POST /api/admin/test-email, so the
// template, the keys and the non-browser API switch can be proven without
// booking and paying for a shoot. Costs two of the month's requests.
const SAMPLE = {
  id: "EZ-TEST01", when: "Saturday, October 10 at 8:00 PM",
  address: "1841 Maplehurst Drive, Birmingham MI 48009",
  packageName: "Listing Pro", amount: 125, firstShoot: true,
  name: "Test Customer", email: "", phone: "(313) 555-0142",
  brokerage: "Sample Brokerage", size: "2,450 sq ft", occupancy: "Occupied",
  access: "Agent will meet me there", notes: "This is a test booking. Nothing was charged.",
  token: "test"
};

async function sendTest(siteUrl) {
  const out = { owner: false, customer: false, to: OWNERS, errors: [] };
  if (!configured() || !OWNERS.length) {
    out.errors.push("not configured: " + why().join(", "));
    return out;
  }
  const mail = render(SAMPLE, siteUrl);
  try {
    await send(OWNERS.join(","), "[Test] " + mail.owner.subject, mail.owner.text, mail.owner.html, OWNER);
    out.owner = true;
  } catch (e) { out.errors.push("owner: " + e.message); }
  await new Promise(r => setTimeout(r, 1100));
  try {
    await send(OWNER, "[Test] " + mail.customer.subject, mail.customer.text, mail.customer.html, OWNER);
    out.customer = true;
  } catch (e) { out.errors.push("customer copy: " + e.message); }
  return out;
}

module.exports = { notifyBooked, configured, why, render, sendTest };
