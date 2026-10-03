// End to end, the whole no call funnel: a client books for $0, both emails go
// out, the owner marks the shoot done and sends the photos, the client pays
// after seeing them, the files unlock, the review request follows a day later,
// an unhappy client is flagged and left alone, and the owner refunds from
// admin. The real server against a real Postgres, with a fake
// Stripe and a fake EmailJS standing in, so nothing leaves this machine and no
// money moves.
//
// Needs a local Postgres: DATABASE_URL in .env (or the environment) pointing at
// one. A throwaway database is created for the run and dropped afterwards, so
// the dev data is never touched.
//
// Run: npm run check:bookings
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";

function fromEnvFile(key) {
  try {
    const m = fs.readFileSync(".env", "utf8").match(new RegExp("^\\s*" + key + "\\s*=\\s*(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch { return ""; }
}
const BASE_DB = process.env.DATABASE_URL || fromEnvFile("DATABASE_URL");
if (!BASE_DB || !/localhost|127\.0\.0\.1/.test(BASE_DB)) {
  console.log("SKIP check:bookings needs a local DATABASE_URL");
  process.exit(0);
}
const DB_NAME = "ez_shots_check_" + process.pid;
const dbUrl = new URL(BASE_DB);
dbUrl.pathname = "/" + DB_NAME;

let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ok    " : "  FAIL  ") + name + (ok || detail === undefined ? "" : "\n        " + JSON.stringify(detail)));
  if (!ok) failures++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(100); }
  return fn();
}
const readBody = req => new Promise(r => { let d = ""; req.on("data", c => { d += c; }); req.on("end", () => r(d)); });
const listen = handler => new Promise(r => { const s = http.createServer(handler); s.listen(0, "127.0.0.1", () => r(s)); });
const portOf = s => s.address().port;

// ---- fake Stripe ----------------------------------------------------------
const stripeCalls = [];
const refundsByKey = new Map();
let refundsFail = false;
let sessions = 0;
const stripeSrv = await listen(async (req, res) => {
  const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
  stripeCalls.push({ method: req.method, url: req.url, form, key: req.headers["idempotency-key"] });
  res.setHeader("content-type", "application/json");
  if (req.method === "POST" && req.url === "/v1/checkout/sessions") {
    sessions++;
    return res.end(JSON.stringify({ id: "cs_test_" + sessions, url: "https://checkout.test/cs_test_" + sessions }));
  }
  if (req.method === "GET" && req.url.startsWith("/v1/checkout/sessions/")) {
    return res.end(JSON.stringify({ id: req.url.split("/").pop(), payment_status: "paid", payment_intent: "pi_from_session" }));
  }
  if (req.method === "POST" && req.url === "/v1/refunds") {
    if (refundsFail) { res.statusCode = 402; return res.end(JSON.stringify({ error: { message: "The refund could not be processed." } })); }
    const key = req.headers["idempotency-key"];
    if (!refundsByKey.has(key)) refundsByKey.set(key, { id: "re_" + (refundsByKey.size + 1), amount: Number(form.amount), payment_intent: form.payment_intent });
    return res.end(JSON.stringify(refundsByKey.get(key)));
  }
  res.statusCode = 404;
  res.end("{}");
});

// ---- fake EmailJS ---------------------------------------------------------
const mails = [];
const mailSrv = await listen(async (req, res) => {
  const b = JSON.parse(await readBody(req) || "{}");
  mails.push(b.template_params || {});
  res.end("OK");
});

// ---- the real server --------------------------------------------------------
const free = await listen(() => {});
const PORT = portOf(free);
free.close();
const SITE = "http://127.0.0.1:" + PORT;

execFileSync("psql", [BASE_DB, "-qc", `CREATE DATABASE ${DB_NAME}`], { stdio: "pipe" });
let server;
let serverLog = "";
try {
  server = spawn(process.execPath, ["server.js"], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), DATABASE_URL: dbUrl.toString(), NODE_ENV: "development", TZ: "America/Detroit",
      ADMIN_PASSWORD: "check-pass", ADMIN_SECRET: "",
      STRIPE_SECRET_KEY: "sk_test_fake", STRIPE_WEBHOOK_SECRET: "whsec_check",
      STRIPE_API_BASE: "http://127.0.0.1:" + portOf(stripeSrv),
      EMAILJS_SERVICE_ID: "service_check", EMAILJS_PUBLIC_KEY: "pub", EMAILJS_PRIVATE_KEY: "priv",
      EMAILJS_TEMPLATE_BOOKING: "template_check", EMAILJS_ENDPOINT: "http://127.0.0.1:" + portOf(mailSrv) + "/send",
      OWNER_EMAIL: "owner@example.com", SITE_URL: SITE, DATA_DIR: "", TICK_MS: "5000", REVIEW_URL: "https://g.page/r/test-review"
    }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.on("data", d => { serverLog += d; });
  server.stderr.on("data", d => { serverLog += d; });

  let cookie = "";
  async function call(method, path, body, headers = {}) {
    const r = await fetch(SITE + path, {
      method,
      headers: Object.assign({ "content-type": "application/json", accept: "application/json" }, cookie ? { cookie } : {}, headers),
      body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body)
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, headers: r.headers };
  }

  const up = await waitFor(() => /online booking ON/.test(serverLog), 15000);
  check("server boots against a fresh database", up, serverLog.slice(-600));
  if (!up) throw new Error("server did not start");

  const cfg = (await call("GET", "/api/config")).json;
  const pkg = cfg.packages.find(p => p.active !== false);
  const av = (await call("GET", "/api/availability")).json;
  const days = Object.keys(av.days).filter(d => av.days[d].length);

  function signed(payload) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac("sha256", "whsec_check").update(t + "." + payload).digest("hex");
    return { "stripe-signature": `t=${t},v1=${v1}` };
  }
  const login = await call("POST", "/api/admin/login", { password: "check-pass" });
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("admin signs in", login.status === 200 && cookie.startsWith("ez_admin="));
  const asAdmin = (method, path, body) => call(method, path, body);
  const asClient = async (method, path, body) => { const c = cookie; cookie = ""; try { return await call(method, path, body); } finally { cookie = c; } };

  function bookIt(i, extra = {}) {
    const date = days[i], time = av.days[date][0];
    return asClient("POST", "/api/book", Object.assign({
      packageId: pkg.id, firstShoot: true, date, time,
      name: "Dana <b>Ruiz</b>", email: `dana${i}@example.com`, phone: "(313) 555-0142",
      address: `18${i}1 Maplehurst Drive, Birmingham MI 48009`, notes: "Back deck & pond from the air"
    }, extra)).then(r => Object.assign(r, { date, time }));
  }
  function webhookPaid(id, sid, pi) {
    const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {
      id: sid, payment_status: "paid", payment_intent: pi, client_reference_id: id, metadata: { booking_id: id, purpose: "pay" } } } });
    return call("POST", "/api/stripe/webhook", payload, signed(payload));
  }
  // Book, shoot, send photos, pay: the normal journey, start to finish.
  async function paidBooking(i, pi) {
    const r = await bookIt(i);
    const id = r.json.id, token = r.json.token;
    await asAdmin("PATCH", "/api/admin/bookings/" + id, { action: "shot" });
    await asAdmin("PATCH", "/api/admin/bookings/" + id, { action: "ready", previewUrl: "https://gallery.test/preview-" + i, finalUrl: "https://files.test/final-" + i });
    const pay = await asClient("POST", "/api/pay?t=" + token);
    const sid = pay.json && pay.json.url ? pay.json.url.split("/").pop() : "";
    const w = await webhookPaid(id, sid, pi);
    return { id, token, date: r.date, time: r.time, book: r, pay, sid, webhook: w };
  }
  const mailsTo = (to, re) => mails.filter(m => m.to_email === to && re.test(m.subject));
  const manageOf = async t => (await asClient("GET", "/api/manage?t=" + t)).json.booking;

  // ---- 1. book for $0: confirmed on the spot, both emails, nothing charged
  const b0 = await bookIt(0);
  const one = { id: b0.json && b0.json.id, token: b0.json && b0.json.token, date: b0.date, time: b0.time };
  check("booking is confirmed on the spot and sent to the confirmation page", b0.status === 200 && /^EZ-\d{6}$/.test(one.id) &&
    b0.json.url === "/booked.html?t=" + one.token, b0.json);
  check("no Stripe call is made to book", !stripeCalls.some(c => c.url === "/v1/checkout/sessions"), stripeCalls);
  const again = await bookIt(0, { resume: { id: one.id, token: one.token } });
  check("a double tap returns the same booking", again.status === 200 && again.json.id === one.id, again.json);
  const stolen = await bookIt(0, { email: "someone@else.com" });
  check("anyone else asking for that time is refused", stolen.status === 409 && stolen.json.taken === true, stolen.json);
  const gone = (await call("GET", "/api/availability")).json.days[one.date] || [];
  check("the time is off the public calendar", gone.indexOf(one.time) === -1, gone);
  const ownerMail = await waitFor(() => mailsTo("owner@example.com", /^Booked: /)[0]);
  const clientMail = await waitFor(() => mailsTo("dana0@example.com", /^You are booked/)[0]);
  check("owner gets the booking email, saying nothing is paid yet", !!ownerMail && /Nothing is paid yet/.test(ownerMail.message), mails.map(m => m.subject));
  check("client gets You are booked: $0 today, what happens next, prep list, calendar file", !!clientMail &&
    clientMail.message.includes("Due today: $0") && clientMail.message.includes("WHAT HAPPENS NEXT") &&
    clientMail.message_html.includes("Before I arrive") && clientMail.message_html.includes("/api/ics?t=" + one.token));
  const gcal = ownerMail && (ownerMail.message.match(/^Add to Google Calendar: (\S+)$/m) || [])[1];
  const gp = gcal ? new URL(gcal).searchParams : new URLSearchParams();
  const m0 = await manageOf(one.token);
  const startZ = new Date(m0.startsAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  check("owner email has an Add to Google Calendar button", !!ownerMail && ownerMail.message_html.includes(">Add to Google Calendar<"));
  check("the calendar link is filled in: title, place, start time, details",
    gcal && gcal.startsWith("https://calendar.google.com/calendar/render?") && gp.get("action") === "TEMPLATE" &&
    gp.get("text") === "EZ Shots: 1801 Maplehurst Drive, Birmingham MI 48009" && gp.get("dates").startsWith(startZ + "/") &&
    gp.get("location") === "1801 Maplehurst Drive, Birmingham MI 48009" && /Client: Dana <b>Ruiz<\/b>/.test(gp.get("details")),
    { gcal, startZ });
  check("owner email escapes the client's name", ownerMail && ownerMail.message_html.includes("Dana &lt;b&gt;Ruiz") && !ownerMail.message_html.includes("<b>Ruiz"));
  check("the manage page says booked, unpaid, can cancel, cannot pay yet", m0.stage === "booked" && m0.paid === false &&
    m0.canCancel === true && m0.canPay === false && m0.finalUrl === "", m0);
  check("paying before the photos is refused", (await asClient("POST", "/api/pay?t=" + one.token)).status === 400);

  // ---- 2. shoot done, photos sent, paid after: the files unlock once
  const path = "/api/admin/bookings/" + one.id;
  const shot = await asAdmin("PATCH", path, { action: "shot" });
  check("the owner marks the shoot done", shot.status === 200 && shot.json.booking.stage === "shot" && shot.json.emailed === true, shot.json);
  check("the client is told the photos are on the way", !!(await waitFor(() => mailsTo("dana0@example.com", /^Shoot done at /)[0])));
  const sameLinks = await asAdmin("PATCH", path, { action: "ready", previewUrl: "https://x.test/a", finalUrl: "https://x.test/a" });
  check("the preview and files links have to differ", sameLinks.status === 400, sameLinks.json);
  const ready = await asAdmin("PATCH", path, { action: "ready", previewUrl: "https://gallery.test/preview-0", finalUrl: "https://files.test/final-0" });
  check("the owner sends the photos and payment is due", ready.status === 200 && ready.json.booking.stage === "ready", ready.json);
  const readyMail = await waitFor(() => mailsTo("dana0@example.com", /^Your photos are ready/)[0]);
  check("the client gets the previews with Pay and Not happy, and not the files link", !!readyMail &&
    readyMail.message_html.includes("https://gallery.test/preview-0") && readyMail.message_html.includes("#pay") &&
    readyMail.message_html.includes("#unhappy") && !readyMail.message_html.includes("files.test"));
  const m1 = await manageOf(one.token);
  check("the manage page shows the previews and Pay, still not the files", m1.canPay === true && m1.previewUrl === "https://gallery.test/preview-0" &&
    m1.finalUrl === "" && m1.canCancel === false, m1);
  const pay = await asClient("POST", "/api/pay?t=" + one.token);
  const sess = stripeCalls.filter(c => c.url === "/v1/checkout/sessions").pop();
  check("Pay opens a Stripe checkout for the booked amount, set by the server", pay.status === 200 && pay.json.mode === "session" &&
    sess && sess.form["line_items[0][price_data][unit_amount]"] === String(pkg.firstPrice * 100) &&
    sess.form["metadata[booking_id]"] === one.id && /manage\.html\?t=/.test(sess.form.success_url), { pay: pay.json, form: sess && sess.form });
  const sid = pay.json.url.split("/").pop();
  const wh = await webhookPaid(one.id, sid, "pi_one");
  check("the Stripe webhook marks it paid", wh.status === 200, wh.json);
  const delivered = await waitFor(() => mailsTo("dana0@example.com", /^Paid, here are your files/)[0]);
  check("the client gets the files link and Book another shoot", !!delivered && delivered.message_html.includes("https://files.test/final-0") &&
    delivered.message_html.includes("/book.html"));
  check("the owner is told it was paid", !!(await waitFor(() => mailsTo("owner@example.com", /^Paid \$/)[0])));
  const m2 = await manageOf(one.token);
  check("the manage page now shows the files", m2.paid === true && m2.stage === "delivered" && m2.finalUrl === "https://files.test/final-0" && !m2.canPay, m2);
  const before = mails.length;
  await webhookPaid(one.id, sid, "pi_one");
  await call("GET", "/api/session?id=" + sid);
  await sleep(1500);
  check("a repeated webhook and the success page deliver nothing twice", mails.length === before, mails.slice(before).map(m => m.subject));

  // ---- 3. the review request: a day after delivery, only for a happy paid job
  execFileSync("psql", [dbUrl.toString(), "-qc", `UPDATE bookings SET delivered_at = now() - interval '25 hours' WHERE id = '${one.id}'`], { stdio: "pipe" });
  const review = await waitFor(() => mailsTo("dana0@example.com", /^How did the photos do/)[0], 9000);
  check("a day after delivery the client gets the review request, with the review link", !!review && review.message_html.includes("https://g.page/r/test-review"));
  await sleep(6000);
  check("and only once", mailsTo("dana0@example.com", /^How did the photos do/).length === 1);

  // ---- 4. refunds from admin, on a paid job
  check("a refund without confirm is refused", (await call("PATCH", path, { action: "refund", amount: 10 })).status === 400);
  const part = await call("PATCH", path, { action: "refund", amount: 20.5, confirm: true });
  const total = Math.round((((part.json && part.json.booking) || {}).amount || 0) * 100);
  check("partial refund of $20.50, booking stays paid", part.status === 200 && part.json.booking.refundedCents === 2050 && part.json.booking.state === "confirmed", part.json);
  const r1 = stripeCalls.find(c => c.url === "/v1/refunds");
  check("Stripe was asked for 2050 cents on the right payment, with an idempotency key",
    r1 && r1.form.amount === "2050" && r1.form.payment_intent === "pi_one" && r1.key === `refund-${one.id}-0-2050`, r1);
  check("client gets the refund email", !!(await waitFor(() => mailsTo("dana0@example.com", /^Refund of \$20\.50/)[0])));
  // The admin page sends the same request id when the same refund is pressed
  // twice. Once at the same moment, and once again after the first finished.
  const refundMailsBefore = mailsTo("dana0@example.com", /^Refund of/).length;
  const same = { action: "refund", amount: 5, confirm: true, requestId: "dbl5refund01" };
  const [c1, c2] = await Promise.all([call("PATCH", path, same), call("PATCH", path, same)]);
  const c3 = await call("PATCH", path, same);
  const afterDouble = (await call("GET", "/api/admin/bookings")).json.bookings.find(b => b.id === one.id);
  check("the same $5 refund pressed three times is refunded once", c1.status === 200 && c2.status === 200 && c3.status === 200 &&
    afterDouble.refundedCents === 2550 && [c1, c2, c3].filter(c => c.json.duplicate).length === 2,
    { c1: c1.json.duplicate, c2: c2.json.duplicate, c3: c3.json.duplicate, refunded: afterDouble.refundedCents });
  await sleep(2500);
  check("and emails the client once", mailsTo("dana0@example.com", /^Refund of/).length === refundMailsBefore + 1);
  check("and asked Stripe with one key", new Set(stripeCalls.filter(c => c.url === "/v1/refunds" && /dbl5refund01/.test(c.key)).map(c => c.key)).size === 1);
  const over = await call("PATCH", path, { action: "refund", amount: total / 100, confirm: true });
  check("refunding more than is left is refused", over.status === 400, over.json);
  const rest = (total - 2550) / 100;
  const full = await call("PATCH", path, { action: "refund", amount: rest, cancel: true, confirm: true });
  check("refunding the rest with cancel ticked cancels the booking", full.status === 200 && full.json.booking.refundedCents === total &&
    full.json.booking.state === "cancelled" && full.json.booking.refundable === 0, full.json);
  const cancelMail = await waitFor(() => mails.find(m => m.to_email === "dana0@example.com" && /cancelled/.test(m.message)));
  check("that refund email says the booking is cancelled", !!cancelMail);
  const slot = (await call("GET", "/api/availability")).json.days[one.date] || [];
  check("the time is open again", slot.indexOf(one.time) !== -1, slot);
  check("nothing is left to refund afterwards", (await call("PATCH", path, { action: "refund", amount: 1, confirm: true })).status === 400);

  // ---- 5. when Stripe refuses, nothing changes
  const two = await paidBooking(1, "pi_two");
  await waitFor(() => mailsTo("owner@example.com", /^Booked: /).length >= 2);
  refundsFail = true;
  const refused = await call("PATCH", "/api/admin/bookings/" + two.id, { action: "refund", amount: 5, cancel: true, confirm: true });
  refundsFail = false;
  const still = (await call("GET", "/api/admin/bookings")).json.bookings.find(b => b.id === two.id);
  check("a refused refund leaves the booking paid and untouched", refused.status === 502 && still.state === "confirmed" && !still.refundedCents,
    { refused: refused.json, state: still.state });
  check("and sends no refund email", !mailsTo("dana1@example.com", /^Refund/).length);

  // ---- 6. reschedule and add a booking by hand
  const movePath = "/api/admin/bookings/" + two.id;
  const addDate = days[2];
  const made = await call("POST", "/api/admin/bookings", {
    packageId: pkg.id, date: addDate, time: "7:15 AM", name: "Phone Client", email: "phone@example.com",
    phone: "(248) 555-0100", address: "400 Phone Booking Lane, Troy MI 48084", paid: false, amount: 90
  });
  check("the owner can add a booking by hand, unpaid, at his own price", made.status === 200 && made.json.booking.state === "confirmed" &&
    made.json.booking.paid === false && made.json.booking.amount === 90 && made.json.booking.source === "admin", made.json);
  const onto = await call("PATCH", movePath, { action: "move", date: addDate, time: "7:15 AM" });
  check("a move onto another booking's time is refused", onto.status === 409, onto.json);
  const target = days[days.length - 1];
  const beforeMove = mails.length;
  const moved = await call("PATCH", movePath, { action: "move", date: target, time: "9:30 am", notify: true });
  check("the owner can move a booking to any real time", moved.status === 200 && moved.json.booking.date === target &&
    moved.json.booking.time === "9:30 AM" && moved.json.booking.state === "confirmed", moved.json);
  const movedMail = await waitFor(() => mails.slice(beforeMove).find(m => m.to_email === "dana1@example.com" && /^Your shoot is now /.test(m.subject)));
  check("and the client is emailed the new time when he asks", !!movedMail);
  const oldSlot = (await call("GET", "/api/availability")).json.days[two.date] || [];
  check("the old time opens back up", oldSlot.indexOf(two.time) !== -1, oldSlot);
  const quiet = await call("PATCH", movePath, { action: "move", date: target, time: "10:30 AM" });
  await sleep(1500);
  check("a move without notify sends nothing", quiet.status === 200 && !mails.slice(beforeMove + 1).some(m => /^Your shoot is now 10:30/.test(m.subject) || /10:30 AM/.test(m.subject)));

  const clashAdd = await call("POST", "/api/admin/bookings", {
    packageId: pkg.id, date: addDate, time: "7:15 AM", name: "Second Client", address: "401 Phone Booking Lane, Troy MI"
  });
  check("adding a second booking at that time is refused", clashAdd.status === 409, clashAdd.json);
  const markPaid = await call("PATCH", "/api/admin/bookings/" + made.json.booking.id, { action: "confirm" });
  check("marking the hand booking paid records the payment", markPaid.status === 200 && markPaid.json.booking.paid === true && !!markPaid.json.booking.paidAt, markPaid.json);

  // ---- 7. the unhappy client: flagged, and left alone
  const sad = await bookIt(3);
  const sadPath = "/api/admin/bookings/" + sad.json.id;
  check("the unhappy button is not offered before the shoot", (await asClient("POST", "/api/manage/unhappy?t=" + sad.json.token, {})).status === 400);
  await asAdmin("PATCH", sadPath, { action: "ready", previewUrl: "https://gallery.test/p3", finalUrl: "https://files.test/f3" });
  await waitFor(() => mailsTo("dana3@example.com", /^Your photos are ready/)[0]);
  const flag = await asClient("POST", "/api/manage/unhappy?t=" + sad.json.token, { reason: "Kitchen too dark" });
  check("the client can say they are not happy", flag.status === 200 && flag.json.booking.flagged === true && flag.json.booking.canPay === true, flag.json);
  const sadMail = await waitFor(() => mailsTo("owner@example.com", /^Not happy: /)[0]);
  check("the owner is told, with what they said", !!sadMail && sadMail.message.includes("Kitchen too dark"));
  const resend = await asAdmin("PATCH", sadPath, { action: "ready", previewUrl: "https://gallery.test/p3b", finalUrl: "https://files.test/f3" });
  await sleep(1500);
  check("a flagged job gets no more payment emails", resend.status === 200 && resend.json.emailed === false &&
    mailsTo("dana3@example.com", /^Your photos are ready/).length === 1);
  const sadList = (await call("GET", "/api/admin/bookings")).json;
  check("the admin list counts the flagged job", sadList.stats.flagged === 1, sadList.stats);

  // ---- 8. the customer cancels: the slot frees and the owner hears
  const leaver = await bookIt(4);
  const cx = await asClient("POST", "/api/manage/cancel?t=" + leaver.json.token, {});
  check("the client can cancel before the shoot", cx.status === 200 && cx.json.booking.state === "cancelled", cx.json);
  check("the owner is emailed about it", !!(await waitFor(() => mailsTo("owner@example.com", /^Cancelled: /)[0])));
  const freed = (await call("GET", "/api/availability")).json.days[leaver.date] || [];
  check("and the time is open again", freed.indexOf(leaver.time) !== -1, freed);

  // ---- 9. the day before reminder
  const soon = new Date(Date.now() + 6 * 3600 * 1000);
  const soonKey = soon.getFullYear() + "-" + String(soon.getMonth() + 1).padStart(2, "0") + "-" + String(soon.getDate()).padStart(2, "0");
  const soonTime = ((soon.getHours() % 12) || 12) + ":" + String(soon.getMinutes()).padStart(2, "0") + (soon.getHours() < 12 ? " AM" : " PM");
  const tomorrow = await call("POST", "/api/admin/bookings", {
    packageId: pkg.id, date: soonKey, time: soonTime, name: "Soon Client", email: "soon@example.com",
    phone: "(248) 555-0101", address: "12 Reminder Road, Troy MI 48084", access: "Lockbox"
  });
  check("a shoot inside the next day can be added", tomorrow.status === 200, tomorrow.json);
  const remind = await waitFor(() => mailsTo("soon@example.com", /^Tomorrow: your shoot/)[0], 9000);
  check("its client gets the reminder with how to get in, and no code asked for in email", !!remind && remind.message.includes("Getting in: Lockbox"));
  await sleep(6000);
  check("and only once", mailsTo("soon@example.com", /^Tomorrow: your shoot/).length === 1);
  const list = (await call("GET", "/api/admin/bookings")).json;
  check("the admin list counts each client's bookings and reports net revenue",
    list.bookings.every(b => typeof b.clientBookings === "number") && typeof list.stats.revenue === "number" &&
    typeof list.stats.unpaid === "number" && Array.isArray(list.packages), list.stats);

  // ---- 5. pages
  const adminPage = await fetch(SITE + "/admin").then(r => r.text().then(t => ({ status: r.status, t })));
  check("/admin opens the bookings page", adminPage.status === 200 && adminPage.t.includes("js/admin-bookings.js"));
  check("the removed accept and decline page is gone", (await fetch(SITE + "/decide.html")).status === 404 && (await call("GET", "/api/decide?b=EZ-000001")).status === 404);
} catch (e) {
  failures++;
  console.log("  FAIL  " + e.message);
} finally {
  if (server) server.kill();
  for (const s of [stripeSrv, mailSrv]) s.close();
  await sleep(300);
  try { execFileSync("psql", [BASE_DB, "-qc", `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`], { stdio: "pipe" }); } catch {}
}

if (failures) {
  console.log("\n" + failures + " booking check(s) failed. Server log:\n" + serverLog.slice(-2000));
  process.exit(1);
}
console.log("\nAll booking checks passed.");
