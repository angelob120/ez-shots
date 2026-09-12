// End to end: a paid booking, the owner's accept and decline links, admin
// refunds, the emails and the Google sync. The real server against a real
// Postgres, with a fake Stripe, a fake EmailJS and a fake Google standing in, so
// nothing leaves this machine and no money moves.
//
// Needs a local Postgres: DATABASE_URL in .env (or the environment) pointing at
// one. A throwaway database is created for the run and dropped afterwards, so
// the dev data is never touched.
//
// Run: npm run check:decisions
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
  console.log("SKIP check:decisions needs a local DATABASE_URL");
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

// ---- fake Google Apps Script, with the same 302 the real one answers with ----
const google = [];
const googleSrv = await listen(async (req, res) => {
  if (req.method === "POST") {
    google.push(JSON.parse(await readBody(req) || "{}"));
    res.statusCode = 302;
    res.setHeader("location", "/reply");
    return res.end();
  }
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true }));
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
      OWNER_EMAIL: "owner@example.com",
      GOOGLE_SCRIPT_URL: "http://127.0.0.1:" + portOf(googleSrv) + "/exec", GOOGLE_SCRIPT_SECRET: "g-secret",
      SITE_URL: SITE, DATA_DIR: ""
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

  const applied = execFileSync("psql", [dbUrl.toString(), "-Atc", "SELECT string_agg(name, ',' ORDER BY name) FROM schema_migrations"]).toString().trim();
  check("migration 003 applied", applied.includes("003_decisions_and_refunds.sql"), applied);

  const cfg = (await call("GET", "/api/config")).json;
  const pkg = cfg.packages.find(p => p.active !== false);
  const av = (await call("GET", "/api/availability")).json;
  const days = Object.keys(av.days).filter(d => av.days[d].length);

  function signed(payload) {
    const t = Math.floor(Date.now() / 1000);
    const v1 = crypto.createHmac("sha256", "whsec_check").update(t + "." + payload).digest("hex");
    return { "stripe-signature": `t=${t},v1=${v1}` };
  }
  async function paidBooking(i, pi) {
    const date = days[i], time = av.days[date][0];
    const r = await call("POST", "/api/book", {
      packageId: pkg.id, firstShoot: true, date, time,
      name: "Dana <b>Ruiz</b>", email: `dana${i}@example.com`, phone: "(313) 555-0142",
      address: `18${i}1 Maplehurst Drive, Birmingham MI 48009`, notes: "=HYPERLINK(\"x\")"
    });
    const sid = r.json && r.json.url ? r.json.url.split("/").pop() : "";
    const payload = JSON.stringify({ type: "checkout.session.completed", data: { object: {
      id: sid, payment_status: "paid", payment_intent: pi, client_reference_id: r.json.id, metadata: { booking_id: r.json.id }
    } } });
    const w = await call("POST", "/api/stripe/webhook", payload, signed(payload));
    return { id: r.json.id, token: r.json.token, book: r, webhook: w };
  }
  const mailsTo = (to, re) => mails.filter(m => m.to_email === to && re.test(m.subject));
  const linkParams = u => Object.fromEntries(new URL(u).searchParams);

  // ---- 1. paid: owner gets Accept and Decline, customer gets request received
  const one = await paidBooking(0, "pi_one");
  check("booking is held and sent to checkout", one.book.status === 200 && /^EZ-\d{6}$/.test(one.id), one.book.json);
  check("webhook confirms it", one.webhook.status === 200, one.webhook.json);
  const ownerMail = await waitFor(() => mailsTo("owner@example.com", /^Needs your OK/)[0]);
  const requestMail = await waitFor(() => mailsTo("dana0@example.com", /^Request received/)[0]);
  check("owner email says it needs an OK", !!ownerMail, mails.map(m => m.subject));
  check("customer email says request received, not booked", !!requestMail && !mailsTo("dana0@example.com", /You are booked/).length);
  check("owner email escapes the customer's name", ownerMail && ownerMail.message_html.includes("Dana &lt;b&gt;Ruiz") && !ownerMail.message_html.includes("<b>Ruiz"));
  const accept = ownerMail && (ownerMail.message.match(/^Accept: (\S+)$/m) || [])[1];
  const decline = ownerMail && (ownerMail.message.match(/^Decline and refund \$[\d.]+: (\S+)$/m) || [])[1];
  check("owner email carries both signed links", !!accept && !!decline && accept.startsWith(SITE + "/decide.html?"), ownerMail && ownerMail.message);
  const gPaid = await waitFor(() => google.find(g => g.event === "paid" && g.booking.id === one.id));
  check("Google gets the paid booking, on the calendar and not yet accepted",
    gPaid && gPaid.secret === "g-secret" && gPaid.booking.onCalendar === true && gPaid.booking.accepted === false, gPaid);

  // ---- 2. the links are signed per booking and per action
  const a = linkParams(accept), d = linkParams(decline);
  const view = await call("GET", "/api/decide?" + new URLSearchParams(a));
  check("accept link opens the booking", view.status === 200 && view.json.booking.status === "confirmed" && view.json.booking.decision === "", view.json);
  const tampered = Object.assign({}, a, { s: a.s.slice(0, -1) + (a.s.endsWith("0") ? "1" : "0") });
  check("a tampered signature is refused", (await call("GET", "/api/decide?" + new URLSearchParams(tampered))).status === 403);
  check("an accept signature does not work for decline", (await call("GET", "/api/decide?" + new URLSearchParams(Object.assign({}, a, { a: "decline" })))).status === 403);
  check("decline without the second yes is refused", (await call("POST", "/api/decide", d)).status === 400);

  // ---- 3. accept, twice
  const acc = await call("POST", "/api/decide", a);
  check("accept works", acc.status === 200 && acc.json.booking.decision === "accepted", acc.json);
  const bookedMail = await waitFor(() => mailsTo("dana0@example.com", /^You are booked/)[0]);
  check("customer gets you are booked, with the calendar link", !!bookedMail && bookedMail.message_html.includes("/api/ics?t="));
  const gAcc = await waitFor(() => google.find(g => g.event === "accepted" && g.booking.id === one.id));
  check("Google gets the accept", gAcc && gAcc.booking.accepted === true);
  const before = mails.length;
  const again = await call("POST", "/api/decide", a);
  await sleep(1500);
  check("a second accept changes nothing and sends nothing", again.status === 200 && again.json.already === true && mails.length === before, again.json);

  // ---- 4. admin refunds, partial, a double click, too much
  const login = await call("POST", "/api/admin/login", { password: "check-pass" });
  cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  check("admin signs in", login.status === 200 && cookie.startsWith("ez_admin="));
  const path = "/api/admin/bookings/" + one.id;
  check("refund without confirm is refused", (await call("PATCH", path, { action: "refund", amount: 10 })).status === 400);
  const part = await call("PATCH", path, { action: "refund", amount: 62.5, confirm: true });
  // Whatever the first active package costs; the numbers below are worked out
  // from it rather than assuming Listing Pro.
  const total = Math.round((((part.json && part.json.booking) || {}).amount || 0) * 100);
  const fmt = c => "$" + (c / 100).toFixed(2).replace(/\.00$/, "");
  check("the package costs more than the refunds this test makes", total > 7250, total);
  check("partial refund of $62.50", part.status === 200 && part.json.booking.refundedCents === 6250 && part.json.booking.state === "confirmed", part.json);
  const call1 = stripeCalls.find(c => c.url === "/v1/refunds");
  check("Stripe was asked for 6250 cents on the right payment", call1 && call1.form.amount === "6250" && call1.form.payment_intent === "pi_one" && call1.key === `refund-${one.id}-0-6250`, call1);
  check("customer gets the refund email", !!(await waitFor(() => mailsTo("dana0@example.com", /^Refund of \$62\.50/)[0])));
  const [c1, c2] = await Promise.all([
    call("PATCH", path, { action: "refund", amount: 10, confirm: true }),
    call("PATCH", path, { action: "refund", amount: 10, confirm: true })
  ]);
  const afterDouble = (await call("GET", "/api/admin/bookings")).json.bookings.find(b => b.id === one.id);
  check("a double clicked $10 refund is recorded once", (c1.status === 200 || c2.status === 200) && afterDouble.refundedCents === 7250, { c1: c1.json, c2: c2.json, refunded: afterDouble.refundedCents });
  const over = await call("PATCH", path, { action: "refund", amount: 100, confirm: true });
  check("refunding more than is left is refused", over.status === 400 && over.json.error.includes(fmt(total - 7250)), over.json);

  // ---- 5. decline from the email link refunds the rest
  const dView = await call("GET", "/api/decide?" + new URLSearchParams(d));
  check("decline page shows what is left to refund", dView.json.booking.refundable === (total - 7250) / 100 && dView.json.booking.canRefund === true, dView.json);
  const dec = await call("POST", "/api/decide", Object.assign({}, d, { confirm: true }));
  check("decline refunds what is left and cancels", dec.status === 200 && dec.json.refundedCents === total - 7250 &&
    dec.json.booking.status === "cancelled" && dec.json.booking.decision === "declined", dec.json);
  check("customer gets the decline email", !!(await waitFor(() => mailsTo("dana0@example.com", /^About your shoot/)[0])));
  const gDec = await waitFor(() => google.find(g => g.event === "declined" && g.booking.id === one.id));
  check("Google takes it off the calendar", gDec && gDec.booking.onCalendar === false && gDec.booking.refunded === total / 100, gDec && gDec.booking);
  check("declining twice is refused", (await call("POST", "/api/decide", Object.assign({}, d, { confirm: true }))).status === 400);
  const manage = await call("GET", "/api/manage?t=" + one.token);
  check("customer's manage page shows cancelled and every dollar refunded", manage.json.booking.state === "cancelled" && manage.json.booking.refunded === total / 100, manage.json);

  // ---- 6. when Stripe refuses, nothing changes
  const two = await paidBooking(1, "pi_two");
  await waitFor(() => google.find(g => g.event === "paid" && g.booking.id === two.id));
  refundsFail = true;
  const refused = await call("PATCH", "/api/admin/bookings/" + two.id, { action: "decline", confirm: true });
  refundsFail = false;
  const stillThere = (await call("GET", "/api/admin/bookings")).json.bookings.find(b => b.id === two.id);
  check("a refused refund leaves the booking paid and waiting", refused.status === 502 && stillThere.state === "confirmed" && stillThere.awaiting === true && !stillThere.refundedCents, { refused: refused.json, state: stillThere.state });
  check("and no decline email goes out", !mailsTo("dana1@example.com", /^About your shoot/).length);
  const adminAccept = await call("PATCH", "/api/admin/bookings/" + two.id, { action: "accept" });
  check("admin can accept too", adminAccept.status === 200 && adminAccept.json.booking.decision === "accepted", adminAccept.json);

  // ---- 7. pages
  const adminPage = await fetch(SITE + "/admin").then(r => r.text().then(t => ({ status: r.status, t })));
  check("/admin opens the bookings page", adminPage.status === 200 && adminPage.t.includes("js/admin-bookings.js"));
  const decidePage = await fetch(SITE + "/decide.html").then(r => r.text().then(t => ({ status: r.status, t })));
  check("decide.html is served and not indexed", decidePage.status === 200 && decidePage.t.includes("noindex"));
  const secret = execFileSync("psql", [dbUrl.toString(), "-Atc", "SELECT length(value #>> '{}') FROM settings WHERE key = 'link_secret'"]).toString().trim();
  check("the link key lives in the database", secret === "64", secret);
} catch (e) {
  failures++;
  console.log("  FAIL  " + e.message);
} finally {
  if (server) server.kill();
  for (const s of [stripeSrv, mailSrv, googleSrv]) s.close();
  await sleep(300);
  try { execFileSync("psql", [BASE_DB, "-qc", `DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE)`], { stdio: "pipe" }); } catch {}
}

if (failures) {
  console.log("\n" + failures + " decision check(s) failed. Server log:\n" + serverLog.slice(-2000));
  process.exit(1);
}
console.log("\nAll decision checks passed.");
