// The emails a booking sends. All of them go from the server through EmailJS.
//
// A booking costs nothing to make. The customer pays after seeing the photos,
// so every step between the booking and the payment has its own email, and the
// customer never has to ask what happens next:
//
//   booked     owner:    new booking, nothing paid, Add to Google Calendar
//              customer: you are booked, $0 today, what happens next, prep list
//   reminder   customer: the day before
//   shot       customer: the shoot is done, photos in about 24 hours
//   ready      customer: previews, the amount, Pay and Not happy buttons
//   delivered  customer: payment received, the clean files, Book another
//              owner:    paid
//   review     customer: a day after delivery, only when paid, unflagged and
//                        not refunded
//   unhappy    owner:    the customer pressed Not happy, the job is flagged
//   cancelled  owner:    the customer cancelled from the manage page
//   refunded   customer: money on its way back, when the owner refunds
//   moved      customer: a new time, when the owner moves the shoot
//
// WHY THIS IS ON THE SERVER AND NOT IN THE BROWSER
// EmailJS is a browser library and the rest of the site uses it that way, in
// js/contact-form.js. These cannot work that way. The moment a booking becomes
// real is Stripe's webhook, which arrives here with no browser involved at all.
// Send from booked.html instead and every customer who pays and closes the tab,
// or whose phone drops the redirect, gets no email and the owner gets no
// notification, for a shoot that is paid for and on the calendar. EmailJS has a
// REST endpoint for exactly this; the private key is what makes it work off a
// browser.
//
// THE GOOGLE CALENDAR BUTTON
// A plain calendar.google.com link with the shoot filled in: title, time,
// address and the client's details. The owner taps it, checks it and saves.
// No Google sign in, no API, nothing stored.
//
// ENV
//   EMAILJS_SERVICE_ID        the Gmail service, service_dburs96
//   EMAILJS_PUBLIC_KEY        sent as user_id
//   EMAILJS_PRIVATE_KEY       sent as accessToken. Without it nothing sends,
//                             and the site carries on booking as if emails were
//                             never part of the deal.
//   EMAILJS_TEMPLATE_BOOKING  one generic template for every email here. Its To
//                             Email must be {{to_email}}, its subject
//                             {{subject}}, and its content exactly
//                             {{{message_html}}}, three braces, which is how
//                             EmailJS inserts HTML without escaping it. The
//                             server builds the whole email.
//   OWNER_EMAIL               where the owner's email goes. A comma separated
//                             list goes out as ONE request with several
//                             recipients, because the free plan counts
//                             requests, not addresses. If EmailJS refuses that,
//                             the addresses are retried one at a time.
//   EMAILJS_ENDPOINT          only for scripts/check-bookings.mjs, which points
//                             it at a fake EmailJS.
//
// EmailJS also has to be told to allow this. Account, Security, API access for
// non-browser applications. It is off by default and the call 403s without it.
"use strict";

// Trimmed, because a value pasted into Railway can carry a tab or a newline
// nobody can see. On 2026-09-12 one did, in TZ.
const env = k => String(process.env[k] || "").trim();
const ENDPOINT = env("EMAILJS_ENDPOINT") || "https://api.emailjs.com/api/v1.0/email/send";
const SERVICE = env("EMAILJS_SERVICE_ID");
const PUBLIC = env("EMAILJS_PUBLIC_KEY");
const PRIVATE = env("EMAILJS_PRIVATE_KEY");
const TEMPLATE = env("EMAILJS_TEMPLATE_BOOKING");
// "a@b.com, c@d.com" -> ["a@b.com", "c@d.com"]. The first one is the reply-to
// the customer sees, so order matters.
const OWNERS = env("OWNER_EMAIL").split(",").map(s => s.trim()).filter(Boolean);
const OWNER = OWNERS[0] || "";
const SHOOT_MS = 90 * 60 * 1000;

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

// EmailJS allows one request a second across the whole account. Every send
// waits its turn here, so a refund pressed while the booking emails are still
// going out is not refused for going too fast.
let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + 1100;
  if (at > now) await new Promise(r => setTimeout(r, at - now));
}

async function send(toEmail, mail, replyTo) {
  await pace();
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
        subject: mail.subject,
        // Plain text, for a template that still says {{message}}.
        message: mail.text,
        // The designed email, for a template that says {{{message_html}}}.
        message_html: mail.html,
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
function cents(c) { return money(Number(c || 0) / 100); }
function trimSite(s) { return String(s || "").replace(/\/$/, ""); }

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

function firstName(b) { return (b.name || "").split(/\s+/)[0] || "there"; }

// ---------------------------------------------------------------------------
// The words. Text and HTML are built from the same rows and sentences, so the
// two versions of an email can never say different things.
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
const TURNAROUND = "Finished photos come back in about 24 hours, and never later than 72 hours from your booked time or the shoot is free, even if I do not show up.";
const GUARANTEE = "If you are not happy with the photos, you do not pay, and I send you $20 for the trouble.";
const BANK = "It goes back to the card you paid with. Most banks show it within 5 to 10 business days.";
const FOOTER = "Questions? Just reply to this email.<br>EZ Shots, real estate photography in Metro Detroit";
// The four steps every customer email can show, so the client always sees
// where they are and what comes next.
const STEPS = [
  ["Booked", "Your time is on my calendar. Nothing is due."],
  ["Shoot day", "I photograph the property and fly the drone."],
  ["Your photos", "Previews in your inbox in about 24 hours."],
  ["Pay when happy", "Pay online and the full resolution files unlock. Not happy, you do not pay."]
];

function ownerRows(b) {
  return [
    ["When", b.when],
    ["Address", b.address],
    ["Package", b.packageName],
    [b.paid ? "Paid" : "Due after", money(b.amount) + (b.firstShoot ? " (first shoot, half price)" : "")],
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
    ["Package", b.packageName + (b.firstShoot ? ", first shoot half price" : "")],
    b.paid ? ["Paid", money(b.amount)] : ["Due today", "$0"],
    b.paid ? ["", ""] : ["After you see the photos", money(b.amount)],
    ["Booking", b.id]
  ];
}

// A Google Calendar "create event" link with the shoot filled in. Google reads
// the times as UTC when they end in Z, so no timezone guessing is involved.
function googleCalendarUrl(b, site) {
  const start = Date.parse(b.startsAt);
  if (!start) return "";
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const details = [
    `${b.packageName}, ${b.paid ? "paid" : "due after the shoot"} ${money(b.amount)}`,
    "",
    lines([
      ["Client", b.name],
      ["Phone", b.phone],
      ["Email", b.email],
      ["Brokerage", b.brokerage],
      ["Size", b.size],
      ["Occupancy", b.occupancy],
      ["Access", b.access],
      ["Access notes", b.accessNotes],
      ["Notes", String(b.notes || "").slice(0, 600)]
    ]),
    "",
    `Booking ${b.id}`,
    site ? `${site}/admin` : ""
  ].join("\n").trim();
  return "https://calendar.google.com/calendar/render?" + new URLSearchParams({
    action: "TEMPLATE",
    text: `EZ Shots: ${b.address}`,
    dates: `${stamp(start)}/${stamp(start + SHOOT_MS)}`,
    location: b.address,
    details
  }).toString();
}

// ---------------------------------------------------------------------------
// HTML. Email clients are not browsers: Gmail strips <style> in places and
// Outlook lays out with Word, so this is tables and inline styles on purpose.
// Colours are the light palette from css/styles.css.
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

// Inline blocks rather than table cells, so a row of buttons wraps on a phone
// instead of pushing the email sideways.
function button(href, label, primary) {
  const bg = primary ? C.brand : C.card;
  const fg = primary ? "#ffffff" : C.brand;
  const border = primary ? C.brand : C.line;
  return `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:12px 20px;border-radius:8px;border:1px solid ${border};background:${bg};color:${fg};font:600 15px/1 ${FONT};text-decoration:none;">${esc(label)}</a>`;
}

function buttonRow(list) { return list && list.length ? `<div>${list.join("")}</div>` : ""; }

function detailsBox(pairs) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};border:1px solid ${C.line};border-radius:10px;">` +
    `<tr><td style="padding:6px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${htmlRows(pairs)}</table></td></tr></table>`;
}

function label(t) {
  return `<div style="margin:28px 0 0;font:700 12px/1 ${FONT};letter-spacing:1px;text-transform:uppercase;color:${C.brand};">${esc(t)}</div>`;
}
function para(t) { return t ? `<p style="margin:12px 0 0;font:15px/1.55 ${FONT};color:${C.ink};">${esc(t)}</p>` : ""; }
function note(t) {
  return t ? `<p style="margin:14px 0 0;padding:14px 16px;background:${C.soft};border-radius:10px;font:15px/1.55 ${FONT};color:${C.brandDk};">${esc(t)}</p>` : "";
}
function signoff(t) {
  return `<p style="margin:24px 0 0;font:15px/1.55 ${FONT};color:${C.ink};">${esc(t)}<br><strong>Angelo</strong><br>EZ Shots</p>`;
}

function layout({ preheader, eyebrow, heading, intro, actions, body, buttons, footer }) {
  return `<!doctype html><html><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">` +
    `</head><body style="margin:0;padding:0;background:${C.page};">` +
    // The line an inbox shows under the subject, hidden in the email itself.
    `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(preheader)}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.page};">` +
    `<tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">` +
    `<tr><td style="padding:0 4px 16px;font:800 20px/1 ${FONT};color:${C.ink};letter-spacing:-0.2px;">` +
    `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${C.brand};margin-right:8px;vertical-align:middle;"></span>` +
    `EZ <span style="color:${C.brand};">Shots</span></td></tr>` +
    `<tr><td style="background:${C.card};border:1px solid ${C.line};border-radius:14px;overflow:hidden;">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">` +
    `<tr><td style="height:4px;background:${C.brand};font-size:0;line-height:0;">&nbsp;</td></tr>` +
    `<tr><td style="padding:28px 28px 8px;">` +
    `<div style="font:700 12px/1 ${FONT};letter-spacing:1px;text-transform:uppercase;color:${C.brand};">${esc(eyebrow)}</div>` +
    `<h1 style="margin:10px 0 0;font:800 24px/1.25 ${FONT};color:${C.ink};">${esc(heading)}</h1>` +
    (intro ? `<p style="margin:12px 0 0;font:16px/1.55 ${FONT};color:${C.ink};">${intro}</p>` : "") +
    `</td></tr>` +
    (actions && actions.length ? `<tr><td style="padding:16px 28px 0;">${buttonRow(actions)}</td></tr>` : "") +
    `<tr><td style="padding:12px 28px 8px;">${body}</td></tr>` +
    (buttons && buttons.length
      ? `<tr><td style="padding:14px 28px 20px;">${buttonRow(buttons)}</td></tr>`
      : `<tr><td style="padding:0 0 20px;font-size:0;line-height:0;">&nbsp;</td></tr>`) +
    `</table></td></tr>` +
    `<tr><td style="padding:18px 8px 0;font:13px/1.5 ${FONT};color:${C.muted};text-align:center;">${footer}</td></tr>` +
    `</table></td></tr></table></body></html>`;
}

function stepsBlock(at) {
  const rows = STEPS.map((st, i) => {
    const done = i < at, now = i === at;
    const dot = done ? "&#10003;" : String(i + 1);
    const bg = done || now ? C.brand : C.line;
    const fg = done || now ? "#ffffff" : C.muted;
    return `<tr><td valign="top" style="padding:7px 12px 7px 0;width:28px;">` +
      `<div style="width:26px;height:26px;border-radius:13px;background:${bg};color:${fg};font:700 13px/26px ${FONT};text-align:center;">${dot}</div></td>` +
      `<td valign="top" style="padding:7px 0;font:15px/1.45 ${FONT};color:${C.ink};">` +
      `<strong${now ? ` style="color:${C.brand};"` : ""}>${esc(st[0])}${now ? " (now)" : ""}</strong><br>` +
      `<span style="color:${C.muted};">${esc(st[1])}</span></td></tr>`;
  }).join("");
  return label("What happens next") +
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;">${rows}</table>`;
}
function stepsText(at) {
  return ["WHAT HAPPENS NEXT", ...STEPS.map((st, i) => `${i + 1}. ${st[0]}${i === at ? " (now)" : i < at ? " (done)" : ""}: ${st[1]}`)].join("\n");
}

function manageUrl(b, site) { return `${site}/manage?t=${b.token}`; }

// ---------------------------------------------------------------------------
// The emails
// ---------------------------------------------------------------------------

// To the owner the moment a booking is made. Nothing is paid yet.
function ownerMail(b, site) {
  const first = firstName(b);
  const bookings = `${site}/admin`;
  const gcal = googleCalendarUrl(b, site);
  const text = [`${b.name} booked ${b.packageName}. Nothing is paid yet, ${money(b.amount)} is due after the shoot.`, "", lines(ownerRows(b)), ""];
  if (gcal) text.push(`Add to Google Calendar: ${gcal}`);
  text.push(`Bookings: ${bookings}`);

  const contact = [];
  if (b.phone) contact.push(button("tel:" + String(b.phone).replace(/[^\d+]/g, ""), "Call " + first, false));
  if (b.email) contact.push(button("mailto:" + b.email, "Email " + first, false));
  contact.push(button(bookings, "Open bookings", false));

  return {
    subject: `Booked: ${b.when}, ${b.address}`,
    text: text.join("\n"),
    html: layout({
      preheader: `${b.name} booked ${b.packageName} on ${b.when}.`,
      eyebrow: "New booking",
      heading: `${b.name} booked ${b.packageName}`,
      intro: `<strong>${esc(b.when)}</strong><br>${esc(b.address)}<br>${esc(money(b.amount))} due after the shoot. The client has been sent their confirmation.`,
      actions: gcal ? [button(gcal, "Add to Google Calendar", true)] : [],
      body: detailsBox(ownerRows(b)),
      buttons: contact,
      footer: "Sent by ezshots.org when the booking was made. Reply to this email to reach the client."
    })
  };
}

// To the customer the moment they book.
function bookedMail(b, site) {
  const first = firstName(b);
  const manage = manageUrl(b, site);
  const ics = `${site}/api/ics?t=${b.token}`;
  const prep = PREP.map(p =>
    `<tr><td valign="top" style="padding:6px 10px 6px 0;font:700 15px/1.45 ${FONT};color:${C.brand};">&#10003;</td>` +
    `<td style="padding:6px 0;font:15px/1.45 ${FONT};color:${C.ink};">${esc(p)}</td></tr>`).join("");
  return {
    subject: `You are booked for ${b.when}`,
    text: [
      `Hi ${first},`, "",
      "You are booked. Nothing is due today. Here are the details:", "",
      lines(customerRows(b)), "",
      stepsText(0), "",
      GUARANTEE, "",
      "BEFORE I ARRIVE", PREP_INTRO, "",
      PREP.map(p => "- " + p).join("\n"), "",
      "I email you the day before, and text you that morning for anything I need to get in.", "",
      `Add it to your calendar: ${ics}`,
      `Your booking, any time: ${manage}`, "",
      "See you then,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: `Your shoot is booked for ${b.when}. Nothing is due today.`,
      eyebrow: "You are booked",
      heading: `You are booked, ${first}`,
      intro: `I will see you on <strong>${esc(b.when)}</strong>. Nothing is due today: you pay ${esc(money(b.amount))} after you have seen the photos.`,
      body: detailsBox(customerRows(b)) + stepsBlock(0) + note(GUARANTEE) +
        label("Before I arrive") + para(PREP_INTRO) +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:6px;">${prep}</table>` +
        para("I email you the day before, and text you that morning for anything I need to get in.") +
        signoff("See you then,"),
      buttons: [button(ics, "Add to calendar", true), button(manage, "View or cancel your booking", false)],
      footer: FOOTER
    })
  };
}

// To the customer the day before.
function reminderMail(b, site) {
  const first = firstName(b);
  const manage = manageUrl(b, site);
  const access = [b.access, b.accessNotes].filter(Boolean).join(". ");
  const rows = [["When", b.when], ["Where", b.address], ["Package", b.packageName], ["Getting in", access], ["Due today", "$0"]];
  return {
    subject: `Tomorrow: your shoot at ${b.address}`,
    text: [
      `Hi ${first},`, "",
      `A reminder that I am shooting ${b.address} on ${b.when}.`, "",
      lines(rows), "",
      "If anything about getting in has changed, reply to this email. If you need the code to get in, I text you for it that morning, never put it in an email.", "",
      PREP.map(p => "- " + p).join("\n"), "",
      `Need to cancel? ${manage}`, "",
      "See you tomorrow,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: `See you ${b.when}. A quick checklist for the house.`,
      eyebrow: "Reminder",
      heading: `See you tomorrow, ${first}`,
      intro: `I am shooting <strong>${esc(b.address)}</strong> on <strong>${esc(b.when)}</strong>.`,
      body: detailsBox(rows) +
        para("If anything about getting in has changed, reply to this email. If there is a code, I text you for it that morning, so it never sits in an inbox.") +
        label("Quick checklist") + para(PREP.join(" ")) + stepsBlock(1) + signoff("See you tomorrow,"),
      buttons: [button(manage, "View your booking", true)],
      footer: FOOTER
    })
  };
}

// To the customer when the owner presses Shoot done.
function shotMail(b, site) {
  const first = firstName(b);
  const manage = manageUrl(b, site);
  return {
    subject: `Shoot done at ${b.address}, photos on the way`,
    text: [
      `Hi ${first},`, "",
      `The shoot at ${b.address} is done. I am editing now.`, "",
      TURNAROUND + " You will get an email with your previews and nothing is due until then.", "",
      stepsText(2), "",
      `Your booking, any time: ${manage}`, "",
      "Thanks,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: "The shoot is done. Your previews are on the way.",
      eyebrow: "Shoot done",
      heading: "Your photos are being edited",
      intro: `Hi ${esc(first)}, the shoot at <strong>${esc(b.address)}</strong> is done.`,
      body: note(TURNAROUND + " You will get an email with your previews, and nothing is due until then.") +
        stepsBlock(2) + signoff("Thanks,"),
      buttons: [button(manage, "View your booking", true)],
      footer: FOOTER
    })
  };
}

// To the customer when the owner sends the previews. The pay button goes to
// the manage page, which makes the checkout, so the link in the email never
// goes stale.
function readyMail(b, site) {
  const first = firstName(b);
  const manage = manageUrl(b, site);
  const rows = [["Property", b.address], ["Package", b.packageName], ["Amount", money(b.amount)], ["Booking", b.id]];
  const buttons = [];
  if (b.previewUrl) buttons.push(button(b.previewUrl, "See your photos", true));
  buttons.push(button(manage + "#pay", "Pay " + money(b.amount) + " and get the files", !b.previewUrl));
  buttons.push(button(manage + "#unhappy", "Not happy with them?", false));
  return {
    subject: `Your photos are ready: ${b.address}`,
    text: [
      `Hi ${first},`, "",
      `Your photos for ${b.address} are ready to look at.`, "",
      b.previewUrl ? `See them: ${b.previewUrl}` : "", "",
      `Happy with them? Pay ${money(b.amount)} online and the full resolution files unlock straight away: ${manage}#pay`, "",
      `${GUARANTEE} Tell me here: ${manage}#unhappy, or just reply.`, "",
      lines(rows), "",
      "Thanks,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: `Your photos for ${b.address} are ready. Pay only if you are happy.`,
      eyebrow: "Photos ready",
      heading: `Your photos are ready, ${first}`,
      intro: `Have a look at <strong>${esc(b.address)}</strong>. If you are happy, pay ${esc(money(b.amount))} online and the full resolution files unlock straight away.`,
      actions: buttons,
      body: detailsBox(rows) + note(GUARANTEE + " Press Not happy, or just reply to this email.") +
        stepsBlock(3) + signoff("Thanks,"),
      footer: "The previews are for checking the work. The clean, full resolution files come with the payment.<br>" + FOOTER
    })
  };
}

// To the customer when the payment lands. The clean files, and the way back.
function deliveredMail(b, site) {
  const first = firstName(b);
  const manage = manageUrl(b, site);
  const rows = [["Property", b.address], ["Package", b.packageName], ["Paid", money(b.amount)], ["Booking", b.id]];
  const buttons = [];
  if (b.finalUrl) buttons.push(button(b.finalUrl, "Download your files", true));
  buttons.push(button(`${site}/book`, "Book another shoot", !b.finalUrl));
  return {
    subject: `Paid, here are your files: ${b.address}`,
    text: [
      `Hi ${first},`, "",
      `Thank you, I have your payment of ${money(b.amount)}. This email is your receipt.`, "",
      b.finalUrl ? `Your full resolution files: ${b.finalUrl}` : "Your full resolution files are on your booking page.", "",
      lines(rows), "",
      `Your booking page keeps the link: ${manage}`,
      `Next listing? Book in a minute: ${site}/book`, "",
      "If anything is not right, reply to this email. The guarantee still stands: not happy, your money back and $20.", "",
      "Thanks,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: "Payment received. Your full resolution files are ready to download.",
      eyebrow: "Paid and delivered",
      heading: "Here are your files",
      intro: `Thank you, ${esc(first)}. I have your payment of ${esc(money(b.amount))}, and this email is your receipt.`,
      actions: buttons,
      body: detailsBox(rows) +
        para("The link stays on your booking page if you lose this email.") +
        note("If anything is not right, reply to this email. The guarantee still stands: not happy, your money back and $20.") +
        signoff("Thanks,"),
      buttons: [button(manage, "Your booking page", false)],
      footer: FOOTER
    })
  };
}

// To the customer a day after delivery. Only ever paid, unflagged, unrefunded.
function reviewMail(b, site, reviewUrl) {
  const first = firstName(b);
  const buttons = [];
  if (reviewUrl) buttons.push(button(reviewUrl, "Leave a quick review", true));
  buttons.push(button(`${site}/book`, "Book your next listing", !reviewUrl));
  return {
    subject: `How did the photos do, ${first}?`,
    text: [
      `Hi ${first},`, "",
      `Thanks again for having me shoot ${b.address}.`, "",
      reviewUrl ? `If the photos helped, a short review makes a real difference to a one person business: ${reviewUrl}` :
        "If the photos helped, reply and tell me. If anything could have been better, tell me that too.", "",
      `Got another listing coming? Book it in a minute, nothing due until you see the photos: ${site}/book`, "",
      "Thanks,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: "A quick thank you, and an easy way to book the next one.",
      eyebrow: "Thank you",
      heading: `Thanks for having me, ${first}`,
      intro: `I hope the photos for <strong>${esc(b.address)}</strong> are doing their job.`,
      body: para(reviewUrl ? "If they helped, a short review makes a real difference to a one person business."
        : "If they helped, reply and tell me. If anything could have been better, tell me that too.") +
        para("Got another listing coming? Book it in a minute. Nothing is due until you have seen the photos.") +
        signoff("Thanks,"),
      buttons,
      footer: FOOTER
    })
  };
}

// To the owner: something happened that needs him, or that he wants to know.
function ownerAlert(b, site, o) {
  const rows = [["Client", b.name], ["Email", b.email], ["Phone", b.phone], ["When", b.when], ["Address", b.address],
    ["Package", b.packageName], ["Amount", money(b.amount)], ["Paid", b.paid ? "Yes" : "No"], ["Booking", b.id]];
  if (o.reason) rows.unshift(["What they said", o.reason]);
  return {
    subject: o.subject,
    text: [o.line, "", lines(rows), "", `Bookings: ${site}/admin`].join("\n"),
    html: layout({
      preheader: o.line,
      eyebrow: o.eyebrow,
      heading: o.heading,
      intro: esc(o.line),
      body: detailsBox(rows),
      buttons: [button(`${site}/admin`, "Open bookings", true)].concat(b.email ? [button("mailto:" + b.email, "Email " + firstName(b), false)] : []),
      footer: "Sent by ezshots.org."
    })
  };
}

const ALERTS = {
  unhappy: b => ({
    subject: `Not happy: ${b.address}`, eyebrow: "Needs you", heading: `${b.name} is not happy with the photos`,
    line: `${b.name} pressed Not happy for ${b.address}. The job is flagged: no payment request, reminder or review email goes out until you clear it in admin.`
  }),
  cancelled: b => ({
    subject: `Cancelled: ${b.when}, ${b.address}`, eyebrow: "Cancelled by the client", heading: `${b.name} cancelled`,
    line: `${b.name} cancelled the shoot on ${b.when} at ${b.address}. The time is open on the calendar again.` +
      (b.paid ? " It was paid, so refund it from admin." : " Nothing was paid.")
  }),
  paid: b => ({
    subject: `Paid ${money(b.amount)}: ${b.address}`, eyebrow: "Paid", heading: `${b.name} paid ${money(b.amount)}`,
    line: `${b.name} paid ${money(b.amount)} for ${b.address}. The delivery email with the files link has gone to them.`
  })
};

// To the customer when the owner refunds from admin. `o.cents` is this refund;
// `b.refunded` is the running total in dollars, this one included.
function refundedMail(b, site, o) {
  const first = firstName(b);
  const amount = cents(o.cents);
  const status = o.cancelled ? "This booking is now cancelled." : "Your shoot is still booked for that time.";
  const manage = `${site}/manage?t=${b.token}`;
  return {
    subject: `Refund of ${amount} for your EZ Shots booking`,
    text: [
      `Hi ${first},`, "",
      `I have refunded ${amount} for ${b.address} on ${b.when}.`, "", BANK, "", status, "",
      lines([["Booking", b.id], ["Paid", money(b.amount)], ["Refunded so far", money(b.refunded)]]), "",
      "Thanks,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: `${amount} is on its way back to your card.`,
      eyebrow: "Refund issued",
      heading: `${amount} is on its way back`,
      intro: `Hi ${esc(first)}, I have refunded ${esc(amount)} for <strong>${esc(b.address)}</strong> on <strong>${esc(b.when)}</strong>.`,
      body: detailsBox([
        ["Booking", b.id],
        ["Package", b.packageName],
        ["Paid", money(b.amount)],
        ["Refunded so far", money(b.refunded)]
      ]) + note(BANK) + para(status) + signoff("Thanks,"),
      buttons: o.cancelled ? [button(`${site}/book`, "Book another time", true)] : [button(manage, "Change or cancel", false)],
      footer: FOOTER
    })
  };
}

// To the customer when the owner moves the shoot from admin, and ticks the box
// to tell them. `o.was` is the old date and time as words.
function movedMail(b, site, o) {
  const first = firstName(b);
  const manage = `${site}/manage?t=${b.token}`;
  const ics = `${site}/api/ics?t=${b.token}`;
  return {
    subject: `Your shoot is now ${b.when}`,
    text: [
      `Hi ${first},`, "",
      `Your shoot at ${b.address} has moved to ${b.when}.`, o.was ? `It was ${o.was}.` : "", "",
      lines(customerRows(b)), "",
      `Add the new time to your calendar: ${ics}`,
      `Need to change or cancel? ${manage}`, "",
      "Thanks,", "Angelo", "EZ Shots"
    ].join("\n"),
    html: layout({
      preheader: `Your shoot has moved to ${b.when}.`,
      eyebrow: "New time",
      heading: `Your shoot is now ${b.when}`,
      intro: `Hi ${esc(first)}, the shoot at <strong>${esc(b.address)}</strong> has moved.` +
        (o.was ? ` It was ${esc(o.was)}.` : ""),
      body: detailsBox(customerRows(b)) + signoff("Thanks,"),
      buttons: [button(ics, "Add the new time to your calendar", true), button(manage, "Change or cancel", false)],
      footer: FOOTER
    })
  };
}

async function notifyMoved(b, siteUrl, o) {
  const out = result();
  if (!configured()) { out.errors.push("not configured: " + why().join(", ")); return out; }
  if (!b.email) { out.errors.push("the booking has no customer email"); return out; }
  try { await send(b.email, movedMail(b, trimSite(siteUrl), o || {}), OWNER); out.customer = true; }
  catch (e) { out.errors.push("customer: " + e.message); }
  return out;
}

// Every email for one booking, without sending anything. Used by
// scripts/preview-emails.mjs.
function render(booking, siteUrl, opts = {}) {
  const site = trimSite(siteUrl);
  const paid = Object.assign({}, booking, { paid: true });
  return {
    owner: ownerMail(booking, site),
    booked: bookedMail(booking, site),
    reminder: reminderMail(booking, site),
    shot: shotMail(booking, site),
    ready: readyMail(booking, site),
    delivered: deliveredMail(paid, site),
    review: reviewMail(paid, site, opts.reviewUrl || ""),
    unhappy: ownerAlert(booking, site, Object.assign({ reason: "The kitchen is too dark." }, ALERTS.unhappy(booking))),
    refunded: refundedMail(paid, site, { cents: opts.cents || 0, cancelled: !!opts.cancelled })
  };
}

// ---------------------------------------------------------------------------
// Sending. None of these throw: a failure here must not fail a webhook (a
// non-200 makes Stripe retry the whole event) or an owner's button. Each
// returns what was sent and what was not, for the log.
// ---------------------------------------------------------------------------
function result() { return { owner: false, customer: false, errors: [] }; }

async function notifyBooked(b, siteUrl) {
  const out = result();
  if (!configured()) { out.errors.push("not configured: " + why().join(", ")); return out; }
  const site = trimSite(siteUrl);
  if (OWNERS.length) {
    const m = ownerMail(b, site);
    try {
      await send(OWNERS.join(","), m, b.email);
      out.owner = true;
    } catch (e) {
      out.errors.push("owner: " + e.message);
      // Some EmailJS templates will not take several addresses in To Email. One
      // request each then, which costs more of the monthly quota but is better
      // than the owner finding out about a shoot when he drives past it.
      if (OWNERS.length > 1) {
        for (const addr of OWNERS) {
          try { await send(addr, m, b.email); out.owner = true; }
          catch (e2) { out.errors.push(`owner ${addr}: ${e2.message}`); }
        }
      }
    }
  }
  if (b.email) {
    try { await send(b.email, bookedMail(b, site), OWNER); out.customer = true; }
    catch (e) { out.errors.push("customer: " + e.message); }
  }
  return out;
}

async function notifyRefunded(b, siteUrl, o) {
  const out = result();
  if (!configured()) { out.errors.push("not configured: " + why().join(", ")); return out; }
  if (!b.email) { out.errors.push("the booking has no customer email"); return out; }
  try { await send(b.email, refundedMail(b, trimSite(siteUrl), o || {}), OWNER); out.customer = true; }
  catch (e) { out.errors.push("customer: " + e.message); }
  return out;
}

// One email to the customer, by name. `kind` is reminder, shot, ready,
// delivered or review.
const CUSTOMER = { reminder: reminderMail, shot: shotMail, ready: readyMail, delivered: deliveredMail, review: reviewMail };

async function toCustomer(kind, b, siteUrl, extra) {
  const out = result();
  if (!configured()) { out.errors.push("not configured: " + why().join(", ")); return out; }
  if (!b.email) { out.errors.push("the booking has no customer email"); return out; }
  try { await send(b.email, CUSTOMER[kind](b, trimSite(siteUrl), extra), OWNER); out.customer = true; }
  catch (e) { out.errors.push("customer: " + e.message); }
  return out;
}

// One alert to the owner inboxes. `kind` is unhappy, cancelled or paid.
async function toOwner(kind, b, siteUrl, o = {}) {
  const out = result();
  if (!configured() || !OWNERS.length) { out.errors.push("not configured: " + why().join(", ")); return out; }
  const m = ownerAlert(b, trimSite(siteUrl), Object.assign({}, o, ALERTS[kind](b)));
  try { await send(OWNERS.join(","), m, b.email); out.owner = true; }
  catch (e) {
    out.errors.push("owner: " + e.message);
    if (OWNERS.length > 1) {
      for (const addr of OWNERS) {
        try { await send(addr, m, b.email); out.owner = true; }
        catch (e2) { out.errors.push(`owner ${addr}: ${e2.message}`); }
      }
    }
  }
  return out;
}

// Both booking emails for a made up booking, sent to the owner inboxes only,
// never to a customer. Behind the admin sign in as POST /api/admin/test-email.
// Costs two of the month's requests.
const SAMPLE = {
  id: "EZ-TEST01", when: "Saturday, October 10 at 8:00 PM", startsAt: "2026-10-11T00:00:00.000Z",
  address: "1841 Maplehurst Drive, Birmingham MI 48009",
  packageName: "Listing Pro", amount: 125, firstShoot: true,
  name: "Test Customer", email: "", phone: "(313) 555-0142",
  brokerage: "Sample Brokerage", size: "2,450 sq ft", occupancy: "Occupied",
  access: "Agent will meet me there", notes: "This is a test booking. Nothing was charged.", paid: false,
  token: "test", refunded: 0
};

async function sendTest(siteUrl) {
  const out = { owner: false, customer: false, to: OWNERS, errors: [] };
  if (!configured() || !OWNERS.length) {
    out.errors.push("not configured: " + why().join(", "));
    return out;
  }
  const site = trimSite(siteUrl);
  const owner = ownerMail(SAMPLE, site);
  const customer = bookedMail(SAMPLE, site);
  try {
    await send(OWNERS.join(","), Object.assign({}, owner, { subject: "[Test] " + owner.subject }), OWNER);
    out.owner = true;
  } catch (e) { out.errors.push("owner: " + e.message); }
  try {
    await send(OWNER, Object.assign({}, customer, { subject: "[Test] " + customer.subject }), OWNER);
    out.customer = true;
  } catch (e) { out.errors.push("customer copy: " + e.message); }
  return out;
}

module.exports = { notifyBooked, notifyRefunded, notifyMoved, toCustomer, toOwner, configured, why, render, sendTest, googleCalendarUrl };
