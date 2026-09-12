// Renders both booking emails for a sample booking, without sending anything,
// and checks the things that have gone wrong before: an undefined in the copy,
// an unescaped customer value, an empty optional row, a dash.
//   node scripts/preview-emails.mjs            check only
//   node scripts/preview-emails.mjs <dir>      also write the .html and .txt files
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
const require = createRequire(import.meta.url);
const email = require("../server/email.js");

const booking = {
  id: "EZ-000002", when: "Saturday, October 10 at 8:00 PM",
  address: "1841 Maplehurst Drive, Birmingham MI 48009",
  packageName: "Listing Pro", amount: 125, firstShoot: true,
  name: "Dana <b>Ruiz</b>", email: "dana.ruiz@example.com", phone: "(313) 555-0142",
  brokerage: "Keller Williams Birmingham", size: "2,450 sq ft", occupancy: "Occupied",
  access: "Lockbox", accessNotes: "", notes: "Please shoot the back deck & the pond from the air.",
  token: "75c159a6deadbeef"
};
const out = email.render(booking, "https://ezshots.org/");
let bad = 0;
const fail = m => { console.error("FAIL " + m); bad++; };
for (const who of ["owner", "customer"]) {
  const m = out[who];
  for (const k of ["subject", "text", "html"]) {
    if (/undefined|null|NaN/.test(m[k])) fail(`${who} ${k} prints undefined, null or NaN`);
    if (/[\u2013\u2014]/.test(m[k])) fail(`${who} ${k} contains a dash`);
  }
  if (m.html.includes("<b>Ruiz")) fail(`${who} html does not escape customer input`);
  if (/Access notes/.test(m.text + m.html)) fail(`${who} prints an empty optional row`);
  if (m.html.includes("ezshots.org//")) fail(`${who} doubles the slash in links`);
}
if (!out.owner.html.includes("admin-bookings.html")) fail("owner email does not link to bookings");
if (!out.customer.html.includes("/api/ics?t=75c159a6deadbeef")) fail("customer email has no calendar link");

const dir = process.argv[2];
if (dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const who of ["owner", "customer"]) {
    fs.writeFileSync(path.join(dir, who + ".html"), out[who].html);
    fs.writeFileSync(path.join(dir, who + ".txt"), out[who].subject + "\n\n" + out[who].text);
  }
  console.log("wrote " + dir);
}
if (bad) process.exit(1);
console.log("emails ok");
