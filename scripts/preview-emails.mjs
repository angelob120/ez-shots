// Renders every booking email for a sample booking, without sending anything,
// and checks the things that have gone wrong before: an undefined in the copy,
// an unescaped customer value, an empty optional row, a dash, a doubled slash.
//   node scripts/preview-emails.mjs            check only
//   node scripts/preview-emails.mjs <dir>      also write the .html and .txt files
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const email = require("../server/email.js");

const booking = {
  id: "EZ-000002", when: "Saturday, October 10 at 8:00 PM", startsAt: "2026-10-11T00:00:00.000Z",
  address: "1841 Maplehurst Drive, Birmingham MI 48009",
  packageName: "Listing Pro", amount: 125, firstShoot: true, refunded: 62.5,
  name: "Dana <b>Ruiz</b>", email: "dana.ruiz@example.com", phone: "(313) 555-0142",
  brokerage: "Keller Williams Birmingham", size: "2,450 sq ft", occupancy: "Occupied",
  access: "Lockbox", accessNotes: "", notes: "Please shoot the back deck & the pond from the air.",
  token: "75c159a6deadbeef"
};
const out = email.render(booking, "https://ezshots.org/", { cents: 6250 });

let bad = 0;
const fail = m => { console.error("FAIL " + m); bad++; };
for (const [who, m] of Object.entries(out)) {
  for (const k of ["subject", "text", "html"]) {
    if (!m[k]) fail(`${who} has no ${k}`);
    if (/undefined|null|NaN/.test(m[k])) fail(`${who} ${k} prints undefined, null or NaN`);
    if (/[\u2013\u2014]/.test(m[k])) fail(`${who} ${k} contains a dash`);
  }
  if (m.html.includes("<b>Ruiz")) fail(`${who} html does not escape customer input`);
  if (/Access notes/.test(m.text + m.html)) fail(`${who} prints an empty optional row`);
  if (m.html.includes("ezshots.org//")) fail(`${who} doubles the slash in links`);
}
const has = (who, s, what) => { if (!(out[who].html.includes(s) && out[who].text.includes(s))) fail(`${who} is missing ${what}`); };
has("owner", "calendar.google.com/calendar/render?action=TEMPLATE", "the Google Calendar link");
has("owner", "dates=20261011T000000Z%2F20261011T013000Z", "the right shoot times in the calendar link");
has("owner", "ezshots.org/admin", "the bookings link");
has("booked", "/api/ics?t=75c159a6deadbeef", "the calendar link");
has("booked", "/manage.html?t=75c159a6deadbeef", "the manage link");
has("refunded", "$62.50", "the refund amount");
if (!out.owner.html.includes(">Add to Google Calendar<")) fail("owner email has no Add to Google Calendar button");
if (!/^Booked: /.test(out.owner.subject)) fail("owner subject does not start with Booked:");
if (!/^You are booked/.test(out.booked.subject)) fail("customer subject is wrong");

const dir = process.argv[2];
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [who, m] of Object.entries(out)) {
    fs.writeFileSync(path.join(dir, who + ".html"), m.html);
    fs.writeFileSync(path.join(dir, who + ".txt"), m.subject + "\n\n" + m.text);
  }
  console.log("wrote " + dir);
}
if (bad) process.exit(1);
console.log("emails ok, " + Object.keys(out).length + " rendered");
