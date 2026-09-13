// EZ Shots server.
//
// The site is still static HTML. This process exists for the things a static
// file cannot do:
//   1. Hold the live prices, checkout links and availability, so the owner can
//      change a price on the site instead of editing code and redeploying.
//   2. Hold the Stripe secret key, so the CUSTOMER'S BROWSER NEVER DECIDES WHAT
//      A SHOOT COSTS. The browser sends a package id, the server looks the
//      price up in its own config and creates the Checkout Session.
//   3. Own the calendar. GET /api/availability is the only thing that says
//      what can be booked, and POST /api/book is the only thing that takes a
//      slot, inside a database transaction, so two agents cannot both get the
//      same 1:00 PM. See server/availability.js and server/db.js.
//
// ENV
//   PORT                   Railway sets this. 3000 locally.
//   DATABASE_URL           the Railway Postgres. Config and bookings live there.
//                          Without it the site still serves, prices come from
//                          DATA_DIR or the seed config.json, and online booking
//                          is off: the booking page says so.
//   DATA_DIR               where the config file goes when there is no
//                          database. Default ./data. Kept for a laptop, not for
//                          production, which has the database.
//   ADMIN_PASSWORD         required to use /admin. Unset means admin is off, and
//                          there is no default password, ever.
//   ADMIN_SECRET           optional, signs the session cookie. Derived from the
//                          password when unset, which logs everyone out whenever
//                          the password changes. That is the right behaviour.
//   STRIPE_SECRET_KEY      optional. When set, checkout is a Session created
//                          here with a server side price and the booking is
//                          confirmed by Stripe. When unset, the booking page
//                          falls back to the payment links in the config and
//                          the owner marks bookings paid by hand in admin.
//   STRIPE_WEBHOOK_SECRET  optional, from the Stripe dashboard once an endpoint
//                          for /api/stripe/webhook exists. Without it the
//                          booking is confirmed when the customer lands on the
//                          success page, which is the same server side read of
//                          the session, only it depends on the browser coming
//                          back. Set it and that dependency goes away.
//   OWNER_EMAIL            where a booking notification goes. Unset means the
//                          owner gets no email; the customer still gets his.
//   EMAILJS_*              the confirmation emails. See server/email.js for the
//                          full list and for why they are sent from here and
//                          not from the browser like the contact form is.
//   SITE_URL               optional, the public origin used to build Stripe's
//                          return URLs. Worked out from the request when unset.
//   TZ                     the business timezone. Defaulted below to Detroit so
//                          "8:00 AM" means 8 in the morning in Michigan even on
//                          a Railway box that thinks it is in UTC.
"use strict";

// Before anything touches a Date. Node reads TZ when it first needs it.
// Trimmed: on 2026-09-12 a tab pasted in front of the Railway value made the
// zone unreadable, and Node quietly falls back to UTC when that happens.
process.env.TZ = String(process.env.TZ || "").trim() || "America/Detroit";

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const avail = require("./server/availability");
const stripe = require("./server/stripe");
const { Db } = require("./server/db");
const email = require("./server/email");

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT || "3000", 10);
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, "data");
const LIVE_CONFIG = path.join(DATA_DIR, "config.json");
const SEED_CONFIG = path.join(ROOT, "config.json");
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "";
const ADMIN_SECRET = process.env.ADMIN_SECRET || (ADMIN_PASSWORD ? "s:" + ADMIN_PASSWORD : "");
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || "";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || "";
const SITE_URL = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
const SESSION_HOURS = 12;

// How long a slot stays held while the customer pays. A Checkout Session is
// told to expire at 30 minutes, the shortest Stripe allows, and the hold
// outlives it by a little so the expiry webhook finds it still there. With
// payment links nothing can confirm a payment on its own, so the hold lasts a
// day and the owner marks it paid in admin, or it lapses.
const HOLD_SESSION_MS = 32 * 60 * 1000;
const HOLD_LINK_MS = 24 * 3600 * 1000;
const STRIPE_EXPIRES_SEC = 30 * 60 + 60;

// Files that live in the repo but must not be served. docs/site.md noted that
// the working notes were publicly readable on the old static deploy. They are
// not any more.
const PRIVATE = [/^\/?\.git/, /^\/?\.claude/, /^\/?node_modules/, /^\/?data\//, /^\/?server\//,
  /\.md$/i, /^\/?server\.js$/, /^\/?package(-lock)?\.json$/, /^\/?Dockerfile$/, /^\/?scripts\//];

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"
};

// ---------------------------------------------------------------------------
// Config store: the database when there is one, a file in DATA_DIR when not.
// ---------------------------------------------------------------------------
let db = null;
let cache = null;

async function readConfig() {
  if (cache) return cache;
  let cfg = null;
  if (db) cfg = await db.getConfig();
  if (!cfg) {
    try { cfg = JSON.parse(await fsp.readFile(LIVE_CONFIG, "utf8")); }
    catch { cfg = JSON.parse(await fsp.readFile(SEED_CONFIG, "utf8")); }
  }
  validate(cfg);
  cache = cfg;
  return cfg;
}

async function writeConfig(cfg) {
  if (db) {
    await db.setConfig(cfg);
  } else {
    await fsp.mkdir(DATA_DIR, { recursive: true });
    // Write then rename, so a crash mid write cannot leave half a price list
    // on disk for the booking page to read.
    const tmp = LIVE_CONFIG + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(cfg, null, 2));
    await fsp.rename(tmp, LIVE_CONFIG);
  }
  cache = cfg;
}

// Anything that reaches this from the admin page has been typed by a person
// into a form, so it is checked rather than trusted. A price that arrives as
// the string "one fifty" must not become NaN on the pricing page. It also runs
// over the config on the way in, so an old file missing a newer field gets the
// default rather than undefined.
function validate(cfg) {
  const errs = [];
  if (!cfg || !Array.isArray(cfg.packages) || !cfg.packages.length) {
    return ["There has to be at least one package."];
  }
  const ids = new Set();
  cfg.packages.forEach((p, i) => {
    const at = `Package ${i + 1}`;
    if (!p.id || !/^[a-z0-9-]+$/.test(p.id)) errs.push(`${at}: id must be lowercase letters, numbers or dashes.`);
    if (ids.has(p.id)) errs.push(`${at}: the id "${p.id}" is used twice.`);
    ids.add(p.id);
    if (!p.name || !String(p.name).trim()) errs.push(`${at}: needs a name.`);
    for (const f of ["price", "firstPrice"]) {
      const v = Number(p[f]);
      if (!Number.isFinite(v) || v < 0 || v > 100000) errs.push(`${at}: ${f} must be a number between 0 and 100000.`);
      else p[f] = Math.round(v);
    }
    for (const f of ["checkoutFull", "checkoutFirst"]) {
      const v = String(p[f] || "").trim();
      if (v && !/^https:\/\/[^\s]+$/i.test(v)) errs.push(`${at}: ${f} has to be an https link or be left blank.`);
      p[f] = v;
    }
    p.bullets = Array.isArray(p.bullets) ? p.bullets.map(b => String(b).trim()).filter(Boolean).slice(0, 20) : [];
    p.active = p.active !== false;
    p.name = String(p.name).trim();
    p.blurb = String(p.blurb || "").trim();
    p.badge = String(p.badge || "").trim();
  });

  const a = cfg.availability || (cfg.availability = {});
  // The hours are what the admin page builds the per day lists from. The
  // lists are what the calendar uses.
  const h = a.hours && typeof a.hours === "object" ? a.hours : {};
  a.hours = {
    start: avail.normalize(h.start) || "8:00 AM",
    end: avail.normalize(h.end) || "8:00 PM",
    every: Math.max(15, Math.min(480, Math.round(Number(h.every)) || 120))
  };
  if (avail.minutesOf(a.hours.end) < avail.minutesOf(a.hours.start)) errs.push("Hours: the end has to come after the start.");
  a.week = a.week && typeof a.week === "object" ? a.week : {};
  for (let d = 0; d < 7; d++) a.week[String(d)] = avail.cleanList(a.week[String(d)]);
  for (const f of ["blocked", "overrides"]) {
    const o = a[f] && typeof a[f] === "object" ? a[f] : {};
    a[f] = {};
    for (const k of Object.keys(o)) {
      if (!avail.isKey(k)) { errs.push(`${f}: "${k}" is not a real YYYY-MM-DD date.`); continue; }
      a[f][k] = f === "blocked" ? String(o[k] || "Blocked").slice(0, 200) : avail.cleanList(o[k]);
    }
  }
  const nums = { minNoticeHours: [0, 720, 24], maxAdvanceDays: [1, 365, 28], maxPerDay: [1, 50, 5], lookBusy: [0, 90, 0] };
  for (const [k, [lo, hi, def]] of Object.entries(nums)) {
    const v = Number(a[k]);
    a[k] = Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : def;
  }
  delete a.daysShown;
  return errs;
}

// ---------------------------------------------------------------------------
// Admin auth. One user, so this is a signed cookie and not a user table.
// ---------------------------------------------------------------------------
const attempts = new Map();

function rateLimited(ip) {
  const now = Date.now();
  // One entry per address, never cleaned, is a slow memory leak on a process
  // that is meant to run for months. Nothing here needs to remember a quiet
  // address from an hour ago.
  if (attempts.size > 500) {
    for (const [k, v] of attempts) {
      if ((v.until || 0) < now && now - (v.at || 0) > 15 * 60 * 1000) attempts.delete(k);
    }
  }
  const rec = attempts.get(ip) || { n: 0, until: 0 };
  if (rec.until > now) return true;
  if (now - (rec.at || 0) > 15 * 60 * 1000) rec.n = 0;
  rec.n++;
  rec.at = now;
  if (rec.n > 8) { rec.until = now + 15 * 60 * 1000; rec.n = 0; }
  attempts.set(ip, rec);
  return rec.until > now;
}

function sign(exp) {
  return exp + "." + crypto.createHmac("sha256", ADMIN_SECRET).update(String(exp)).digest("hex");
}

function validToken(tok) {
  if (!ADMIN_SECRET || !tok) return false;
  const [exp, mac] = String(tok).split(".");
  if (!exp || !mac || Number(exp) < Date.now()) return false;
  const want = crypto.createHmac("sha256", ADMIN_SECRET).update(exp).digest("hex");
  const a = Buffer.from(mac, "utf8");
  const b = Buffer.from(want, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function authed(req) {
  return !!ADMIN_PASSWORD && validToken(cookies(req).ez_admin);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function send(res, code, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  res.writeHead(code, { "content-length": buf.length, ...headers });
  res.end(buf);
}

function json(res, code, obj, headers = {}) {
  send(res, code, JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
}

function raw(req, limit = 200 * 1024) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const chunks = [];
    req.on("data", c => {
      n += c.length;
      if (n > limit) { reject(new Error("too big")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function body(req, limit) {
  const buf = await raw(req, limit);
  if (!buf.length) return {};
  try { return JSON.parse(buf.toString("utf8")); } catch { throw new Error("bad json"); }
}

function origin(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0];
  return proto + "://" + (req.headers.host || "localhost:" + PORT);
}

function str(v, max) { return String(v == null ? "" : v).trim().slice(0, max); }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
function longDate(key) {
  const d = avail.dateOf(key);
  return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
}

// What a customer is allowed to see of their own booking. No internal notes,
// no Stripe ids.
function publicBooking(b) {
  if (!b) return null;
  return {
    id: b.id, status: b.status, date: b.date, time: b.time, when: longDate(b.date) + " at " + b.time,
    package: b.packageName, packageName: b.packageName, amount: b.amount, firstShoot: b.firstShoot, paid: b.paid,
    startsAt: b.startsAt, refunded: Number(b.refundedCents || 0) / 100,
    name: b.name, email: b.email, phone: b.phone, brokerage: b.brokerage,
    address: b.address, size: b.size, occupancy: b.occupancy, access: b.access,
    accessNotes: b.accessNotes, notes: b.notes, token: b.token
  };
}

// "held" is the stored status; whether the hold still stands is a matter of
// the clock, and the admin page wants the answer, not the arithmetic.
function stateOf(b, now = Date.now()) {
  if (b.status === "held" && (!b.expiresAt || Date.parse(b.expiresAt) <= now)) return "expired";
  return b.status;
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
function isPrivate(p) { return PRIVATE.some(re => re.test(p)); }

async function serveStatic(req, res, pathname) {
  // The rules serve.json used to apply. cleanUrls stays off: turning it on 301s
  // /project.html?id=x to /project and drops the query string, which broke
  // every portfolio detail page in production once already.
  let rel = decodeURIComponent(pathname);
  if (rel === "/") rel = "/index.html";
  // /admin is the owner's way in, linked only from the footer. It opens the
  // day's bookings rather than the settings, because that is where a refund is.
  else if (rel === "/admin") rel = "/admin-bookings.html";
  else if (/^\/[a-z0-9-]+$/i.test(rel)) rel = rel + ".html";

  if (isPrivate(rel)) return send(res, 404, "Not found", { "content-type": "text/plain" });

  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden", { "content-type": "text/plain" });

  let stat;
  try { stat = await fsp.stat(file); } catch { stat = null; }
  if (!stat || stat.isDirectory()) {
    const html = await fsp.readFile(path.join(ROOT, "index.html")).catch(() => null);
    if (!html) return send(res, 404, "Not found", { "content-type": "text/plain" });
    return send(res, 404, html, { "content-type": TYPES[".html"] });
  }

  const ext = path.extname(file).toLowerCase();
  // Everything the site is built from revalidates on every request, and the
  // ETag below makes that a 304 rather than a download. This has to be
  // no-cache: there is no build step and no hash in the filenames, so
  // js/booking.js keeps the same URL forever. With a long max-age a deploy
  // would reach a returning visitor whenever their browser felt like it, which
  // is how a stale price list outlives the deploy that fixed it.
  // Images and fonts do not have that problem, a new photo is a new filename.
  const CODE = [".html", ".json", ".js", ".css", ".svg", ".xml", ".txt"];
  const cacheHeader = CODE.indexOf(ext) !== -1 ? "no-cache" : "public, max-age=604800";
  const etag = '"' + stat.size + "-" + Number(stat.mtimeMs).toString(36) + '"';
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, { etag }); return res.end(); }

  res.writeHead(200, {
    "content-type": TYPES[ext] || "application/octet-stream",
    "content-length": stat.size,
    "cache-control": cacheHeader,
    etag
  });
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
async function takenNow(av, now) {
  return db.takenByDate(avail.keyOf(now), avail.keyOf(avail.window(av, now)), now);
}

// The confirmation emails, on the way out of a confirmation.
//
// Deliberately not awaited. The webhook caller must answer Stripe quickly, and
// a non-200 there makes Stripe retry the whole event and re-run a confirmation
// that already happened; the success page caller must not make a customer who
// has just paid watch a spinner while two HTTP calls to EmailJS finish. So this
// is started and left to run, and every outcome is logged with the booking id,
// which is the only thing that makes a missing email findable afterwards.
//
// The claim is what stops the webhook and the success page both sending.
function notify(b) {
  if (!b || !db) return;
  db.claimNotify(b.id).then(async claimed => {
    if (!claimed) return;
    const r = await email.notifyBooked(publicBooking(b), SITE_URL);
    if (r.owner || r.customer) {
      console.log(`[ez-shots] ${b.id} emailed:${r.owner ? " owner" : ""}${r.customer ? " customer" : ""}`);
    }
    for (const e of r.errors) console.error(`[ez-shots] ${b.id} email failed, ${e}`);
    // Nothing got out. Hand the claim back so a retry, or the success page
    // arriving after the webhook, can try again instead of the booking being
    // marked notified forever on the strength of two failures.
    if (!r.owner && !r.customer) await db.releaseNotify(b.id).catch(() => {});
  }).catch(e => console.error(`[ez-shots] ${b.id} could not send confirmations:`, e.message));
}

// Paid, as far as Stripe is concerned. Both the webhook and the success page
// end up here, and the second caller finds it already confirmed.
async function confirmFromSession(session, source) {
  if (!db || !session || session.payment_status !== "paid") return null;
  const id = (session.metadata && session.metadata.booking_id) || session.client_reference_id || "";
  let b = await db.bySession(session.id);
  if (!b && id) b = await db.find(id);
  if (!b) return null;
  if (b.status === "confirmed") return b;
  try {
    const c = await db.confirm(b.id, {
      stripeSessionId: session.id,
      stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      status: "confirmed"
    });
    console.log(`[ez-shots] ${c.id} confirmed by the ${source}`);
    notify(c);
    return c;
  } catch (e) {
    // The only way here is the unique index refusing a second confirmed
    // booking on the slot, which means two people paid for one time. Say so
    // loudly rather than lose either.
    console.error(`[ez-shots] COULD NOT CONFIRM ${b.id} on ${b.date} ${b.time}, paid twice?`, e.message);
    return b;
  }
}

async function book(req, res) {
  if (!db) return json(res, 503, { error: "Online booking is not switched on yet. Email me and I will book you in." });
  const cfg = await readConfig();
  const av = cfg.availability;
  const b = await body(req).catch(() => null);
  if (!b) return json(res, 400, { error: "That did not arrive as valid JSON." });

  const pkg = cfg.packages.find(p => p.id === b.packageId && p.active !== false);
  if (!pkg) return json(res, 400, { error: "Pick a package first." });
  const first = b.firstShoot !== false;
  const link = first ? pkg.checkoutFirst : pkg.checkoutFull;
  if (!STRIPE_KEY && !link) return json(res, 503, { error: "No checkout is set up for that package yet." });

  const date = str(b.date, 10);
  const time = avail.normalize(b.time);
  const name = str(b.name, 120), email = str(b.email, 200), phone = str(b.phone, 40), address = str(b.address, 300);
  if (!avail.isKey(date) || !time) return json(res, 400, { error: "Pick a day and a time." });
  if (name.length < 2) return json(res, 400, { error: "Please enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "That email address does not look right. Please check it." });
  if (phone.replace(/\D/g, "").length < 7) return json(res, 400, { error: "Please enter a mobile number I can text." });
  if (address.length < 6) return json(res, 400, { error: "Please enter the property address." });

  const now = new Date();

  // A retry after a failed email, a back button from Stripe, a double tap:
  // the same person asking for the same slot gets the hold they already have,
  // not "that time was just booked" because of their own hold.
  const r = b.resume && typeof b.resume === "object" ? b.resume : null;
  if (r && r.id && r.token) {
    const old = await db.find(str(r.id, 20));
    if (old && old.token === str(r.token, 64) && old.status === "held") {
      const same = old.date === date && old.time === time && old.packageId === pkg.id && old.firstShoot === first;
      if (same && stateOf(old, now.getTime()) === "held" && old.checkoutUrl) {
        return json(res, 200, { id: old.id, token: old.token, url: old.checkoutUrl, mode: old.checkoutMode, expiresAt: old.expiresAt, resumed: true });
      }
      await db.release(old.id, now);
    }
  }

  const taken = await takenNow(av, now);
  const verdict = avail.why(av, taken, date, time, now);
  if (verdict === "closed") return json(res, 409, { error: "That time is not open for booking. Pick another time.", taken: true });
  if (verdict !== "ok") return json(res, 409, { error: "That time was just booked. Pick another available time.", taken: true });

  const fields = {
    date, time, startsAt: avail.slotAt(date, time),
    packageId: pkg.id, packageName: pkg.name, firstShoot: first,
    amount: first ? pkg.firstPrice : pkg.price, listPrice: pkg.price,
    name, email, phone, brokerage: str(b.brokerage, 120), address,
    size: str(b.size, 60), occupancy: str(b.occupancy, 60), access: str(b.access, 60),
    accessNotes: str(b.accessNotes, 500), notes: str(b.notes, 2000),
    checkoutMode: STRIPE_KEY ? "session" : "link", checkoutUrl: STRIPE_KEY ? "" : link
  };
  const held = await db.hold(fields, STRIPE_KEY ? HOLD_SESSION_MS : HOLD_LINK_MS, now);
  if (!held) return json(res, 409, { error: "That time was just booked. Pick another available time.", taken: true });

  const reply = { id: held.id, token: held.token, expiresAt: held.expiresAt };
  if (!STRIPE_KEY) return json(res, 200, Object.assign(reply, { url: link, mode: "link" }));

  const site = origin(req);
  const payload = {
    mode: "payment",
    success_url: site + "/booked.html?session_id={CHECKOUT_SESSION_ID}",
    cancel_url: site + "/book.html",
    client_reference_id: held.id,
    customer_email: email,
    customer_creation: "always",
    expires_at: Math.floor(now.getTime() / 1000) + STRIPE_EXPIRES_SEC,
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": Math.round(held.amount * 100),
    "line_items[0][price_data][product_data][name]": pkg.name + (first ? " (first shoot, half price)" : ""),
    "line_items[0][price_data][product_data][description]":
      [address, longDate(date), time].join(", ").slice(0, 500),
    metadata: {
      booking_id: held.id,
      package: pkg.name,
      package_id: pkg.id,
      first_shoot: first ? "yes" : "no",
      address: address.slice(0, 400),
      shoot_date: longDate(date),
      shoot_time: time
    }
  };

  try {
    const s = await stripe.createSession(STRIPE_KEY, payload, held.id);
    await db.update(held.id, { checkoutMode: "session", checkoutUrl: s.url, stripeSessionId: s.id }, now);
    return json(res, 200, Object.assign(reply, { url: s.url, mode: "session" }));
  } catch (e) {
    console.error("[ez-shots] Stripe session failed:", e.message);
    // A Stripe outage must not cost a booking. The payment link still works,
    // and the hold is stretched to the link timing since nothing can now
    // confirm it automatically.
    if (link) {
      const u = await db.update(held.id, { checkoutMode: "link", checkoutUrl: link, expiresAt: new Date(now.getTime() + HOLD_LINK_MS) }, now);
      return json(res, 200, Object.assign(reply, { url: link, mode: "link-fallback", expiresAt: u.expiresAt }));
    }
    await db.release(held.id, now);
    return json(res, 502, { error: "Checkout could not be created. Try again in a minute." });
  }
}

// The success page. Stripe is asked directly whether the session was paid, so
// a query string cannot claim a booking that was never paid for, and the
// booking is confirmed here if the webhook has not done it already.
async function session(req, res, url) {
  const id = url.searchParams.get("id") || "";
  if (!STRIPE_KEY || !/^cs_[A-Za-z0-9_]+$/.test(id)) return json(res, 404, { error: "No session." });
  let s;
  try { s = await stripe.getSession(STRIPE_KEY, id); }
  catch (e) {
    console.error("[ez-shots] session lookup failed:", e.message);
    return json(res, 502, { error: "Could not read that session." });
  }
  if (s.payment_status !== "paid") return json(res, 404, { error: "Not a paid session." });
  const b = await confirmFromSession(s, "success page");
  return json(res, 200, {
    paid: true,
    amount: (s.amount_total || 0) / 100,
    email: (s.customer_details && s.customer_details.email) || "",
    package: (s.metadata && s.metadata.package) || "",
    address: (s.metadata && s.metadata.address) || "",
    date: (s.metadata && s.metadata.shoot_date) || "",
    time: (s.metadata && s.metadata.shoot_time) || "",
    booking: publicBooking(b)
  });
}

// Stripe calling back. The signature is checked against the raw bytes, and
// anything that is not one of the four session events is acknowledged and
// ignored, which is what Stripe wants: a 200 means "got it, stop retrying".
async function webhook(req, res) {
  const buf = await raw(req, 1024 * 1024).catch(() => null);
  if (!buf) return json(res, 400, { error: "Bad body." });
  if (!WEBHOOK_SECRET) {
    console.error("[ez-shots] webhook received but STRIPE_WEBHOOK_SECRET is not set");
    return json(res, 503, { error: "Webhook secret not configured." });
  }
  if (!stripe.verifySignature(WEBHOOK_SECRET, req.headers["stripe-signature"], buf)) {
    return json(res, 400, { error: "Bad signature." });
  }
  let ev;
  try { ev = JSON.parse(buf.toString("utf8")); } catch { return json(res, 400, { error: "Bad JSON." }); }
  const obj = (ev.data && ev.data.object) || {};
  const id = (obj.metadata && obj.metadata.booking_id) || obj.client_reference_id || "";
  try {
    if (ev.type === "checkout.session.completed" || ev.type === "checkout.session.async_payment_succeeded") {
      await confirmFromSession(obj, "webhook");
    } else if ((ev.type === "checkout.session.expired" || ev.type === "checkout.session.async_payment_failed") && db && id) {
      const b = await db.find(id);
      if (b && b.status === "held") { await db.release(b.id); console.log(`[ez-shots] ${b.id} released, session ${ev.type}`); }
    }
  } catch (e) {
    console.error("[ez-shots] webhook handling failed:", e.message);
    return json(res, 500, { error: "Handling failed, retry." });
  }
  return json(res, 200, { received: true });
}

// The customer's own view of a booking, by the token in their manage link.
async function manage(req, res, url) {
  if (!db) return json(res, 404, { error: "No booking." });
  const tok = url.searchParams.get("t") || "";
  const b = /^[a-f0-9]{32}$/.test(tok) ? await db.byToken(tok) : null;
  if (!b) return json(res, 404, { error: "That link does not match a booking." });
  const now = new Date();
  const state = stateOf(b, now.getTime());
  const out = publicBooking(b);
  out.state = state;
  out.canCancel = (state === "confirmed" || state === "held") && Date.parse(b.startsAt) > now.getTime();
  if (req.method === "GET") return json(res, 200, { booking: out });
  if (req.method === "POST" && url.pathname === "/api/manage/cancel") {
    if (!out.canCancel) return json(res, 400, { error: "This booking can no longer be cancelled here. Email me and I will sort it." });
    const c = await db.cancel(b.id, "customer", now);
    console.log(`[ez-shots] ${b.id} cancelled by the customer`);
    return json(res, 200, { booking: Object.assign(publicBooking(c), { state: "cancelled", canCancel: false }) });
  }
  return json(res, 405, { error: "No." });
}

// An .ics the phone's calendar app opens straight from the success page.
async function ics(req, res, url) {
  const tok = url.searchParams.get("t") || "";
  const b = db && /^[a-f0-9]{32}$/.test(tok) ? await db.byToken(tok) : null;
  if (!b) return send(res, 404, "Not found", { "content-type": "text/plain" });
  const start = new Date(b.startsAt);
  const end = new Date(start.getTime() + 90 * 60 * 1000);
  const stamp = d => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = s => String(s || "").replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, m => "\\" + m);
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EZ Shots//Booking//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    "UID:" + b.id + "@ezshots.org",
    "DTSTAMP:" + stamp(new Date()),
    "DTSTART:" + stamp(start),
    "DTEND:" + stamp(end),
    "SUMMARY:" + esc("EZ Shots photo shoot, " + b.address),
    "LOCATION:" + esc(b.address),
    "DESCRIPTION:" + esc(b.packageName + ". Booking " + b.id + ". Manage: " + origin(req) + "/manage.html?t=" + b.token),
    "END:VEVENT", "END:VCALENDAR"
  ];
  return send(res, 200, lines.join("\r\n") + "\r\n", {
    "content-type": "text/calendar; charset=utf-8",
    "content-disposition": `attachment; filename="ez-shots-${b.id}.ics"`,
    "cache-control": "no-store"
  });
}

// ---------------------------------------------------------------------------
// Refunds
//
// The owner refunds from a booking card in admin, any amount up to what is
// left. The money moves first: if Stripe refuses, nothing about the booking
// changes and no email goes out.
// ---------------------------------------------------------------------------
function userError(message, status = 400) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// A refusal the owner should read, as JSON. Stripe's own message is passed on,
// because "Charge has already been refunded" is exactly what he needs to know.
// Anything else is a real bug and goes on to the 500 handler.
function fail(res, e) {
  if (e && e.status) return json(res, e.status, { error: e.message });
  if (e && e.stripe) return json(res, 502, { error: "Stripe said: " + e.message });
  throw e;
}

function dollars(cents) { return "$" + (cents / 100).toFixed(2).replace(/\.00$/, ""); }
function paidCents(b) { return b.paid ? Math.round(Number(b.amount || 0) * 100) : 0; }
function refundableCents(b) { return Math.max(0, paidCents(b) - Number(b.refundedCents || 0)); }

// Log an email's outcome with the booking id. Never lets a rejection escape,
// because an unhandled one ends the process.
function after(p, id, what) {
  Promise.resolve(p).then(r => {
    if (r.owner || r.customer) console.log(`[ez-shots] ${id} emailed, ${what}`);
    for (const e of r.errors) console.error(`[ez-shots] ${id} ${what} email failed, ${e}`);
  }).catch(e => console.error(`[ez-shots] ${id} ${what} email crashed:`, e.message));
}

// The payment a booking's checkout took. Stored at confirmation, and read back
// from the session for a booking where that column never got filled.
async function paymentIntentOf(b) {
  if (b.stripePaymentIntent) return b.stripePaymentIntent;
  if (!STRIPE_KEY || !b.stripeSessionId) return null;
  const s = await stripe.getSession(STRIPE_KEY, b.stripeSessionId);
  const pi = typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent && s.payment_intent.id) || null;
  if (pi) {
    await db.update(b.id, { stripePaymentIntent: pi });
    b.stripePaymentIntent = pi;
  }
  return pi;
}

// Money back through Stripe. Returns the booking as it now stands, and
// `duplicate` when Stripe handed back a refund that was already recorded.
//
// `requestId` comes from the admin page, minted when the refund panel opens. It
// is the Stripe idempotency key, so a second press of the same refund reaches
// Stripe with the same key and gets the same refund back rather than a new one.
async function refundMoney(b, cents, by, requestId) {
  if (!b.paid) throw userError("Nothing was paid on this booking, so there is nothing to refund.");
  if (!Number.isInteger(cents) || cents <= 0) throw userError("Enter an amount to refund.");
  const left = refundableCents(b);
  if (!left) throw userError("This booking is already refunded in full.");
  if (cents > left) throw userError(`That is more than is left to refund. The most is ${dollars(left)}.`);
  if (!STRIPE_KEY) throw userError("Stripe is not connected to the site, so refund this one in the Stripe dashboard.");
  const pi = await paymentIntentOf(b);
  if (!pi) throw userError("This booking was not paid through the site checkout, so refund it in the Stripe dashboard.");
  const key = requestId ? `refund-${b.id}-${requestId}` : `refund-${b.id}-${Number(b.refundedCents || 0)}-${cents}`;
  const r = await stripe.refund(STRIPE_KEY, pi, cents, key, { booking_id: b.id, refunded_by: by });
  const recorded = await db.recordRefund(b.id, r.id, cents);
  if (recorded) console.log(`[ez-shots] ${b.id} refunded ${dollars(cents)} by ${by}, ${r.id}`);
  return { booking: recorded || (await db.find(b.id)), duplicate: !recorded };
}

// One refund at a time per booking, so a second press waits for the first to
// finish and then sees what it did, instead of both reading the same balance.
const refundLocks = new Map();
function oneAtATime(key, fn) {
  const run = (refundLocks.get(key) || Promise.resolve()).then(fn);
  const tail = run.then(() => {}, () => {});
  refundLocks.set(key, tail);
  tail.then(() => { if (refundLocks.get(key) === tail) refundLocks.delete(key); });
  return run;
}

// Refund request ids already carried out, for an hour, so a repeat is answered
// as a repeat instead of "more than is left to refund".
const refundsDone = new Map();
function rememberRefund(key) {
  const now = Date.now();
  for (const [k, at] of refundsDone) if (now - at > 3600 * 1000) refundsDone.delete(k);
  refundsDone.set(key, now);
}

// ---------------------------------------------------------------------------
// Admin bookings
// ---------------------------------------------------------------------------
async function adminBookings(req, res) {
  if (!db) return json(res, 503, { error: "No database, so there are no bookings to show." });
  const cfg = await readConfig();
  const now = new Date();
  const today = avail.keyOf(now);
  const from = avail.keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60));
  const to = avail.keyOf(new Date(now.getFullYear(), now.getMonth(), now.getDate() + Math.max(120, cfg.availability.maxAdvanceDays)));
  const counts = await db.clientCounts();
  const list = (await db.list(from, to)).map(b => Object.assign(adminView(b, now), {
    clientBookings: counts.get(String(b.email || "").toLowerCase()) || 0
  }));

  // The numbers at the top of the admin home, worked out from what is
  // confirmed. Revenue is by shoot date, so a month reads as what the month's
  // shoots are worth, and it is net of refunds, because money that went back
  // was never earned.
  const confirmed = list.filter(b => b.state === "confirmed");
  const net = b => (b.paid ? b.amount : 0) - Number(b.refundedCents || 0) / 100;
  const monthKey = today.slice(0, 7);
  const lastMonthKey = avail.keyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
  const inWeek = b => b.date >= avail.keyOf(weekStart) && b.date <= avail.keyOf(weekEnd);
  const month = confirmed.filter(b => b.date.slice(0, 7) === monthKey);
  // Refunds on cancelled bookings still came out of a month's money.
  const moneyIn = key => list.filter(b => b.date.slice(0, 7) === key && b.paid).reduce((s, b) => s + net(b), 0);
  const revenue = Math.round(moneyIn(monthKey) * 100) / 100;
  const upcoming = confirmed.filter(b => b.date >= today);
  const stats = {
    today: confirmed.filter(b => b.date === today).length,
    week: confirmed.filter(inWeek).length,
    month: month.length,
    revenue,
    lastMonthRevenue: Math.round(moneyIn(lastMonthKey) * 100) / 100,
    ticket: month.length ? Math.round(month.reduce((s, b) => s + b.amount, 0) / month.length) : 0,
    upcoming: upcoming.length,
    upcomingValue: upcoming.reduce((s, b) => s + b.amount, 0),
    unpaid: list.filter(b => b.date >= today && (b.state === "held" || b.state === "expired" || (b.state === "confirmed" && !b.paid))).length,
    repeat: [...counts.values()].filter(n => n > 1).length
  };
  return json(res, 200, {
    today, now: now.toISOString(), stripe: !!STRIPE_KEY, email: email.configured(), stats, bookings: list,
    packages: cfg.packages.map(p => ({ id: p.id, name: p.name, price: p.price, firstPrice: p.firstPrice, active: p.active !== false }))
  });
}

// A booking as the admin page wants it: the state worked out, the long date,
// and how much is left to refund.
function adminView(b, now = new Date()) {
  return Object.assign(b, {
    state: stateOf(b, now.getTime()),
    when: longDate(b.date),
    refundable: refundableCents(b) / 100
  });
}

// A booking the owner adds by hand, for a client who phoned or texted. It takes
// the slot the same way the site does, behind the same lock, and is booked
// straight away: paid if he says it is, otherwise booked and waiting on
// payment. Any real time works, the public schedule does not apply to him.
// The client gets the You are booked email only when it is paid and he asks,
// because that email says paid.
async function adminCreate(req, res) {
  if (!db) return json(res, 503, { error: "No database." });
  const cfg = await readConfig();
  const p = await body(req).catch(() => null);
  if (!p) return json(res, 400, { error: "That did not arrive as valid JSON." });
  const pkg = cfg.packages.find(x => x.id === p.packageId);
  if (!pkg) return json(res, 400, { error: "Pick a package." });
  const date = str(p.date, 10);
  const time = avail.normalize(p.time);
  const name = str(p.name, 120), mail = str(p.email, 200), phone = str(p.phone, 40), address = str(p.address, 300);
  if (!avail.isKey(date) || !time) return json(res, 400, { error: "Pick a day and a time." });
  if (name.length < 2) return json(res, 400, { error: "Enter the client's name." });
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return json(res, 400, { error: "That email address does not look right." });
  if (address.length < 6) return json(res, 400, { error: "Enter the property address." });
  const first = p.firstShoot === true;
  let amount = first ? pkg.firstPrice : pkg.price;
  if (p.amount !== undefined && p.amount !== "" && p.amount !== null) {
    const v = Number(p.amount);
    if (!Number.isFinite(v) || v < 0 || v > 100000) return json(res, 400, { error: "The price has to be a number of dollars." });
    amount = Math.round(v);
  }
  const now = new Date();
  const held = await db.hold({
    date, time, startsAt: avail.slotAt(date, time),
    packageId: pkg.id, packageName: pkg.name, firstShoot: first, amount, listPrice: pkg.price,
    name, email: mail, phone, brokerage: str(p.brokerage, 120), address,
    access: str(p.access, 60), notes: str(p.notes, 2000), internalNotes: str(p.internalNotes, 4000),
    checkoutMode: "manual", checkoutUrl: "", source: "admin"
  }, 60 * 1000, now);
  if (!held) return json(res, 409, { error: "Another booking already has that time. Pick a different one." });
  const paid = p.paid === true;
  let b;
  try {
    b = await db.update(held.id, { status: "confirmed", paid, paidAt: paid ? now : null, expiresAt: null }, now);
  } catch (e) {
    await db.release(held.id, now).catch(() => {});
    return json(res, 409, { error: "Another booking already has that time. Pick a different one." });
  }
  console.log(`[ez-shots] ${b.id} added by the owner for ${date} ${time}${paid ? ", paid" : ", unpaid"}`);
  let emailed = false;
  if (paid && p.notify === true && mail) { emailed = email.configured(); notify(b); }
  return json(res, 200, { booking: adminView(b, now), emailed });
}

async function adminBooking(req, res, id) {
  if (!db) return json(res, 503, { error: "No database." });
  const b = await db.find(id);
  if (!b) return json(res, 404, { error: "No such booking." });
  const p = await body(req).catch(() => ({}));
  const now = new Date();
  const extra = {};
  let out = b;
  try {
    if (p.action === "confirm") {
      if (b.status === "confirmed" && b.paid) return json(res, 200, { booking: adminView(b, now) });
      if (b.status === "cancelled") return json(res, 400, { error: "This booking is cancelled. Add a new booking instead." });
      if (b.status === "confirmed") {
        // Booked by hand and paid since, in cash or by Zelle.
        out = await db.update(b.id, { paid: true, paidAt: now }, now);
      } else {
        const other = await db.clash(b.date, b.time, b.id, now);
        if (other) return json(res, 409, { error: `That slot has since gone to ${other}. Cancel that one first, or reschedule this booking.` });
        out = await db.confirm(b.id, { checkoutMode: b.checkoutMode || "manual" }, now);
      }
    } else if (p.action === "move") {
      // The owner can put a shoot at any real time, including one the public
      // calendar would not offer, because he is the one driving there. The only
      // thing refused is a slot another booking owns.
      if (b.status === "cancelled") return json(res, 400, { error: "This booking is cancelled, so there is nothing to move." });
      const date = str(p.date, 10);
      const time = avail.normalize(p.time);
      if (!avail.isKey(date) || !time) return json(res, 400, { error: "Pick a new day and time." });
      if (date === b.date && time === b.time) return json(res, 400, { error: "That is the time it is already booked for." });
      const was = longDate(b.date) + " at " + b.time;
      const moved = await db.move(b.id, date, time, avail.slotAt(date, time), now);
      if (!moved) return json(res, 409, { error: "Another booking already has that time. Pick a different one." });
      out = moved;
      console.log(`[ez-shots] ${b.id} moved from ${b.date} ${b.time} to ${date} ${time}`);
      extra.emailed = false;
      if (p.notify === true && out.email) {
        extra.emailed = email.configured();
        after(email.notifyMoved(publicBooking(out), SITE_URL, { was }), out.id, "reschedule");
      }
    } else if (p.action === "refund") {
      if (p.confirm !== true) return json(res, 400, { error: "Confirm the refund first." });
      const cents = Math.round(Number(p.amount) * 100);
      const requestId = /^[A-Za-z0-9]{8,64}$/.test(String(p.requestId || "")) ? String(p.requestId) : "";
      const done = await oneAtATime(b.id, async () => {
        const cur = await db.find(b.id);
        if (requestId && refundsDone.has(b.id + ":" + requestId)) return { booking: cur, duplicate: true, cancelled: false };
        const r = await refundMoney(cur, cents, "owner", requestId);
        let booking = r.booking;
        const cancelled = !r.duplicate && p.cancel === true && booking.status !== "cancelled";
        if (cancelled) booking = await db.cancel(booking.id, "owner", new Date());
        if (requestId) rememberRefund(b.id + ":" + requestId);
        return { booking, duplicate: r.duplicate, cancelled };
      });
      out = done.booking;
      extra.duplicate = done.duplicate;
      extra.refundedCents = done.duplicate ? 0 : cents;
      if (!done.duplicate) after(email.notifyRefunded(publicBooking(out), SITE_URL, { cents, cancelled: done.cancelled }), out.id, "refund");
    } else if (p.action === "cancel") {
      out = await db.cancel(b.id, "owner", now);
    } else if (p.action === "note") {
      out = await db.update(b.id, { internalNotes: str(p.note, 4000) }, now);
    } else {
      return json(res, 400, { error: "Unknown action." });
    }
  } catch (e) { return fail(res, e); }
  return json(res, 200, Object.assign({ booking: adminView(out, now) }, extra));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
async function api(req, res, url) {
  const pathname = url.pathname;
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress || "?";

  // What every page reads. Public on purpose: prices and payment links are on
  // the pricing page anyway. The calendar is NOT in here, it has its own
  // endpoint below, because it depends on what has been booked.
  if (pathname === "/api/config" && req.method === "GET") {
    const cfg = await readConfig();
    return json(res, 200, {
      packages: cfg.packages,
      availability: { minNoticeHours: cfg.availability.minNoticeHours, maxAdvanceDays: cfg.availability.maxAdvanceDays },
      serverCheckout: !!STRIPE_KEY,
      bookings: !!db
    });
  }

  // The calendar, worked out here and nowhere else.
  if (pathname === "/api/availability" && req.method === "GET") {
    if (!db) return json(res, 503, { error: "Online booking is not switched on yet." });
    const cfg = await readConfig();
    const now = new Date();
    return json(res, 200, avail.calendar(cfg.availability, await takenNow(cfg.availability, now), now));
  }

  if (pathname === "/api/book" && req.method === "POST") return book(req, res);
  if (pathname === "/api/session" && req.method === "GET") return session(req, res, url);
  if (pathname === "/api/stripe/webhook" && req.method === "POST") return webhook(req, res);
  if (pathname === "/api/manage" || pathname === "/api/manage/cancel") return manage(req, res, url);
  if (pathname === "/api/ics" && req.method === "GET") return ics(req, res, url);

  if (pathname === "/api/admin/session" && req.method === "GET") {
    return json(res, 200, { enabled: !!ADMIN_PASSWORD, authed: authed(req), stripe: !!STRIPE_KEY, webhook: !!WEBHOOK_SECRET, bookings: !!db, email: email.configured() });
  }

  if (pathname === "/api/admin/login" && req.method === "POST") {
    if (!ADMIN_PASSWORD) {
      return json(res, 503, { error: "Admin is off. Set ADMIN_PASSWORD in the Railway variables and redeploy." });
    }
    if (rateLimited(ip)) return json(res, 429, { error: "Too many tries. Wait fifteen minutes." });
    const b = await body(req).catch(() => ({}));
    const given = Buffer.from(String(b.password || ""), "utf8");
    const want = Buffer.from(ADMIN_PASSWORD, "utf8");
    const ok = given.length === want.length && crypto.timingSafeEqual(given, want);
    if (!ok) return json(res, 401, { error: "That password is not right." });
    const tok = sign(Date.now() + SESSION_HOURS * 3600 * 1000);
    return json(res, 200, { ok: true }, {
      "set-cookie": `ez_admin=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_HOURS * 3600}` +
        (process.env.NODE_ENV === "development" ? "" : "; Secure")
    });
  }

  if (pathname === "/api/admin/logout" && req.method === "POST") {
    return json(res, 200, { ok: true }, { "set-cookie": "ez_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
  }

  if (pathname.startsWith("/api/admin/")) {
    if (!authed(req)) return json(res, 401, { error: "Sign in first." });

    if (pathname === "/api/admin/config") {
      if (req.method === "GET") return json(res, 200, await readConfig());
      if (req.method === "PUT") {
        const b = await body(req).catch(() => null);
        if (!b) return json(res, 400, { error: "That did not arrive as valid JSON." });
        const errs = validate(b);
        if (errs.length) return json(res, 400, { error: errs.join(" ") });
        await writeConfig(b);
        return json(res, 200, { ok: true, config: b });
      }
    }

    if (pathname === "/api/admin/test-email" && req.method === "POST") {
      const r = await email.sendTest(SITE_URL);
      return json(res, r.owner && r.customer ? 200 : 502, r);
    }

    if (pathname === "/api/admin/bookings" && req.method === "GET") return adminBookings(req, res);
    if (pathname === "/api/admin/bookings" && req.method === "POST") return adminCreate(req, res);
    const m = /^\/api\/admin\/bookings\/(EZ-\d{6})$/.exec(pathname);
    if (m && req.method === "PATCH") return adminBooking(req, res, m[1]);
  }

  return json(res, 404, { error: "No such endpoint." });
}

// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "strict-origin-when-cross-origin");

  const done = p => p.catch(err => {
    console.error("[ez-shots]", err);
    if (!res.headersSent) json(res, 500, { error: "Something went wrong on the server. Try again in a minute." });
  });

  if (url.pathname.startsWith("/api/")) return done(api(req, res, url));
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "content-type": "text/plain" });
  return done(serveStatic(req, res, url.pathname));
});

// The database is joined after the site is already serving, and joined again
// every fifteen seconds until it answers. A Postgres that is still coming up
// after a deploy, or a bad DATABASE_URL, must not take the brochure and the
// prices down with it: the pages serve, and the booking page says online
// booking is off until the database is there.
async function connectDb(url) {
  const d = new Db(url);
  try {
    await d.migrate();
    // First boot against an empty database: carry whatever config was on disk
    // across, so a price set on the old file store is not lost.
    if (!(await d.getConfig())) {
      await d.setConfig(await readConfig());
      console.log("[ez-shots] seeded the config into the database");
    }
  } catch (e) {
    await d.close().catch(() => {});
    throw e;
  }
  db = d;
  cache = null;
  console.log("[ez-shots] postgres connected, online booking ON");
}

function keepConnecting(url) {
  connectDb(url).catch(e => {
    console.error("[ez-shots] postgres not reachable, retrying in 15s:", e.message);
    setTimeout(() => keepConnecting(url), 15000);
  });
}

server.listen(PORT, () => {
  console.log(`[ez-shots] listening on ${PORT}, timezone ${process.env.TZ}`);
  console.log(`[ez-shots] admin ${ADMIN_PASSWORD ? "on" : "OFF (set ADMIN_PASSWORD)"}` +
    `, stripe ${STRIPE_KEY ? "server side sessions" : "payment links"}` +
    `, webhook ${WEBHOOK_SECRET ? "on" : "off"}` +
    `, confirmation emails ${email.configured() ? "on" : "OFF"}`);
  // Named at boot, because the first time anybody notices a missing variable
  // should not be the first booking that goes unconfirmed.
  if (!email.configured()) console.log(`[ez-shots] no confirmation emails, missing: ${email.why().join(", ")}`);
  if (process.env.DATABASE_URL) keepConnecting(process.env.DATABASE_URL);
  else console.log(`[ez-shots] no DATABASE_URL: config from ${DATA_DIR}, online booking OFF`);
});
