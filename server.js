// EZ Shots server.
//
// The site is still static HTML. This process exists for the things a static
// file cannot do:
//   1. Hold the live prices, checkout links and availability, so the owner can
//      change a price on the site instead of editing code and redeploying.
//   2. Hold the Stripe secret key, so the CUSTOMER'S BROWSER NEVER DECIDES WHAT
//      A SHOOT COSTS. Booking costs nothing. The price is fixed on the booking
//      from the server's own config, and after the shoot, when the customer
//      has seen the previews, POST /api/pay makes the Checkout Session for it.
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
//   STRIPE_SECRET_KEY      optional. When set, the after the shoot payment is a
//                          Checkout Session created here for the amount on the
//                          booking, and Stripe saying paid unlocks the files.
//                          When unset, the Pay button falls back to the
//                          payment links in the config and the owner marks
//                          the booking paid by hand in admin.
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
//   REVIEW_URL             optional, the Google review link the thank you email
//                          points at a day after a paid delivery. Without it
//                          that email asks for a reply instead.
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
const tracker = require("./server/tracker");
const crm = require("./server/crm");

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
    accessNotes: b.accessNotes, notes: b.notes, token: b.token,
    stage: b.stage || "booked", flagged: !!b.flaggedAt,
    wantWatermark: !!b.watermarkWanted, watermarkSpot: b.watermarkSpot || "", referenceNotes: b.referenceNotes || "",
    // The previews are what the owner chose to send unpaid. The clean files
    // link is the thing the payment buys, so it never leaves the server
    // before the booking is paid.
    previewUrl: b.stage === "ready" || b.stage === "delivered" ? b.previewUrl || "" : "",
    finalUrl: b.paid ? b.finalUrl || "" : ""
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

// Every page has a clean address, /services and not /services.html. Two are
// not their file name: /admin is the bookings page, the owner's way in, linked
// only from the footer, and /admin-settings is admin.html, because /admin was
// already taken.
const CLEAN = { "/": "/index.html", "/admin": "/admin-bookings.html", "/admin-settings": "/admin.html" };
const CLEAN_OF = Object.fromEntries(Object.entries(CLEAN).map(([k, v]) => [v, k]));

async function serveStatic(req, res, pathname, search = "") {
  // The rules serve.json used to apply, plus the clean addresses. An old
  // /page.html link is sent on with a 301, and THE QUERY STRING GOES WITH IT:
  // serve's cleanUrls dropped it, which turned /project.html?id=x into a
  // project page with no project and broke every portfolio detail page in
  // production once already.
  let rel = decodeURIComponent(pathname);
  // Blog articles live one folder down, /blog/<slug>, built by scripts/build-seo.mjs.
  if (/^\/(blog\/)?[a-z0-9-]+\.html$/i.test(rel) && !isPrivate(rel)) {
    const clean = CLEAN_OF[rel] || rel.slice(0, -5);
    if (fs.existsSync(path.join(ROOT, rel))) {
      res.writeHead(301, { location: clean + (search || ""), "cache-control": "public, max-age=3600" });
      return res.end();
    }
  }
  if (CLEAN[rel]) rel = CLEAN[rel];
  else if (/^\/(blog\/)?[a-z0-9-]+$/i.test(rel)) rel = rel + ".html";

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
  if (b.status === "confirmed") {
    if (b.paid) return b;
    return paidAfter(b, {
      stripeSessionId: session.id,
      stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null
    }, source);
  }
  try {
    const c = await db.confirm(b.id, {
      stripeSessionId: session.id,
      stripePaymentIntent: typeof session.payment_intent === "string" ? session.payment_intent : null,
      stripeCustomerId: typeof session.customer === "string" ? session.customer : null,
      status: "confirmed"
    });
    console.log(`[ez-shots] ${c.id} confirmed by the ${source}`);
    notify(c);
    tracker.reportPaid(db, c);
    return c;
  } catch (e) {
    // The only way here is the unique index refusing a second confirmed
    // booking on the slot, which means two people paid for one time. Say so
    // loudly rather than lose either.
    console.error(`[ez-shots] COULD NOT CONFIRM ${b.id} on ${b.date} ${b.time}, paid twice?`, e.message);
    return b;
  }
}

// A booking from the site. Nothing is paid here: the slot is taken and the
// booking is confirmed in one go, the owner and the customer are emailed, and
// the customer pays after seeing the photos (see pay() below).
// ---------------------------------------------------------------------------
// Keeping bots and competitors off the calendar
//
// Booking is $0 and confirmed on the spot, so nothing but these stops one
// person filling every open time. Each is cheap and none of them gets in a
// real agent's way:
//
//   ticket     the booking page is handed a signed timestamp with the
//              calendar. A booking needs one at least BOOK_MIN_SECONDS old,
//              so a script has to load the calendar and wait, and a human
//              takes longer than that to fill three screens anyway.
//   honeypot   the hidden _hp field. A person never sees it; a form filling
//              bot fills it.
//   address    at most BOOK_PER_IP site bookings from one address in a day.
//   client     at most BOOK_PER_CLIENT upcoming shoots on one email or phone
//              number. Past that the agent emails and the owner adds them.
//   total      at most BOOK_PER_DAY site bookings in a day from everyone. A
//              one person business cannot shoot more than that anyway, and a
//              flood from many addresses stops there.
//
// Every refusal says to email, so a real agent who trips one is not lost.
// The owner's own bookings from admin are never limited. Each limit can be
// moved with the env var of the same name.
// ---------------------------------------------------------------------------
const LIMITS = {
  BOOK_MIN_SECONDS: 5, BOOK_PER_IP: 3, BOOK_PER_CLIENT: 4, BOOK_PER_DAY: 10
};
for (const k of Object.keys(LIMITS)) {
  if (process.env[k] !== undefined && process.env[k] !== "" && !isNaN(Number(process.env[k]))) LIMITS[k] = Number(process.env[k]);
}
const TICKET_KEY = ADMIN_SECRET || crypto.randomBytes(32).toString("hex");
const TICKET_HOURS = 24;

function ticket(now = Date.now()) {
  return now + "." + crypto.createHmac("sha256", "ticket:" + TICKET_KEY).update(String(now)).digest("hex").slice(0, 32);
}
// "ok", "fast" (under the minimum), or "bad" (missing, forged or stale).
function ticketAge(t, now = Date.now()) {
  const [ts, mac] = String(t || "").split(".");
  if (!ts || !mac || !/^\d+$/.test(ts)) return "bad";
  const want = crypto.createHmac("sha256", "ticket:" + TICKET_KEY).update(ts).digest("hex").slice(0, 32);
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return "bad";
  const age = now - Number(ts);
  if (age > TICKET_HOURS * 3600 * 1000 || age < -60 * 1000) return "bad";
  return age < LIMITS.BOOK_MIN_SECONDS * 1000 ? "fast" : "ok";
}

// The address the request came from. Railway's proxy sets X-Real-IP; the
// first X-Forwarded-For entry is whatever the client chose to send, so it is
// the last one, the hop the proxy added, that is trusted.
function clientIp(req) {
  const real = String(req.headers["x-real-ip"] || "").trim();
  if (real) return real.slice(0, 64);
  const hops = String(req.headers["x-forwarded-for"] || "").split(",").map(x => x.trim()).filter(Boolean);
  return (hops.length ? hops[hops.length - 1] : req.socket.remoteAddress || "").slice(0, 64);
}

// null when the booking may go ahead, or the refusal to send.
async function bookingRefusal(req, b, email, phone) {
  const say = (why, error, status = 429) => {
    console.log(`[ez-shots] booking refused (${why}) from ${clientIp(req)} for ${email}`);
    return { status, error };
  };
  if (str(b.hp, 200)) return say("honeypot", "Sorry, the booking did not go through. Email angelobrown1000@gmail.com and I will book you in.", 400);
  const t = ticketAge(b.ticket);
  if (t === "bad") return say("no ticket", "This page has been open too long. Refresh it and book again, your choices only take a moment.", 400);
  if (t === "fast") return say("too fast", "That was quicker than a person can book. Wait a few seconds and press Book again.", 400);
  const p = await db.bookingPressure(clientIp(req), email, phone);
  const email_ = "Email angelobrown1000@gmail.com and I will book you in myself.";
  if (p.upcoming >= LIMITS.BOOK_PER_CLIENT) return say("client", `You already have ${p.upcoming} shoots coming up, which is the most the site books at once. ${email_}`);
  if (p.byIp >= LIMITS.BOOK_PER_IP) return say("address", `That is a lot of bookings from one place today. ${email_}`);
  if (p.total >= LIMITS.BOOK_PER_DAY) return say("total", `Online booking is full for today. ${email_}`);
  return null;
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

  const date = str(b.date, 10);
  const time = avail.normalize(b.time);
  const name = str(b.name, 120), email = str(b.email, 200), phone = str(b.phone, 40), address = str(b.address, 300);
  if (!avail.isKey(date) || !time) return json(res, 400, { error: "Pick a day and a time." });
  if (name.length < 2) return json(res, 400, { error: "Please enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: "That email address does not look right. Please check it." });
  if (phone.replace(/\D/g, "").length < 7) return json(res, 400, { error: "Please enter a mobile number I can text." });
  if (address.length < 6) return json(res, 400, { error: "Please enter the property address." });

  const now = new Date();
  const done = x => json(res, 200, { id: x.id, token: x.token, url: "/booked?t=" + x.token, mode: "booked" });

  // A double tap, or a retry after the network dropped the first answer: the
  // same person asking for the same booking gets the one they already have,
  // not "that time was just booked" because of their own booking.
  const r = b.resume && typeof b.resume === "object" ? b.resume : null;
  if (r && r.id && r.token) {
    const old = await db.find(str(r.id, 20));
    if (old && old.token === str(r.token, 64) && old.status !== "cancelled") {
      const same = old.date === date && old.time === time && old.packageId === pkg.id && old.address === address;
      if (same && old.status === "confirmed") return done(old);
      if (old.status === "held") await db.release(old.id, now);
    }
  }

  const refused = await bookingRefusal(req, b, email, phone);
  if (refused) return json(res, refused.status, { error: refused.error, limited: true });

  const taken = await takenNow(av, now);
  const verdict = avail.why(av, taken, date, time, now);
  if (verdict === "closed") return json(res, 409, { error: "That time is not open for booking. Pick another time.", taken: true });
  if (verdict !== "ok") return json(res, 409, { error: "That time was just booked. Pick another available time.", taken: true });

  const held = await db.hold({
    date, time, startsAt: avail.slotAt(date, time),
    packageId: pkg.id, packageName: pkg.name, firstShoot: first,
    amount: first ? pkg.firstPrice : pkg.price, listPrice: pkg.price,
    name, email, phone, brokerage: str(b.brokerage, 120), address,
    size: str(b.size, 60), occupancy: str(b.occupancy, 60), access: str(b.access, 60),
    accessNotes: str(b.accessNotes, 500), notes: str(b.notes, 2000),
    checkoutMode: "after", checkoutUrl: "", clientIp: clientIp(req)
  }, 60 * 1000, now);
  if (!held) return json(res, 409, { error: "That time was just booked. Pick another available time.", taken: true });

  let c;
  try {
    c = await db.update(held.id, { status: "confirmed", stage: "booked", expiresAt: null }, now);
  } catch (e) {
    // The unique index: someone confirmed this slot in the instant between.
    await db.release(held.id, now).catch(() => {});
    return json(res, 409, { error: "That time was just booked. Pick another available time.", taken: true });
  }
  console.log(`[ez-shots] ${c.id} booked from the site for ${date} ${time}, nothing paid`);
  notify(c);
  crm.report("booked", publicBooking(c));
  return done(c);
}

// The customer pressing Pay on their booking page, after seeing the photos.
// The server reads the amount off the booking, never from the browser.
async function pay(req, res, url) {
  if (!db) return json(res, 503, { error: "Payments are not switched on yet. Reply to your email and I will send an invoice." });
  const tok = url.searchParams.get("t") || "";
  const b = /^[a-f0-9]{32}$/.test(tok) ? await db.byToken(tok) : null;
  if (!b) return json(res, 404, { error: "That link does not match a booking." });
  if (b.paid) return json(res, 400, { error: "This one is already paid. Thank you." });
  if (b.status !== "confirmed") return json(res, 400, { error: "This booking is cancelled, so there is nothing to pay." });
  if (b.stage !== "ready") return json(res, 400, { error: "Nothing is due yet. You pay once your photos are ready." });

  if (!STRIPE_KEY) {
    // No secret key on the server: the package's payment link, and the owner
    // marks it paid by hand when Stripe tells him.
    const cfg = await readConfig();
    const pkg = cfg.packages.find(p => p.id === b.packageId) || {};
    const link = b.firstShoot ? pkg.checkoutFirst : pkg.checkoutFull;
    if (!link) return json(res, 503, { error: "Online payment is not set up yet. Reply to your email and I will send an invoice." });
    return json(res, 200, { url: link, mode: "link" });
  }

  const site = origin(req);
  const manageUrl = site + "/manage?t=" + b.token;
  const payload = {
    mode: "payment",
    success_url: manageUrl + "&paid={CHECKOUT_SESSION_ID}",
    cancel_url: manageUrl,
    client_reference_id: b.id,
    customer_email: b.email || undefined,
    customer_creation: "always",
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": Math.round(Number(b.amount) * 100),
    "line_items[0][price_data][product_data][name]": b.packageName + (b.firstShoot ? " (first shoot, half price)" : ""),
    "line_items[0][price_data][product_data][description]": [b.address, longDate(b.date)].join(", ").slice(0, 500),
    "payment_intent_data[receipt_email]": b.email || undefined,
    metadata: { booking_id: b.id, purpose: "pay", package: b.packageName, address: b.address.slice(0, 400), shoot_date: longDate(b.date) }
  };
  try {
    // Keyed on the booking and the minute, so a double tap is one session.
    const s = await stripe.createSession(STRIPE_KEY, payload, b.id + "-pay-" + Math.floor(Date.now() / 60000));
    await db.update(b.id, { stripeSessionId: s.id });
    return json(res, 200, { url: s.url, mode: "session" });
  } catch (e) {
    console.error(`[ez-shots] ${b.id} pay session failed:`, e.message);
    return json(res, 502, { error: "The payment page could not be opened. Try again in a minute, or reply to your email." });
  }
}

// Paid after the shoot: mark it, unlock the files, tell both sides. markPaid
// only answers the first caller, so a webhook sent twice, or the webhook and
// the success page together, deliver once.
async function paidAfter(b, payment, source) {
  const now = new Date();
  const c = await db.markPaid(b.id, payment, now);
  if (!c) return db.find(b.id);
  console.log(`[ez-shots] ${c.id} paid ${c.amount} by the ${source}, delivered`);
  tracker.reportPaid(db, c);
  crm.report("paid", publicBooking(c));
  after(email.toCustomer("delivered", publicBooking(c), SITE_URL), c.id, "delivered");
  after(email.toOwner("paid", publicBooking(c), SITE_URL), c.id, "paid alert");
  return c;
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
// Everything the customer can do without phoning anyone happens here: see
// where the job is, see the previews, pay, get the files, cancel before the
// shoot, or say they are not happy.
async function manage(req, res, url) {
  if (!db) return json(res, 404, { error: "No booking." });
  const tok = url.searchParams.get("t") || "";
  const b = /^[a-f0-9]{32}$/.test(tok) ? await db.byToken(tok) : null;
  if (!b) return json(res, 404, { error: "That link does not match a booking." });
  const now = new Date();
  const view = x => {
    const out = publicBooking(x);
    out.state = stateOf(x, now.getTime());
    out.canCancel = (out.state === "confirmed" || out.state === "held") && (x.stage || "booked") === "booked" && Date.parse(x.startsAt) > now.getTime();
    out.canPay = out.state === "confirmed" && x.stage === "ready" && !x.paid;
    out.canFlag = out.state === "confirmed" && (x.stage === "ready" || x.stage === "delivered" || x.stage === "shot") && !x.flaggedAt;
    // The watermark and reference photos can change until the photos are sent.
    out.canBrand = out.state === "confirmed" && ["booked", "shot"].includes(x.stage || "booked");
    return out;
  };
  const out = view(b);
  if (url.pathname.startsWith("/api/manage/") && !["/api/manage/cancel", "/api/manage/unhappy"].includes(url.pathname)) {
    return brand(req, res, url, b, out.canBrand);
  }
  if (req.method === "GET") return json(res, 200, { booking: Object.assign(out, await uploadsOf(b)) });
  if (req.method === "POST" && url.pathname === "/api/manage/cancel") {
    if (!out.canCancel) return json(res, 400, { error: "This booking can no longer be cancelled here. Reply to your confirmation email and I will sort it." });
    const c = await db.cancel(b.id, "customer", now);
    console.log(`[ez-shots] ${b.id} cancelled by the customer`);
    crm.reportCancelled(db, publicBooking(c), "customer");
    after(email.toOwner("cancelled", publicBooking(c), SITE_URL), c.id, "cancel alert");
    return json(res, 200, { booking: Object.assign(view(c), { state: "cancelled", canCancel: false }) });
  }
  if (req.method === "POST" && url.pathname === "/api/manage/unhappy") {
    if (!out.canFlag) return json(res, 400, { error: b.flaggedAt ? "I already have this, and I will be in touch." : "Reply to your email and tell me what is wrong." });
    const p = await body(req).catch(() => ({}));
    const reason = str(p.reason, 2000);
    const c = await db.update(b.id, { flaggedAt: now, flagReason: reason }, now);
    console.log(`[ez-shots] ${b.id} flagged unhappy by the customer`);
    crm.report("unhappy", publicBooking(c), { reason });
    after(email.toOwner("unhappy", publicBooking(c), SITE_URL, { reason }), c.id, "unhappy alert");
    return json(res, 200, { booking: view(c) });
  }
  return json(res, 405, { error: "No." });
}

// ---------------------------------------------------------------------------
// The client's brokerage watermark and reference photos
//
// Added from the manage page, before the photos are sent: a logo the owner
// puts on the photos if they ask for it, and example shots of the look they
// like. The bytes live in booking_files. Uploads are the raw image as the
// request body, sniffed here, because the browser's own content type is only
// a claim.
// ---------------------------------------------------------------------------
const UPLOAD_LIMIT = { watermark: 5 * 1024 * 1024, reference: 8 * 1024 * 1024 };
const MAX_REFERENCES = 12;
const SPOTS = ["bottom right", "bottom left", "top right", "top left", "center"];

function sniff(buf) {
  if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length > 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return "";
}

// What the manage page and admin show: file details without the bytes, each
// with the address it can be fetched from.
function fileView(f, href) { return f && Object.assign({}, f, { url: href(f.id) }); }

async function uploadsOf(b) {
  const of = (await db.filesFor([b]))(b);
  const href = id => "/api/manage/file?t=" + b.token + "&id=" + id;
  return { watermark: fileView(of.watermark, href), references: of.references.map(f => fileView(f, href)) };
}

function sendFile(res, f) {
  const ext = f.mime.split("/")[1].replace("jpeg", "jpg");
  return send(res, 200, f.data, {
    "content-type": f.mime,
    "content-disposition": `inline; filename="${(f.name || f.kind).replace(/[^\w. -]/g, "").replace(/\.[a-z]+$/i, "") || f.kind}.${ext}"`,
    "content-security-policy": "default-src 'none'; sandbox",
    "cache-control": "private, max-age=3600"
  });
}

async function brand(req, res, url, b, open) {
  const p = url.pathname;
  if (p === "/api/manage/file" && req.method === "GET") {
    const f = await db.file(Number(url.searchParams.get("id")) || 0);
    // Their own booking's files, or the watermark they added to an earlier one.
    const owner = f && f.bookingId !== b.id && f.kind === "watermark" ? await db.find(f.bookingId) : null;
    const theirs = f && (f.bookingId === b.id || (owner && String(owner.email).toLowerCase() === String(b.email).toLowerCase()));
    return theirs ? sendFile(res, f) : send(res, 404, "Not found", { "content-type": "text/plain" });
  }
  if (req.method !== "POST") return json(res, 405, { error: "No." });
  if (!open) return json(res, 400, { error: "Your photos are already done, so this cannot change now. Reply to your email if something is wrong." });

  if (p === "/api/manage/upload") {
    const kind = url.searchParams.get("kind");
    if (!UPLOAD_LIMIT[kind]) return json(res, 400, { error: "Unknown upload." });
    const buf = await raw(req, UPLOAD_LIMIT[kind]).catch(() => null);
    if (!buf) return json(res, 413, { error: `That file is too big. Keep it under ${UPLOAD_LIMIT[kind] / 1024 / 1024} MB.` });
    const mime = sniff(buf);
    if (!mime) return json(res, 400, { error: "That is not a PNG, JPG or WebP image. A PNG with a see through background works best for a logo." });
    if (kind === "reference" && (await uploadsOf(b)).references.length >= MAX_REFERENCES) {
      return json(res, 400, { error: `That is the most I can take, ${MAX_REFERENCES} photos. Remove one to add another, or paste links in the box below.` });
    }
    await db.addFile(b.id, kind, str(url.searchParams.get("name"), 120), mime, buf);
    console.log(`[ez-shots] ${b.id} ${kind} added by the customer`);
    // A logo on file is a logo they want on the photos, unless they untick it.
    const c = kind === "watermark" && !b.watermarkWanted ? await db.update(b.id, { watermarkWanted: true, watermarkSpot: b.watermarkSpot || SPOTS[0] }) : b;
    return json(res, 200, { booking: Object.assign(publicBooking(c), await uploadsOf(c)) });
  }
  if (p === "/api/manage/remove") {
    const x = await body(req).catch(() => ({}));
    if (!await db.deleteFile(b.id, Number(x.id) || 0)) return json(res, 404, { error: "That file is already gone." });
    return json(res, 200, { booking: Object.assign(publicBooking(b), await uploadsOf(b)) });
  }
  if (p === "/api/manage/brand") {
    const x = await body(req).catch(() => ({}));
    const c = await db.update(b.id, {
      watermarkWanted: !!x.wantWatermark,
      watermarkSpot: SPOTS.includes(x.watermarkSpot) ? x.watermarkSpot : SPOTS[0],
      referenceNotes: str(x.referenceNotes, 4000)
    });
    return json(res, 200, { booking: Object.assign(publicBooking(c), await uploadsOf(c)) });
  }
  return json(res, 404, { error: "No such endpoint." });
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
    "DESCRIPTION:" + esc(b.packageName + ". Booking " + b.id + ". Manage: " + origin(req) + "/manage?t=" + b.token),
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
  if (recorded) {
    console.log(`[ez-shots] ${b.id} refunded ${dollars(cents)} by ${by}, ${r.id}`);
    tracker.reportRefund(b, r.id, cents);
  }
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
  const rows = await db.list(from, to);
  const filesOf = await db.filesFor(rows);
  const href = id => "/api/admin/files/" + id;
  const list = rows.map(b => {
    const f = filesOf(b);
    return Object.assign(adminView(b, now), {
      clientBookings: counts.get(String(b.email || "").toLowerCase()) || 0,
      watermark: fileView(f.watermark, href),
      references: f.references.map(x => fileView(x, href))
    });
  });

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
    // Photos sent and not paid yet: the money the owner is waiting on.
    unpaid: list.filter(b => b.state === "confirmed" && b.stage === "ready" && !b.paid).length,
    flagged: list.filter(b => b.state === "confirmed" && b.flaggedAt).length,
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
// straight away: paid if he says it is, otherwise booked with payment due
// after the shoot like every site booking. Any real time works, the public
// schedule does not apply to him. The client gets the You are booked email
// when he ticks the box.
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
  crm.report("booked", publicBooking(b));
  if (paid) crm.report("paid", publicBooking(b));
  let emailed = false;
  if (p.notify === true && mail) { emailed = email.configured(); notify(b); }
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
        // Paid outside the site checkout: cash, Zelle, a payment link. Once
        // the photos are out that is the same as a payment landing: delivered,
        // and the files link goes out. Paid ahead of the photos, it is only
        // recorded, and the files go when he sends them.
        if (b.stage === "ready") {
          out = await paidAfter(b, { checkoutMode: b.checkoutMode || "manual" }, "owner");
          extra.emailed = !!(out.email && email.configured());
        } else {
          out = await db.update(b.id, { paid: true, paidAt: now, checkoutMode: b.checkoutMode || "manual" }, now);
          tracker.reportPaid(db, out);
          crm.report("paid", publicBooking(out));
        }
      } else {
        const other = await db.clash(b.date, b.time, b.id, now);
        if (other) return json(res, 409, { error: `That slot has since gone to ${other}. Cancel that one first, or reschedule this booking.` });
        out = await db.confirm(b.id, { checkoutMode: b.checkoutMode || "manual" }, now);
        tracker.reportPaid(db, out);
        crm.report("booked", publicBooking(out));
        crm.report("paid", publicBooking(out));
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
      crm.report("moved", publicBooking(out));
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
      if (done.cancelled) crm.reportCancelled(db, publicBooking(out), "owner");
    } else if (p.action === "shot") {
      // Shoot done. The customer hears that editing has started and when to
      // expect the photos, so nobody is left wondering after the car drives off.
      if (b.status !== "confirmed") return json(res, 400, { error: "Only a booked shoot can be marked done." });
      out = await db.update(b.id, { stage: b.stage === "booked" ? "shot" : b.stage, shotAt: b.shotAt || now }, now);
      if (b.stage === "booked") crm.report("shot", publicBooking(out));
      extra.emailed = false;
      if (p.notify !== false && out.email && !out.flaggedAt) {
        extra.emailed = email.configured();
        after(email.toCustomer("shot", publicBooking(out), SITE_URL), out.id, "shoot done");
      }
    } else if (p.action === "ready") {
      // Previews out, payment due. Both links are kept; only the preview one
      // is ever shown before the booking is paid.
      if (b.status !== "confirmed") return json(res, 400, { error: "This booking is cancelled." });
      const preview = str(p.previewUrl, 1000), fin = str(p.finalUrl, 1000);
      if (!/^https:\/\/\S+$/i.test(preview)) return json(res, 400, { error: "Paste the preview gallery link, starting https://" });
      if (!/^https:\/\/\S+$/i.test(fin)) return json(res, 400, { error: "Paste the full resolution files link, starting https://" });
      if (preview === fin) return json(res, 400, { error: "The preview link and the files link are the same. The files link is what the payment unlocks, so it has to be a different one." });
      const patch = { previewUrl: preview, finalUrl: fin, shotAt: b.shotAt || now };
      if (!b.paid) Object.assign(patch, { stage: "ready", readyAt: b.readyAt || now });
      else Object.assign(patch, { stage: "delivered", deliveredAt: b.deliveredAt || now });
      out = await db.update(b.id, patch, now);
      if (!b.paid && b.stage !== "ready") crm.report("ready", publicBooking(out));
      extra.emailed = false;
      if (p.notify !== false && out.email && !out.flaggedAt) {
        extra.emailed = email.configured();
        after(email.toCustomer(out.paid ? "delivered" : "ready", publicBooking(out), SITE_URL), out.id, out.paid ? "delivered" : "photos ready");
      }
    } else if (p.action === "flag") {
      out = await db.update(b.id, { flaggedAt: b.flaggedAt || now, flagReason: str(p.reason, 2000) || b.flagReason || "Flagged by the owner" }, now);
    } else if (p.action === "unflag") {
      out = await db.update(b.id, { flaggedAt: null }, now);
    } else if (p.action === "cancel") {
      out = await db.cancel(b.id, "owner", now);
      if (b.status !== "cancelled") crm.reportCancelled(db, publicBooking(out), "owner");
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
    // ?all=1 drops look busy, for the owner's reschedule and new booking
    // pickers. It needs the admin cookie, so the public calendar cannot ask.
    const honest = url.searchParams.get("all") === "1" && authed(req);
    // The ticket the booking form hands back with the booking, see LIMITS.
    return json(res, 200, Object.assign(avail.calendar(cfg.availability, await takenNow(cfg.availability, now), now, honest), { ticket: ticket() }));
  }

  if (pathname === "/api/book" && req.method === "POST") return book(req, res);
  if (pathname === "/api/session" && req.method === "GET") return session(req, res, url);
  if (pathname === "/api/stripe/webhook" && req.method === "POST") return webhook(req, res);
  if (pathname === "/api/manage" || pathname.startsWith("/api/manage/")) return manage(req, res, url);
  if (pathname === "/api/pay" && req.method === "POST") return pay(req, res, url);
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
    const fm = /^\/api\/admin\/files\/(\d+)$/.exec(pathname);
    if (fm && req.method === "GET") {
      const f = db && await db.file(Number(fm[1]));
      return f ? sendFile(res, f) : send(res, 404, "Not found", { "content-type": "text/plain" });
    }
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
  return done(serveStatic(req, res, url.pathname, url.search));
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

// ---------------------------------------------------------------------------
// The clock: the day before reminder, and the review request a day after
// delivery. Every ten minutes, each email claimed in the database before it
// goes so a restart or a second instance cannot send it twice. A flagged job
// gets neither. The review only goes to a job that is paid, delivered and
// not refunded.
// ---------------------------------------------------------------------------
const REVIEW_URL = String(process.env.REVIEW_URL || "").trim();

async function tick() {
  if (!db || !email.configured()) return;
  const now = new Date();
  for (const b of await db.dueReminders(now)) {
    if (!(await db.claim(b.id, "reminded_at", now))) continue;
    const r = await email.toCustomer("reminder", publicBooking(b), SITE_URL);
    if (r.customer) console.log(`[ez-shots] ${b.id} reminder sent`);
    else { for (const e of r.errors) console.error(`[ez-shots] ${b.id} reminder failed, ${e}`); await db.unclaim(b.id, "reminded_at").catch(() => {}); }
  }
  for (const b of await db.dueReviews(now)) {
    if (!(await db.claim(b.id, "review_sent_at", now))) continue;
    const r = await email.toCustomer("review", publicBooking(b), SITE_URL, REVIEW_URL);
    if (r.customer) console.log(`[ez-shots] ${b.id} review request sent`);
    else { for (const e of r.errors) console.error(`[ez-shots] ${b.id} review request failed, ${e}`); await db.unclaim(b.id, "review_sent_at").catch(() => {}); }
  }
}
const TICK_MS = Math.max(5000, Number(process.env.TICK_MS) || 10 * 60 * 1000);
setInterval(() => tick().catch(e => console.error("[ez-shots] scheduled emails failed:", e.message)), TICK_MS).unref();

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
